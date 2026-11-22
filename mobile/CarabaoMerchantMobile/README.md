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

Copy `.env.example` (or set these before `npm start`); the values are the same as in the buyer
app and are described in `documentation/manuals/SYSTEM_REFERENCE.md` §4.3:

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
- Deep links handled in the app: `carabaomerchant://orders`, `.../chats`, `.../produce`,
  `.../reviews`, `.../notifications`, `.../order-chat?orderId=<id>`, `.../onboarding`.
