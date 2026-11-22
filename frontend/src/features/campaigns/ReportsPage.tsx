import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../shared/api/apiClient';
import { compressImage } from '../../shared/compressImage';
import { date, inr, label } from '../../shared/format';
import { useRun } from '../../shared/useRun';
import type { Campaign } from './CampaignsPage';

interface Report {
  id: string;
  holderName: string;
  mobile: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'INCOMPLETE' | 'MISSING' | 'ALREADY_EXISTING';
  note: string | null;
  createdAt: string;
  campaign: { id: string; title: string; reward: number };
}

/** Opens a proof picture in a new tab (it is fetched with the session, so only its owner can see it). */
export async function openProof(id: string) {
  const r = await api<{ mime: string; data: string }>(`/campaigns/reports/${id}/file`);
  if (!r.data) return;
  const bytes = Uint8Array.from(atob(r.data.data), (c) => c.charCodeAt(0));
  window.open(URL.createObjectURL(new Blob([bytes], { type: r.data.mime })), '_blank', 'noopener');
}

export default function ReportsPage() {
  const [params] = useSearchParams();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [q, setQ] = useState('');
  const [campaignId, setCampaignId] = useState(params.get('campaign') ?? '');
  const [holder, setHolder] = useState('');
  const [mobile, setMobile] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [editing, setEditing] = useState<Report | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const form = useRun();
  const list = useRun();

  const load = useCallback(async () => {
    const [c, r] = await Promise.all([api<{ items: Campaign[] }>('/campaigns'), api<{ items: Report[] }>('/campaigns/reports')]);
    setCampaigns((c.data?.items ?? []).filter((x) => x.needsProof));
    setReports(r.data?.items ?? []);
  }, []);
  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const reset = () => {
    setEditing(null);
    setHolder('');
    setMobile('');
    setFile(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void form.run(async () => {
      const picture = file ? await compressImage(file) : null;
      if (editing) {
        const r = await api(`/campaigns/reports/${editing.id}`, { method: 'PUT', body: { holderName: holder, mobile, ...(picture ?? {}) } });
        reset();
        await load();
        return r;
      }
      if (!picture) throw new Error('Choose the screenshot that proves the account was opened.');
      const r = await api('/campaigns/reports', { method: 'POST', body: { campaignId, holderName: holder, mobile, ...picture } });
      reset();
      await load();
      return r;
    });
  };

  const edit = (r: Report) => {
    setEditing(r);
    setCampaignId(r.campaign.id);
    setHolder(r.holderName);
    setMobile(r.mobile);
    setFile(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const remove = (r: Report) => {
    if (!window.confirm(`Delete the report for ${r.holderName}?`)) return;
    void list.run(async () => {
      const res = await api(`/campaigns/reports/${r.id}`, { method: 'DELETE' });
      if (editing?.id === r.id) reset();
      await load();
      return res;
    });
  };

  const shown = reports.filter((r) => `${r.holderName} ${r.campaign.title} ${r.mobile}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <>
      <div>
        <h1>Submit reports</h1>
        <p className="muted">Upload the proof for each account you got opened. The screenshot must clearly show the successful account creation.</p>
      </div>

      <div className="reports-grid">
        <form className="card" onSubmit={submit}>
          <h2>{editing ? 'Edit report' : 'New report'}</h2>
          <label>
            Campaign
            <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} disabled={!!editing} required>
              <option value="">Choose campaign</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} ({inr(c.reward)})
                </option>
              ))}
            </select>
          </label>
          <label>
            Account holder name
            <input value={holder} onChange={(e) => setHolder(e.target.value)} placeholder="Enter account holder name" maxLength={80} required />
          </label>
          <label>
            Mobile number
            <input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="Registered mobile number" inputMode="numeric" maxLength={10} required />
          </label>
          <label>
            Screenshot {editing && <span className="muted">(leave empty to keep the old one)</span>}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          {form.msg && <div className={`alert ${form.msg.type}`}>{form.msg.text}</div>}
          <div className="campaign-actions">
            <button className="btn" disabled={form.busy || !campaignId || !holder || !mobile}>
              {form.busy ? 'Sending...' : editing ? 'Save changes' : 'Submit report'}
            </button>
            {editing && (
              <button className="btn ghost" type="button" onClick={reset}>
                Cancel
              </button>
            )}
          </div>
        </form>

        <div className="card">
          <h2>My reports</h2>
          <input className="team-search" placeholder="Search reports..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search your reports" />
          {list.msg && <div className={`alert ${list.msg.type}`}>{list.msg.text}</div>}
          {shown.length === 0 && <p className="muted">No reports found.</p>}
          <div className="report-list">
            {shown.map((r) => (
              <div className="report-row" key={r.id}>
                <div>
                  <b>{r.holderName}</b>
                  <small className="muted">
                    {r.campaign.title} · {r.mobile} · submitted {date(r.createdAt)}
                  </small>
                  {r.status === 'INCOMPLETE' && <small className="muted">The team needs more: fix the report with Edit and it goes back for review.</small>}
                  {r.status === 'MISSING' && <small className="muted">We could not find this account.</small>}
                  {r.status === 'ALREADY_EXISTING' && <small className="muted">This account was already registered before.</small>}
                  {r.note && r.status !== 'APPROVED' && r.status !== 'PENDING' && <small className="muted">Reason: {r.note}</small>}
                </div>
                <span className={`badge ${r.status.toLowerCase()}`}>{label(r.status)}</span>
                <div className="report-actions">
                  <button className="btn ghost" type="button" onClick={() => void openProof(r.id)}>
                    View
                  </button>
                  {(r.status === 'PENDING' || r.status === 'INCOMPLETE') && (
                    <>
                      <button className="btn ghost" type="button" onClick={() => edit(r)}>
                        Edit
                      </button>
                      <button className="btn ghost danger" type="button" onClick={() => remove(r)}>
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
