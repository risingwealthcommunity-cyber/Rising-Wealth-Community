import { useEffect, useState } from 'react';
import { api } from '../../shared/api/apiClient';
import { Avatar } from '../../shared/components/Avatar';
import { inr, label } from '../../shared/format';

interface Row {
  position: number;
  name: string;
  avatar: string | null;
  rank: string;
  package: string;
  total: number;
  me: boolean;
}

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'Last 30 Days' },
  { key: 'all', label: 'All Time' }
] as const;
type Period = (typeof PERIODS)[number]['key'];

const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };
const tag = (r: Row) => (r.rank === 'NONE' ? label(r.package) : label(r.rank));

function Podium({ row }: { row: Row }) {
  return (
    <div className={`pod pod-${row.position}${row.me ? ' me' : ''}`}>
      <div className="pod-avatar">
        <Avatar avatar={row.avatar} name={row.name} size={row.position === 1 ? 96 : 76} />
      </div>
      <span className="pod-place">
        {MEDAL[row.position]} {row.position === 1 ? '1st' : row.position === 2 ? '2nd' : '3rd'}
        {row.me && ' · YOU'}
      </span>
      <strong>{row.name}</strong>
      <em>{inr(row.total)}</em>
    </div>
  );
}

function Line({ row }: { row: Row }) {
  return (
    <div className={`board-row${row.me ? ' me' : ''}`}>
      <span className="board-pos">{row.position > 0 ? `#${row.position}` : '–'}</span>
      <span className="board-who">
        <Avatar avatar={row.avatar} name={row.name} size={38} />
        <span className="board-name">
          {row.name}
          {row.me && <small>This is you</small>}
        </span>
      </span>
      <span className="badge">{tag(row)}</span>
      <span className="board-count">{inr(row.total)}</span>
    </div>
  );
}

export default function LeaderboardPage() {
  const [data, setData] = useState<{ items: Row[]; me: Row } | null>(null);
  const [failed, setFailed] = useState(false);
  const [period, setPeriod] = useState<Period>('all');

  useEffect(() => {
    let current = true;
    setFailed(false);
    api<{ items: Row[]; me: Row }>(`/dashboard/leaderboard?period=${period}`)
      .then((r) => current && setData(r.data ?? null))
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [period]);

  const items = data?.items ?? [];
  const podium = [items[1], items[0], items[2]].filter(Boolean); // 2nd, 1st, 3rd
  const rest = items.slice(3);
  const meOutside = data && !items.some((r) => r.me) ? data.me : null;

  return (
    <>
      <div>
        <h1>Leaderboard</h1>
        <p className="muted">The top 10 members by income earned in the period you choose. Only first names are shown.</p>
      </div>

      <div className="period-toggle" role="tablist" aria-label="Leaderboard period">
        {PERIODS.map((p) => (
          <button key={p.key} type="button" role="tab" aria-selected={period === p.key} className={period === p.key ? 'on' : ''} onClick={() => setPeriod(p.key)}>
            {p.label}
          </button>
        ))}
      </div>

      {failed && <div className="alert error">Could not load the leaderboard. Please try again.</div>}
      {!failed && !data && <p className="muted">Loading...</p>}

      {data && items.length === 0 && (
        <div className="card empty-state">
          <strong>No one is on the board {period === 'all' ? 'yet' : 'for this period'}</strong>
          {period === 'all' ? 'Earn your first income and you will be the first name here.' : 'Nobody has earned in this period yet. Try another period, or be the first.'}
        </div>
      )}

      {podium.length > 0 && (
        <div className="podium">
          {podium.map((r) => (
            <Podium row={r} key={r.position} />
          ))}
        </div>
      )}

      {(rest.length > 0 || meOutside) && (
        <div className="card">
          <h2>Rankings</h2>
          <div className="board">
            {rest.map((r) => (
              <Line row={r} key={r.position} />
            ))}
            {meOutside && (
              <>
                <div className="board-gap" aria-hidden="true">
                  Your position
                </div>
                <Line row={meOutside} />
                {meOutside.position === 0 && <p className="muted board-note">{period === 'all' ? 'Earn your first income to get ranked.' : 'You have not earned in this period yet.'}</p>}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
