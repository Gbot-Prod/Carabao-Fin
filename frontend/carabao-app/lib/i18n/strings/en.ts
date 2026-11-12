// English UI strings (L1). This file defines the shape every language must match.

const en = {
  language: {
    label: 'Language',
    en: 'English',
    fil: 'Filipino',
  },
  nav: {
    shops: 'Shops',
    cart: 'Cart',
    track: 'Track',
    orders: 'Orders',
    merchant: 'Merchant',
    myShopPage: 'My Shop Page',
    dashboard: 'Dashboard',
    signOut: 'Sign Out',
    signIn: 'Sign In',
    loading: 'Loading...',
    openProfile: 'Open profile',
  },
  auth: {
    logoAlt: 'Carabao Logo',
    brandTagline:
      'Farm-fresh produce, delivered with confidence. Join the marketplace that connects buyers and trusted local merchants.',
    welcome: 'Welcome',
    signUpTitle: 'Create your Carabao account',
    signInTitle: 'Sign in to Carabao',
    modeLabel: 'Authentication mode',
    signIn: 'Sign in',
    signUp: 'Sign up',
    signUpModeLabel: 'Signup mode',
    signUpWithPhone: 'Sign up with phone number',
    signUpWithEmail: 'Sign up with email',
    emailPlaceholder: 'Email address',
    passwordPlaceholder: 'Password',
    codePlaceholder: '6-digit verification code',
    resendCode: 'Resend Code',
    resendWait: 'Please wait before sending another code',
    pleaseWait: 'Please wait...',
    sendCode: 'Send verification code',
    verifyAndContinue: 'Verify and continue',
    genericError: 'Authentication failed. Please try again.',
  },
};

export type Strings = typeof en;
export default en;
