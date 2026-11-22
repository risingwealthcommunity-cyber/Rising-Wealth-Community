import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../shared/api/apiClient';
import { inr, label } from '../../shared/format';
import { openProof } from '../campaigns/ReportsPage';
import { useRun } from '../../shared/useRun';

type State = 'PENDING' | 'APPROVED' | 'REJECTED' | 'INCOMPLETE' | 'MISSING' | 'ALREADY_EXISTING';
type Mark = 'REJECTED' | 'INCOMPLETE' | 'MISSING' | 'ALREADY_EXISTING';

interface Report {
  id: string;
  holderName: string;
  mobile: string;
  status: State;
  note: string | null;
  createdAt: string;
  processedAt: string | null;
  campaign: { id: string; title: string; reward: number };
  user: { name: string; email: string; referralCode: string };
}

const FILTERS: [string, string][] = [
  ['PENDING', 'Waiting'],
  ['APPROVED', 'Approved'],
  ['INCOMPLETE', 'Incomplete'],
  ['MISSING', 'Missing'],
  ['ALREADY_EXISTING', 'Already existing'],
  ['REJECTED', 'Rejected'],
  ['ALL', 'All']
];

/** The decisions that pay nothing, with what they mean (shown as the tooltip). */
const MARKS: { status: Mark; text: string; hint: string }[] = [
  { status: 'REJECTED', text: 'Reject', hint: 'Not valid. Nothing is paid.' },
  { status: 'INCOMPLETE', text: 'Mark as Incomplete', hint: 'The member can fix the report and send it again.' },
  { status: 'MISSING', text: 'Missing', hint: 'The account could not be found.' },
  { status: 'ALREADY_EXISTING', text: 'Already Existing', hint: 'This account was registered before.' }
];

const stamp = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

const csvCell = (v: string | number) => {
  const text = String(v);
  // a cell that starts with = + - @ would run as a formula in a spreadsheet
  const safe = /^[\t\r =+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** Every report: filter, search, sort, tick several and decide them together, see when each was submitted, download as CSV. */
export default function AdminReports() {
  const [status, setStatus] = useState('PENDING');
  const [campaignId, setCampaignId] = useState('');
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Report[] | null>(null);
  const [campaigns, setCampaigns] = useState<{ id: string; title: string }[]>([]);
  const [asc, setAsc] = useState<boolean | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const act = useRun();

  useEffect(() => {
    api<{ items: { id: string; title: string }[] }>('/admin/campaigns').then((r) => setCampaigns(r.data?.items ?? [])).catch(() => undefined);
  }, []);

  const load = useCallback(() => {
    const qs = `status=${status}${campaignId ? `&campaignId=${campaignId}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
    setPicked(new Set());
    api<{ items: Report[] }>(`/admin/reports?${qs}`).then((r) => setItems(r.data?.items ?? [])).catch(() => setItems([]));
  }, [status, campaignId, q]);
  useEffect(load, [load]);

  const rows = useMemo(() => {
    if (!items || asc === null) return items;
    return [...items].sort((a, b) => a.campaign.title.localeCompare(b.campaign.title) * (asc ? 1 : -1));
  }, [items, asc]);

  const closeMenu = (el: HTMLElement) => el.closest('details')?.removeAttribute('open');
  const waiting = (rows ?? []).filter((r) => r.status === 'PENDING');
  const chosen = waiting.filter((r) => picked.has(r.id));
  const allTicked = waiting.length > 0 && chosen.length === waiting.length;

  const flip = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  /** Run one decision on several reports, one after the other, and report how many went through. */
  const batch = (targets: Report[], run: (r: Report) => Promise<unknown>, done: string) =>
    void act.run(async () => {
      let ok = 0;
      let last = '';
      for (const r of targets) {
        try {
          await run(r);
          ok++;
        } catch (err) {
          last = (err as Error).message;
        }
      }
      load();
      if (ok < targets.length) throw new Error(`${ok} of ${targets.length} done. ${last}`);
      return { message: `${ok} ${done}` };
    });

  const approveOne = (r: Report, el: HTMLElement) => {
    closeMenu(el);
    batch([r], (x) => api(`/admin/reports/${x.id}/approve`, { method: 'POST' }), 'approved and the reward was added to the wallet.');
  };

  const markMany = (targets: Report[], m: (typeof MARKS)[number], el?: HTMLElement) => {
    if (el) closeMenu(el);
    const answer = window.prompt(`${m.text}${targets.length > 1 ? ` (${targets.length} reports)` : ''}: ${m.hint}\n\nReason the member can see (optional):`);
    if (answer === null) return;
    batch(targets, (x) => api(`/admin/reports/${x.id}/mark`, { method: 'POST', body: { status: m.status, ...(answer.trim() ? { note: answer.trim() } : {}) } }), `report${targets.length === 1 ? '' : 's'} marked as ${m.text.toLowerCase()}.`);
  };

  const approveMany = () => {
    if (!window.confirm(`Approve ${chosen.length} report${chosen.length === 1 ? '' : 's'} and pay the rewards?`)) return;
    batch(chosen, (x) => api(`/admin/reports/${x.id}/approve`, { method: 'POST' }), 'approved and the rewards were added.');
  };

  const download = () => {
    if (!rows?.length) return;
    const head = ['Campaign', 'Campaign ID', 'Submitter', 'Submitter email', 'Affiliate ID', 'Account holder', 'Phone', 'Submitted on', 'Status', 'Reason'];
    const lines = rows.map((r) => [r.campaign.title, r.campaign.id, r.user.name, r.user.email, r.user.referralCode, r.holderName, r.mobile, stamp(r.createdAt), label(r.status), r.note ?? ''].map(csvCell).join(','));
    const blob = new Blob([[head.map(csvCell).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `reports-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const reward = rows?.filter((r) => r.status === 'APPROVED').reduce((s, r) => s + r.campaign.reward, 0) ?? 0;

  return (
    <div className="card">
      <form
        className="rep-tools"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(typed.trim());
        }}
      >
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search by name or phone..." aria-label="Search reports" />
        <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} aria-label="Campaign">
          <option value="">All Campaigns</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          {FILTERS.map(([k, name]) => (
            <option key={k} value={k}>
              {name}
            </option>
          ))}
        </select>
        <button className="btn ghost">Search</button>
        <button className="btn" type="button" disabled={!rows?.length} onClick={download}>
          Download as CSV
        </button>
      </form>
      <p className="muted">
        {rows ? `${rows.length} report${rows.length === 1 ? '' : 's'}` : 'Loading...'}
        {reward > 0 && <> · approved rewards in this list {inr(reward)}</>}
      </p>

      {chosen.length > 0 && (
        <div className="bulk-bar" role="group" aria-label="Selected reports">
          <b>{chosen.length} selected</b>
          <button className="btn ok" type="button" disabled={act.busy} onClick={approveMany}>
            Approve selected
          </button>
          {MARKS.map((m) => (
            <button className="btn ghost" type="button" key={m.status} title={m.hint} disabled={act.busy} onClick={() => markMany(chosen, m)}>
              {m.text}
            </button>
          ))}
          <button className="btn ghost" type="button" onClick={() => setPicked(new Set())}>
            Clear
          </button>
        </div>
      )}
      {act.msg && <div className={`alert ${act.msg.type}`}>{act.msg.text}</div>}
      {rows && rows.length === 0 && <p className="muted">No reports found.</p>}

      {rows && rows.length > 0 && (
        <div className="table-wrap">
          <table className="rep-table">
            <thead>
              <tr>
                <th className="tick">
                  <input
                    type="checkbox"
                    aria-label="Select all waiting reports"
                    checked={allTicked}
                    disabled={waiting.length === 0}
                    onChange={() => setPicked(allTicked ? new Set() : new Set(waiting.map((r) => r.id)))}
                  />
                </th>
                <th>
                  <button type="button" className="sort-btn" onClick={() => setAsc((v) => (v === null ? true : v ? false : null))} aria-label="Sort by campaign">
                    Campaign {asc === null ? '↕' : asc ? '↑' : '↓'}
                  </button>
                </th>
                <th>Campaign ID</th>
                <th>Submitter</th>
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
                  <td className="tick">
                    {r.status === 'PENDING' && <input type="checkbox" aria-label={`Select the report of ${r.holderName}`} checked={picked.has(r.id)} onChange={() => flip(r.id)} />}
                  </td>
                  <td>
                    <b>{r.campaign.title}</b>
                    <small className="muted">{inr(r.campaign.reward)} per report</small>
                  </td>
                  <td>
                    <code className="idcell" title={r.campaign.id}>
                      {r.campaign.id.slice(0, 8)}
                    </code>
                  </td>
                  <td>
                    <b>{r.user.name}</b>
                    <small className="muted">{r.user.email}</small>
                  </td>
                  <td>{r.holderName}</td>
                  <td>{r.mobile}</td>
                  <td>{stamp(r.createdAt)}</td>
                  <td>
                    <span className={`badge ${r.status.toLowerCase()}`}>{label(r.status)}</span>
                    {r.note && <small className="muted">{r.note}</small>}
                  </td>
                  <td className="rep-actions">
                    <details className="menu">
                      <summary className="btn ghost" aria-label="Actions">
                        •••
                      </summary>
                      <div className="menu-pop">
                        <strong className="menu-title">Actions</strong>
                        <button type="button" onClick={(e) => void openProof(r.id).then(() => closeMenu(e.currentTarget))}>
                          View proof
                        </button>
                        {r.status === 'PENDING' && (
                          <>
                            <button type="button" className="ok" disabled={act.busy} onClick={(e) => approveOne(r, e.currentTarget)}>
                              Approve
                            </button>
                            {MARKS.map((m) => (
                              <button type="button" key={m.status} title={m.hint} disabled={act.busy} onClick={(e) => markMany([r], m, e.currentTarget)}>
                                {m.text}
                              </button>
                            ))}
                          </>
                        )}
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
