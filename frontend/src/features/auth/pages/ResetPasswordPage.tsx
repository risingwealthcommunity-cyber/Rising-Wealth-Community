import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { SmoothInput } from '../../../shared/components/SmoothInput';
import { authApi } from '../auth.api';
import AuthShell from '../components/AuthShell';
import { EyeIcon, EyeOffIcon, KeyIcon } from '../components/Icons';
import PasswordMeter from '../components/PasswordMeter';

export default function ResetPasswordPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await authApi.resetPassword(token, password);
      navigate('/login', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      icon={<KeyIcon />}
      title="Set a new password"
      subtitle="Choose a password with at least 8 characters."
      footer={
        <>
          <Link to="/login">Back to login</Link> {'·'} <Link to="/forgot-password">Request a new link</Link>
        </>
      }
    >
      {error && <div className="au-alert error">{error}</div>}
      <form className="au-form" onSubmit={onSubmit}>
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
          label="Confirm password"
          type={show ? 'text' : 'password'}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Type it again"
          autoComplete="new-password"
          minLength={8}
          required
          hint={confirm && confirm !== password ? 'Passwords do not match yet' : undefined}
        />
        <button className="au-btn" disabled={busy}>
          {busy ? 'Saving...' : 'Reset password'}
        </button>
      </form>
    </AuthShell>
  );
}
