# Carabao (mobile buyer app)

The buyer app: browse farms, cart, checkout, order tracking and history, chat with a farm,
notifications. Merchant (farm) screens are in the separate Carabao Merchant app,
[`../CarabaoMerchantMobile`](../CarabaoMerchantMobile/README.md). Both apps use the same
FastAPI backend and sign in through Better Auth on the Carabao website.

| App | Folder | Scheme | Who uses it |
|---|---|---|---|
| Carabao (this app) | `mobile/CarabaoMobile` | `carabaomobile://` | buyers (any account except admins) |
| Carabao Merchant | `mobile/CarabaoMerchantMobile` | `carabaomerchant://` | accounts with a farm |

## Run

```powershell
cd mobile/CarabaoMobile
npm install
npx expo start   # then press a / i, or scan the QR code
```

Environment: `.env` in this folder with `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_WEB_URL` and
`EXPO_PUBLIC_IDLE_TIMEOUT_MINUTES` (values:
[`SYSTEM_REFERENCE.md` §4.3](../../documentation/manuals/SYSTEM_REFERENCE.md)). The merchant
app uses the same names and values.

## Test and check

```powershell
npx tsc --noEmit
npm run lint
npm test          # node --test "src/lib/**/*.test.ts"
```

## Merchant hand-off

The merchant screens live in the Carabao Merchant app (`../CarabaoMerchantMobile`), so the
buyer app opens them there - from the Profile banner and from merchant notifications
(`src/lib/openMerchant.ts`):

- the app first, via `carabaomerchant://<path>`; `src/lib/merchantHandoff.ts` builds the
  path: `/` for the dashboard, `/orders`, `/chats` or `/reviews` for a notification's kind,
  `/order-chat?orderId=<id>` for a chat message about one order, `/onboarding` for the farm
  form (the same mapping the merchant app uses for its links);
- the website when the app is not installed: `${EXPO_PUBLIC_WEB_URL}/merchantDashboard` or
  `/merchantOnboarding`, both of which redirect to the `merchant.` host
  ([`SUBDOMAINS.md` 1.1](../../documentation/manuals/SUBDOMAINS.md)).

The merchant app's "Open buyer app" row opens this app with `carabaomobile://`, and the
website (`EXPO_PUBLIC_WEB_URL`) when this app is not installed.

iOS needs `ios.infoPlist.LSApplicationQueriesSchemes: ["carabaomerchant"]` in `app.json`
before `Linking.canOpenURL` can see the app; it is there. Android 11+ cannot be told about
the scheme from `app.json` (Expo's config has no `android.queries`), so `canOpenURL` may
answer false on a phone that does have the app - the hand-off then opens the web page
instead, the same fallback as an uninstalled app. Add the `<queries>` entry to the Android
manifest (a config plugin or `expo prebuild`) if a native build needs the app to win.

## Expo notes

This project was created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app)
and uses [file-based routing](https://docs.expo.dev/router/introduction) in `app/`. You can open
it in a
[development build](https://docs.expo.dev/develop/development-builds/introduction/), an
[Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/), an
[iOS simulator](https://docs.expo.dev/workflow/ios-simulator/) or
[Expo Go](https://expo.dev/go).

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
