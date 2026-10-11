import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  StatusBar as NativeStatusBar,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { OWNER_EMAIL, supabase } from './src/lib/supabase';

const C = {
  bg: '#07101A',
  bg2: '#0A1521',
  card: '#101E2C',
  card2: '#142536',
  line: 'rgba(255,255,255,0.11)',
  text: '#F6F0E5',
  muted: '#A5B1BE',
  soft: '#758392',
  gold: '#EFC36E',
  goldDark: '#D2A34E',
  green: '#9BE0B0',
  red: '#F28B8B',
};
const WHATSAPP = 'https://wa.me/919987268181';
const FAV_KEY = 'ss-properties-mobile-favourites';
const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1600607688969-a5bfcd646154?auto=format&fit=crop&w=1200&q=85';

type ListingType = 'buy' | 'rent' | 'commercial';
type Screen = 'home' | 'saved' | 'detail' | 'enquiry' | 'account' | 'owner';
type OwnerTab = 'enquiries' | 'properties';
type Property = {
  id: string;
  title: string;
  description: string | null;
  property_type: string;
  listing_type: string;
  price: number | null;
  price_display: string | null;
  location: string;
  area_sqft: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  image_url: string | null;
  images: string[];
  amenities: string[];
  status: string;
  featured: boolean;
  created_at?: string;
};
type Enquiry = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  purpose: string | null;
  property_type: string | null;
  property_id: string | null;
  message: string | null;
  status: string;
  created_at: string;
};
type Draft = {
  title: string;
  location: string;
  property_type: string;
  listing_type: ListingType;
  price: string;
  price_display: string;
  area_sqft: string;
  bedrooms: string;
  bathrooms: string;
  description: string;
  amenities: string;
  status: 'available' | 'unavailable';
  featured: boolean;
};
type EnquiryDraft = {
  name: string;
  phone: string;
  email: string;
  purpose: string;
  property_type: string;
  message: string;
};

const EMPTY_DRAFT: Draft = {
  title: '',
  location: '',
  property_type: 'Apartment',
  listing_type: 'buy',
  price: '',
  price_display: '',
  area_sqft: '',
  bedrooms: '',
  bathrooms: '',
  description: '',
  amenities: '',
  status: 'available',
  featured: false,
};
const EMPTY_ENQUIRY: EnquiryDraft = {
  name: '',
  phone: '',
  email: '',
  purpose: 'For Sale',
  property_type: 'Apartment',
  message: '',
};

function normalizeImages(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === 'string');
  } catch (_) {}
  const matches = value.match(/https?:\/\/[^\s,{}"']+/g);
  return matches ?? [];
}
function photoUrls(property: Partial<Property> | null | undefined): string[] {
  if (!property) return [];
  return Array.from(new Set([property.image_url, ...normalizeImages(property.images)].filter((url): url is string => Boolean(url))));
}
function priceLabel(property: Partial<Property>): string {
  if (property.price_display) return property.price_display;
  if (property.price === null || property.price === undefined || !Number.isFinite(Number(property.price))) return 'Price on request';
  return '₹ ' + Number(property.price).toLocaleString('en-IN');
}
function rupeeBudget(price: number | null, range: string, listingType: string): boolean {
  if (range === 'all') return true;
  if (price === null || !Number.isFinite(price)) return false;
  const isRent = listingType === 'rent';
  const low = isRent ? 25000 : 5000000;
  const high = isRent ? 75000 : 15000000;
  if (range === 'low') return price < low;
  if (range === 'mid') return price >= low && price < high;
  return price >= high;
}
function featureMatch(property: Property, feature: string): boolean {
  if (feature === 'all') return true;
  if (feature === '2bhk') return (property.bedrooms ?? 0) >= 2 || /(^|\s)[2-9]\s*(bhk|bed|beds|bedroom|bedrooms)\b/i.test(property.title);
  if (feature === '3bhk') return (property.bedrooms ?? 0) >= 3 || /(^|\s)[3-9]\s*(bhk|bed|beds|bedroom|bedrooms)\b/i.test(property.title);
  const text = [property.title, property.description ?? '', ...property.amenities].join(' ').toLowerCase();
  if (feature === 'parking') return /\bparking\b|\bcar park\b/.test(text);
  if (feature === 'furnished') return /\bfurnished\b/.test(text);
  return true;
}
function asNullableNumber(value: string): number | null {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function asNullableInteger(value: string): number | null {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}
function waPhone(value: string): string {
  let digits = value.replace(/\D/g, '');
  if (digits.length === 10) digits = '91' + digits;
  return digits;
}
function normalizeLocation(value: string): string {
  return value.toLowerCase().replace(/\(w\)/g, ' west').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function safeFileName(value: string): string {
  return value.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-80) || 'property-photo.jpg';
}
function cleanError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message);
  return String(error ?? 'Something went wrong.');
}

function Pill({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.pill, active && styles.pillActive]} accessibilityRole="button">
      <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
    </Pressable>
  );
}
function ActionButton({ label, onPress, secondary, danger, disabled }: { label: string; onPress: () => void; secondary?: boolean; danger?: boolean; disabled?: boolean }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[styles.actionButton, secondary && styles.actionSecondary, danger && styles.actionDanger, disabled && styles.disabled]} accessibilityRole="button">
      <Text style={[styles.actionText, secondary && styles.actionSecondaryText, danger && styles.actionDangerText]}>{label}</Text>
    </Pressable>
  );
}
function Field({ label, value, onChangeText, placeholder, multiline, keyboardType, secureTextEntry, autoCapitalize }: {
  label: string; value: string; onChangeText: (value: string) => void; placeholder?: string;
  multiline?: boolean; keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'numeric' | 'decimal-pad'; secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? label}
        placeholderTextColor={C.soft}
        multiline={multiline}
        keyboardType={keyboardType ?? 'default'}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize ?? 'sentences'}
        textAlignVertical={multiline ? 'top' : 'center'}
      />
    </View>
  );
}
function PropertyCard({ property, saved, onOpen, onToggleSaved }: {
  property: Property; saved: boolean; onOpen: () => void; onToggleSaved: () => void;
}) {
  const photos = photoUrls(property);
  const image = photos[0] || FALLBACK_IMAGE;
  return (
    <View style={styles.propertyCard}>
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={'View ' + property.title}>
        <View style={styles.cardImageWrap}>
          <Image source={{ uri: image }} style={styles.cardImage} />
          <View style={styles.imageBadge}>
            <Text style={styles.imageBadgeText}>{property.listing_type === 'rent' ? 'FOR RENT' : property.listing_type === 'commercial' ? 'COMMERCIAL' : 'FOR SALE'}</Text>
          </View>
          {property.featured ? <View style={styles.featuredBadge}><Text style={styles.featuredText}>FEATURED</Text></View> : null}
          {photos.length > 1 ? <View style={styles.photoCount}><Text style={styles.photoCountText}>{photos.length} photos</Text></View> : null}
        </View>
      </Pressable>
      <View style={styles.cardBody}>
        <View style={styles.cardTitleRow}>
          <View style={styles.cardTitleColumn}>
            <Text style={styles.kicker}>{property.property_type || 'Property'}</Text>
            <Text style={styles.cardTitle}>{property.title}</Text>
            <Text style={styles.locationText}>⌖  {property.location}</Text>
          </View>
          <Pressable onPress={onToggleSaved} style={styles.heartButton} accessibilityRole="button" accessibilityLabel={saved ? 'Remove from saved properties' : 'Save property'}>
            <Text style={[styles.heart, saved && styles.heartActive]}>{saved ? '♥' : '♡'}</Text>
          </Pressable>
        </View>
        <Text style={styles.priceText}>{priceLabel(property)}</Text>
        <View style={styles.metaRow}>
          {property.bedrooms !== null ? <Text style={styles.metaText}>{property.bedrooms} BHK</Text> : null}
          {property.bathrooms !== null ? <Text style={styles.metaText}>{property.bathrooms} baths</Text> : null}
          {property.area_sqft !== null ? <Text style={styles.metaText}>{Number(property.area_sqft).toLocaleString('en-IN')} sq ft</Text> : null}
        </View>
        <ActionButton label="View full details  →" onPress={onOpen} secondary />
      </View>
    </View>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [session, setSession] = useState<Session | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [ownerProperties, setOwnerProperties] = useState<Property[]>([]);
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [loadingProperties, setLoadingProperties] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [globalError, setGlobalError] = useState('');
  const [ownerTab, setOwnerTab] = useState<OwnerTab>('enquiries');
  const [searchText, setSearchText] = useState('');
  const [purposeFilter, setPurposeFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [budgetFilter, setBudgetFilter] = useState('all');
  const [featureFilter, setFeatureFilter] = useState('all');
  const [enquiryProperty, setEnquiryProperty] = useState<Property | null>(null);
  const [enquiryDraft, setEnquiryDraft] = useState<EnquiryDraft>(EMPTY_ENQUIRY);
  const [loginEmail, setLoginEmail] = useState(OWNER_EMAIL);
  const [loginPassword, setLoginPassword] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [propertyFormOpen, setPropertyFormOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const scrollRef = useRef<ScrollView | null>(null);
  const [existingPhotos, setExistingPhotos] = useState<string[]>([]);
  const [removedPhotos, setRemovedPhotos] = useState<string[]>([]);
  const [newPhotos, setNewPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [formBusy, setFormBusy] = useState(false);

  const isOwner = session?.user?.email?.toLowerCase() === OWNER_EMAIL;
  const availableLocations = useMemo(
    () => Array.from(new Map(properties.map((p) => [normalizeLocation(p.location), p.location] as const)).values()).filter(Boolean).sort(),
    [properties],
  );

  const loadProperties = useCallback(async () => {
    const { data, error } = await supabase
      .from('properties')
      .select('id,title,description,property_type,listing_type,price,price_display,location,area_sqft,bedrooms,bathrooms,image_url,images,amenities,status,featured,created_at')
      .eq('status', 'available')
      .order('featured', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    const rows = (data ?? []).map((row) => ({
      ...row,
      images: normalizeImages(row.images),
      amenities: Array.isArray(row.amenities) ? row.amenities.filter((item: unknown): item is string => typeof item === 'string') : [],
    })) as Property[];
    setProperties(rows);
  }, []);

  const loadOwnerProperties = useCallback(async () => {
    const { data, error } = await supabase
      .from('properties')
      .select('id,title,description,property_type,listing_type,price,price_display,location,area_sqft,bedrooms,bathrooms,image_url,images,amenities,status,featured,created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    setOwnerProperties((data ?? []).map((row) => ({
      ...row,
      images: normalizeImages(row.images),
      amenities: Array.isArray(row.amenities) ? row.amenities.filter((item: unknown): item is string => typeof item === 'string') : [],
    })) as Property[]);
  }, []);

  const loadEnquiries = useCallback(async () => {
    const { data, error } = await supabase
      .from('enquiries')
      .select('id,name,phone,email,purpose,property_type,property_id,message,status,created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    setEnquiries((data ?? []) as Enquiry[]);
  }, []);

  const refreshCurrent = useCallback(async () => {
    setRefreshing(true);
    setGlobalError('');
    try {
      await loadProperties();
      if (isOwner && screen === 'owner') {
        if (ownerTab === 'enquiries') await loadEnquiries();
        else await loadOwnerProperties();
      }
    } catch (error) {
      setGlobalError(cleanError(error));
    } finally {
      setRefreshing(false);
      setLoadingProperties(false);
    }
  }, [isOwner, screen, ownerTab, loadEnquiries, loadOwnerProperties, loadProperties]);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setGlobalError(error.message);
      setSession(data.session);
    });
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    AsyncStorage.getItem(FAV_KEY)
      .then((value) => {
        if (!active || !value) return;
        const parsed: unknown = JSON.parse(value);
        if (Array.isArray(parsed)) setSavedIds(parsed.filter((item): item is string => typeof item === 'string'));
      })
      .catch(() => undefined);
    loadProperties()
      .catch((error) => setGlobalError(cleanError(error)))
      .finally(() => {
        if (active) setLoadingProperties(false);
      });
    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [loadProperties]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [screen, selectedProperty, ownerTab]);

  useEffect(() => {
    if (!isOwner || screen !== 'owner') return;
    if (ownerTab === 'enquiries') loadEnquiries().catch((error) => setGlobalError(cleanError(error)));
    else loadOwnerProperties().catch((error) => setGlobalError(cleanError(error)));
  }, [isOwner, screen, ownerTab, loadEnquiries, loadOwnerProperties]);

  const filteredProperties = useMemo(() => {
    return properties.filter((property) => {
      const query = normalizeLocation(searchText);
      const haystack = normalizeLocation([property.title, property.location, property.property_type, property.description ?? '', ...property.amenities].join(' '));
      const matchesQuery = !query || haystack.includes(query);
      const purpose = purposeFilter === 'all' ||
        (purposeFilter === 'commercial'
          ? property.listing_type === 'commercial' || property.property_type.toLowerCase().includes('commercial')
          : property.listing_type === purposeFilter);
      const type = typeFilter === 'all' || (
        typeFilter === 'apartment' ? /apartment|flat/.test(property.property_type.toLowerCase()) :
        typeFilter === 'villa' ? /villa|house|bungalow|independent/.test(property.property_type.toLowerCase()) :
        typeFilter === 'plot' ? /plot|land/.test(property.property_type.toLowerCase()) :
        typeFilter === 'commercial' ? /commercial|office|shop|warehouse/.test(property.property_type.toLowerCase()) :
        typeFilter === 'other' ? !/apartment|flat|villa|house|bungalow|independent|plot|land|commercial|office|shop|warehouse/.test(property.property_type.toLowerCase()) : true
      );
      const locationKey = normalizeLocation(locationFilter);
      const matchesLocation = locationFilter === 'all' || normalizeLocation(property.location) === locationKey;
      return matchesQuery && purpose && type && matchesLocation && rupeeBudget(property.price, budgetFilter, property.listing_type) && featureMatch(property, featureFilter);
    });
  }, [properties, searchText, purposeFilter, typeFilter, locationFilter, budgetFilter, featureFilter]);

  const updateFavourite = async (property: Property) => {
    const id = property.id;
    const next = savedIds.includes(id) ? savedIds.filter((item) => item !== id) : [...savedIds, id];
    setSavedIds(next);
    try {
      await AsyncStorage.setItem(FAV_KEY, JSON.stringify(next));
    } catch (_) {
      Alert.alert('Saved for this session', 'Storage was unavailable, so this favourite may not persist after closing the app.');
    }
  };

  const startEnquiry = (property: Property | null) => {
    setEnquiryProperty(property);
    setEnquiryDraft({
      ...EMPTY_ENQUIRY,
      purpose: property?.listing_type === 'rent' ? 'For Rent' : property?.listing_type === 'commercial' ? 'Commercial' : 'For Sale',
      property_type: property?.property_type || 'Apartment',
      message: property ? 'I am interested in ' + property.title + ' in ' + property.location + '. Please share more details.' : '',
    });
    setScreen('enquiry');
  };

  const submitEnquiry = async () => {
    if (!enquiryDraft.name.trim() || !enquiryDraft.phone.trim()) {
      Alert.alert('Missing details', 'Please enter your name and phone number.');
      return;
    }
    setFormBusy(true);
    try {
      const { error } = await supabase.from('enquiries').insert({
        name: enquiryDraft.name.trim(),
        phone: enquiryDraft.phone.trim(),
        email: enquiryDraft.email.trim() || null,
        purpose: enquiryDraft.purpose,
        property_type: enquiryDraft.property_type,
        property_id: enquiryProperty?.id ?? null,
        message: enquiryDraft.message.trim() || null,
        status: 'new',
      });
      if (error) throw error;
      Alert.alert('Enquiry sent', 'Thank you. SS Properties will get back to you soon.');
      setEnquiryDraft(EMPTY_ENQUIRY);
      setEnquiryProperty(null);
      setScreen('home');
    } catch (error) {
      Alert.alert('Could not send enquiry', cleanError(error) + '\n\nYou can still reach us on WhatsApp or by phone.');
    } finally {
      setFormBusy(false);
    }
  };

  const doOwnerLogin = async () => {
    if (!loginEmail.trim() || !loginPassword) {
      Alert.alert('Enter your credentials', 'Please enter the owner email and password.');
      return;
    }
    setLoginBusy(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginEmail.trim(),
        password: loginPassword,
      });
      if (error) throw error;
      if (data.user.email?.toLowerCase() !== OWNER_EMAIL) {
        await supabase.auth.signOut();
        throw new Error('This account is not authorised for the SS Properties owner dashboard.');
      }
      setSession(data.session);
      setLoginPassword('');
      setOwnerTab('enquiries');
      setScreen('owner');
    } catch (error) {
      Alert.alert('Owner sign-in failed', cleanError(error));
    } finally {
      setLoginBusy(false);
    }
  };

  const ownerSignOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setScreen('home');
    setOwnerProperties([]);
    setEnquiries([]);
  };

  const beginAddProperty = () => {
    setEditingId(null);
    setPropertyFormOpen(true);
    setDraft({ ...EMPTY_DRAFT });
    setExistingPhotos([]);
    setRemovedPhotos([]);
    setNewPhotos([]);
    setGlobalError('');
  };
  const beginEditProperty = (property: Property) => {
    setEditingId(property.id);
    setPropertyFormOpen(true);
    setDraft({
      title: property.title ?? '',
      location: property.location ?? '',
      property_type: property.property_type ?? 'Apartment',
      listing_type: property.listing_type === 'rent' || property.listing_type === 'commercial' ? property.listing_type : 'buy',
      price: property.price === null ? '' : String(property.price),
      price_display: property.price_display ?? '',
      area_sqft: property.area_sqft === null ? '' : String(property.area_sqft),
      bedrooms: property.bedrooms === null ? '' : String(property.bedrooms),
      bathrooms: property.bathrooms === null ? '' : String(property.bathrooms),
      description: property.description ?? '',
      amenities: property.amenities.join(', '),
      status: property.status === 'unavailable' ? 'unavailable' : 'available',
      featured: Boolean(property.featured),
    });
    setExistingPhotos(photoUrls(property));
    setRemovedPhotos([]);
    setNewPhotos([]);
    setGlobalError('');
  };
  const setDraftValue = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
  };

  const pickPhotos = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 12,
        quality: 0.85,
      });
      if (!result.canceled) {
        setNewPhotos((previous) => [...previous, ...result.assets].slice(0, 12));
      }
    } catch (error) {
      Alert.alert('Photo picker failed', cleanError(error));
    }
  };

  const storagePathFromUrl = (url: string): string => {
    try {
      const parsed = new URL(url);
      const marker = '/storage/v1/object/public/property-images/';
      const index = parsed.pathname.indexOf(marker);
      return index < 0 ? '' : decodeURIComponent(parsed.pathname.slice(index + marker.length));
    } catch (_) {
      return '';
    }
  };

  const cleanupUnusedPhotos = async (urls: string[], currentPropertyId: string): Promise<boolean> => {
    const candidates = urls
      .map((url) => ({ url, path: storagePathFromUrl(url) }))
      .filter((item) => Boolean(item.path));
    if (!candidates.length) return false;
    const { data: otherProperties, error } = await supabase
      .from('properties')
      .select('id,image_url,images')
      .neq('id', currentPropertyId);
    if (error) return true;
    const referenced = new Set<string>();
    (otherProperties ?? []).forEach((property) => {
      if (property.image_url) referenced.add(property.image_url);
      normalizeImages(property.images).forEach((url) => referenced.add(url));
    });
    const paths = candidates.filter((item) => !referenced.has(item.url)).map((item) => item.path);
    if (!paths.length) return false;
    const { error: removeError } = await supabase.storage.from('property-images').remove(paths);
    return Boolean(removeError);
  };

  const saveProperty = async () => {
    if (!isOwner) {
      Alert.alert('Not authorised', 'Sign in with the business owner account first.');
      return;
    }
    if (!draft.title.trim() || !draft.location.trim() || !draft.property_type.trim()) {
      Alert.alert('Required fields', 'Title, location and property type are required.');
      return;
    }
    const tooLarge = newPhotos.find((asset) => typeof asset.fileSize === 'number' && asset.fileSize > 10 * 1024 * 1024);
    if (tooLarge) {
      Alert.alert('Photo too large', 'Each photo must be 10 MB or smaller. Remove the oversized image and try again.');
      return;
    }
    const payload = {
      title: draft.title.trim(),
      location: draft.location.trim(),
      property_type: draft.property_type.trim(),
      listing_type: draft.listing_type,
      price: asNullableNumber(draft.price),
      price_display: draft.price_display.trim() || null,
      area_sqft: asNullableInteger(draft.area_sqft),
      bedrooms: asNullableInteger(draft.bedrooms),
      bathrooms: asNullableInteger(draft.bathrooms),
      description: draft.description.trim() || null,
      amenities: draft.amenities.split(',').map((item) => item.trim()).filter(Boolean),
      featured: draft.featured,
    };
    setFormBusy(true);
    setGlobalError('');
    try {
      let propertyId = editingId;
      if (!propertyId) {
        const { data, error } = await supabase
          .from('properties')
          .insert({ ...payload, status: 'unavailable', image_url: null, images: [] })
          .select('id')
          .single();
        if (error) throw error;
        propertyId = data.id as string;
      }

      const uploadedUrls: string[] = [];
      for (const asset of newPhotos) {
        const filename = safeFileName(asset.fileName || 'property-photo.jpg');
        const path = 'properties/' + propertyId + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + filename;
        const response = await fetch(asset.uri);
        const bytes = await response.arrayBuffer();
        const contentType = asset.mimeType || 'image/jpeg';
        const { error: uploadError } = await supabase.storage.from('property-images').upload(path, bytes, {
          cacheControl: '3600',
          upsert: false,
          contentType,
        });
        if (uploadError) throw uploadError;
        const { data: publicData } = supabase.storage.from('property-images').getPublicUrl(path);
        uploadedUrls.push(publicData.publicUrl);
      }

      const allPhotos = Array.from(new Set([
        ...existingPhotos.filter((url) => !removedPhotos.includes(url)),
        ...uploadedUrls,
      ]));
      const { error: updateError } = await supabase.from('properties').update({
        ...payload,
        status: draft.status,
        images: allPhotos,
        image_url: allPhotos[0] ?? null,
        updated_at: new Date().toISOString(),
      }).eq('id', propertyId);
      if (updateError) throw updateError;

      let cleanupWarning = false;
      if (editingId && removedPhotos.length) {
        cleanupWarning = await cleanupUnusedPhotos(removedPhotos, propertyId);
      }
      Alert.alert('Property saved', 'Saved ' + allPhotos.length + ' photo(s) for ' + payload.title + '.' + (cleanupWarning ? '\n\nSome unused photo files may remain in storage.' : ''));
      setEditingId(null);
      setPropertyFormOpen(false);
      setExistingPhotos([]);
      setRemovedPhotos([]);
      setNewPhotos([]);
      setDraft({ ...EMPTY_DRAFT });
      await loadOwnerProperties();
      await loadProperties();
    } catch (error) {
      Alert.alert('Could not save property', cleanError(error) + '\n\nIf a new listing was started, it may remain hidden as unavailable until you reopen and save it.');
    } finally {
      setFormBusy(false);
    }
  };

  const togglePropertyStatus = async (property: Property) => {
    if (!isOwner) return;
    const newStatus = property.status === 'available' ? 'unavailable' : 'available';
    try {
      const { error } = await supabase.from('properties').update({
        status: newStatus,
        updated_at: new Date().toISOString(),
      }).eq('id', property.id);
      if (error) throw error;
      await loadOwnerProperties();
      await loadProperties();
    } catch (error) {
      Alert.alert('Could not update listing', cleanError(error));
    }
  };

  const deleteProperty = (property: Property) => {
    Alert.alert(
      'Delete property?',
      'Permanently delete "' + property.title + '"? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase.from('properties').delete().eq('id', property.id);
              if (error) throw error;
              const warning = await cleanupUnusedPhotos(photoUrls(property), property.id);
              await loadOwnerProperties();
              await loadProperties();
              Alert.alert('Property deleted', warning ? 'The listing was deleted, but some unused photo files may remain in storage.' : 'The listing was deleted.');
            } catch (error) {
              Alert.alert('Could not delete property', cleanError(error));
            }
          },
        },
      ],
    );
  };

  const updateEnquiryStatus = async (enquiry: Enquiry, status: string) => {
    try {
      const { error } = await supabase.from('enquiries').update({ status }).eq('id', enquiry.id);
      if (error) throw error;
      await loadEnquiries();
    } catch (error) {
      Alert.alert('Could not update enquiry', cleanError(error));
    }
  };

  const deleteEnquiry = (enquiry: Enquiry) => {
    Alert.alert(
      'Delete enquiry?',
      'Permanently delete the enquiry from ' + enquiry.name + '? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase.from('enquiries').delete().eq('id', enquiry.id);
              if (error) throw error;
              await loadEnquiries();
            } catch (error) {
              Alert.alert('Could not delete enquiry', cleanError(error) + '\n\nConfirm the admin-only DELETE policy is enabled in Supabase.');
            }
          },
        },
      ],
    );
  };

  const openWhatsApp = async (property?: Property | null) => {
    const message = property
      ? 'Hi SS Properties, I am interested in ' + property.title + ' in ' + property.location + '. Please share more details.'
      : 'Hi SS Properties, I would like to know about your available properties.';
    try {
      await Linking.openURL(WHATSAPP + '?text=' + encodeURIComponent(message));
    } catch (_) {
      Alert.alert('Could not open WhatsApp', 'Please call +91 99872 68181.');
    }
  };
  const openCall = async () => {
    try { await Linking.openURL('tel:+919987268181'); }
    catch (_) { Alert.alert('Call SS Properties', '+91 99872 68181'); }
  };

  const renderPropertyForm = () => (
    <View style={styles.formCard}>
      <SectionTitle title={editingId ? 'Edit listing' : 'New listing'} subtitle="Photos and listing details sync to your existing Supabase website." />
      <Field label="Property title *" value={draft.title} onChangeText={(value) => setDraftValue('title', value)} placeholder="e.g. 2 BHK Apartment" />
      <Field label="Location *" value={draft.location} onChangeText={(value) => setDraftValue('location', value)} placeholder="e.g. Thane West" />
      <Field label="Property type *" value={draft.property_type} onChangeText={(value) => setDraftValue('property_type', value)} placeholder="Apartment, Office, Plot…" />
      <Text style={styles.fieldLabel}>Listing type</Text>
      <View style={styles.wrapRow}>
        <Pill label="Buy / Sale" active={draft.listing_type === 'buy'} onPress={() => setDraftValue('listing_type', 'buy')} />
        <Pill label="Rent" active={draft.listing_type === 'rent'} onPress={() => setDraftValue('listing_type', 'rent')} />
        <Pill label="Commercial" active={draft.listing_type === 'commercial'} onPress={() => setDraftValue('listing_type', 'commercial')} />
      </View>
      <View style={styles.twoColumns}>
        <View style={styles.column}><Field label="Price (numeric)" value={draft.price} onChangeText={(value) => setDraftValue('price', value)} keyboardType="decimal-pad" placeholder="e.g. 8500000" /></View>
        <View style={styles.column}><Field label="Displayed price" value={draft.price_display} onChangeText={(value) => setDraftValue('price_display', value)} placeholder="₹85 L" /></View>
        <View style={styles.column}><Field label="Area (sq ft)" value={draft.area_sqft} onChangeText={(value) => setDraftValue('area_sqft', value)} keyboardType="numeric" placeholder="950" /></View>
        <View style={styles.column}><Field label="Bedrooms / BHK" value={draft.bedrooms} onChangeText={(value) => setDraftValue('bedrooms', value)} keyboardType="numeric" placeholder="2" /></View>
        <View style={styles.column}><Field label="Bathrooms" value={draft.bathrooms} onChangeText={(value) => setDraftValue('bathrooms', value)} keyboardType="numeric" placeholder="2" /></View>
      </View>
      <Field label="Description" value={draft.description} onChangeText={(value) => setDraftValue('description', value)} placeholder="Describe the property…" multiline />
      <Field label="Facilities / amenities (comma-separated)" value={draft.amenities} onChangeText={(value) => setDraftValue('amenities', value)} placeholder="Lift, Parking, Security, Gym" multiline />
      <Text style={styles.fieldLabel}>Availability</Text>
      <View style={styles.wrapRow}>
        <Pill label="Available publicly" active={draft.status === 'available'} onPress={() => setDraftValue('status', 'available')} />
        <Pill label="Hidden / unavailable" active={draft.status === 'unavailable'} onPress={() => setDraftValue('status', 'unavailable')} />
      </View>
      <Pill label={draft.featured ? '★ Featured on website' : '☆ Feature on website'} active={draft.featured} onPress={() => setDraftValue('featured', !draft.featured)} />
      <Text style={styles.sectionLabel}>Existing photos</Text>
      {existingPhotos.length ? (
        <View style={styles.photoGrid}>
          {existingPhotos.map((url) => {
            const removed = removedPhotos.includes(url);
            return (
              <View key={url} style={[styles.photoTile, removed && styles.photoTileRemoved]}>
                <Image source={{ uri: url }} style={styles.photoThumb} />
                <Pressable onPress={() => setRemovedPhotos((previous) => removed ? previous.filter((item) => item !== url) : [...previous, url])} style={[styles.photoAction, removed && styles.photoActionKeep]}>
                  <Text style={styles.photoActionText}>{removed ? 'Keep' : 'Remove'}</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : <Text style={styles.helperText}>No existing photos yet.</Text>}
      <Text style={styles.sectionLabel}>New photos</Text>
      {newPhotos.length ? (
        <View style={styles.photoGrid}>
          {newPhotos.map((asset, index) => (
            <View key={asset.assetId ?? asset.uri + index} style={styles.photoTile}>
              <Image source={{ uri: asset.uri }} style={styles.photoThumb} />
              <Pressable onPress={() => setNewPhotos((previous) => previous.filter((_, i) => i !== index))} style={styles.photoAction}>
                <Text style={styles.photoActionText}>Remove</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : <Text style={styles.helperText}>Choose one or more photos from this device.</Text>}
      <ActionButton label="＋ Choose photos" onPress={pickPhotos} secondary />
      <Text style={styles.helperText}>JPG, PNG, WebP, GIF or AVIF. Up to 10 MB per photo. A successful save updates the website too.</Text>
      <ActionButton label={formBusy ? 'Saving…' : 'Save listing'} onPress={saveProperty} disabled={formBusy} />
      <ActionButton label="Cancel" onPress={() => { setEditingId(null); setPropertyFormOpen(false); setDraft({ ...EMPTY_DRAFT }); setExistingPhotos([]); setRemovedPhotos([]); setNewPhotos([]); }} secondary />
    </View>
  );

  const renderHome = () => (
    <>
      <View style={styles.hero}>
        <View style={styles.heroBadge}><Text style={styles.heroBadgeText}>THANE · MAHARASHTRA</Text></View>
        <Text style={styles.heroTitle}>Your next chapter<Text style={styles.heroTitleGold}> starts here.</Text></Text>
        <Text style={styles.heroCopy}>Thoughtfully chosen homes, apartments, plots and commercial spaces — with personal support from first enquiry to final decision.</Text>
        <View style={styles.trustRow}>
          <View><Text style={styles.trustValue}>SS</Text><Text style={styles.trustLabel}>Local expertise</Text></View>
          <View style={styles.trustDivider} />
          <View><Text style={styles.trustValue}>1:1</Text><Text style={styles.trustLabel}>Personal support</Text></View>
          <View style={styles.trustDivider} />
          <View><Text style={styles.trustValue}>24/7</Text><Text style={styles.trustLabel}>Enquiry access</Text></View>
        </View>
      </View>
      <View style={styles.sectionBlock}>
        <SectionTitle title="Find your property" subtitle="Filter live listings from SS Properties." />
        <Field label="Search by title, location or amenities" value={searchText} onChangeText={setSearchText} placeholder="Try Thane West, parking…" />
        <Text style={styles.fieldLabel}>Looking for</Text>
        <View style={styles.wrapRow}>
          <Pill label="All" active={purposeFilter === 'all'} onPress={() => setPurposeFilter('all')} />
          <Pill label="Buy" active={purposeFilter === 'buy'} onPress={() => setPurposeFilter('buy')} />
          <Pill label="Rent" active={purposeFilter === 'rent'} onPress={() => setPurposeFilter('rent')} />
          <Pill label="Commercial" active={purposeFilter === 'commercial'} onPress={() => setPurposeFilter('commercial')} />
        </View>
        <Text style={styles.fieldLabel}>Property type</Text>
        <View style={styles.wrapRow}>
          {['all', 'apartment', 'villa', 'plot', 'commercial', 'other'].map((value) => (
            <Pill key={value} label={value === 'all' ? 'Any type' : value[0].toUpperCase() + value.slice(1)} active={typeFilter === value} onPress={() => setTypeFilter(value)} />
          ))}
        </View>
        <Text style={styles.fieldLabel}>Location</Text>
        <View style={styles.wrapRow}>
          <Pill label="Any location" active={locationFilter === 'all'} onPress={() => setLocationFilter('all')} />
          {availableLocations.map((location) => (
            <Pill key={location} label={location} active={normalizeLocation(locationFilter) === normalizeLocation(location)} onPress={() => setLocationFilter(location)} />
          ))}
        </View>
        <Text style={styles.fieldLabel}>Budget</Text>
        <View style={styles.wrapRow}>
          <Pill label="Any" active={budgetFilter === 'all'} onPress={() => setBudgetFilter('all')} />
          <Pill label={purposeFilter === 'rent' ? 'Under ₹25K/mo' : 'Under ₹50L'} active={budgetFilter === 'low'} onPress={() => setBudgetFilter('low')} />
          <Pill label={purposeFilter === 'rent' ? '₹25–75K/mo' : '₹50L–1.5Cr'} active={budgetFilter === 'mid'} onPress={() => setBudgetFilter('mid')} />
          <Pill label={purposeFilter === 'rent' ? '₹75K+/mo' : '₹1.5Cr+'} active={budgetFilter === 'high'} onPress={() => setBudgetFilter('high')} />
        </View>
        <Text style={styles.fieldLabel}>Features</Text>
        <View style={styles.wrapRow}>
          <Pill label="Any features" active={featureFilter === 'all'} onPress={() => setFeatureFilter('all')} />
          <Pill label="2+ BHK" active={featureFilter === '2bhk'} onPress={() => setFeatureFilter('2bhk')} />
          <Pill label="3+ BHK" active={featureFilter === '3bhk'} onPress={() => setFeatureFilter('3bhk')} />
          <Pill label="Parking" active={featureFilter === 'parking'} onPress={() => setFeatureFilter('parking')} />
          <Pill label="Furnished" active={featureFilter === 'furnished'} onPress={() => setFeatureFilter('furnished')} />
        </View>
      </View>
      <View style={styles.sectionBlock}>
        <View style={styles.sectionTop}>
          <View style={styles.flexOne}><SectionTitle title="Available properties" subtitle={filteredProperties.length + ' matching listing(s)'} /></View>
          <Pressable onPress={() => refreshCurrent()} style={styles.textAction}><Text style={styles.textActionText}>Refresh</Text></Pressable>
        </View>
        {loadingProperties ? <ActivityIndicator color={C.gold} size="large" style={styles.loading} /> :
          filteredProperties.length ? filteredProperties.map((property) => (
            <PropertyCard
              key={property.id}
              property={property}
              saved={savedIds.includes(property.id)}
              onOpen={() => { setSelectedProperty(property); setPhotoIndex(0); setScreen('detail'); }}
              onToggleSaved={() => updateFavourite(property)}
            />
          )) : <EmptyState title="No matching properties" copy="Try clearing a filter or contact us for current availability." action="Ask SS Properties" onPress={() => startEnquiry(null)} />}
      </View>
      <View style={styles.contactPanel}>
        <Text style={styles.contactTitle}>Need a little guidance?</Text>
        <Text style={styles.contactCopy}>Tell us what you are looking for and we will help you shortlist the right options.</Text>
        <ActionButton label="Send an enquiry" onPress={() => startEnquiry(null)} />
        <ActionButton label="Chat on WhatsApp" onPress={() => openWhatsApp(null)} secondary />
      </View>
    </>
  );

  const renderDetail = () => {
    if (!selectedProperty) return <EmptyState title="No property selected" copy="Go back to the listings and choose a property." action="Back to listings" onPress={() => setScreen('home')} />;
    const photos = photoUrls(selectedProperty);
    const currentPhotos = photos.length ? photos : [FALLBACK_IMAGE];
    const index = Math.min(photoIndex, currentPhotos.length - 1);
    return (
      <>
        <View style={styles.detailTop}>
          <ActionButton label="← Back to listings" secondary onPress={() => setScreen('home')} />
          <Text style={styles.detailEyebrow}>{selectedProperty.listing_type === 'rent' ? 'FOR RENT' : selectedProperty.listing_type === 'commercial' ? 'COMMERCIAL' : 'FOR SALE'}</Text>
        </View>
        <Image source={{ uri: currentPhotos[index] }} style={styles.detailImage} />
        <View style={styles.galleryControls}>
          <ActionButton label="‹ Previous" secondary disabled={currentPhotos.length < 2} onPress={() => setPhotoIndex((index - 1 + currentPhotos.length) % currentPhotos.length)} />
          <Text style={styles.photoIndexText}>{index + 1} / {currentPhotos.length}</Text>
          <ActionButton label="Next ›" secondary disabled={currentPhotos.length < 2} onPress={() => setPhotoIndex((index + 1) % currentPhotos.length)} />
        </View>
        {currentPhotos.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbStrip}>
          {currentPhotos.map((url, photoNo) => (
            <Pressable key={url} onPress={() => setPhotoIndex(photoNo)} style={[styles.thumbWrap, photoNo === index && styles.thumbActive]}>
              <Image source={{ uri: url }} style={styles.thumbImage} />
            </Pressable>
          ))}
        </ScrollView> : null}
        <View style={styles.detailPanel}>
          <Text style={styles.kicker}>{selectedProperty.property_type}</Text>
          <Text style={styles.detailTitle}>{selectedProperty.title}</Text>
          <Text style={styles.locationText}>⌖  {selectedProperty.location}</Text>
          <Text style={styles.detailPrice}>{priceLabel(selectedProperty)}</Text>
          <View style={styles.factGrid}>
            {selectedProperty.bedrooms !== null ? <Fact label="Bedrooms" value={selectedProperty.bedrooms + ' BHK'} /> : null}
            {selectedProperty.bathrooms !== null ? <Fact label="Bathrooms" value={String(selectedProperty.bathrooms)} /> : null}
            {selectedProperty.area_sqft !== null ? <Fact label="Area" value={Number(selectedProperty.area_sqft).toLocaleString('en-IN') + ' sq ft'} /> : null}
            <Fact label="Listing" value={selectedProperty.listing_type === 'rent' ? 'Rent' : selectedProperty.listing_type === 'commercial' ? 'Commercial' : 'Sale'} />
          </View>
          <Text style={styles.detailSectionTitle}>Property overview</Text>
          <Text style={styles.bodyCopy}>{selectedProperty.description || 'Contact SS Properties to learn more about this listing and arrange a viewing.'}</Text>
          {selectedProperty.amenities.length ? <>
            <Text style={styles.detailSectionTitle}>Facilities & amenities</Text>
            <View style={styles.wrapRow}>{selectedProperty.amenities.map((amenity) => <Pill key={amenity} label={'✓  ' + amenity} onPress={() => {}} active /> )}</View>
          </> : null}
          <ActionButton label="Enquire about this property" onPress={() => startEnquiry(selectedProperty)} />
          <ActionButton label="WhatsApp SS Properties" onPress={() => openWhatsApp(selectedProperty)} secondary />
          <ActionButton label="Call +91 99872 68181" onPress={openCall} secondary />
          <ActionButton label={savedIds.includes(selectedProperty.id) ? '♥  Remove from saved' : '♡  Save this property'} onPress={() => updateFavourite(selectedProperty)} secondary />
        </View>
      </>
    );
  };

  const renderSaved = () => {
    const savedProperties = properties.filter((property) => savedIds.includes(property.id));
    return (
      <View style={styles.sectionBlock}>
        <SectionTitle title="Saved properties" subtitle="Favourites are stored on this device." />
        {savedProperties.length ? savedProperties.map((property) => (
          <PropertyCard key={property.id} property={property} saved onOpen={() => { setSelectedProperty(property); setPhotoIndex(0); setScreen('detail'); }} onToggleSaved={() => updateFavourite(property)} />
        )) : <EmptyState title="No saved properties yet" copy="Tap the heart on any listing to keep it here." action="Browse properties" onPress={() => setScreen('home')} />}
      </View>
    );
  };

  const renderEnquiry = () => (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sectionBlock}>
      <SectionTitle title="Send an enquiry" subtitle={enquiryProperty ? 'Ask us about ' + enquiryProperty.title : 'Tell us what property you are looking for.'} />
      <View style={styles.formCard}>
        {enquiryProperty ? <View style={styles.selectedPropertyRow}>
          <Image source={{ uri: photoUrls(enquiryProperty)[0] || FALLBACK_IMAGE }} style={styles.smallPreview} />
          <View style={styles.flexOne}><Text style={styles.cardTitle}>{enquiryProperty.title}</Text><Text style={styles.locationText}>{enquiryProperty.location}</Text><Text style={styles.priceText}>{priceLabel(enquiryProperty)}</Text></View>
        </View> : null}
        <Field label="Your name *" value={enquiryDraft.name} onChangeText={(value) => setEnquiryDraft((old) => ({ ...old, name: value }))} placeholder="Full name" />
        <Field label="Phone number *" value={enquiryDraft.phone} onChangeText={(value) => setEnquiryDraft((old) => ({ ...old, phone: value }))} keyboardType="phone-pad" placeholder="10-digit mobile number" />
        <Field label="Email (optional)" value={enquiryDraft.email} onChangeText={(value) => setEnquiryDraft((old) => ({ ...old, email: value }))} keyboardType="email-address" autoCapitalize="none" placeholder="you@example.com" />
        <Text style={styles.fieldLabel}>Looking for</Text>
        <View style={styles.wrapRow}>
          {['For Sale', 'For Rent', 'Commercial', 'Sell My Property'].map((purpose) => <Pill key={purpose} label={purpose} active={enquiryDraft.purpose === purpose} onPress={() => setEnquiryDraft((old) => ({ ...old, purpose }))} />)}
        </View>
        <Text style={styles.fieldLabel}>Property type</Text>
        <View style={styles.wrapRow}>
          {['Apartment', 'Villa', 'Plot', 'Commercial', 'Any'].map((propertyType) => <Pill key={propertyType} label={propertyType} active={enquiryDraft.property_type === propertyType} onPress={() => setEnquiryDraft((old) => ({ ...old, property_type: propertyType }))} />)}
        </View>
        <Field label="Message" value={enquiryDraft.message} onChangeText={(value) => setEnquiryDraft((old) => ({ ...old, message: value }))} multiline placeholder="Location, budget, size and anything else we should know." />
        <ActionButton label={formBusy ? 'Sending…' : 'Submit enquiry'} onPress={submitEnquiry} disabled={formBusy} />
        <ActionButton label="Or message us on WhatsApp" onPress={() => openWhatsApp(enquiryProperty)} secondary />
      </View>
    </KeyboardAvoidingView>
  );

  const renderAccount = () => (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sectionBlock}>
      <SectionTitle title="Owner access" subtitle="Customer browsing does not require an account. This sign-in is for the business owner only." />
      <View style={styles.formCard}>
        <View style={styles.ownerMark}><Text style={styles.ownerMarkText}>SS</Text></View>
        {session && !isOwner ? <Text style={styles.errorText}>This signed-in account is not authorised for the owner dashboard.</Text> : null}
        <Field label="Owner email" value={loginEmail} onChangeText={setLoginEmail} keyboardType="email-address" autoCapitalize="none" placeholder={OWNER_EMAIL} />
        <Field label="Password" value={loginPassword} onChangeText={setLoginPassword} secureTextEntry autoCapitalize="none" placeholder="Business account password" />
        <ActionButton label={loginBusy ? 'Signing in…' : 'Sign in to owner dashboard'} onPress={doOwnerLogin} disabled={loginBusy} />
        <Text style={styles.helperText}>Use the existing Supabase Auth account. The app checks the owner email in the interface, and Supabase RLS must still enforce all database permissions.</Text>
        <ActionButton label="View public website" secondary onPress={() => Linking.openURL('https://ssproperty82.github.io/SS-Properties/')} />
      </View>
    </KeyboardAvoidingView>
  );

  const renderOwner = () => (
    <View style={styles.sectionBlock}>
      <View style={styles.ownerHeader}>
        <View style={styles.flexOne}>
          <Text style={styles.kicker}>BUSINESS CONTROL CENTER</Text>
          <Text style={styles.sectionTitle}>Owner dashboard</Text>
          <Text style={styles.helperText}>{session?.user.email}</Text>
        </View>
        <ActionButton label="Sign out" secondary onPress={ownerSignOut} />
      </View>
      <View style={styles.wrapRow}>
        <Pill label={'Enquiries (' + enquiries.length + ')'} active={ownerTab === 'enquiries'} onPress={() => setOwnerTab('enquiries')} />
        <Pill label={'Properties (' + ownerProperties.length + ')'} active={ownerTab === 'properties'} onPress={() => setOwnerTab('properties')} />
      </View>
      {ownerTab === 'enquiries' ? (
        <>
          <View style={styles.sectionTop}><View style={styles.flexOne}><SectionTitle title="Recent enquiries" subtitle={enquiries.filter((item) => item.status === 'new').length + ' new · ' + enquiries.length + ' total'} /></View><Pressable style={styles.textAction} onPress={() => loadEnquiries().catch((error) => Alert.alert('Refresh failed', cleanError(error)))}><Text style={styles.textActionText}>Refresh</Text></Pressable></View>
          {enquiries.length ? enquiries.map((enquiry) => (
            <View key={enquiry.id} style={styles.adminCard}>
              <View style={styles.cardTitleRow}>
                <View style={styles.flexOne}><Text style={styles.cardTitle}>{enquiry.name}</Text><Text style={styles.locationText}>{new Date(enquiry.created_at).toLocaleString()}</Text></View>
                <View style={[styles.statusBadge, enquiry.status === 'new' && styles.statusNew]}><Text style={styles.statusText}>{enquiry.status || 'new'}</Text></View>
              </View>
              <Text style={styles.bodyCopy}>☎  {enquiry.phone}{enquiry.email ? '\n✉  ' + enquiry.email : ''}</Text>
              <Text style={styles.bodyCopy}>{enquiry.purpose || '—'} · {enquiry.property_type || '—'}</Text>
              {enquiry.message ? <Text style={styles.bodyCopy}>{enquiry.message}</Text> : null}
              <View style={styles.wrapRow}>
                {(['new', 'contacted', 'closed'] as const).map((status) => <Pill key={status} label={status[0].toUpperCase() + status.slice(1)} active={enquiry.status === status} onPress={() => updateEnquiryStatus(enquiry, status)} />)}
              </View>
              <View style={styles.wrapRow}>
                <ActionButton label="Call" secondary onPress={() => Linking.openURL('tel:' + enquiry.phone)} />
                <ActionButton label="WhatsApp" secondary onPress={() => Linking.openURL('https://wa.me/' + waPhone(enquiry.phone))} />
                <ActionButton label="Delete" danger secondary onPress={() => deleteEnquiry(enquiry)} />
              </View>
            </View>
          )) : <EmptyState title="No enquiries yet" copy="New customer enquiries will appear here." action="Refresh" onPress={() => loadEnquiries()} />}
        </>
      ) : (
        <>
          <View style={styles.sectionTop}><View style={styles.flexOne}><SectionTitle title="Property inventory" subtitle={ownerProperties.filter((item) => item.status === 'available').length + ' available publicly'} /></View><ActionButton label="+ Add" onPress={beginAddProperty} /></View>
          {ownerProperties.map((property) => (
            <View key={property.id} style={styles.adminCard}>
              <View style={styles.adminPropertyRow}>
                <Image source={{ uri: photoUrls(property)[0] || FALLBACK_IMAGE }} style={styles.adminThumb} />
                <View style={styles.flexOne}>
                  <Text style={styles.cardTitle}>{property.title}</Text>
                  <Text style={styles.locationText}>{property.location}</Text>
                  <Text style={styles.priceText}>{priceLabel(property)}</Text>
                  <Text style={styles.helperText}>{property.status} · {photoUrls(property).length} photo(s)</Text>
                </View>
              </View>
              <View style={styles.wrapRow}>
                <ActionButton label="Edit" secondary onPress={() => beginEditProperty(property)} />
                <ActionButton label={property.status === 'available' ? 'Hide listing' : 'Publish listing'} secondary onPress={() => togglePropertyStatus(property)} />
                <ActionButton label="Delete" danger secondary onPress={() => deleteProperty(property)} />
              </View>
            </View>
          ))}
          {propertyFormOpen ? renderPropertyForm() : (
            <View style={styles.addNudge}><Text style={styles.bodyCopy}>Add a listing to publish it on the website and in this app.</Text><ActionButton label="+ Add new property" onPress={beginAddProperty} /></View>
          )}
        </>
      )}
    </View>
  );

  const renderScreen = () => {
    if (screen === 'home') return renderHome();
    if (screen === 'saved') return renderSaved();
    if (screen === 'detail') return renderDetail();
    if (screen === 'enquiry') return renderEnquiry();
    if (screen === 'account') return renderAccount();
    return renderOwner();
  };

  const navigate = (nextScreen: Screen) => {
    if (nextScreen === 'account' && isOwner) setScreen('owner');
    else if (nextScreen === 'owner' && !isOwner) setScreen('account');
    else setScreen(nextScreen);
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.app}>
      <StatusBar style="light" />
      <View style={styles.topbar}>
        <Pressable style={styles.brand} onPress={() => setScreen('home')} accessibilityRole="button" accessibilityLabel="SS Properties home">
          <View style={styles.brandMark}><Text style={styles.brandMarkText}>SS</Text></View>
          <View><Text style={styles.brandName}>SS Properties</Text><Text style={styles.brandTag}>HOMES · SPACES · POSSIBILITIES</Text></View>
        </Pressable>
        <Pressable style={styles.ownerShortcut} onPress={() => navigate('account')}><Text style={styles.ownerShortcutText}>{isOwner ? 'Owner' : 'Account'}  ↗</Text></Pressable>
      </View>
      {globalError ? <Pressable onPress={() => setGlobalError('')} style={styles.errorBanner}><Text style={styles.errorText}>{globalError}  ·  Tap to dismiss</Text></Pressable> : null}
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refreshCurrent()} tintColor={C.gold} colors={[C.gold]} />}
      >
        {screen === 'owner' && !isOwner
          ? <EmptyState title="Owner sign-in required" copy="Please sign in using the business account." action="Owner login" onPress={() => setScreen('account')} />
          : renderScreen()}
        <View style={styles.footer}>
          <Text style={styles.footerName}>SS PROPERTIES</Text>
          <Text style={styles.footerText}>Thane, Maharashtra · +91 99872 68181</Text>
          <Text style={styles.footerText}>© {new Date().getFullYear()} SS Properties</Text>
        </View>
      </ScrollView>
      <View style={styles.bottomNav}>
        <NavItem label="Explore" icon="home-outline" active={screen === 'home' || screen === 'detail'} onPress={() => setScreen('home')} />
        <NavItem label="Saved" icon="heart-outline" active={screen === 'saved'} onPress={() => setScreen('saved')} />
        <NavItem label="Enquire" icon="mail-outline" active={screen === 'enquiry'} onPress={() => startEnquiry(null)} />
        <NavItem label={isOwner ? 'Owner' : 'Account'} icon={isOwner ? 'grid-outline' : 'person-circle-outline'} active={screen === 'account' || screen === 'owner'} onPress={() => navigate('account')} />
      </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return <View style={styles.sectionTitleWrap}><Text style={styles.sectionTitle}>{title}</Text>{subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}</View>;
}
function Fact({ label, value }: { label: string; value: string }) {
  return <View style={styles.factBox}><Text style={styles.factLabel}>{label}</Text><Text style={styles.factValue}>{value}</Text></View>;
}
function EmptyState({ title, copy, action, onPress }: { title: string; copy: string; action?: string; onPress?: () => void }) {
  return <View style={styles.emptyState}><Text style={styles.emptyMark}>SS</Text><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyCopy}>{copy}</Text>{action && onPress ? <ActionButton label={action} onPress={onPress} secondary /> : null}</View>;
}
function NavItem({ label, icon, active, onPress }: { label: string; icon: React.ComponentProps<typeof Ionicons>['name']; active: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={styles.navItem} accessibilityRole="button" accessibilityState={{ selected: active }}><Ionicons name={icon} size={22} color={active ? C.gold : C.soft} /><Text style={[styles.navLabel, active && styles.navLabelActive]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: C.bg },
  topbar: { minHeight: 78, paddingHorizontal: 18, paddingTop: Platform.OS === 'android' ? (NativeStatusBar.currentHeight ?? 24) + 8 : 4, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomColor: C.line, borderBottomWidth: StyleSheet.hairlineWidth, backgroundColor: '#08121D' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMark: { width: 44, height: 44, borderWidth: 1, borderColor: 'rgba(239,195,110,0.65)', borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card2 },
  brandMarkText: { color: C.gold, fontSize: 17, fontWeight: '900', letterSpacing: -1 },
  brandName: { color: C.text, fontSize: 16, fontWeight: '800' },
  brandTag: { color: C.soft, fontSize: 8, letterSpacing: 1.1, marginTop: 2 },
  ownerShortcut: { borderColor: C.line, borderWidth: 1, borderRadius: 20, paddingVertical: 9, paddingHorizontal: 12, backgroundColor: C.card },
  ownerShortcutText: { color: C.gold, fontSize: 11, fontWeight: '800' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 26 },
  errorBanner: { padding: 10, marginHorizontal: 14, marginTop: 10, borderRadius: 10, backgroundColor: '#502C2F', borderColor: C.red, borderWidth: 1 },
  errorText: { color: '#FFBABA', fontSize: 12, lineHeight: 18 },
  hero: { paddingHorizontal: 20, paddingTop: 25, paddingBottom: 24, backgroundColor: C.bg2, borderBottomWidth: 1, borderBottomColor: C.line },
  heroBadge: { alignSelf: 'flex-start', borderRadius: 20, borderColor: 'rgba(239,195,110,0.4)', borderWidth: 1, paddingVertical: 6, paddingHorizontal: 10, marginBottom: 16 },
  heroBadgeText: { color: C.gold, fontWeight: '800', fontSize: 9, letterSpacing: 1.5 },
  heroTitle: { color: C.text, fontSize: 34, lineHeight: 39, fontWeight: '800', letterSpacing: -1, maxWidth: 360 },
  heroTitleGold: { color: C.gold },
  heroCopy: { color: C.muted, fontSize: 13, lineHeight: 21, marginTop: 13, marginBottom: 22, maxWidth: 440 },
  trustRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  trustValue: { color: C.gold, fontSize: 16, fontWeight: '800' },
  trustLabel: { color: C.soft, fontSize: 9, marginTop: 3 },
  trustDivider: { height: 30, width: 1, backgroundColor: C.line },
  sectionBlock: { paddingHorizontal: 16, paddingTop: 23, gap: 12 },
  loading: { paddingVertical: 30 },
  sectionTitleWrap: { marginBottom: 8, gap: 5 },
  sectionTitle: { color: C.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  sectionSubtitle: { color: C.muted, fontSize: 12, lineHeight: 18 },
  sectionTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  flexOne: { flex: 1 },
  fieldWrap: { marginBottom: 10, gap: 6 },
  fieldLabel: { color: C.muted, fontSize: 11, fontWeight: '700', marginBottom: 7, marginTop: 5 },
  input: { minHeight: 46, backgroundColor: '#0A1724', borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11, color: C.text, fontSize: 13 },
  inputMultiline: { minHeight: 88, textAlignVertical: 'top' },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, alignItems: 'center', marginBottom: 8 },
  pill: { paddingVertical: 8, paddingHorizontal: 11, borderRadius: 30, borderWidth: 1, borderColor: C.line, backgroundColor: '#0D1A27', marginBottom: 2 },
  pillActive: { backgroundColor: 'rgba(239,195,110,0.15)', borderColor: C.gold },
  pillText: { color: C.muted, fontSize: 10, fontWeight: '700' },
  pillTextActive: { color: C.gold },
  propertyCard: { borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.card, overflow: 'hidden', marginBottom: 14 },
  cardImageWrap: { height: 205, width: '100%', backgroundColor: C.card2 },
  cardImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  imageBadge: { position: 'absolute', top: 12, left: 12, borderRadius: 14, backgroundColor: C.gold, paddingVertical: 6, paddingHorizontal: 9 },
  imageBadgeText: { color: C.bg, fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
  featuredBadge: { position: 'absolute', top: 12, right: 12, borderRadius: 14, backgroundColor: 'rgba(7,16,26,0.85)', borderWidth: 1, borderColor: C.gold, paddingVertical: 6, paddingHorizontal: 9 },
  featuredText: { color: C.gold, fontSize: 8, fontWeight: '900' },
  photoCount: { position: 'absolute', bottom: 10, right: 10, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: 'rgba(7,16,26,0.83)' },
  photoCountText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
  cardBody: { padding: 15 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardTitleColumn: { flex: 1 },
  kicker: { color: C.gold, textTransform: 'uppercase', letterSpacing: 1.2, fontSize: 9, fontWeight: '900', marginBottom: 6 },
  cardTitle: { color: C.text, fontSize: 16, fontWeight: '800', lineHeight: 21 },
  locationText: { color: C.muted, fontSize: 11, marginTop: 5, lineHeight: 16 },
  heartButton: { width: 38, height: 38, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line, backgroundColor: C.bg2 },
  heart: { color: C.text, fontSize: 21, lineHeight: 24 },
  heartActive: { color: C.gold },
  priceText: { color: C.gold, fontSize: 17, fontWeight: '900', marginTop: 12 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 11, marginBottom: 4 },
  metaText: { color: C.muted, fontSize: 10, borderWidth: 1, borderColor: C.line, borderRadius: 9, paddingVertical: 5, paddingHorizontal: 8 },
  actionButton: { minHeight: 43, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 13, backgroundColor: C.gold, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.gold, marginTop: 6 },
  actionText: { color: C.bg, fontSize: 12, fontWeight: '900', textAlign: 'center' },
  actionSecondary: { borderColor: C.line, backgroundColor: 'transparent' },
  actionSecondaryText: { color: C.text },
  actionDanger: { borderColor: 'rgba(242,139,139,0.55)', backgroundColor: 'rgba(242,139,139,0.07)' },
  actionDangerText: { color: C.red },
  disabled: { opacity: 0.52 },
  textAction: { padding: 8, borderRadius: 9, borderWidth: 1, borderColor: C.line },
  textActionText: { color: C.gold, fontSize: 11, fontWeight: '800' },
  contactPanel: { marginHorizontal: 16, marginTop: 22, padding: 20, borderWidth: 1, borderColor: 'rgba(239,195,110,0.28)', borderRadius: 18, backgroundColor: '#0C1A28' },
  contactTitle: { color: C.text, fontSize: 20, fontWeight: '800' },
  contactCopy: { color: C.muted, fontSize: 12, lineHeight: 19, marginTop: 8, marginBottom: 7 },
  emptyState: { paddingHorizontal: 22, paddingVertical: 38, alignItems: 'center', borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.card, marginTop: 12, marginBottom: 12 },
  emptyMark: { color: C.gold, fontSize: 25, fontWeight: '900', borderWidth: 1, borderColor: C.gold, width: 55, height: 55, borderRadius: 16, textAlign: 'center', textAlignVertical: 'center', overflow: 'hidden', lineHeight: 53 },
  emptyTitle: { color: C.text, fontSize: 17, fontWeight: '800', marginTop: 17, textAlign: 'center' },
  emptyCopy: { color: C.muted, fontSize: 12, textAlign: 'center', lineHeight: 19, marginTop: 8, marginBottom: 12 },
  detailTop: { paddingHorizontal: 16, paddingTop: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  detailEyebrow: { color: C.gold, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  detailImage: { marginTop: 14, width: '100%', height: 280, resizeMode: 'cover', backgroundColor: C.card2 },
  galleryControls: { paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 9 },
  photoIndexText: { color: C.muted, fontSize: 11, fontWeight: '700' },
  thumbStrip: { gap: 9, paddingHorizontal: 16, paddingVertical: 12 },
  thumbWrap: { borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  thumbActive: { borderColor: C.gold },
  thumbImage: { width: 78, height: 58, resizeMode: 'cover' },
  detailPanel: { paddingHorizontal: 17, paddingTop: 14, paddingBottom: 24 },
  detailTitle: { color: C.text, fontSize: 27, fontWeight: '900', lineHeight: 32, marginTop: 2 },
  detailPrice: { color: C.gold, fontWeight: '900', fontSize: 24, marginTop: 18, marginBottom: 10 },
  factGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 11, marginBottom: 19 },
  factBox: { width: '48%', minHeight: 66, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.card, padding: 12 },
  factLabel: { color: C.muted, fontSize: 10, marginBottom: 6 },
  factValue: { color: C.text, fontSize: 14, fontWeight: '800' },
  detailSectionTitle: { color: C.text, fontSize: 18, fontWeight: '800', marginTop: 12, marginBottom: 8 },
  bodyCopy: { color: C.muted, fontSize: 12, lineHeight: 19, marginTop: 8 },
  sectionLabel: { color: C.muted, fontSize: 11, fontWeight: '800', marginTop: 12, marginBottom: 8 },
  thumbStrip2: { flexDirection: 'row', gap: 8 },
  formCard: { borderRadius: 18, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, padding: 15, marginTop: 8, marginBottom: 18 },
  selectedPropertyRow: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 15, padding: 10, backgroundColor: C.bg2, borderRadius: 12 },
  smallPreview: { width: 82, height: 70, borderRadius: 10, backgroundColor: C.card2 },
  helperText: { color: C.soft, fontSize: 10, lineHeight: 16, marginTop: 6, marginBottom: 4 },
  ownerMark: { height: 58, width: 58, borderRadius: 16, borderColor: C.gold, borderWidth: 1, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 12 },
  ownerMarkText: { color: C.gold, fontWeight: '900', fontSize: 20 },
  ownerHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  adminCard: { borderRadius: 15, borderWidth: 1, borderColor: C.line, backgroundColor: C.card, padding: 13, marginBottom: 12 },
  adminPropertyRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  adminThumb: { width: 96, height: 84, borderRadius: 10, backgroundColor: C.card2 },
  statusBadge: { paddingVertical: 5, paddingHorizontal: 8, borderRadius: 10, backgroundColor: C.card2, borderWidth: 1, borderColor: C.line },
  statusNew: { borderColor: C.gold, backgroundColor: 'rgba(239,195,110,0.1)' },
  statusText: { color: C.gold, fontSize: 9, fontWeight: '900', textTransform: 'uppercase' },
  twoColumns: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  column: { width: '48%' },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  photoTile: { width: 98, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 5, backgroundColor: C.bg2 },
  photoTileRemoved: { borderColor: C.red, opacity: 0.58 },
  photoThumb: { width: 86, height: 68, borderRadius: 6, resizeMode: 'cover' },
  photoAction: { borderColor: C.red, borderWidth: 1, borderRadius: 7, paddingVertical: 5, marginTop: 5, alignItems: 'center' },
  photoActionKeep: { borderColor: C.green },
  photoActionText: { color: C.text, fontSize: 9, fontWeight: '800' },
  addNudge: { padding: 18, borderRadius: 14, borderWidth: 1, borderColor: C.line, marginTop: 10 },
  footer: { alignItems: 'center', paddingTop: 28, paddingBottom: 20, gap: 5 },
  footerName: { color: C.gold, fontWeight: '900', fontSize: 10, letterSpacing: 2 },
  footerText: { color: C.soft, fontSize: 9 },
  bottomNav: { minHeight: 66, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingBottom: Platform.OS === 'ios' ? 8 : 2, paddingTop: 5, borderTopColor: C.line, borderTopWidth: 1, backgroundColor: '#08121D' },
  navItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 5, gap: 3 },
  navGlyph: { color: C.soft, fontSize: 19, lineHeight: 22 },
  navGlyphActive: { color: C.gold },
  navLabel: { color: C.soft, fontSize: 9, fontWeight: '700' },
  navLabelActive: { color: C.gold },
});
