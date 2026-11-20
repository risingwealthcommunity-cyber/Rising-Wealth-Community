import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SmoothInput } from '../../../shared/components/SmoothInput';
import { authApi } from '../auth.api';
import AuthShell from '../components/AuthShell';
import { EyeIcon, EyeOffIcon, KeyIcon, MailIcon } from '../components/Icons';
import OtpBoxes from '../components/OtpBoxes';
import PasswordMeter from '../components/PasswordMeter';
import { useCooldown } from '../components/useCooldown';

/**
 * Step 1: ask for the email. Step 2: the email carries a link AND a 6-digit code, so the person can
 * either click the link or type the code here together with the new password.
 */
export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, startCooldown] = useCooldown();

  const send = async () => {
    setError('');
    setBusy(true);
    try {
      const res = await authApi.forgotPassword(email);
      setMessage(res.message ?? 'Check your email.');
      setSent(true);
      setCode('');
      startCooldown(60);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onEmail = (e: FormEvent) => {
    e.preventDefault();
    void send();
  };

  const onReset = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await authApi.resetPasswordWithCode(email, code, password);
      navigate('/login?reset=true', { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  if (!sent) {
    return (
      <AuthShell
        icon={<KeyIcon />}
        title="Forgot password?"
        subtitle="Enter your email. We will send a link and a 6-digit code to set a new password."
        footer={<Link to="/login">{'←'} Back to login</Link>}
      >
        {error && <div className="au-alert error">{error}</div>}
        <form className="au-form" onSubmit={onEmail}>
          <SmoothInput
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            autoComplete="email"
            required
          />
          <button className="au-btn" disabled={busy}>
            {busy ? 'Sending...' : 'Send reset email'}
          </button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      icon={<MailIcon />}
      title="Check your email"
      subtitle={
        <>
          We sent a link and a 6-digit code to <b>{email}</b>. Click the link, or type the code below with your new
          password.
        </>
      }
      footer={<Link to="/login">{'←'} Back to login</Link>}
    >
      {message && <div className="au-alert success">{message}</div>}
      {error && (
        <div className="au-alert error" role="alert">
          {error}
        </div>
      )}
      <form className="au-form" onSubmit={onReset}>
        <div>
          <span className="au-field-label">6-digit code</span>
          <OtpBoxes value={code} onChange={setCode} disabled={busy} />
        </div>
        <SmoothInput
          label="New password"
          type={show ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters"
          autoComplete="new-password"
          minLength={8}
          required
          rightElement={
            <button
              type="button"
              className="au-eye"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? 'Hide passwords' : 'Show passwords'}
              aria-pressed={show}
            >
              {show ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          }
        />
        <PasswordMeter password={password} />
        <SmoothInput
          label="Confirm new password"
          type={show ? 'text' : 'password'}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Type it again"
          autoComplete="new-password"
          minLength={8}
          required
          hint={confirm && confirm !== password ? 'Passwords do not match yet' : undefined}
        />
        <button className="au-btn" disabled={busy || code.length !== 6}>
          {busy ? 'Saving...' : 'Set new password'}
        </button>
      </form>
      <div className="au-links">
        <button
          type="button"
          className="au-linkbtn"
          onClick={() => {
            setSent(false);
            setError('');
          }}
        >
          Use a different email
        </button>
        <button type="button" className="au-linkbtn" disabled={cooldown > 0 || busy} onClick={() => void send()}>
          {cooldown > 0 ? `Send again in ${cooldown}s` : 'Send again'}
        </button>
      </div>
    </AuthShell>
  );
}
