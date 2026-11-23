import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../shared/api/apiClient';

interface Session {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  minTier: 'TRAINEE' | 'PRO' | 'ELITE';
  unlocked: boolean;
  posterUrl?: string | null;
  link?: string;
}

/** A session counts as "live now" from its start for 3 hours (the server keeps it listed that long). */
const LIVE_MS = 3 * 3_600_000;

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export default function LivePage() {
  const [items, setItems] = useState<Session[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    api<{ items: Session[] }>('/live').then((r) => setItems(r.data?.items ?? [])).catch(() => setFailed(true));
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <div>
        <h1>Live trainings</h1>
        <p className="muted">Join the team live. Some sessions are for PRO or ELITE members only.</p>
      </div>
      {failed && <div className="alert error">Could not load the schedule. Please try again.</div>}
      {!failed && !items && <p className="muted">Loading...</p>}
      {items && items.length === 0 && (
        <div className="card empty-state">
          <strong>No live training is scheduled</strong>
          New sessions show up here as soon as the team adds them.
        </div>
      )}
      <div className="live-list">
        {items?.map((s) => {
          const start = new Date(s.startsAt).getTime();
          const live = now >= start && now <= start + LIVE_MS;
          return (
            <div className={`card live-card${live ? ' now' : ''}`} key={s.id}>
              {s.posterUrl && <img className="live-poster" src={s.posterUrl} alt={`Poster of ${s.title}`} loading="lazy" />}
              <div>
                <div className="live-when">
                  {live && <span className="live-dot">LIVE NOW</span>}
                  <span>{when(s.startsAt)}</span>
                  {s.minTier !== 'TRAINEE' && <span className="badge">{s.minTier} only</span>}
                </div>
                <h3>{s.title}</h3>
                {s.description && <p className="muted">{s.description}</p>}
              </div>
              {s.unlocked && s.link ? (
                <a className="btn" href={s.link} target="_blank" rel="noopener noreferrer">
                  {live ? 'Join now' : 'Open link'}
                </a>
              ) : (
                <Link className="btn ghost" to="/activation">
                  Upgrade to {s.minTier} to join
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
