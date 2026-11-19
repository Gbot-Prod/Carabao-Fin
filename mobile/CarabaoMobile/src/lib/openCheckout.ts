// CF-0114: the one way the app opens a payment page. Refuses any URL that is not a
// PayMongo checkout page (src/lib/paymentUrl.ts) and says so, instead of opening it.
import * as WebBrowser from 'expo-web-browser';
import { isAllowedCheckoutUrl } from './paymentUrl';

export class CheckoutUrlRefused extends Error {
  constructor() {
    super('The payment page address was not recognised, so it was not opened. Please try again or contact support.');
    this.name = 'CheckoutUrlRefused';
  }
}

/** Resolves when the buyer closes the payment page. Throws CheckoutUrlRefused for an unknown host. */
export async function openCheckout(url: unknown): Promise<void> {
  if (!isAllowedCheckoutUrl(url)) throw new CheckoutUrlRefused();
  await WebBrowser.openBrowserAsync(url);
}
