import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { authApi, googleLoginUrl } from '../auth.api';
import { useAuth } from '../AuthContext';

export default function RegisterPage() {
  const { register } = useAuth();
  const [params] = useSearchParams();

  // Referral link format: /register?ref=RWCXXXXXXXX&leg=LEFT
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    sponsorCode: params.get('ref') ?? '',
    leg: params.get('leg') === 'RIGHT' ? 'RIGHT' : 'LEFT'
  });
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await register({
        name: form.name,
        email: form.email,
        phone: form.phone || undefined,
        password: form.password,
        sponsorCode: form.sponsorCode,
        leg: form.leg as 'LEFT' | 'RIGHT'
      });
      setSentTo(form.email);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setInfo('');
    try {
      const res = await authApi.resendVerification(sentTo);
      setInfo(res.message ?? 'Sent.');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (sentTo) {
    return (
      <div className="auth-page">
        <div className="card">
          <h1>Check your email</h1>
          <p>
            We sent a verification link to <strong>{sentTo}</strong>. Click it to activate your account, then log in.
          </p>
          {info && <div className="alert success">{info}</div>}
          {error && <div className="alert error">{error}</div>}
          <button className="btn ghost" onClick={resend}>
            Resend email
          </button>
          <p className="links">
            <Link to="/login">Go to login</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <form className="card" onSubmit={onSubmit}>
        <h1>Join RWC</h1>
        <p className="muted">Register as a Trainee. Learn, refer, earn, upgrade.</p>

        {error && <div className="alert error">{error}</div>}

        <label>
          Full name
          <input value={form.name} onChange={set('name')} required />
        </label>
        <label>
          Email
          <input type="email" value={form.email} onChange={set('email')} required />
        </label>
        <label>
          Mobile (optional)
          <input value={form.phone} onChange={set('phone')} maxLength={10} inputMode="numeric" />
        </label>
        <label>
          Password
          <input type="password" value={form.password} onChange={set('password')} minLength={8} required />
          <small className="muted">At least 8 characters.</small>
        </label>
        <label>
          Sponsor code
          <input value={form.sponsorCode} onChange={set('sponsorCode')} required />
        </label>
        <label>
          Placement leg
          <select value={form.leg} onChange={set('leg')}>
            <option value="LEFT">Left</option>
            <option value="RIGHT">Right</option>
          </select>
        </label>

        <button className="btn" disabled={busy}>
          {busy ? 'Creating account...' : 'Register'}
        </button>

        {form.sponsorCode && (
          <>
            <div className="divider">or</div>
            <a className="btn ghost" href={googleLoginUrl(form.sponsorCode, form.leg)}>
              Sign up with Google
            </a>
          </>
        )}

        <p className="links">
          <span>Already have an account?</span>
          <Link to="/login">Login</Link>
        </p>
      </form>
    </div>
  );
}
