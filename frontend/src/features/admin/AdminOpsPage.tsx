import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../shared/api/apiClient';
import { date, inr, label } from '../../shared/format';
import { useRun } from '../../shared/useRun';
import { openProof } from '../campaigns/ReportsPage';
import AdminWithdrawals from './AdminWithdrawals';
import { LiveEditor, RankPerksEditor } from './AdminPlanTabs';
import { openProofAt } from '../../shared/openProof';

type Status = 'PENDING' | 'APPROVED' | 'REJECTED';
type Tab = 'funds' | 'withdrawals' | 'reports' | 'campaigns' | 'perks' | 'live';

interface Person {
  name: string;
  email: string;
  phone?: string | null;
  referralCode: string;
}
interface FundReq {
  id: string;
  amount: string;
  reference: string;
  status: Status;
  createdAt: string;
  user: Person;
}
interface Bank {
  bankName: string;
  account: string;
  ifsc: string;
  upiId: string;
}
interface WdReq {
  id: string;
  amount: string;
  status: Status;
  createdAt: string;
  user: Person;
  bank: Bank | null;
}
interface Rep {
  id: string;
  holderName: string;
  mobile: string;
  status: Status;
  createdAt: string;
  campaign: { title: string; reward: number };
  user: Person;
}
interface Claim {
  id: string;
  rank: string;
  status: Status;
  createdAt: string;
  user: Person;
}
interface Camp {
  id: string;
  title: string;
  description: string;
  reward: number;
  url: string;
  videoUrl: string;
  needsProof: boolean;
  isDemat: boolean;
  isActive: boolean;
}

const who = (p: Person) => (
  <>
    <b>{p.name}</b>
    <small className="muted">
      {p.email} · {p.referralCode}
      {p.phone ? ` · ${p.phone}` : ''}
    </small>
  </>
);

/** One review queue: pick a status, list the rows, approve or reject each. */
function Queue<T extends { id: string; status: Status; createdAt: string }>({
  path,
  row,
  extra,
  rejectLabel = 'Reject'
}: {
  path: string;
  row: (r: T) => React.ReactNode;
  extra?: (r: T) => React.ReactNode;
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

  return (
    <div className="card">
      <div className="team-head">
        <select value={status} onChange={(e) => setStatus(e.target.value as Status)} aria-label="Status">
          <option value="PENDING">Waiting</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </select>
        <span className="muted">{items ? `${items.length} shown` : 'Loading...'}</span>
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

const EMPTY: Omit<Camp, 'id'> = { title: '', description: '', reward: 0, url: '', videoUrl: '', needsProof: true, isDemat: false, isActive: true };

function Campaigns() {
  const [items, setItems] = useState<Camp[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY, reward: '' as string | number });
  const act = useRun();

  const load = useCallback(() => {
    api<{ items: Camp[] }>('/admin/campaigns').then((r) => setItems(r.data?.items ?? [])).catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  const reset = () => {
    setEditId(null);
    setForm({ ...EMPTY, reward: '' });
  };
  const edit = (c: Camp) => {
    setEditId(c.id);
    setForm({ title: c.title, description: c.description, reward: c.reward, url: c.url, videoUrl: c.videoUrl, needsProof: c.needsProof, isDemat: c.isDemat, isActive: c.isActive });
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    const reward = Number(form.reward);
    if (!Number.isFinite(reward) || reward < 0) return act.setMsg({ type: 'error', text: 'Enter the reward in rupees.' });
    void act.run(async () => {
      const r = await api(editId ? `/admin/campaigns/${editId}` : '/admin/campaigns', { method: editId ? 'PUT' : 'POST', body: { ...form, reward } });
      reset();
      load();
      return r;
    });
  };
  const remove = (c: Camp) => {
    if (!window.confirm(`Delete "${c.title}"? A campaign that already has reports is switched off instead.`)) return;
    void act.run(async () => {
      const r = await api(`/admin/campaigns/${c.id}`, { method: 'DELETE' });
      load();
      return r;
    });
  };

  return (
    <>
      <form className="card stack" onSubmit={save}>
        <h2>{editId ? 'Edit campaign' : 'New campaign'}</h2>
        <label>
          Title
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={80} required />
        </label>
        <label>
          Short description
          <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={300} />
        </label>
        <div className="form-row">
          <label>
            Reward (₹)
            <input value={form.reward} inputMode="decimal" onChange={(e) => setForm({ ...form, reward: e.target.value })} required />
          </label>
          <label>
            Link members share (https)
            <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://" required />
          </label>
          <label>
            Video link (optional)
            <input value={form.videoUrl} onChange={(e) => setForm({ ...form, videoUrl: e.target.value })} placeholder="https://" />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={form.needsProof} onChange={(e) => setForm({ ...form, needsProof: e.target.checked })} /> Members must send a proof report (reward after approval)
        </label>
        <label className="check">
          <input type="checkbox" checked={form.isDemat} onChange={(e) => setForm({ ...form, isDemat: e.target.checked })} /> This is a Demat account opening: approving a report pays the Demat income plan (member's direct income + 5 sponsor levels)
        </label>
        <label className="check">
          <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Visible to members
        </label>
        {act.msg && <div className={`alert ${act.msg.type}`}>{act.msg.text}</div>}
        <div className="profile-actions">
          <button className="btn" disabled={act.busy}>
            {editId ? 'Save campaign' : 'Create campaign'}
          </button>
          {editId && (
            <button className="btn ghost" type="button" onClick={reset}>
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="card">
        <h2>Campaigns</h2>
        {items.length === 0 && <p className="muted">No campaigns yet.</p>}
        <div className="report-list">
          {items.map((c) => (
            <div className="report-row ops-row" key={c.id}>
              <div>
                <b>{c.title}</b>
                <small className="muted">
                  {inr(c.reward)} · {c.needsProof ? 'with report' : 'no report'} · {c.isDemat ? 'Demat plan · ' : ''}{c.isActive ? 'visible' : 'hidden'}
                </small>
              </div>
              <span />
              <div className="report-actions">
                <button className="btn ghost" type="button" onClick={() => edit(c)}>
                  Edit
                </button>
                <button className="btn ghost danger" type="button" onClick={() => remove(c)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export default function AdminOpsPage() {
  const [tab, setTab] = useState<Tab>('funds');
  const tabs: [Tab, string][] = [
    ['funds', 'Fund requests'],
    ['withdrawals', 'Withdrawals'],
    ['reports', 'Reports'],
    ['campaigns', 'Campaigns'],
    ['perks', 'Rank perks'],
    ['live', 'Live trainings']
  ];

  return (
    <>
      <div className="team-head">
        <h1>Operations</h1>
        <Link className="btn ghost" to="/admin">
          Back to admin
        </Link>
      </div>
      <div className="dash-tabs ops-tabs">
        {tabs.map(([k, name]) => (
          <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>
            {name}
          </button>
        ))}
      </div>

      {tab === 'funds' && (
        <Queue<FundReq>
          path="/admin/fund-requests"
          row={(r) => (
            <>
              {who(r.user)}
              <small>
                <b>{inr(r.amount)}</b> · transaction ID <b>{r.reference}</b>
              </small>
            </>
          )}
          extra={(r) => (
            <button className="btn ghost" type="button" onClick={() => void openProofAt(`/admin/fund-requests/${r.id}/proof`)}>
              View screenshot
            </button>
          )}
        />
      )}
      {tab === 'withdrawals' && <AdminWithdrawals />}
      {tab === 'reports' && (
        <Queue<Rep>
          path="/admin/reports"
          row={(r) => (
            <>
              {who(r.user)}
              <small>
                {r.campaign.title} ({inr(r.campaign.reward)}) · {r.holderName} · {r.mobile}
              </small>
            </>
          )}
          extra={(r) => (
            <button className="btn ghost" type="button" onClick={() => void openProof(r.id)}>
              View proof
            </button>
          )}
        />
      )}
      {tab === 'campaigns' && <Campaigns />}
      {tab === 'perks' && (
        <>
          <Queue<Claim>
            path="/admin/perk-claims"
            row={(r) => (
              <>
                {who(r.user)}
                <small>
                  Wants the <b>{label(r.rank)}</b> perk
                </small>
              </>
            )}
            rejectLabel="Reject"
          />
          <RankPerksEditor />
        </>
      )}
      {tab === 'live' && <LiveEditor />}
    </>
  );
}
