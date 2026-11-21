import { useEffect, useState } from 'react';
import { api } from '../../shared/api/apiClient';
import { label } from '../../shared/format';

interface Row {
  position: number;
  name: string;
  rank: string;
  package: string;
  directs: number;
  me: boolean;
}

export default function LeaderboardPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api<{ items: Row[] }>('/dashboard/leaderboard')
      .then((r) => setRows(r.data?.items ?? []))
      .catch(() => setFailed(true));
  }, []);

  return (
    <>
      <div>
        <h1>Leaderboard</h1>
        <p className="muted">The top 20 members by direct referrals. Only first names are shown.</p>
      </div>

      <div className="card">
        {failed && <p className="muted">Could not load the leaderboard. Please try again.</p>}
        {!failed && !rows && <p className="muted">Loading...</p>}
        {rows && rows.length === 0 && (
          <div className="empty-state">
            <strong>No one is on the board yet</strong>
            Refer your first member and you will be the first name here.
          </div>
        )}
        {rows && rows.length > 0 && (
          <div className="board">
            {rows.map((r) => (
              <div className={`board-row${r.me ? ' me' : ''}`} key={r.position}>
                <span className="board-pos">{r.position}</span>
                <span className="board-name">
                  {r.name}
                  {r.me && <small>This is you</small>}
                </span>
                <span className="badge">{r.rank === 'NONE' ? label(r.package) : label(r.rank)}</span>
                <span className="board-count">
                  {r.directs}
                  <small>direct{r.directs === 1 ? '' : 's'}</small>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
