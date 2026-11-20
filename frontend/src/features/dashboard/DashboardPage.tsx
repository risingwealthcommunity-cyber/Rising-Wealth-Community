import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../shared/api/apiClient';
import { inr, label } from '../../shared/format';
import { useAuth } from '../auth';

type Copied = string;

export default function DashboardPage() {
  const { user } = useAuth();
  const [balance, setBalance] = useState<string | null>(null);
  const [copied, setCopied] = useState<Copied>('');

  useEffect(() => {
    api<{ balance: string }>('/wallet')
      .then((r) => setBalance(r.data?.balance ?? null))
      .catch(() => undefined);
  }, []);

  if (!user) return null;

  const link = (code: string) => `${window.location.origin}/register?ref=${code}`;

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(''), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const codes = [
    { side: 'LEFT', code: user.leftCode, note: 'New members who use this code join your LEFT team.' },
    { side: 'RIGHT', code: user.rightCode, note: 'New members who use this code join your RIGHT team.' }
  ] as const;

  return (
    <>
      <h1>Hi, {user.name}</h1>

      <div className="grid">
        <div className="card stat">
          <span className="muted">Wallet</span>
          <strong>{balance === null ? '...' : inr(balance)}</strong>
        </div>
        <div className="card stat">
          <span className="muted">Package</span>
          <strong>{user.package}</strong>
        </div>
        <div className="card stat">
          <span className="muted">Rank</span>
          <strong>{user.rank === 'NONE' ? 'Not ranked yet' : label(user.rank)}</strong>
        </div>
      </div>

      <div className="card">
        <h2>Your sponsor codes</h2>
        <p className="muted">You have two codes, one for each side of your team. Share the one for the side you want.</p>
        <div className="code-grid">
          {codes.map((c) => (
            <div className="code-card" key={c.side} data-side={c.side}>
              <span className="badge">{c.side}</span>
              <strong className="code-value">{c.code ?? '...'}</strong>
              <span className="muted">{c.note}</span>
              <div className="copy-row">
                <button className="btn ghost" disabled={!c.code} onClick={() => c.code && copy(`${c.side}-code`, c.code)}>
                  {copied === `${c.side}-code` ? 'Copied!' : 'Copy code'}
                </button>
                <button className="btn" disabled={!c.code} onClick={() => c.code && copy(`${c.side}-link`, link(c.code))}>
                  {copied === `${c.side}-link` ? 'Copied!' : 'Copy invite link'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {!user.hasPassword && (
        <div className="alert">
          You signed in with Google. <Link to="/set-password">Set a password</Link> to also log in with your email.
        </div>
      )}

      {user.package === 'TRAINEE' && (
        <div className="alert">
          You are a Trainee: you earn from Demat referrals only. <Link to="/packages">Upgrade to PRO or ELITE</Link> to unlock
          package income, passive levels, bonuses and ranks.
        </div>
      )}
    </>
  );
}
