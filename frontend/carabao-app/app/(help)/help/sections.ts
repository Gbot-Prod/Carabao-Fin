import { CircleHelp, FileText, Lock, MessageCircle } from 'lucide-react';
import { helpUrl } from '@/lib/urls';

// Navigation for help.<root>. All four are help pages.

export const HELP_SECTIONS = [
  { id: 'faq', icon: CircleHelp, label: 'FAQ', href: helpUrl('/'), helpPath: '/' },
  { id: 'contact', icon: MessageCircle, label: 'Contact support', href: helpUrl('/contact'), helpPath: '/contact' },
  { id: 'terms', icon: FileText, label: 'Terms of Service', href: helpUrl('/terms'), helpPath: '/terms' },
  { id: 'privacy', icon: Lock, label: 'Privacy Policy', href: helpUrl('/privacy'), helpPath: '/privacy' },
] as const;

export const SUPPORT_EMAIL = 'support@carabao.ph';
