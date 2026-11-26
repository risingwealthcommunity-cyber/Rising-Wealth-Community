import type { ReactNode } from 'react';
import { SOCIALS, telLink, whatsappLink } from '../../features/landing/contactLinks';
import { ICONS } from '../../features/landing/SiteFooter';
import { useSiteContent } from '../../features/site';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/** Footer of the member app: the social and contact links an admin sets in Website content show up here for every member. */
export default function MemberFooter() {
  const { content } = useSiteContent();
  const c = content.contact;
  if (!c) return null;

  const wa = c.whatsapp ? whatsappLink(c.whatsapp) : null;
  const call = c.phone ? telLink(c.phone) : null;
  const socials = SOCIALS.filter((s) => c[s.key]);
  const hasLinks = Boolean(wa || call || c.email || socials.length);

  return (
    <footer className="member-footer">
      {hasLinks && (
        <div className="member-footer-links">
          {socials.map((s) => (
            <a key={s.key} href={c[s.key]} target="_blank" rel="noopener noreferrer" aria-label={s.label} title={s.label}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {ICONS[s.key]}
              </svg>
            </a>
          ))}
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp support" title="WhatsApp support">
              <Icon>
                <path d="M3.5 20.5l1.3-4.4A8.5 8.5 0 1 1 8 19.3l-4.5 1.2z" />
                <path d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.6-2-1-1 .8a4.5 4.5 0 0 1-2-2l.8-1-1-2L9 8.5z" />
              </Icon>
            </a>
          )}
          {call && c.phone && (
            <a href={call} aria-label={`Call ${c.phone}`} title={c.phone}>
              <Icon>
                <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />
              </Icon>
            </a>
          )}
          {c.email && (
            <a href={`mailto:${c.email}`} aria-label={`Email ${c.email}`} title={c.email}>
              <Icon>
                <rect x="3" y="5" width="18" height="14" rx="2.5" />
                <path d="M3.5 7l8.5 6 8.5-6" />
              </Icon>
            </a>
          )}
        </div>
      )}
      <span>
        {'©'} {new Date().getFullYear()} Rising Wealth Community. All rights reserved.
      </span>
    </footer>
  );
}
