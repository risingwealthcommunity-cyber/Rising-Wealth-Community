import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SmoothInput } from '../../../shared/components/SmoothInput';
import { authApi, googleLoginUrl } from '../auth.api';
import { useAuth } from '../AuthContext';
import AuthShell from '../components/AuthShell';
import { EyeIcon, EyeOffIcon, GoogleIcon, MailIcon } from '../components/Icons';
import PasswordMeter from '../components/PasswordMeter';
import { useCooldown } from '../components/useCooldown';

export default function RegisterPage() {
  const { register } = useAuth();
  const [params] = useSearchParams();
  const invitedBy = params.get('ref') ?? '';

  // Referral link format: /register?ref=RWCXXXXXXXX&leg=LEFT
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    confirm: '',
    sponsorCode: invitedBy,
    leg: params.get('leg') === 'RIGHT' ? 'RIGHT' : 'LEFT'
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, startCooldown] = useCooldown();

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const mismatch = form.confirm.length > 0 && form.confirm !== form.password;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) {
      setError('The two passwords do not match.');
      return;
    }
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
      startCooldown(30);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (cooldown > 0) return;
    setInfo('');
    setError('');
    try {
      const res = await authApi.resendVerification(sentTo);
      setInfo(res.message ?? 'Sent.');
      startCooldown(30);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (sentTo) {
    return (
      <AuthShell
        icon={<MailIcon />}
        title="Check your email"
        subtitle={
          <>
            We sent a verification link to <b>{sentTo}</b>. Click it to activate your account, then log in.
          </>
        }
      >
        {info && <div className="au-alert success">{info}</div>}
        {error && <div className="au-alert error">{error}</div>}
        <button className="au-btn ghost" onClick={resend} disabled={cooldown > 0}>
          {cooldown > 0 ? `Resend email in ${cooldown}s` : 'Resend email'}
        </button>
        <Link className="au-btn" to="/login">
          Go to login
        </Link>
        <p className="au-foot">Not in your inbox? Check the spam folder too.</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Start free as a Trainee. Learn, refer, earn and upgrade when you are ready."
      footer={
        <>
          Already have an account? <Link to="/login">Log in</Link>
        </>
      }
    >
      {invitedBy && (
        <div className="au-ref">
          You were invited with sponsor code <b>{invitedBy}</b>.
        </div>
      )}
      {error && (
        <div className="au-alert error" role="alert">
          {error}
        </div>
      )}

      <form className="au-form" onSubmit={onSubmit}>
        <SmoothInput label="Full name" value={form.name} onChange={set('name')} placeholder="Your full name" autoComplete="name" required />
        <SmoothInput
          label="Email"
          type="email"
          value={form.email}
          onChange={set('email')}
          placeholder="name@example.com"
          autoComplete="email"
          required
        />
        <SmoothInput
          label="Mobile (optional)"
          type="tel"
          value={form.phone}
          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
          placeholder="10 digit number"
          inputMode="numeric"
          autoComplete="tel-national"
        />

        <div className="au-row">
          <SmoothInput
            label="Password"
            type={showPassword ? 'text' : 'password'}
            value={form.password}
            onChange={set('password')}
            placeholder="8+ characters"
            autoComplete="new-password"
            minLength={8}
            required
            rightElement={
              <button
                type="button"
                className="au-eye"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? 'Hide passwords' : 'Show passwords'}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            }
          />
          <SmoothInput
            label="Confirm password"
            type={showPassword ? 'text' : 'password'}
            value={form.confirm}
            onChange={set('confirm')}
            placeholder="Type it again"
            autoComplete="new-password"
            required
            hint={mismatch ? 'Passwords do not match yet' : undefined}
          />
        </div>
        <PasswordMeter password={form.password} />

        <SmoothInput
          label="Sponsor code"
          value={form.sponsorCode}
          onChange={set('sponsorCode')}
          placeholder="Code of the person who invited you"
          autoComplete="off"
          required
        />

        <div>
          <span className="au-field-label">Which side of your sponsor&rsquo;s team do you join?</span>
          <div className="au-seg" role="radiogroup" aria-label="Placement leg">
            {(['LEFT', 'RIGHT'] as const).map((leg) => (
              <label key={leg}>
                <input type="radio" name="leg" value={leg} checked={form.leg === leg} onChange={set('leg')} />
                {leg === 'LEFT' ? 'Left' : 'Right'}
              </label>
            ))}
          </div>
        </div>

        <button className="au-btn" disabled={busy}>
          {busy ? 'Creating account...' : 'Create account'}
        </button>
      </form>

      {form.sponsorCode && (
        <>
          <div className="au-or">or</div>
          <a className="au-btn ghost" href={googleLoginUrl(form.sponsorCode, form.leg)}>
            <GoogleIcon /> Sign up with Google
          </a>
        </>
      )}
    </AuthShell>
  );
}
