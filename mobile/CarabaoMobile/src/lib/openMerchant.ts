// src/lib/openMerchant.ts
// CF-0125 / CF-0127 (plan §3.3): open Carabao Merchant at `kind`, and its web page when
// the merchant app is not installed. Not pure, so there is no test file (the paths it
// uses are checked in merchantHandoff.test.ts).
import { Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { WEB_BASE } from './config';
import {
  MERCHANT_APP_URL, merchantAppPath, merchantWebUrl, type MerchantHandoffKind,
} from './merchantHandoff';

/**
 * Opens the merchant app (`carabaomerchant://<path>`), or the web page when it is not
 * installed. On Android 11+ `canOpenURL` may say no for an app that is installed (the
 * scheme is not in the manifest's `<queries>`, see the README), which only means the web
 * page opens instead. A failed open falls back the same way; the rejection reaches the
 * caller only when the web page fails too.
 */
export async function openMerchant(kind: MerchantHandoffKind, notificationKind?: string): Promise<void> {
  const url = `${MERCHANT_APP_URL}${merchantAppPath(kind, notificationKind)}`;
  try {
    if (await Linking.canOpenURL(url)) {
      await Linking.openURL(url);
      return;
    }
  } catch {
    // Not installed, or the app refused: show the website instead.
  }
  await WebBrowser.openBrowserAsync(merchantWebUrl(WEB_BASE, kind));
}
