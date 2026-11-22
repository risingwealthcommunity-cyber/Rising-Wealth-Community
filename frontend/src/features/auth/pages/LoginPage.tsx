import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { SmoothInput } from '../../../shared/components/SmoothInput';
import { ApiError } from '../../../shared/api/apiClient';
import { authApi, googleLoginUrl } from '../auth.api';
import { useAuth } from '../AuthContext';
import type { OtpChallenge } from '../auth.types';
import AuthShell from '../components/AuthShell';
import { EyeIcon, EyeOffIcon, GoogleIcon, ShieldIcon } from '../components/Icons';
import OtpBoxes from '../components/OtpBoxes';
import { useCooldown } from '../components/useCooldown';

const URL_MESSAGES: Record<string, { type: 'success' | 'error'; text: string }> = {
  verified: { type: 'success', text: 'Email verified. You can log in now.' },
  reset: { type: 'success', text: 'Password updated. Log in with your new password.' },
  verification_failed: { type: 'error', text: 'That verification link is invalid or expired. Log in to get a new one.' },
  GoogleAuthFailed: { type: 'error', text: 'Google sign-in failed. Please try again.' },
  account_not_found: {
    type: 'error',
    text: 'No account found for that Google email. Please create an account first, using your sponsor\u2019s link.'
  },
  sponsor_required: {
    type: 'error',
    text: 'New accounts need a sponsor. Open a referral link, or register with a sponsor code first.'
  }
};

export default function LoginPage() {
  const { login, verifyOtp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const wanted = (location.state as { from?: string } | null)?.from;
  // only a path inside this app: never "//other-site" or a full address
  const from = typeof wanted === 'string' && /^\/(?![/\\])/.test(wanted) ? wanted : '/dashboard';

  const urlMsg = params.get('verified')
    ? URL_MESSAGES.verified
    : params.get('reset')
      ? URL_MESSAGES.reset
      : URL_MESSAGES[params.get('error') ?? ''] ?? null;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [needsVerification, setNeedsVerification] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cooldown, startCooldown] = useCooldown();

  const fail = (err: unknown) => {
    setError((err as Error).message);
    setNeedsVerification(err instanceof ApiError && err.status === 403);
  };

  const onLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setNeedsVerification(false);
    setBusy(true);
    try {
      const otpChallenge = await login(email, password);
      if (otpChallenge) {
        setChallenge(otpChallenge);
        setOtp('');
        setInfo(otpChallenge.message);
        startCooldown(45);
      } else {
        navigate(from, { replace: true });
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const onOtp = async (e: FormEvent) => {
    e.preventDefault();
    if (!challenge) return;
    setError('');
    setBusy(true);
    try {
      await verifyOtp(challenge.tempToken, otp);
      navigate(from, { replace: true });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const resendCode = async () => {
    if (!challenge || cooldown > 0) return;
    setError('');
    try {
      const res = await authApi.resendOtp(challenge.tempToken);
      setInfo(res.message ?? 'A new code has been sent.');
      setOtp('');
      startCooldown(45);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const resendVerification = async () => {
    setError('');
    try {
      const res = await authApi.resendVerification(email);
      setInfo(res.message ?? 'Verification email sent.');
      setNeedsVerification(false);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (challenge) {
    return (
      <AuthShell
        icon={<ShieldIcon />}
        title="Verification code"
        subtitle={
          <>
            Enter the 6-digit code we emailed to <b>{challenge.email}</b>.
          </>
        }
      >
        <form className="au-form" onSubmit={onOtp}>
          {info && <div className="au-alert success">{info}</div>}
          {error && <div className="au-alert error">{error}</div>}
          <OtpBoxes value={otp} onChange={setOtp} disabled={busy} />
          <button className="au-btn" disabled={busy || otp.length !== 6}>
            {busy ? 'Verifying...' : 'Verify and log in'}
          </button>
          <div className="au-links">
            <button
              type="button"
              className="au-linkbtn"
              onClick={() => {
                setChallenge(null);
                setOtp('');
                setError('');
              }}
            >
              {'←'} Back
            </button>
            <button type="button" className="au-linkbtn" disabled={cooldown > 0} onClick={resendCode}>
              {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            </button>
          </div>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in to your Rising Wealth account."
      footer={
        <>
          New to RWC? <Link to="/register">Create an account</Link>
        </>
      }
    >
      {urlMsg && !error && <div className={`au-alert ${urlMsg.type}`}>{urlMsg.text}</div>}
      {info && <div className="au-alert success">{info}</div>}
      {error && (
        <div className="au-alert error" role="alert">
          {error}
          {needsVerification && (
            <>
              <button type="button" className="au-linkbtn" onClick={resendVerification}>
                Resend verification email
              </button>
              <Link
                className="au-linkbtn"
                style={{ display: 'block', marginTop: 6 }}
                to={`/verify-email?email=${encodeURIComponent(email.trim().toLowerCase())}`}
              >
                I have a code
              </Link>
            </>
          )}
        </div>
      )}

      <form className="au-form" onSubmit={onLogin}>
        <SmoothInput
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          autoComplete="email"
          required
        />
        <SmoothInput
          label="Password"
          labelAside={
            <Link to="/forgot-password" className="au-linkbtn" style={{ fontSize: '0.8rem' }}>
              Forgot password?
            </Link>
          }
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Your password"
          autoComplete="current-password"
          required
          rightElement={
            <button
              type="button"
              className="au-eye"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
            >
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          }
        />
        <button className="au-btn" disabled={busy}>
          {busy ? 'Logging in...' : 'Log in'}
        </button>
      </form>

      <div className="au-or">or</div>
      <a className="au-btn ghost" href={googleLoginUrl()}>
        <GoogleIcon /> Continue with Google
      </a>
    </AuthShell>
  );
}
