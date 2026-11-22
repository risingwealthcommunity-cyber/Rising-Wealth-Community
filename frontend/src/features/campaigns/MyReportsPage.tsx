import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../shared/api/apiClient';
import { date, inr, label } from '../../shared/format';
import { useRun } from '../../shared/useRun';
import { openProof } from './ReportsPage';

type State = 'PENDING' | 'APPROVED' | 'REJECTED' | 'INCOMPLETE' | 'MISSING' | 'ALREADY_EXISTING';

interface Report {
  id: string;
  holderName: string;
  mobile: string;
  status: State;
  note: string | null;
  createdAt: string;
  campaign: { id: string; title: string; reward: number };
}

const FILTERS: [string, string][] = [
  ['ALL', 'All'],
  ['PENDING', 'Waiting'],
  ['APPROVED', 'Approved'],
  ['INCOMPLETE', 'Incomplete'],
  ['MISSING', 'Missing'],
  ['ALREADY_EXISTING', 'Already existing'],
  ['REJECTED', 'Rejected']
];

const PAGE = 20;

/** Every report I sent, with its state, the date I submitted it, and what to do next. */
export default function MyReportsPage() {
  const [items, setItems] = useState<Report[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');
  const [state, setState] = useState('ALL');
  const [page, setPage] = useState(1);
  const act = useRun();

  const load = useCallback(() => {
    api<{ items: Report[] }>('/campaigns/reports').then((r) => setItems(r.data?.items ?? [])).catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);

  const remove = (r: Report) => {
    if (!window.confirm(`Delete the report for ${r.holderName}?`)) return;
    void act.run(async () => {
      const res = await api(`/campaigns/reports/${r.id}`, { method: 'DELETE' });
      load();
      return res;
    });
  };

  const needle = q.trim().toLowerCase();
  const shown = (items ?? []).filter((r) => (state === 'ALL' || r.status === state) && (!needle || `${r.holderName} ${r.mobile} ${r.campaign.title}`.toLowerCase().includes(needle)));
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const rows = shown.slice((page - 1) * PAGE, page * PAGE);
  const earned = (items ?? []).filter((r) => r.status === 'APPROVED').reduce((s, r) => s + r.campaign.reward, 0);
  const count = (s: State) => (items ?? []).filter((r) => r.status === s).length;

  return (
    <>
      <div className="team-head">
        <div>
          <h1>My reports</h1>
          <p className="muted">All the reports you sent. Fix an incomplete one and it goes back for review.</p>
        </div>
        <Link className="btn" to="/reports">
          Submit a new report
        </Link>
      </div>

      {failed && <div className="alert error">Could not load your reports. Please try again.</div>}
      {!failed && !items && <p className="muted">Loading...</p>}

      {items && (
        <div className="levels">
          <div className="level">
            <small>Total</small>
            <strong>{items.length}</strong>
          </div>
          <div className="level">
            <small>Approved</small>
            <strong>{count('APPROVED')}</strong>
          </div>
          <div className="level">
            <small>Waiting</small>
            <strong>{count('PENDING')}</strong>
          </div>
          <div className="level">
            <small>Need your attention</small>
            <strong>{count('INCOMPLETE')}</strong>
          </div>
          <div className="level">
            <small>Reward from approved</small>
            <strong>{inr(earned)}</strong>
          </div>
        </div>
      )}

      {items && (
        <div className="card">
          <div className="rep-tools">
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="Search by name, phone or campaign..."
              aria-label="Search your reports"
            />
            <select
              value={state}
              onChange={(e) => {
                setState(e.target.value);
                setPage(1);
              }}
              aria-label="Status"
            >
              {FILTERS.map(([k, name]) => (
                <option key={k} value={k}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          {act.msg && <div className={`alert ${act.msg.type}`}>{act.msg.text}</div>}
          {shown.length === 0 && <p className="muted">{items.length === 0 ? 'You have not sent any report yet.' : 'No reports match.'}</p>}

          {rows.length > 0 && (
            <div className="table-wrap">
              <table className="rep-table">
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>Account holder</th>
                    <th>Phone</th>
                    <th>Submitted on</th>
                    <th>Status</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <b>{r.campaign.title}</b>
                        <small className="muted">{inr(r.campaign.reward)} per report</small>
                      </td>
                      <td>{r.holderName}</td>
                      <td>{r.mobile}</td>
                      <td>{date(r.createdAt)}</td>
                      <td>
                        <span className={`badge ${r.status.toLowerCase()}`}>{label(r.status)}</span>
                        {r.status === 'INCOMPLETE' && <small className="muted">More is needed. Edit and send again.</small>}
                        {r.status === 'MISSING' && <small className="muted">We could not find this account.</small>}
                        {r.status === 'ALREADY_EXISTING' && <small className="muted">Already registered before.</small>}
                        {r.note && r.status !== 'APPROVED' && r.status !== 'PENDING' && <small className="muted">Reason: {r.note}</small>}
                      </td>
                      <td className="rep-actions">
                        <button className="btn ghost" type="button" onClick={() => void openProof(r.id)}>
                          View
                        </button>
                        {(r.status === 'PENDING' || r.status === 'INCOMPLETE') && (
                          <>
                            <Link className="btn ghost" to={`/reports?edit=${r.id}`}>
                              Edit
                            </Link>
                            <button className="btn ghost danger" type="button" disabled={act.busy} onClick={() => remove(r)}>
                              Delete
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {pages > 1 && (
            <div className="pager">
              <button className="btn ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <span className="muted">
                Page {page} of {pages}
              </span>
              <button className="btn ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
