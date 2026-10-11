# SS Properties — Mobile App

A native Android and iOS app built with React Native and Expo. This project lives in \`mobile-app/\` so it does not replace or interfere with the existing GitHub Pages website.

## Features

### Customers
- Browse available listings from the existing Supabase \`public.properties\` table.
- Search by title, location, property type and description.
- Filter by buy/rent/commercial, property type, location, budget and features.
- View full listing details, photo galleries, BHK, bathrooms, area and amenities.
- Save favourite properties locally on the device.
- Send an enquiry into the existing Supabase \`public.enquiries\` table.
- Contact SS Properties via WhatsApp or phone.

### Owner
- Sign in through the existing Supabase Auth account.
- Review new enquiries, mark them New / Contacted / Closed, call or WhatsApp a lead, and delete an enquiry.
- Add/edit listings, toggle public availability, feature a listing, upload multiple photos from the device, remove old photos, and set facilities/amenities.
- Changes are written to the same Supabase tables and Storage bucket used by the website.

## Requirements

- Node.js 22.13 or later for the current Expo SDK.
- npm.
- The Expo Go app for quick local testing, or EAS CLI for installable Android/iOS builds.
- Access to the existing Supabase project.

## Run locally

From the repository root:

\`\`\`bash
cd mobile-app
cp .env.example .env
npm install
npx expo install --check
npx expo start
\`\`\`

Scan the QR code with Expo Go on your Android device. For iOS, scan it with the iPhone camera/Expo Go; an iOS simulator can be opened with the Expo CLI on a Mac.

The \`.env.example\` contains the existing project URL and Supabase **publishable** key. Those values are expected to be used by a client app; do not add a Supabase service-role or secret key to this project, the app bundle, or an \`EXPO_PUBLIC_*\` environment variable.

## Build an Android APK for testing

Install and sign into EAS CLI:

\`\`\`bash
npm install --global eas-cli
eas login
eas init
\`\`\`

When \`eas init\` finishes, it adds the EAS project ID to \`app.json\`. Then run:

\`\`\`eas build --platform android --profile preview\`\`\`

The preview profile is configured to create an installable APK for internal testing. For store release, use \`eas build --platform android --profile production\`.

## Build for iOS

On a Mac or using EAS cloud builds:

\`\`\`bash
eas build --platform ios --profile preview
\`\`\`

An iOS device build must be signed with appropriate Apple credentials. A public App Store release requires the Apple Developer Program. Google Play distribution requires a Google Play developer account. See the official [Expo EAS Build guide](https://docs.expo.dev/build/) and [first build setup](https://docs.expo.dev/build/setup/).

## Database and security notes

The app intentionally uses the existing schema:
- \`public.properties\`, including \`images text[]\` and \`amenities text[]\`.
- \`public.enquiries\`, including its \`property_id\` reference.
- Supabase Storage bucket \`property-images\`.

The app checks the owner email for the dashboard experience, but **the database's Row Level Security (RLS) policies are the real security boundary**. Confirm that:
- public/anonymous users can only select available properties and insert enquiries;
- only \`ssproperty82@gmail.com\` can insert/update/delete properties, view/update/delete enquiries, and upload/update/delete property images;
- storage policies are set on the \`property-images\` bucket;
- the \`amenities text[]\` column exists.

If \`amenities\` has not been added yet, run this once in the Supabase SQL editor:

\`\`\`sql
alter table public.properties
add column if not exists amenities text[] not null default '{}';
\`\`\`

Do not disable RLS to make the app work.

## Known limitations of this first mobile version

- Favourites are local to the current device; they are not synced between phones.
- Enquiries are submitted to the shared database, not to push notifications.
- Photo upload supports the existing Storage bucket and 10 MB per-photo limit.
- App Store / Play Store accounts, signing, store metadata, screenshots, privacy declarations and review are separate release steps.
