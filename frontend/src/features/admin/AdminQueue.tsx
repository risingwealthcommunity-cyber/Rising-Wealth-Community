import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api/apiClient';
import { inr, label } from '../../shared/format';
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

const stamp = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * A review queue as a table: when, the details, and Approve / Reject (plus any extra button, like "View screenshot").
 * When rows carry an amount the total is shown too.
 */
export function Queue<T extends { id: string; status: Status; createdAt: string }>({
  path,
  title,
  row,
  extra,
  amountOf,
  rejectLabel = 'Reject'
}: {
  path: string;
  title?: string;
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
        {title ? <h2>{title}</h2> : <span />}
        {total !== null && (
          <div className="wd-total">
            <small>Total of the shown</small>
            <strong>{inr(total)}</strong>
            <small>{items ? `${items.length} request${items.length === 1 ? '' : 's'}` : ''}</small>
          </div>
        )}
      </div>
      <div className="rep-tools">
        <select value={status} onChange={(e) => setStatus(e.target.value as Status)} aria-label="Status">
          <option value="PENDING">Waiting</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </select>
        {total === null && <span className="muted">{items ? `${items.length} shown` : 'Loading...'}</span>}
      </div>
      {act.msg && <div className={`alert ${act.msg.type}`}>{act.msg.text}</div>}
      {items && items.length === 0 && <p className="muted">Nothing here.</p>}

      {items && items.length > 0 && (
        <div className="table-wrap">
          <table className="rep-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Details</th>
                <th className="center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id}>
                  <td>{stamp(r.createdAt)}</td>
                  <td>{row(r)}</td>
                  <td className="rep-actions center">
                    {extra?.(r)}
                    {r.status === 'PENDING' ? (
                      <>
                        <button className="btn ok" type="button" disabled={act.busy} onClick={() => decide(r.id, 'approve')}>
                          Approve
                        </button>
                        <button className="btn bad" type="button" disabled={act.busy} onClick={() => decide(r.id, 'reject')}>
                          {rejectLabel}
                        </button>
                      </>
                    ) : (
                      <span className={`badge ${r.status.toLowerCase()}`}>{label(r.status)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            {total !== null && (
              <tfoot>
                <tr>
                  <td>
                    <b>Total</b>
                  </td>
                  <td colSpan={2}>
                    <b>{inr(total)}</b>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
