import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../shared/api/apiClient';
import { inr } from '../../shared/format';
import { useRun } from '../../shared/useRun';
import ImageSlot from './ImageSlot';

export interface Camp {
  id: string;
  title: string;
  description: string;
  reward: number;
  url: string;
  videoUrl: string;
  needsProof: boolean;
  isDemat: boolean;
  isActive: boolean;
  logoUrl: string | null;
}

const EMPTY = { title: '', description: '', reward: '' as string | number, url: '', videoUrl: '', needsProof: true, isDemat: false, isActive: true };

const body = (f: typeof EMPTY, reward: number) => ({ title: f.title, description: f.description, reward, url: f.url, videoUrl: f.videoUrl, needsProof: f.needsProof, isDemat: f.isDemat, isActive: f.isActive });

/** Create, edit, switch on/off and delete campaigns. Each can have a logo. */
export default function AdminCampaigns() {
  const [items, setItems] = useState<Camp[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const act = useRun();

  const load = useCallback(() => {
    api<{ items: Camp[] }>('/admin/campaigns').then((r) => setItems(r.data?.items ?? [])).catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  const editing = items.find((c) => c.id === editId) ?? null;
  const reset = () => {
    setEditId(null);
    setForm(EMPTY);
  };
  const edit = (c: Camp) => {
    setEditId(c.id);
    setForm({ title: c.title, description: c.description, reward: c.reward, url: c.url, videoUrl: c.videoUrl, needsProof: c.needsProof, isDemat: c.isDemat, isActive: c.isActive });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    const reward = Number(form.reward);
    if (!Number.isFinite(reward) || reward < 0) return act.setMsg({ type: 'error', text: 'Enter the reward in rupees.' });
    void act.run(async () => {
      const r = await api(editId ? `/admin/campaigns/${editId}` : '/admin/campaigns', { method: editId ? 'PUT' : 'POST', body: body(form, reward) });
      reset();
      load();
      return r;
    });
  };

  const toggle = (c: Camp) =>
    void act.run(async () => {
      const r = await api(`/admin/campaigns/${c.id}`, {
        method: 'PUT',
        body: body({ title: c.title, description: c.description, reward: c.reward, url: c.url, videoUrl: c.videoUrl, needsProof: c.needsProof, isDemat: c.isDemat, isActive: !c.isActive }, c.reward)
      });
      load();
      return r;
    }, c.isActive ? 'Campaign hidden from members.' : 'Campaign is live for members.');

  const remove = (c: Camp) => {
    if (!window.confirm(`Delete "${c.title}"? A campaign that already has reports is switched off instead.`)) return;
    void act.run(async () => {
      const r = await api(`/admin/campaigns/${c.id}`, { method: 'DELETE' });
      if (editId === c.id) reset();
      load();
      return r;
    });
  };

  return (
    <>
      <form className="card stack" onSubmit={save}>
        <h2>{editId ? 'Edit campaign' : 'Create new campaign'}</h2>
        <p className="muted">{editId ? 'Change the details below, or add its logo.' : 'Fill out the form to add a new campaign.'}</p>

        <div className="campaign-logo-slot">
          {editing ? (
            <ImageSlot
              title="Campaign logo"
              hint="PNG, JPEG or WebP. Shown on the campaign card."
              assetKey={`campaign-${editing.id}`}
              asset={editing.logoUrl ? { url: editing.logoUrl, updatedAt: '' } : undefined}
              onChanged={load}
            />
          ) : (
            <p className="muted">Save the campaign first, then you can add its logo.</p>
          )}
        </div>

        <label>
          Campaign name
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={80} placeholder="e.g., Upstox Non-Trade (November)" required />
        </label>
        <label>
          Description (optional)
          <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={300} />
        </label>
        <div className="form-row">
          <label>
            Income per report (₹)
            <input value={form.reward} inputMode="decimal" onChange={(e) => setForm({ ...form, reward: e.target.value })} placeholder="e.g., 50" required />
          </label>
          <label>
            Referral link members share (https)
            <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://" required />
          </label>
          <label>
            YouTube video link (optional)
            <input value={form.videoUrl} onChange={(e) => setForm({ ...form, videoUrl: e.target.value })} placeholder="https://" />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Campaign is active (visible to members)
        </label>
        <label className="check">
          <input type="checkbox" checked={form.needsProof} onChange={(e) => setForm({ ...form, needsProof: e.target.checked })} /> Campaign requires documents (members send a proof report, reward after approval)
        </label>
        <label className="check">
          <input type="checkbox" checked={form.isDemat} onChange={(e) => setForm({ ...form, isDemat: e.target.checked })} /> This is a Demat account opening: approving a report pays the Demat income plan (member's direct income + 5 sponsor levels)
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
        <h2>Existing campaigns</h2>
        {items.length === 0 && <p className="muted">No campaigns yet.</p>}
        <div className="report-list">
          {items.map((c) => (
            <div className="report-row ops-row" key={c.id}>
              <div className="camp-line">
                {c.logoUrl ? <img className="camp-thumb" src={c.logoUrl} alt="" width={44} height={44} /> : <span className="camp-thumb empty" aria-hidden="true" />}
                <div>
                  <b>{c.title}</b>
                  <small className="muted">
                    {inr(c.reward)} / report · {c.needsProof ? 'requires documents' : 'no documents'}
                    {c.isDemat ? ' · Demat plan' : ''}
                  </small>
                  <small className="muted">{c.url}</small>
                </div>
              </div>
              <label className="switch-line">
                <input type="checkbox" checked={c.isActive} disabled={act.busy} onChange={() => toggle(c)} aria-label={`${c.title} is active`} />
                {c.isActive ? 'Active' : 'Inactive'}
              </label>
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
