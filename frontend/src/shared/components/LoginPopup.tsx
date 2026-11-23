import { useEffect, useState } from 'react';
import { siteApi } from '../../features/site';
import type { SiteContent } from '../../features/site';

const SEEN = 'rwc-login-popup';

/** Forget that the popup was shown, so the next sign-in shows it again. Called when someone logs in. */
export const resetLoginPopup = () => {
  try {
    sessionStorage.removeItem(SEEN);
  } catch {
    /* storage unavailable: the popup then shows once per page load */
  }
};

/** The poster an admin sets for members: it opens once after they log in. */
export default function LoginPopup() {
  const [content, setContent] = useState<SiteContent | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    try {
      if (sessionStorage.getItem(SEEN)) return;
    } catch {
      /* ignore */
    }
    siteApi
      .content()
      .then((c) => {
        if (!alive) return;
        setContent(c);
        setOpen(Boolean(c.loginPopup?.enabled && c.assets['login-poster']));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const close = () => {
    setOpen(false);
    try {
      sessionStorage.setItem(SEEN, '1');
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const poster = content?.assets['login-poster'];
  if (!open || !poster) return null;
  const link = content?.loginPopup?.link;
  const image = <img src={poster.url} alt="Announcement" className="popup-poster" />;

  return (
    <div className="popup-scrim" role="dialog" aria-modal="true" aria-label="Announcement" onClick={close}>
      <div className="popup-card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="popup-close" aria-label="Close" onClick={close}>
          ×
        </button>
        {link ? (
          <a href={link} target="_blank" rel="noopener noreferrer" onClick={close}>
            {image}
          </a>
        ) : (
          image
        )}
      </div>
    </div>
  );
}
