import { useT } from './pageText';
import { useState } from 'react';
import type { Review, SiteAssets } from '../site';
import Lightbox from './Lightbox';
import { initials } from './initials';

/**
 * Member reviews as screenshots. Only reviews that have a screenshot are shown, and the
 * whole section is hidden when there are none. With four or more it scrolls sideways on
 * its own (pausing on hover); clicking a card opens the screenshot full size.
 */
export default function ReviewsSection({ reviews, assets }: { reviews: Review[] | null; assets: SiteAssets }) {
  const t = useT();
  const [open, setOpen] = useState<{ src: string; alt: string } | null>(null);

  const shown = (reviews ?? []).filter((r) => r.id && assets[`review-${r.id}`]);
  if (shown.length === 0) return null;

  const scrolling = shown.length >= 4;
  const loop = scrolling ? [...shown, ...shown] : shown;

  return (
    <section className="lp-section lp-reviews-wrap" id="reviews">
      <h2>{t('reviews.title')}</h2>
      <p className="lp-section-sub">{t('reviews.sub')}</p>

      <div className={`lp-reviews ${scrolling ? 'is-scrolling' : ''}`}>
        <div className="lp-reviews-track">
          {loop.map((r, i) => {
            const src = assets[`review-${r.id}`].url;
            const duplicate = scrolling && i >= shown.length;
            return (
              <button
                type="button"
                className="lp-review"
                key={`${r.id}-${i}`}
                aria-hidden={duplicate || undefined}
                tabIndex={duplicate ? -1 : undefined}
                onClick={() => setOpen({ src, alt: `Review from ${r.name}` })}
              >
                <img src={src} alt={`Review from ${r.name}`} loading="lazy" decoding="async" />
                <span className="lp-review-meta">
                  <span className="lp-avatar" aria-hidden="true">
                    {initials(r.name)}
                  </span>
                  <b>{r.name}</b>
                  {r.tag && <small>{'✔'} {r.tag}</small>}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {open && <Lightbox src={open.src} alt={open.alt} onClose={() => setOpen(null)} />}
    </section>
  );
}
