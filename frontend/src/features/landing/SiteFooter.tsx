import type { ReactNode } from 'react';
import type { Contact } from '../site';
import { SOCIALS, telLink, whatsappLink } from './contactLinks';

const ICONS: Record<string, ReactNode> = {
  instagram: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="0.8" fill="currentColor" />
    </>
  ),
  youtube: (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
      <path d="M10 9.5l5 2.5-5 2.5z" fill="currentColor" />
    </>
  ),
  facebook: <path d="M14 8h2.5V4.5H14C11.8 4.5 10.5 6 10.5 8v2H8v3.5h2.5V20H14v-6.5h2.4l.6-3.5H14V8.4c0-.3.2-.4.5-.4z" />,
  telegram: <path d="M21 4L3 11l5.5 2L10 19l3-3.5 4.5 3.3L21 4zM8.5 13l8-5-6 6.3" />
};

interface Props {
  contact: Contact;
  hasTeam: boolean;
  hasCertificate: boolean;
}

export default function SiteFooter({ contact, hasTeam, hasCertificate }: Props) {
  const call = contact.phone ? telLink(contact.phone) : null;
  const wa = contact.whatsapp ? whatsappLink(contact.whatsapp) : null;
  const socials = SOCIALS.filter((s) => contact[s.key]);
  const hasContact = Boolean(call || wa || contact.email);

  return (
    <footer className="lp-footer">
      <div className="lp-footer-grid">
        <div className="lp-footer-brand">
          <img src="/logo.png" alt="" width={52} height={52} />
          <strong>Rising Wealth Community</strong>
          <p>
            We envision a world where opportunity is not limited by capital, but driven by mindset, consistency, and
            community power. Rising Wealth Community exists to turn ambition into income and individuals into leaders.
          </p>
        </div>

        <nav className="lp-footer-col" aria-label="Quick links">
          <h4>Quick links</h4>
          <a href="#top">Home</a>
          <a href="#about">About</a>
          <a href="#how">How you earn</a>
          <a href="#plans">Plans</a>
          {hasTeam && <a href="#team">Team</a>}
          {hasContact && <a href="#contact">Contact</a>}
        </nav>

        {hasContact && (
          <div className="lp-footer-col">
            <h4>Contact</h4>
            {call && <a href={call}>{contact.phone}</a>}
            {contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}
            {wa && (
              <a href={wa} target="_blank" rel="noopener noreferrer">
                WhatsApp support
              </a>
            )}
          </div>
        )}

        <div className="lp-footer-col">
          <h4>Trusted &amp; legal</h4>
          {hasCertificate && <span>{'✔'} MSME registered</span>}
          <span>{'✔'} Transparent wallet and payouts</span>
          <span>{'✔'} Free Trainee entry</span>
        </div>
      </div>

      <div className="lp-footer-bottom">
        <span>
          {'©'} {new Date().getFullYear()} Rising Wealth Community. All rights reserved.
        </span>
        {socials.length > 0 && (
          <div className="lp-socials">
            {socials.map((s) => (
              <a key={s.key} href={contact[s.key]} target="_blank" rel="noopener noreferrer" aria-label={s.label}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {ICONS[s.key]}
                </svg>
              </a>
            ))}
          </div>
        )}
      </div>
    </footer>
  );
}
