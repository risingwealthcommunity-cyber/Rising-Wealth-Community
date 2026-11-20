import { Link } from 'react-router-dom';

export default function CtaBanner({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="lp-section" id="join">
      <div className="lp-cta-banner">
        <h2>Your income journey starts here</h2>
        <p>Join free as a Trainee, learn with the community, and upgrade only when you are ready.</p>
        <div className="lp-cta-actions">
          {signedIn ? (
            <Link className="lp-cta" to="/dashboard">
              Go to dashboard
            </Link>
          ) : (
            <>
              <Link className="lp-cta" to="/register">
                Join now
              </Link>
              <Link className="lp-cta-ghost" to="/login">
                Already a member?
              </Link>
            </>
          )}
        </div>
        <small>Free to join {'·'} Transparent wallet and payouts {'·'} Support on WhatsApp</small>
      </div>
    </section>
  );
}
