import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { SmoothInput } from '../../../shared/components/SmoothInput';
import { authApi, googleLoginUrl } from '../auth.api';
import type { SponsorPreview } from '../auth.api';
import { useAuth } from '../AuthContext';
import AuthShell from '../components/AuthShell';
import { EyeIcon, EyeOffIcon, GoogleIcon, MailIcon } from '../components/Icons';
import PasswordMeter from '../components/PasswordMeter';
import VerifyCodeForm from '../components/VerifyCodeForm';

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
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
  const [sentTo, setSentTo] = useState('');
  const [busy, setBusy] = useState(false);
  // what the typed sponsor code opens: whose team, and (for the new LEFT/RIGHT codes) which side
  const [preview, setPreview] = useState<SponsorPreview | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    const code = form.sponsorCode.trim();
    if (code.length < 4) {
      setPreview(null);
      setPreviewFailed(false);
      return;
    }
    let stale = false;
    const t = window.setTimeout(async () => {
      try {
        const res = await authApi.sponsorPreview(code);
        if (stale) return;
        setPreview(res.data ?? null);
        setPreviewFailed(false);
      } catch {
        if (stale) return;
        setPreview(null);
        setPreviewFailed(true);
      }
    }, 350);
    return () => {
      stale = true;
      window.clearTimeout(t);
    };
  }, [form.sponsorCode]);

  // The side is chosen by the code itself. Only an older referral code (or a failed lookup) needs the toggle.
  const codeSetsSide = Boolean(preview?.valid && preview.leg);
  const showSideToggle = form.sponsorCode.trim().length >= 4 && !codeSetsSide && (previewFailed || preview?.valid === true);

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
      setSentTo(form.email.trim().toLowerCase());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (sentTo) {
    return (
      <AuthShell
        icon={<MailIcon />}
        title="Check your email"
        subtitle={
          <>
            We sent a verification link and a 6-digit code to <b>{sentTo}</b>. Click the link, or type the code below.
          </>
        }
      >
        <VerifyCodeForm
          email={sentTo}
          initialCooldown={60}
          onVerified={() => navigate('/login?verified=true', { replace: true })}
        />
        <Link className="au-linkbtn" style={{ textAlign: 'center' }} to="/login">
          I will do it later: go to login
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
          hint={
            preview?.valid && preview.leg ? (
              <span style={{ color: '#14663a', fontWeight: 600 }}>
                {'\u2714'} You will join {preview.sponsorName}&rsquo;s {preview.leg === 'LEFT' ? 'LEFT' : 'RIGHT'} team.
              </span>
            ) : preview?.valid ? (
              <span>Code found ({preview.sponsorName}). Choose the side below.</span>
            ) : preview && !preview.valid ? (
              <span style={{ color: '#a11a1a' }}>We could not find this code. Check it with the person who invited you.</span>
            ) : previewFailed ? (
              <span>Could not check this code right now. You can still choose a side below.</span>
            ) : (
              <span>
                Your sponsor has a LEFT code and a RIGHT code. The code you use decides which side you join, so there is
                nothing else to choose.
              </span>
            )
          }
        />

        {showSideToggle && (
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
        )}

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
