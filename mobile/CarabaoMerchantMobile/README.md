# Carabao Merchant (mobile)

The farm-side app. Buyers use [`../CarabaoMobile`](../CarabaoMobile/README.md); this app is
for accounts with a farm (merchant) profile, and it shares the FastAPI backend and the
Carabao website. The web Merchant Centre (`merchant.` host) stays as it is; this app is a
second client of the same API.

| App | Folder | Scheme | Who uses it |
|---|---|---|---|
| Carabao | `mobile/CarabaoMobile` | `carabaomobile://` | buyers (any account except admins) |
| Carabao Merchant (this app) | `mobile/CarabaoMerchantMobile` | `carabaomerchant://` | accounts with a farm; others see "This app is for farm accounts" |

Links between the apps, with their web fallbacks:

- The buyer app opens this app from its Profile banner and from merchant notifications
  (`carabaomerchant://<path>`), and opens `<web>/merchantDashboard` or
  `<web>/merchantOnboarding` when this app is not installed.
- This app's More tab, "Open buyer app", opens `carabaomobile://`, else the website
  (`EXPO_PUBLIC_WEB_URL`). "Merchant Centre on the web" opens `<web>/merchantDashboard`.

## Run

```powershell
cd mobile/CarabaoMerchantMobile
npm install
npm start   # then press a / i, or scan the QR code
```

`npm run android`, `npm run ios`, `npm run web` work as in the buyer app.

## Environment

Create a `.env.local` in this folder (git-ignored, same as the buyer app) before `npm start`;
the values are described in [`SYSTEM_REFERENCE.md` §4.3](../../documentation/manuals/SYSTEM_REFERENCE.md):

| Variable | Meaning |
|---|---|
| `EXPO_PUBLIC_API_URL` | FastAPI base URL, e.g. `http://localhost:8000` |
| `EXPO_PUBLIC_WEB_URL` | Website base URL, e.g. `http://localhost:3000` |
| `EXPO_PUBLIC_IDLE_TIMEOUT_MINUTES` | minutes of inactivity before the app signs out |
| `EXPO_PUBLIC_GOOGLE_MAPS_KEY` | Android only, optional: Google Maps SDK for Android key for `react-native-maps` (route map). Read by `app.config.ts`; without it the route screen shows the stop list and a "Map not available" note on Android. iOS uses Apple Maps and needs no key. Restart `npm start` after changing it, and rebuild a native build (`expo prebuild` / EAS) for the manifest change to apply. |

Signing in also needs the web change in
[`MOBILE_MERCHANT_SPLIT_PLAN.md` §6](../../documentation/manuals/MOBILE_MERCHANT_SPLIT_PLAN.md) (`carabaomerchant://` must be an
allowed mobile origin on the web app), so use a web app that has it before testing sign-in.

## Dependencies added in Plan 2

Installed with `npx expo install` (SDK 58 versions in `package.json`):

| Package | Used for |
|---|---|
| `react-native-maps` | route map (Shipments) and address pin (Store settings, Onboarding) |
| `expo-image-picker` | produce photo, shop logo, shop banner |
| `expo-document-picker` | onboarding documents (RSBSA, government ID, BIR certificate) |
| `expo-file-system`, `expo-sharing` | sales CSV export |
| `expo-clipboard` | copy shop link |

`expo-file-system` is now a direct dependency (it was transitive only). `app.json` holds the
`expo-image-picker` photo/camera permission text and the `react-native-maps` plugin;
`app.config.ts` adds the Android key from `EXPO_PUBLIC_GOOGLE_MAPS_KEY` when it is set.
`expo-document-picker` needs no plugin entry in SDK 58 (its plugin only adds optional iCloud
entitlements).

## Test and check

```powershell
npx tsc --noEmit
npm run lint
npm test          # node --test "src/lib/**/*.test.ts"
```

`npm test` also reads `../CarabaoMobile` (`sharedCopies.test.ts`: shared files must be the
same in both apps) and the web and backend files (`inStep.test.ts`), so run it from a full
checkout of the repository.

## Notes

- URL scheme: `carabaomerchant://` (buyer app: `carabaomobile://`).
- Bundle identifiers are `online.carabao.merchant` for both iOS and Android. TODO confirm with
  the store listing before the first build - they must differ from the buyer app's.
- TODO merchant icon and splash artwork: `assets/` currently reuses the buyer app's images.
- Deep links: `carabaomerchant://` (the dashboard), plus `.../orders`, `.../chats`,
  `.../chats?order=<id>` (opens that order's chat on top of the list), `.../produce`,
  `.../reviews`, `.../notifications`, `.../order-chat?orderId=<id>` and `.../onboarding`.
  The buyer app hands a merchant notification over with the path its kind maps to
  (`../CarabaoMobile/src/lib/merchantHandoff.ts`; a chat message about one order opens
  `/order-chat?orderId=<id>`), and opens the web page (`/merchantDashboard`,
  `/merchantOnboarding`) when this app is not installed.
- Known limit: a deep link opened while signed out goes to sign-in, and after sign-in the
  app opens Home, not the linked screen. Open the link again after sign-in.
- The root gate reads `/users/me` once per account. An account that gets its farm approved
  on the web while this app is open uses "Check again" on the "This app is for farm
  accounts" screen; no restart is needed.
- "Open buyer app" (More tab) uses `carabaomobile://`. iOS can see the buyer app because
  `app.json` lists `ios.infoPlist.LSApplicationQueriesSchemes: ["carabaomobile"]`. Android 11+
  cannot be told about the scheme from `app.json` (Expo's config has no `android.queries`),
  so `canOpenURL` may answer false although the buyer app is installed; the website
  (`EXPO_PUBLIC_WEB_URL`) then opens instead. Add a `<queries>` entry to the Android manifest
  (config plugin or `expo prebuild`) when a native build must open the app.
