import { useEffect } from 'react';

/** Full-screen image viewer on the same page. Esc, the close button, or a click outside closes it. */
export default function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // freeze the page behind it
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="lp-lightbox" role="dialog" aria-modal="true" aria-label={alt} onClick={onClose} data-lenis-prevent>
      <img src={src} alt={alt} onClick={(e) => e.stopPropagation()} />
      <button type="button" className="lp-lightbox-close" onClick={onClose} aria-label="Close">
        {'×'}
      </button>
    </div>
  );
}
