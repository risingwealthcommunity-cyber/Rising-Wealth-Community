import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { authApi } from '../auth.api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const res = await authApi.forgotPassword(email);
      setMessage(res.message ?? 'Check your email for a reset link.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="card" onSubmit={onSubmit}>
        <h1>Forgot password</h1>
        <p className="muted">We will email you a link that is valid for 15 minutes.</p>
        {message && <div className="alert success">{message}</div>}
        {error && <div className="alert error">{error}</div>}
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <button className="btn" disabled={busy}>
          {busy ? 'Sending...' : 'Send reset link'}
        </button>
        <p className="links">
          <Link to="/login">Back to login</Link>
        </p>
      </form>
    </div>
  );
}
