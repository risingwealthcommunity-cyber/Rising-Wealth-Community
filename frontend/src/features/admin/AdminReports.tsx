import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api/apiClient';
import { date, inr, label } from '../../shared/format';
import { openProof } from '../campaigns/ReportsPage';
import { useRun } from '../../shared/useRun';

type State = 'PENDING' | 'APPROVED' | 'REJECTED' | 'INCOMPLETE' | 'MISSING' | 'ALREADY_EXISTING';

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
const MARKS: { status: 'REJECTED' | 'INCOMPLETE' | 'MISSING' | 'ALREADY_EXISTING'; text: string; hint: string }[] = [
  { status: 'REJECTED', text: 'Reject', hint: 'Not valid. Nothing is paid.' },
  { status: 'INCOMPLETE', text: 'Mark as incomplete', hint: 'The member can fix the report and send it again.' },
  { status: 'MISSING', text: 'Missing', hint: 'The account could not be found.' },
  { status: 'ALREADY_EXISTING', text: 'Already existing', hint: 'This account was registered before.' }
];

const stamp = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

const csvCell = (v: string | number) => {
  const text = String(v);
  // a cell that starts with = + - @ would run as a formula in a spreadsheet
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** Every report: filter by state and campaign, search, see when it was submitted, decide it, download as CSV. */
export default function AdminReports() {
  const [status, setStatus] = useState('PENDING');
  const [campaignId, setCampaignId] = useState('');
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Report[] | null>(null);
  const [campaigns, setCampaigns] = useState<{ id: string; title: string }[]>([]);
  const act = useRun();

  useEffect(() => {
    api<{ items: { id: string; title: string }[] }>('/admin/campaigns').then((r) => setCampaigns(r.data?.items ?? [])).catch(() => undefined);
  }, []);

  const load = useCallback(() => {
    const qs = `status=${status}${campaignId ? `&campaignId=${campaignId}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
    api<{ items: Report[] }>(`/admin/reports?${qs}`).then((r) => setItems(r.data?.items ?? [])).catch(() => setItems([]));
  }, [status, campaignId, q]);
  useEffect(load, [load]);

  const closeMenu = (el: HTMLElement) => el.closest('details')?.removeAttribute('open');

  const approve = (r: Report, el: HTMLElement) => {
    closeMenu(el);
    void act.run(async () => {
      const res = await api(`/admin/reports/${r.id}/approve`, { method: 'POST' });
      load();
      return res;
    });
  };

  const mark = (r: Report, m: (typeof MARKS)[number], el: HTMLElement) => {
    closeMenu(el);
    const answer = window.prompt(`${m.text}: ${m.hint}\n\nReason the member can see (optional):`);
    if (answer === null) return;
    void act.run(async () => {
      const res = await api(`/admin/reports/${r.id}/mark`, { method: 'POST', body: { status: m.status, ...(answer.trim() ? { note: answer.trim() } : {}) } });
      load();
      return res;
    });
  };

  const download = () => {
    if (!items?.length) return;
    const head = ['Campaign', 'Submitter', 'Submitter email', 'Affiliate ID', 'Account holder', 'Phone', 'Submitted on', 'Status', 'Reason'];
    const lines = items.map((r) => [r.campaign.title, r.user.name, r.user.email, r.user.referralCode, r.holderName, r.mobile, stamp(r.createdAt), label(r.status), r.note ?? ''].map(csvCell).join(','));
    const blob = new Blob([[head.map(csvCell).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `reports-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const reward = items?.filter((r) => r.status === 'APPROVED').reduce((s, r) => s + r.campaign.reward, 0) ?? 0;

  return (
    <div className="card">
      <form
        className="rep-tools"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(typed.trim());
        }}
      >
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search by name, phone, email or Affiliate ID..." aria-label="Search reports" />
        <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} aria-label="Campaign">
          <option value="">All campaigns</option>
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
        <button className="btn" type="button" disabled={!items?.length} onClick={download}>
          Download as CSV
        </button>
      </form>
      <p className="muted">
        {items ? `${items.length} report${items.length === 1 ? '' : 's'}` : 'Loading...'}
        {reward > 0 && <> · approved rewards in this list {inr(reward)}</>}
      </p>
      {act.msg && <div className={`alert ${act.msg.type}`}>{act.msg.text}</div>}
      {items && items.length === 0 && <p className="muted">No reports found.</p>}

      {items && items.length > 0 && (
        <div className="table-wrap">
          <table className="rep-table">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Submitter</th>
                <th>Account holder</th>
                <th>Phone</th>
                <th>Submitted on</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id}>
                  <td>
                    <b>{r.campaign.title}</b>
                    <small className="muted">{inr(r.campaign.reward)} per report</small>
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
                        Actions ▾
                      </summary>
                      <div className="menu-pop">
                        <button type="button" onClick={(e) => void openProof(r.id).then(() => closeMenu(e.currentTarget))}>
                          View proof
                        </button>
                        {r.status === 'PENDING' && (
                          <>
                            <button type="button" className="ok" disabled={act.busy} onClick={(e) => approve(r, e.currentTarget)}>
                              Approve
                            </button>
                            {MARKS.map((m) => (
                              <button type="button" key={m.status} title={m.hint} disabled={act.busy} onClick={(e) => mark(r, m, e.currentTarget)}>
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
