# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Merchant hand-off

The merchant screens live in the Carabao Merchant app (`../CarabaoMerchantMobile`), so the
buyer app opens them there - from the Profile banner and from merchant notifications
(`src/lib/openMerchant.ts`):

- the app first, via `carabaomerchant://<path>`; `src/lib/merchantHandoff.ts` builds the
  path: `/` for the dashboard, `/orders`, `/chats` or `/reviews` for a notification's kind,
  `/onboarding` for the farm form (the same mapping the merchant app uses for its links);
- the website when the app is not installed: `${EXPO_PUBLIC_WEB_URL}/merchantDashboard` or
  `/merchantOnboarding`, both of which redirect to the `merchant.` host
  (`documentation/manuals/SUBDOMAINS.md` 1.1).

iOS needs `ios.infoPlist.LSApplicationQueriesSchemes: ["carabaomerchant"]` in `app.json`
before `Linking.canOpenURL` can see the app; it is there. Android 11+ cannot be told about
the scheme from `app.json` (Expo's config has no `android.queries`), so `canOpenURL` may
answer false on a phone that does have the app - the hand-off then opens the web page
instead, the same fallback as an uninstalled app. Add the `<queries>` entry to the Android
manifest (a config plugin or `expo prebuild`) if a native build needs the app to win.

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
