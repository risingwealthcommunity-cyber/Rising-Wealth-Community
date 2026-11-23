import { Link } from 'react-router-dom';
import { useT } from './pageText';

export default function CtaBanner({ signedIn }: { signedIn: boolean }) {
  const t = useT();
  return (
    <section className="lp-section" id="join">
      <div className="lp-cta-banner">
        <h2>{t('cta.title')}</h2>
        <p>{t('cta.text')}</p>
        <div className="lp-cta-actions">
          {signedIn ? (
            <Link className="lp-cta" to="/dashboard">
              Go to dashboard
            </Link>
          ) : (
            <>
              <Link className="lp-cta" to="/register">
                {t('cta.join')}
              </Link>
              <Link className="lp-cta-ghost" to="/login">
                {t('cta.member')}
              </Link>
            </>
          )}
        </div>
        <small>Free to join {'·'} Transparent wallet and payouts {'·'} Support on WhatsApp</small>
      </div>
    </section>
  );
}
