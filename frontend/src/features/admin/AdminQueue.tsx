import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api/apiClient';
import { date, inr, label } from '../../shared/format';
import { useRun } from '../../shared/useRun';

export type Status = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface Person {
  name: string;
  email: string;
  phone?: string | null;
  referralCode: string;
}

export const who = (p: Person) => (
  <>
    <b>{p.name}</b>
    <small className="muted">
      {p.email} · {p.referralCode}
      {p.phone ? ` · ${p.phone}` : ''}
    </small>
  </>
);

/** One review queue: pick a status, list the rows, approve or reject each. Shows the total when rows carry an amount. */
export function Queue<T extends { id: string; status: Status; createdAt: string }>({
  path,
  row,
  extra,
  amountOf,
  rejectLabel = 'Reject'
}: {
  path: string;
  row: (r: T) => React.ReactNode;
  extra?: (r: T) => React.ReactNode;
  amountOf?: (r: T) => number;
  rejectLabel?: string;
}) {
  const [status, setStatus] = useState<Status>('PENDING');
  const [items, setItems] = useState<T[] | null>(null);
  const act = useRun();

  const load = useCallback(() => {
    api<{ items: T[] }>(`${path}?status=${status}`).then((r) => setItems(r.data?.items ?? [])).catch(() => setItems([]));
  }, [path, status]);
  useEffect(load, [load]);

  const decide = (id: string, verb: 'approve' | 'reject') => {
    let note: string | undefined;
    if (verb === 'reject') {
      const answer = window.prompt('Reason (the member can see it). Leave empty for none.');
      if (answer === null) return;
      note = answer.trim() || undefined;
    }
    void act.run(async () => {
      const r = await api(`${path}/${id}/${verb}`, { method: 'POST', body: note ? { note } : {} });
      load();
      return r;
    });
  };

  const total = items && amountOf ? items.reduce((s, r) => s + amountOf(r), 0) : null;

  return (
    <div className="card">
      <div className="team-head">
        <select value={status} onChange={(e) => setStatus(e.target.value as Status)} aria-label="Status">
          <option value="PENDING">Waiting</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </select>
        <span className="muted">
          {items ? `${items.length} shown` : 'Loading...'}
          {total !== null && items && items.length > 0 && (
            <>
              {' · '}total <b>{inr(total)}</b>
            </>
          )}
        </span>
      </div>
      {act.msg && <div className={`alert ${act.msg.type}`}>{act.msg.text}</div>}
      {items && items.length === 0 && <p className="muted">Nothing here.</p>}
      <div className="report-list">
        {items?.map((r) => (
          <div className="report-row ops-row" key={r.id}>
            <div>{row(r)}</div>
            <span className="muted">{date(r.createdAt)}</span>
            <div className="report-actions">
              {extra?.(r)}
              {r.status === 'PENDING' ? (
                <>
                  <button className="btn" type="button" disabled={act.busy} onClick={() => decide(r.id, 'approve')}>
                    Approve
                  </button>
                  <button className="btn ghost danger" type="button" disabled={act.busy} onClick={() => decide(r.id, 'reject')}>
                    {rejectLabel}
                  </button>
                </>
              ) : (
                <span className={`badge ${r.status.toLowerCase()}`}>{label(r.status)}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
