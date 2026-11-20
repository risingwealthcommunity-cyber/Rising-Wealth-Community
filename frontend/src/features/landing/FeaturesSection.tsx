import type { ReactNode } from 'react';
import type { SiteAssets } from '../site';

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const FEATURES: { title: string; text: string; icon: ReactNode }[] = [
  {
    title: 'Start free',
    text: 'Join as a Trainee at no cost and start earning from Demat referrals. Upgrade only when you are ready.',
    icon: (
      <>
        <circle cx="12" cy="12" r="9" {...stroke} />
        <path d="M9 8h6M9 11h6M9 8c3 0 3 5-1 5l5 3" {...stroke} />
      </>
    )
  },
  {
    title: 'Build your team',
    text: 'Grow a two-leg team. New members join under you, and your team’s activity builds your income.',
    icon: (
      <>
        <circle cx="9" cy="8" r="3" {...stroke} />
        <path d="M3 19c0-3.3 2.7-6 6-6s6 2.7 6 6" {...stroke} />
        <circle cx="17" cy="9" r="2.4" {...stroke} />
        <path d="M17 13.5c2.4 0 4 1.8 4 4.5" {...stroke} />
      </>
    )
  },
  {
    title: 'Passive levels',
    text: 'PRO unlocks 7 passive levels and ELITE all 12, so your income grows with your team’s activity.',
    icon: (
      <>
        <path d="M12 3l9 5-9 5-9-5 9-5z" {...stroke} />
        <path d="M3 12.5l9 5 9-5" {...stroke} />
        <path d="M3 17l9 5 9-5" {...stroke} />
      </>
    )
  },
  {
    title: 'Weekly payouts',
    text: 'Pool bonuses are worked out every week and credited to your wallet, where every payout is visible.',
    icon: (
      <>
        <rect x="4" y="5" width="16" height="15" rx="2" {...stroke} />
        <path d="M8 3v4M16 3v4M4 10h16M9 15l2 2 4-4" {...stroke} />
      </>
    )
  }
];

export default function FeaturesSection({ assets }: { assets: SiteAssets }) {
  return (
    <section className="lp-section" id="why">
      <h2>Why join Rising Wealth</h2>
      <p className="lp-section-sub">Everything you need to learn, earn and grow, in one place.</p>
      <div className="lp-features">
        {FEATURES.map((f, i) => {
          const image = assets[`feature-${i + 1}`];
          return (
            <div className="lp-feature" key={f.title}>
              {image ? (
                <img className="lp-feature-img" src={image.url} alt="" loading="lazy" decoding="async" />
              ) : (
                <span className="lp-feature-icon">
                  <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
                    {f.icon}
                  </svg>
                </span>
              )}
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
