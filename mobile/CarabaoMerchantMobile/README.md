# Carabao Merchant (mobile)

The farm-side app. Buyers use `../CarabaoMobile`; this app is for accounts with a farm
(merchant) profile, and it shares the FastAPI backend and the Carabao website.

## Run

```powershell
cd mobile/CarabaoMerchantMobile
npm install
npm start   # then press a / i, or scan the QR code
```

`npm run android`, `npm run ios`, `npm run web` work as in the buyer app.

## Environment

Create a `.env.local` in this folder (git-ignored, same as the buyer app) before `npm start`;
the values are described in `documentation/manuals/SYSTEM_REFERENCE.md` §4.3:

| Variable | Meaning |
|---|---|
| `EXPO_PUBLIC_API_URL` | FastAPI base URL, e.g. `http://localhost:8000` |
| `EXPO_PUBLIC_WEB_URL` | Website base URL, e.g. `http://localhost:3000` |
| `EXPO_PUBLIC_IDLE_TIMEOUT_MINUTES` | minutes of inactivity before the app signs out |

Signing in also needs the web change in
`documentation/manuals/MOBILE_MERCHANT_SPLIT_PLAN.md` §6 (`carabaomerchant://` must be an
allowed mobile origin on the web app), so use a web app that has it before testing sign-in.

## Test and check

```powershell
npx tsc --noEmit
npm run lint
npm test          # node --test "src/lib/**/*.test.ts"
```

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
