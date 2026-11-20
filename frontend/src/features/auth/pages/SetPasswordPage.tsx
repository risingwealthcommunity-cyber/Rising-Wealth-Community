import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../auth.api';
import { useAuth } from '../AuthContext';

/** For accounts created with Google that want an email + password login too. */
export default function SetPasswordPage() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await authApi.setPassword(password, confirm);
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
      <h1>{user?.hasPassword ? 'Change password' : 'Set a password'}</h1>
      <p className="muted">Use it to log in with {user?.email} without Google.</p>
      {error && <div className="alert error">{error}</div>}
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
      </label>
      <label>
        Confirm password
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} required />
      </label>
      <button className="btn" disabled={busy}>
        {busy ? 'Saving...' : 'Save password'}
      </button>
    </form>
  );
}
