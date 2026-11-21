import { SOCIALS, telLink, whatsappLink } from '../../features/landing/contactLinks';
import { ICONS } from '../../features/landing/SiteFooter';
import { useSiteContent } from '../../features/site';

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
            <a href={wa} target="_blank" rel="noopener noreferrer" className="member-footer-chip">
              WhatsApp support
            </a>
          )}
          {call && c.phone && (
            <a href={call} className="member-footer-chip">
              {c.phone}
            </a>
          )}
          {c.email && (
            <a href={`mailto:${c.email}`} className="member-footer-chip">
              {c.email}
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
