import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../../../shared/api/apiClient';
import { authApi, googleLoginUrl } from '../auth.api';
import { useAuth } from '../AuthContext';
import type { OtpChallenge } from '../auth.types';

const URL_MESSAGES: Record<string, { type: 'success' | 'error'; text: string }> = {
  verified: { type: 'success', text: 'Email verified. You can log in now.' },
  verification_failed: { type: 'error', text: 'That verification link is invalid or expired. Log in to get a new one.' },
  GoogleAuthFailed: { type: 'error', text: 'Google sign-in failed. Please try again.' },
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
  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';

  const urlMsg = params.get('verified')
    ? URL_MESSAGES.verified
    : URL_MESSAGES[params.get('error') ?? ''] ?? null;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [needsVerification, setNeedsVerification] = useState(false);
  const [busy, setBusy] = useState(false);

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
        setInfo(otpChallenge.message);
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

  const resend = async (action: () => Promise<{ message?: string }>) => {
    setError('');
    try {
      setInfo((await action()).message ?? 'Sent.');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (challenge) {
    return (
      <div className="auth-page">
        <form className="card" onSubmit={onOtp}>
          <h1>Verification code</h1>
          <p className="muted">Enter the 6-digit code sent to {challenge.email}</p>
          {info && <div className="alert success">{info}</div>}
          {error && <div className="alert error">{error}</div>}
          <label>
            Code
            <input value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" maxLength={6} required />
          </label>
          <button className="btn" disabled={busy}>
            {busy ? 'Verifying...' : 'Verify and login'}
          </button>
          <p className="links">
            <button type="button" className="link" onClick={() => resend(() => authApi.resendOtp(challenge.tempToken))}>
              Resend code
            </button>
            <button type="button" className="link" onClick={() => setChallenge(null)}>
              Back
            </button>
          </p>
        </form>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <form className="card" onSubmit={onLogin}>
        <h1>Welcome back</h1>
        <p className="muted">Login to your RWC account</p>

        {urlMsg && !error && <div className={`alert ${urlMsg.type}`}>{urlMsg.text}</div>}
        {info && <div className="alert success">{info}</div>}
        {error && <div className="alert error">{error}</div>}

        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>

        <button className="btn" disabled={busy}>
          {busy ? 'Logging in...' : 'Login'}
        </button>

        {needsVerification && (
          <button type="button" className="btn ghost" onClick={() => resend(() => authApi.resendVerification(email))}>
            Resend verification email
          </button>
        )}

        <div className="divider">or</div>
        <a className="btn ghost" href={googleLoginUrl()}>
          Continue with Google
        </a>

        <p className="links">
          <Link to="/forgot-password">Forgot password?</Link>
          <Link to="/register">Create account</Link>
        </p>
      </form>
    </div>
  );
}
