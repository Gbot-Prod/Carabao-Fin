import { appUrl, helpUrl } from '@/lib/urls';

// Navigation for help.<root>. FAQ and contact are help pages; Terms and
// Privacy are on the apex (/terms, /privacy) and are linked from here.

export const HELP_SECTIONS = [
  { id: 'faq', icon: '❓', label: 'FAQ', href: helpUrl('/'), helpPath: '/' },
  { id: 'contact', icon: '💬', label: 'Contact support', href: helpUrl('/contact'), helpPath: '/contact' },
  { id: 'terms', icon: '📄', label: 'Terms of Service', href: appUrl('/terms'), helpPath: null },
  { id: 'privacy', icon: '🔒', label: 'Privacy Policy', href: appUrl('/privacy'), helpPath: null },
] as const;

export const SUPPORT_EMAIL = 'support@carabao.ph';
