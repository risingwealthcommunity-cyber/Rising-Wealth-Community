import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../shared/api/apiClient';
import { Avatar } from '../../shared/components/Avatar';
import AvatarPicker from '../../shared/components/AvatarPicker';
import { date, inr, label } from '../../shared/format';
import { useAuth } from '../auth';

interface Stats {
  stats: { total: number; team: number };
}
interface Board {
  me: { position: number };
}

export default function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const [picking, setPicking] = useState(false);
  const [stats, setStats] = useState<Stats['stats'] | null>(null);
  const [place, setPlace] = useState<number | null>(null);
  const [directs, setDirects] = useState<number | null>(null);

  useEffect(() => {
    api<Stats>('/dashboard/summary').then((r) => setStats(r.data?.stats ?? null)).catch(() => undefined);
    api<Board>('/dashboard/leaderboard').then((r) => setPlace(r.data?.me.position ?? 0)).catch(() => undefined);
    api<{ directReferrals: unknown[] }>('/team/summary').then((r) => setDirects(r.data?.directReferrals.length ?? 0)).catch(() => undefined);
  }, []);

  if (!user) return null;

  const rows: [string, string][] = [
    ['Name', user.name],
    ['Email', user.email],
    ['Mobile', user.phone ?? 'Not added'],
    ['Package', label(user.package)],
    ['Rank', user.rank === 'NONE' ? 'Not ranked yet' : label(user.rank)],
    ['Affiliate ID', user.referralCode],
    ['Joined', date(user.createdAt)],
    ['Leaderboard rank', place === null ? '...' : place > 0 ? `#${place}` : 'Not ranked yet']
  ];

  return (
    <>
      <h1>My profile</h1>

      <div className="profile-grid">
        <div className="card profile-card">
          <button type="button" className="dash-avatar profile-avatar" aria-label="Change your avatar" onClick={() => setPicking(true)}>
            <Avatar avatar={user.avatar} name={user.name} size={108} />
            <span className="dash-avatar-edit" aria-hidden="true">
              ✎
            </span>
          </button>
          <h2>{user.name}</h2>
          <span className="muted">{user.email}</span>
          <div className="dash-tags">
            <span className="dash-pill">{label(user.package).toUpperCase()}</span>
            {user.rank !== 'NONE' && <span className="dash-pill">{label(user.rank).toUpperCase()}</span>}
          </div>
          <button className="btn ghost" type="button" onClick={() => setPicking(true)}>
            Change avatar
          </button>
        </div>

        <div className="card">
          <h2>Account details</h2>
          <dl className="profile-rows">
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <div className="profile-actions">
            <Link className="btn ghost" to="/set-password">
              {user.hasPassword ? 'Change password' : 'Set a password'}
            </Link>
            <Link className="btn ghost" to="/activation">
              Upgrade package
            </Link>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Performance</h2>
        <div className="levels">
          <div className="level">
            <small>Total earnings</small>
            <strong>{stats ? inr(stats.total) : '...'}</strong>
          </div>
          <div className="level">
            <small>Direct referrals</small>
            <strong>{directs ?? '...'}</strong>
          </div>
          <div className="level">
            <small>Total team</small>
            <strong>{stats ? stats.team : '...'}</strong>
          </div>
        </div>
      </div>

      {picking && <AvatarPicker current={user.avatar} name={user.name} onSaved={refreshUser} onClose={() => setPicking(false)} />}
    </>
  );
}
