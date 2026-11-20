import type { Contact } from '../site';

/** wa.me wants digits only, with the country code. A bare 10 digit Indian number gets 91 in front. */
export function whatsappLink(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8) return null;
  return `https://wa.me/${digits.length === 10 ? `91${digits}` : digits}`;
}

export function telLink(raw: string): string | null {
  const cleaned = raw.replace(/[^\d+]/g, '');
  return cleaned.replace(/\D/g, '').length >= 6 ? `tel:${cleaned}` : null;
}

export const SOCIALS: { key: keyof Contact; label: string }[] = [
  { key: 'instagram', label: 'Instagram' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'telegram', label: 'Telegram' }
];
