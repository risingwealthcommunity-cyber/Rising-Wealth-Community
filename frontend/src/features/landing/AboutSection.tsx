import { useState } from 'react';
import type { SiteAssets } from '../site';
import Lightbox from './Lightbox';

const VALUES = [
  { title: 'Transparency', text: 'Your wallet, your team and every payout are visible in your dashboard.' },
  { title: 'Community support', text: 'Live trainings and a team that grows alongside you.' },
  { title: 'Shared success', text: 'When members earn, the whole community moves forward.' }
];

export default function AboutSection({ assets }: { assets: SiteAssets }) {
  const about = assets['about-image'];
  const certificate = assets.certificate;
  const [zoom, setZoom] = useState(false);

  return (
    <section className="lp-section lp-about" id="about">
      <div className="lp-about-grid">
        <div className="lp-about-copy">
          <h2>About Rising Wealth Community</h2>
          <p>
            Rising Wealth Community is a learning-and-earning community built on a simple belief: people grow faster
            when they grow together.
          </p>
          <p>
            You start free as a Trainee, learn through live trainings and community support, and earn from Demat
            referrals. When you are ready, the PRO and ELITE packages unlock package income, passive levels, bonus pools
            and rank rewards.
          </p>
          <p>
            Everything is tracked in the open. Your wallet, your team and every payout sit in your dashboard, so you
            always know where your income comes from.
          </p>
        </div>

        <div className="lp-about-media">
          {about ? (
            <img src={about.url} alt="Rising Wealth Community" loading="lazy" decoding="async" />
          ) : (
            <div className="lp-about-fallback">
              <img src="/logo.png" alt="" width={160} height={160} />
            </div>
          )}
        </div>
      </div>

      <ul className="lp-values">
        {VALUES.map((v) => (
          <li key={v.title}>
            <b>{v.title}</b>
            <span>{v.text}</span>
          </li>
        ))}
      </ul>

      <div className="lp-cert" id="registration">
        <span className="lp-cert-badge">
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Verified MSME
        </span>
        <h3>
          <svg className="lp-cert-shield" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
            <path d="M12 2l8 3v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5l8-3z" fill="currentColor" />
            <path d="M8.2 12l2.7 2.6 5-5.2" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Trusted &amp; Registered
        </h3>
        <p>Registered under MSME, Government of India.</p>

        {certificate ? (
          <>
            <button type="button" className="lp-cert-btn" onClick={() => setZoom(true)}>
              View document
            </button>
            <button
              type="button"
              className="lp-cert-thumb"
              onClick={() => setZoom(true)}
              aria-label="View certificate in full"
            >
              <img src={certificate.url} alt="Registration certificate" loading="lazy" decoding="async" />
            </button>
          </>
        ) : (
          <button type="button" className="lp-cert-btn" disabled>
            Document coming soon
          </button>
        )}
      </div>

      {zoom && certificate && (
        <Lightbox src={certificate.url} alt="Registration certificate" onClose={() => setZoom(false)} />
      )}
    </section>
  );
}
