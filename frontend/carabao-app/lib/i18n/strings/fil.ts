// Filipino UI strings (L1).
//
// MACHINE-DRAFTED — NEEDS HUMAN REVIEW. Every string below was drafted without a
// native-speaker check. Have a Filipino speaker review them (tone, word choice,
// Taglish vs. formal Filipino) before a pilot, then set FIL_NEEDS_REVIEW to false.
// "Mag-sign in", "email" and "verification code" are kept in common Taglish usage.

import type { Strings } from './en';

export const FIL_NEEDS_REVIEW = true;

const fil: Strings = {
  language: {
    label: 'Wika',
    en: 'English',
    fil: 'Filipino',
  },
  nav: {
    shops: 'Mga Tindahan',
    cart: 'Basket',
    track: 'Subaybayan',
    orders: 'Mga Order',
    merchant: 'Negosyante',
    myShopPage: 'Aking Tindahan',
    dashboard: 'Dashboard',
    signOut: 'Mag-sign out',
    signIn: 'Mag-sign in',
    loading: 'Naglo-load...',
    openProfile: 'Buksan ang profile',
  },
  auth: {
    logoAlt: 'Logo ng Carabao',
    brandTagline:
      'Sariwang ani mula sa bukid, inihahatid nang maaasahan. Sumali sa pamilihang nag-uugnay sa mga mamimili at mga mapagkakatiwalaang lokal na negosyante.',
    welcome: 'Maligayang pagdating',
    signUpTitle: 'Gumawa ng iyong Carabao account',
    signInTitle: 'Mag-sign in sa Carabao',
    modeLabel: 'Paraan ng pag-access',
    signIn: 'Mag-sign in',
    signUp: 'Mag-sign up',
    signUpModeLabel: 'Paraan ng pag-sign up',
    signUpWithPhone: 'Mag-sign up gamit ang numero ng telepono',
    signUpWithEmail: 'Mag-sign up gamit ang email',
    emailPlaceholder: 'Email address',
    passwordPlaceholder: 'Password',
    codePlaceholder: '6-digit na verification code',
    resendCode: 'Ipadala muli ang code',
    resendWait: 'Maghintay muna bago magpadala ng panibagong code',
    pleaseWait: 'Sandali lang...',
    sendCode: 'Ipadala ang verification code',
    verifyAndContinue: 'I-verify at magpatuloy',
    genericError: 'Hindi natuloy ang pag-sign in. Pakisubukang muli.',
  },
};

export default fil;
