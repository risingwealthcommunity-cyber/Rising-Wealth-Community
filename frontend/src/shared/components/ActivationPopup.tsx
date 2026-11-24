import { useEffect, useState } from 'react';
import { siteApi } from '../../features/site';
import { date, inr } from '../format';

export interface Activated {
  memberName: string;
  referralCode: string;
  package: 'PRO' | 'ELITE';
  amount: number;
  at: string;
  self: boolean;
}

const LOOK = {
  PRO: { name: 'PRO', from: '#0f7a3d', to: '#14a352', soft: '#e7f6ec', asset: 'package-pro' },
  ELITE: { name: 'ELITE', from: '#5b21b6', to: '#8b3dff', soft: '#f0e8ff', asset: 'package-elite' }
} as const;

/**
 * The popup after an activation: the package picture with rounded corners, and who was activated, with which package, for how much
 * and when. The picture is the one an admin uploaded, or a drawn card until then.
 */
export default function ActivationPopup({ info, onClose }: { info: Activated; onClose: () => void }) {
  const look = LOOK[info.package];
  const [image, setImage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    siteApi
      .content()
      .then((c) => alive && setImage(c.assets[look.asset]?.url ?? null))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [look.asset]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="popup-scrim" role="dialog" aria-modal="true" aria-label="Package activated" onClick={onClose}>
      <div className="act-card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="popup-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <div className="act-picture">
          {image ? (
            <img src={image} alt={`${look.name} package`} />
          ) : (
            <div className="act-fallback" style={{ background: `linear-gradient(145deg, ${look.from}, ${look.to})` }}>
              <img src="/logo.png" alt="" width={64} height={64} />
              <strong>{look.name}</strong>
              <span>PACKAGE</span>
            </div>
          )}
        </div>
        <div className="act-body" style={{ background: look.soft }}>
          <span className="act-check">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Activated
          </span>
          <h2>{info.memberName}</h2>
          <p className="act-id">{info.referralCode}</p>
          <dl>
            <div>
              <dt>Package</dt>
              <dd>{look.name}</dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd>{inr(info.amount)}</dd>
            </div>
            <div>
              <dt>Date</dt>
              <dd>{date(info.at)}</dd>
            </div>
          </dl>
          <button type="button" className="btn" onClick={onClose}>
            {info.self ? 'Done' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
