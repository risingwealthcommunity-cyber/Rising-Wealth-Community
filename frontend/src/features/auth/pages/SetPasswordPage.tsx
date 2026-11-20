import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { SmoothInput } from '../../../shared/components/SmoothInput';
import { authApi } from '../auth.api';
import { useAuth } from '../AuthContext';

/**
 * Add a password to a Google-only account, or change an existing one. Changing needs the current
 * password, so a session left open on a shared computer cannot be used to take the account over.
 */
export default function SetPasswordPage() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const hasPassword = Boolean(user?.hasPassword);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await authApi.setPassword(password, confirm, hasPassword ? current : undefined);
      await refreshUser();
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" style={{ maxWidth: 420 }} onSubmit={onSubmit}>
      <h1>{hasPassword ? 'Change password' : 'Set a password'}</h1>
      <p className="muted">
        {hasPassword ? 'Enter your current password first.' : `Use it to log in with ${user?.email} without Google.`}
      </p>
      {error && <div className="alert error">{error}</div>}
      {hasPassword && (
        <SmoothInput
          label="Current password"
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          required
        />
      )}
      <SmoothInput
        label="New password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        minLength={8}
        autoComplete="new-password"
        hint="At least 8 characters."
        required
      />
      <SmoothInput
        label="Confirm new password"
        type="password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        minLength={8}
        autoComplete="new-password"
        required
      />
      <button className="btn" disabled={busy}>
        {busy ? 'Saving...' : 'Save password'}
      </button>
    </form>
  );
}
