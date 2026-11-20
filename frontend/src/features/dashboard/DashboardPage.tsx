import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../shared/api/apiClient';
import { inr, label } from '../../shared/format';
import { useAuth } from '../auth';

export default function DashboardPage() {
  const { user } = useAuth();
  const [balance, setBalance] = useState<string | null>(null);
  const [copied, setCopied] = useState('');

  useEffect(() => {
    api<{ balance: string }>('/wallet')
      .then((r) => setBalance(r.data?.balance ?? null))
      .catch(() => undefined);
  }, []);

  if (!user) return null;

  const link = (leg: 'LEFT' | 'RIGHT') =>
    `${window.location.origin}/register?ref=${user.referralCode}&leg=${leg}`;

  const copy = async (leg: 'LEFT' | 'RIGHT') => {
    try {
      await navigator.clipboard.writeText(link(leg));
      setCopied(leg);
      setTimeout(() => setCopied(''), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

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
        <div className="card stat">
          <span className="muted">Referral code</span>
          <strong>{user.referralCode}</strong>
        </div>
      </div>

      <div className="card">
        <h2>Invite people</h2>
        <p className="muted">Share a link. New members are placed under you on the chosen leg.</p>
        {(['LEFT', 'RIGHT'] as const).map((leg) => (
          <div className="copy-row" key={leg}>
            <input readOnly value={link(leg)} />
            <button className="btn" onClick={() => copy(leg)}>
              {copied === leg ? 'Copied!' : `Copy ${leg.toLowerCase()}`}
            </button>
          </div>
        ))}
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
