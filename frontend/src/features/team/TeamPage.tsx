import { useEffect, useState } from 'react';
import { api } from '../../shared/api/apiClient';
import { date, inr, label } from '../../shared/format';

interface Team {
  rank: string;
  points: { left: number; right: number; unmatchedLeft: number; unmatchedRight: number };
  nextRank: { rank: string; requiredEachLeg: number; reward: number } | null;
  directReferrals: { id: string; name: string; package: string; leg: string | null; createdAt: string }[];
}

const pct = (value: number, target: number) => Math.min(100, Math.round((value / target) * 100));

export default function TeamPage() {
  const [team, setTeam] = useState<Team | null>(null);

  useEffect(() => {
    api<Team>('/team/summary').then((r) => setTeam(r.data ?? null)).catch(() => undefined);
  }, []);

  if (!team) return <p className="muted">Loading...</p>;
  const next = team.nextRank;

  return (
    <>
      <h1>My team</h1>

      <div className="grid">
        <div className="card stat">
          <span className="muted">Rank</span>
          <strong>{team.rank === 'NONE' ? 'Not ranked yet' : label(team.rank)}</strong>
        </div>
        <div className="card stat">
          <span className="muted">Left points</span>
          <strong>{team.points.left}</strong>
        </div>
        <div className="card stat">
          <span className="muted">Right points</span>
          <strong>{team.points.right}</strong>
        </div>
      </div>

      {next && (
        <div className="card">
          <h2>
            Next rank: {label(next.rank)} ({inr(next.reward)} one-time)
          </h2>
          <p className="muted">
            Needs {next.requiredEachLeg} : {next.requiredEachLeg} new points. Points reset after every rank.
          </p>
          {(['left', 'right'] as const).map((leg) => (
            <div key={leg}>
              <small className="muted">
                {label(leg)}: {team.points[leg]} / {next.requiredEachLeg}
              </small>
              <div className="bar">
                <div style={{ width: `${pct(team.points[leg], next.requiredEachLeg)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>Direct referrals ({team.directReferrals.length})</h2>
        {team.directReferrals.length === 0 && <p className="muted">Share your link from the dashboard to build your team.</p>}
        <table>
          <tbody>
            {team.directReferrals.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{label(r.package)}</td>
                <td className="muted">{r.leg ?? '-'}</td>
                <td className="muted">{date(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
