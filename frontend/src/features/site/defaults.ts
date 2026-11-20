import type { Contact, Milestone } from './site.api';

/**
 * What the home page shows until an admin saves their own values. These are starting
 * placeholders: the admin replaces them with the real figures from Website content.
 */
export const DEFAULT_MILESTONES: Milestone[] = [
  { value: '9K+', label: 'Happy Associates' },
  { value: '₹27L+', label: 'Commissions Paid' },
  { value: '450+', label: 'Top Earners' }
];

export const DEFAULT_CONTACT: Contact = {
  phone: '+91 6386594535',
  whatsapp: '+91 6386594535',
  email: 'risingwealthcommunity@gmail.com',
  instagram: '',
  youtube: '',
  facebook: '',
  telegram: '',
  // Optional fallback so the form works before an admin saves a key: VITE_WEB3FORMS_KEY in frontend/.env
  formKey: (import.meta.env.VITE_WEB3FORMS_KEY as string | undefined)?.trim() ?? ''
};
