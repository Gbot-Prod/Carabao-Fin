// Section registry for the /help page. The active section lives in the URL
// (?section=terms) so other pages can deep-link straight to it.

export const HELP_SECTIONS = [
  { id: 'faq', icon: '❓', label: 'FAQ', title: 'Frequently asked questions' },
  { id: 'contact', icon: '💬', label: 'Contact support', title: 'Contact support' },
  { id: 'terms', icon: '📄', label: 'Terms of Service', title: 'Terms of Service' },
  { id: 'privacy', icon: '🔒', label: 'Privacy Policy', title: 'Privacy Policy' },
] as const;

export type HelpSectionId = (typeof HELP_SECTIONS)[number]['id'];

export const DEFAULT_HELP_SECTION: HelpSectionId = 'faq';

export const isHelpSection = (v: string | null): v is HelpSectionId =>
  HELP_SECTIONS.some((s) => s.id === v);

export const SUPPORT_EMAIL = 'support@carabao.ph';
