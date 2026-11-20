import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { authApi } from '../auth.api';

export default function ResetPasswordPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Passwords do not match');
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
    <div className="auth-page">
      <form className="card" onSubmit={onSubmit}>
        <h1>Reset password</h1>
        {error && <div className="alert error">{error}</div>}
        <label>
          New password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
        </label>
        <label>
          Confirm password
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} required />
        </label>
        <button className="btn" disabled={busy}>
          {busy ? 'Saving...' : 'Reset password'}
        </button>
        <p className="links">
          <Link to="/login">Back to login</Link>
          <Link to="/forgot-password">Request a new link</Link>
        </p>
      </form>
    </div>
  );
}
