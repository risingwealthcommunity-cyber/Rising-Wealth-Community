import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../shared/api/apiClient';
import { useRun } from '../../shared/useRun';

/** Opened from the link in the email: the member chooses a new transaction password. The link works once, for 15 minutes. */
export default function ResetTxnPasswordPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const act = useRun();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (next.length < 8) return act.setMsg({ type: 'error', text: 'Use at least 8 characters.' });
    if (next !== again) return act.setMsg({ type: 'error', text: 'The two passwords do not match.' });
    void act.run(async () => {
      const r = await api('/wallet/txn-password/reset', { method: 'POST', body: { token, newPassword: next } });
      setTimeout(() => navigate('/profile', { replace: true }), 1500);
      return r;
    });
  };

  return (
    <form className="card stack" style={{ maxWidth: 440 }} onSubmit={submit} autoComplete="off">
      <h1>New transaction password</h1>
      <p className="muted">Choose the password you will use for transfers, activations, withdrawals and bank details. For your safety, withdrawals and bank changes stay paused for 24 hours after you change it.</p>
      <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New transaction password (8+ characters)" autoComplete="new-password" aria-label="New transaction password" />
      <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} placeholder="Repeat the new password" autoComplete="new-password" aria-label="Repeat the new password" />
      {act.msg && <div className={`alert ${act.msg.type}`}>{act.msg.text}</div>}
      <button className="btn" disabled={act.busy || next.length < 8}>
        {act.busy ? 'Saving...' : 'Save new password'}
      </button>
      <Link to="/profile">Back to My profile</Link>
    </form>
  );
}
