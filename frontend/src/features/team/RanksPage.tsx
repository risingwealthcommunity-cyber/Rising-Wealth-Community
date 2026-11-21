import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api/apiClient';
import { inr, label } from '../../shared/format';
import { useRun } from '../../shared/useRun';

interface RankRow {
  rank: string;
  points: number;
  reward: number;
  status: 'ACHIEVED' | 'NEXT' | 'LOCKED';
  perk: { title: string; description: string } | null;
  claim: { status: 'PENDING' | 'APPROVED' | 'REJECTED'; note: string | null } | null;
}

const STATE: Record<RankRow['status'], string> = { ACHIEVED: 'Achieved', NEXT: 'Next goal', LOCKED: 'Locked' };

export default function RanksPage() {
  const [data, setData] = useState<{ rank: string; items: RankRow[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const claim = useRun();

  const load = useCallback(() => {
    api<{ rank: string; items: RankRow[] }>('/team/ranks').then((r) => setData(r.data ?? null)).catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);

  const ask = (r: RankRow) =>
    void claim.run(async () => {
      const res = await api(`/team/perks/${r.rank}/claim`, { method: 'POST' });
      load();
      return res;
    });

  return (
    <>
      <div>
        <h1>Ranks &amp; rewards</h1>
        <p className="muted">
          Each rank pays a one-time cash reward the moment you reach it, and may come with a perk. Rank points reset after every rank, and a rank reward is paid only once.
        </p>
      </div>

      {failed && <div className="alert error">Could not load the ranks. Please try again.</div>}
      {!failed && !data && <p className="muted">Loading...</p>}
      {data && (
        <div className="card rank-now">
          <small className="muted">Your rank</small>
          <strong>{data.rank === 'NONE' ? 'Not ranked yet' : label(data.rank)}</strong>
        </div>
      )}
      {claim.msg && <div className={`alert ${claim.msg.type}`}>{claim.msg.text}</div>}

      <div className="rank-grid">
        {data?.items.map((r) => (
          <div className={`card rank-card ${r.status.toLowerCase()}`} key={r.rank}>
            <div className="rank-top">
              <h3>{label(r.rank)}</h3>
              <span className={`rank-state ${r.status.toLowerCase()}`}>{STATE[r.status]}</span>
            </div>
            <p className="muted">
              {r.points.toLocaleString('en-IN')} : {r.points.toLocaleString('en-IN')} new points
            </p>
            <strong className="rank-reward">{inr(r.reward)}</strong>
            <small className="muted">one-time reward</small>
            {r.perk ? (
              <div className="rank-perk">
                <b>🎁 {r.perk.title}</b>
                {r.perk.description && <small className="muted">{r.perk.description}</small>}
              </div>
            ) : (
              <small className="muted">No perk announced for this rank yet.</small>
            )}
            {r.claim ? (
              <span className={`badge ${r.claim.status.toLowerCase()}`}>
                Perk claim: {label(r.claim.status)}
                {r.claim.status === 'REJECTED' && r.claim.note ? ` (${r.claim.note})` : ''}
              </span>
            ) : (
              r.status === 'ACHIEVED' &&
              r.perk && (
                <button className="btn" type="button" disabled={claim.busy} onClick={() => ask(r)}>
                  Claim this perk
                </button>
              )
            )}
          </div>
        ))}
      </div>
    </>
  );
}
