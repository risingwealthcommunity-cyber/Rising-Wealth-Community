import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { authApi } from '../auth.api';
import OtpBoxes from './OtpBoxes';
import { useCooldown } from './useCooldown';

interface Props {
  email: string;
  onVerified: () => void;
  /** Seconds before "resend" is allowed; use 60 right after an email was just sent. */
  initialCooldown?: number;
}

/** Type the 6-digit code from the verification email, or ask for a fresh one (once a minute). */
export default function VerifyCodeForm({ email, onVerified, initialCooldown = 0 }: Props) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [cooldown, startCooldown] = useCooldown();

  useEffect(() => {
    if (initialCooldown > 0) startCooldown(initialCooldown);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setBusy(true);
    try {
      await authApi.verifyEmailCode(email, code);
      onVerified();
    } catch (err) {
      setError((err as Error).message);
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (cooldown > 0) return;
    setError('');
    setInfo('');
    try {
      await authApi.resendVerification(email);
      setInfo('If this account still needs verifying, a new email is on its way.');
      setCode('');
      startCooldown(60);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form className="au-form" onSubmit={submit}>
      {info && <div className="au-alert success">{info}</div>}
      {error && (
        <div className="au-alert error" role="alert">
          {error}
        </div>
      )}
      <div>
        <span className="au-field-label">6-digit code</span>
        <OtpBoxes value={code} onChange={setCode} disabled={busy} />
      </div>
      <button className="au-btn" disabled={busy || code.length !== 6}>
        {busy ? 'Verifying...' : 'Verify email'}
      </button>
      <button type="button" className="au-btn ghost" onClick={resend} disabled={cooldown > 0}>
        {cooldown > 0 ? `Email me a new code in ${cooldown}s` : 'Email me a new code'}
      </button>
    </form>
  );
}
