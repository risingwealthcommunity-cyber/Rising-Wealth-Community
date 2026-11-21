import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../shared/api/apiClient';
import { date, inr } from '../../shared/format';

type Status = 'DONE' | 'CURRENT' | 'LOCKED';

interface Bonuses {
  eligible: boolean;
  team: {
    targets: { target: number; members: number; reward: number; status: Status; completedAt: string | null }[];
    current: { target: number; members: number; reward: number } | null;
    pendingLeft: number;
    pendingRight: number;
    totalLeft: number;
    totalRight: number;
    completed: number;
  };
  leadership: {
    points: number;
    targets: { target: number; size: number; threshold: number; reward: number; status: Status; completedAt: string | null }[];
    current: { target: number; size: number; threshold: number; reward: number } | null;
    completed: number;
  };
  history: { id: string; kind: 'TEAM' | 'LEADERSHIP'; target: number; amount: string; note: string | null; createdAt: string }[];
}

const pct = (value: number, target: number) => Math.min(100, Math.round((value / target) * 100));
const statusText: Record<Status, string> = { DONE: 'Completed', CURRENT: 'In progress', LOCKED: 'Locked' };

export default function BonusesPage({ view }: { view: 'team' | 'leadership' }) {
  const [data, setData] = useState<Bonuses | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api<Bonuses>('/team/bonuses')
      .then((r) => setData(r.data ?? null))
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <p className="muted">Could not load your bonuses. Please try again.</p>;
  if (!data) return <p className="muted">Loading...</p>;
  const { team, leadership } = data;
  const cur = team.current;
  const lcur = leadership.current;
  const kind = view === 'team' ? 'TEAM' : 'LEADERSHIP';
  const mine = data.history.filter((h) => h.kind === kind);
  const earned = mine.reduce((sum, h) => sum + Number(h.amount), 0);

  return (
    <>
      <h1>{view === 'team' ? 'Team Performance Bonus' : 'Leadership Bonus'}</h1>

      {!data.eligible && (
        <div className="alert">
          Team and Leadership bonuses are for PRO and ELITE members. <Link to="/packages">Upgrade your package</Link> and the
          members who join after that are counted for you.
        </div>
      )}

      <div className="grid">
        <div className="card stat">
          <span className="muted">Earned from this bonus</span>
          <strong>{inr(earned)}</strong>
        </div>
        {view === 'team' ? (
          <>
            <div className="card stat">
              <span className="muted">Targets completed</span>
              <strong>
                {team.completed} / {team.targets.length}
              </strong>
            </div>
            <div className="card stat">
              <span className="muted">Whole team (left / right)</span>
              <strong>
                {team.totalLeft} / {team.totalRight}
              </strong>
            </div>
          </>
        ) : (
          <>
            <div className="card stat">
              <span className="muted">Leadership points</span>
              <strong>{leadership.points}</strong>
            </div>
            <div className="card stat">
              <span className="muted">Targets completed</span>
              <strong>
                {leadership.completed} / {leadership.targets.length}
              </strong>
            </div>
          </>
        )}
      </div>

      {view === 'team' && (
      <div className="card" data-testid="team-card">
        <h2>Your progress</h2>
        <p className="muted">
          New members on your LEFT and your RIGHT team (your whole downline counts). Each target needs the same number on both
          sides, fresh members only: members used for one target are never counted again.
        </p>

        {cur ? (
          <>
            <h3>
              Current target {cur.target}: {cur.members} : {cur.members} new members = {inr(cur.reward)}
            </h3>
            {(['Left', 'Right'] as const).map((side) => {
              const have = side === 'Left' ? team.pendingLeft : team.pendingRight;
              const need = Math.max(0, cur.members - have);
              return (
                <div key={side} data-testid={`pending-${side.toLowerCase()}`}>
                  <small className="muted">
                    {side}: {Math.min(have, cur.members)} / {cur.members}
                    {need > 0 ? ` (${need} more needed)` : ' (done)'}
                    {have > cur.members ? `, ${have - cur.members} extra kept for the next target` : ''}
                  </small>
                  <div className="bar">
                    <div style={{ width: `${pct(have, cur.members)}%` }} />
                  </div>
                </div>
              );
            })}
          </>
        ) : (
          <p>All {team.targets.length} team targets are completed. Well done!</p>
        )}
        <p className="muted">
          Whole team so far: {team.totalLeft} left, {team.totalRight} right.
        </p>

        <table className="ladder">
          <thead>
            <tr>
              <th>Target</th>
              <th>New members</th>
              <th>Bonus</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {team.targets.map((t) => (
              <tr key={t.target} className={`st-${t.status.toLowerCase()}`}>
                <td>{t.target}</td>
                <td>
                  {t.members} : {t.members}
                </td>
                <td>{inr(t.reward)}</td>
                <td>
                  <span className={`badge ${t.status === 'DONE' ? 'confirmed' : ''}`}>{statusText[t.status]}</span>
                  {t.completedAt && <small className="muted"> {date(t.completedAt)}</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      )}

      {view === 'leadership' && (
      <div className="card" data-testid="leadership-card">
        <h2>Your progress</h2>
        <p className="muted">
          You get 1 Leadership Point for every new member sponsored by one of your direct referrals. Targets are cumulative and each
          one pays as soon as you reach it.
        </p>
        {lcur ? (
          <>
            <h3>
              Next target {lcur.target}: {lcur.threshold} points = {inr(lcur.reward)}
            </h3>
            <small className="muted">
              {leadership.points} / {lcur.threshold} points ({Math.max(0, lcur.threshold - leadership.points)} more needed)
            </small>
            <div className="bar">
              <div style={{ width: `${pct(leadership.points, lcur.threshold)}%` }} />
            </div>
          </>
        ) : (
          <p>All Leadership targets are completed.</p>
        )}
        <table className="ladder">
          <thead>
            <tr>
              <th>Target</th>
              <th>Points needed (total)</th>
              <th>Bonus</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {leadership.targets.map((t) => (
              <tr key={t.target} className={`st-${t.status.toLowerCase()}`}>
                <td>{t.target}</td>
                <td>
                  {t.threshold} <small className="muted">(+{t.size})</small>
                </td>
                <td>{inr(t.reward)}</td>
                <td>
                  <span className={`badge ${t.status === 'DONE' ? 'confirmed' : ''}`}>{statusText[t.status]}</span>
                  {t.completedAt && <small className="muted"> {date(t.completedAt)}</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      )}

      <div className="card" data-testid="bonus-history">
        <h2>Bonus history</h2>
        {mine.length === 0 && (
          <p className="muted">No bonus yet. It is credited to your wallet the moment a target is completed.</p>
        )}
        <table>
          <tbody>
            {mine.map((h) => (
              <tr key={h.id}>
                <td>
                  {h.kind === 'TEAM' ? 'Team target' : 'Leadership target'} {h.target}
                </td>
                <td>
                  <strong>{inr(h.amount)}</strong>
                </td>
                <td className="muted">{h.note}</td>
                <td className="muted">{date(h.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
