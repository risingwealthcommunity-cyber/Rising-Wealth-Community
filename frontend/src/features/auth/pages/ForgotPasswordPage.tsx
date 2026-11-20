import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { SmoothInput } from '../../../shared/components/SmoothInput';
import { authApi } from '../auth.api';
import AuthShell from '../components/AuthShell';
import { KeyIcon } from '../components/Icons';

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
    <AuthShell
      icon={<KeyIcon />}
      title="Forgot password?"
      subtitle="Enter your email and we will send you a link to set a new one. It is valid for 15 minutes."
      footer={<Link to="/login">{'←'} Back to login</Link>}
    >
      {message && <div className="au-alert success">{message}</div>}
      {error && <div className="au-alert error">{error}</div>}
      <form className="au-form" onSubmit={onSubmit}>
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
          {busy ? 'Sending...' : 'Send reset link'}
        </button>
      </form>
    </AuthShell>
  );
}
