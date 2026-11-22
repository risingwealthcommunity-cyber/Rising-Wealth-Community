import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../shared/api/apiClient';
import { inr } from '../../shared/format';
import { useRun } from '../../shared/useRun';
import ImageSlot from './ImageSlot';

export interface Camp {
  id: string;
  title: string;
  groupName: string;
  description: string;
  reward: number;
  url: string;
  linkType: 'STANDARD' | 'PERSONAL';
  videoUrl: string;
  needsProof: boolean;
  isDemat: boolean;
  isActive: boolean;
  logoUrl: string | null;
}

const EMPTY = {
  title: '',
  groupName: '',
  description: '',
  reward: '' as string | number,
  url: '',
  linkType: 'STANDARD' as 'STANDARD' | 'PERSONAL',
  videoUrl: '',
  needsProof: true,
  isDemat: false,
  isActive: true
};

type Form = typeof EMPTY;

const body = (f: Omit<Form, 'reward'>, reward: number) => ({
  title: f.title,
  groupName: f.groupName,
  description: f.description,
  reward,
  url: f.url,
  linkType: f.linkType,
  videoUrl: f.videoUrl,
  needsProof: f.needsProof,
  isDemat: f.isDemat,
  isActive: f.isActive
});

const formOf = (c: Camp): Form => ({
  title: c.title,
  groupName: c.groupName,
  description: c.description,
  reward: c.reward,
  url: c.url,
  linkType: c.linkType,
  videoUrl: c.videoUrl,
  needsProof: c.needsProof,
  isDemat: c.isDemat,
  isActive: c.isActive
});

/** A switch: a checkbox that looks like the on/off toggle in the reference panel. */
function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden="true" />
      <span className="switch-text">{label}</span>
    </label>
  );
}

/** Create new campaign (the form) and Existing campaigns (the list). What is saved here is what members see under Active Campaigns. */
export default function AdminCampaigns() {
  const [items, setItems] = useState<Camp[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const act = useRun();

  const load = useCallback(() => {
    api<{ items: Camp[] }>('/admin/campaigns').then((r) => setItems(r.data?.items ?? [])).catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  const editing = items.find((c) => c.id === editId) ?? null;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const reset = () => {
    setEditId(null);
    setForm(EMPTY);
  };
  const edit = (c: Camp) => {
    setEditId(c.id);
    setForm(formOf(c));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    const reward = Number(form.reward);
    if (!Number.isFinite(reward) || reward < 0) return act.setMsg({ type: 'error', text: 'Enter the income per report in rupees.' });
    void act.run(
      async () => {
        const r = await api(editId ? `/admin/campaigns/${editId}` : '/admin/campaigns', { method: editId ? 'PUT' : 'POST', body: body(form, reward) });
        reset();
        load();
        return r;
      },
      editId ? 'Campaign saved.' : 'Campaign created. Members can see it under Active Campaigns.'
    );
  };

  const toggle = (c: Camp, on: boolean) =>
    void act.run(
      async () => {
        const r = await api(`/admin/campaigns/${c.id}`, { method: 'PUT', body: body({ ...formOf(c), isActive: on }, c.reward) });
        load();
        return r;
      },
      on ? 'Campaign is live for members.' : 'Campaign hidden from members.'
    );

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
        <p className="muted">{editId ? 'Change the details below. Members see the change straight away.' : 'Fill out the form to add a new campaign.'}</p>

        <label>
          Campaign name
          <input value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={80} placeholder="e.g., Summer Promotion" required />
        </label>
        <label>
          Group name (optional)
          <input value={form.groupName} onChange={(e) => set('groupName', e.target.value)} maxLength={60} placeholder="e.g., summer_promo_2024" />
        </label>
        <label>
          Description (optional)
          <textarea rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} maxLength={300} placeholder="Describe the campaign" />
        </label>
        <div className="form-row two">
          <label>
            Income per report (₹)
            <input value={form.reward} inputMode="decimal" onChange={(e) => set('reward', e.target.value)} placeholder="e.g., 50" required />
          </label>
          <label>
            Referral link (optional)
            <input value={form.url} onChange={(e) => set('url', e.target.value)} placeholder="https://.../?ref=SUMMER24" />
          </label>
        </div>
        <label>
          YouTube video link (optional)
          <input value={form.videoUrl} onChange={(e) => set('videoUrl', e.target.value)} placeholder="e.g., https://www.youtube.com/watch?v=..." />
        </label>
        <label className="narrow">
          Link generation type
          <select value={form.linkType} onChange={(e) => set('linkType', e.target.value as Form['linkType'])}>
            <option value="STANDARD">Standard (the same link for everyone)</option>
            <option value="PERSONAL">Personalised (adds the member's Affiliate ID)</option>
          </select>
        </label>

        <Switch checked={form.isActive} onChange={(v) => set('isActive', v)} label="Campaign is active" />
        <Switch checked={form.needsProof} onChange={(v) => set('needsProof', v)} label="Campaign requires documents" />
        <p className="muted">
          {form.needsProof
            ? 'Members can submit a report with a screenshot for this campaign (it shows in Submit Reports).'
            : 'Turned off: this campaign will NOT show in the Submit Reports list, members only get the link. Turn it on if you want reports and proof.'}
        </p>
        <Switch checked={form.isDemat} onChange={(v) => set('isDemat', v)} label="Demat account opening (a paid report also pays the Demat income plan: member's direct income + 5 sponsor levels)" />

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
            <p className="muted">Logo: save the campaign first, then edit it to add a logo.</p>
          )}
        </div>

        {act.msg && <div className={`alert ${act.msg.type}`}>{act.msg.text}</div>}
        <div className="profile-actions">
          <button className="btn solid" disabled={act.busy}>
            {editId ? 'Save campaign' : 'Create campaign'}
          </button>
          {editId && (
            <button className="btn ghost" type="button" onClick={reset}>
              Cancel
            </button>
          )}
        </div>
      </form>

      <h2 className="section-title">Existing campaigns</h2>
      {items.length === 0 && (
        <div className="card">
          <p className="muted">No campaigns yet. Create the first one above.</p>
        </div>
      )}
      <div className="camp-list">
        {items.map((c) => (
          <div className="card camp-card" key={c.id}>
            <div className="camp-line">
              {c.logoUrl ? <img className="camp-thumb" src={c.logoUrl} alt="" width={48} height={48} /> : <span className="camp-thumb empty" aria-hidden="true" />}
              <div className="camp-info">
                <b>{c.title}</b>
                <span>{inr(c.reward)} / report</span>
                <small>
                  Code: <code>{c.url || '(no link)'}</code>
                </small>
                <small>
                  Requires documents: <b>{c.needsProof ? 'Yes' : 'No (not listed in Submit Reports)'}</b>
                </small>
                <small>
                  Link type: <b>{c.linkType === 'PERSONAL' ? 'Personalised' : 'Standard'}</b>
                  {c.groupName ? ` · Group: ${c.groupName}` : ''}
                  {c.isDemat ? ' · Demat plan' : ''}
                </small>
              </div>
            </div>
            <div className="camp-actions">
              <Switch checked={c.isActive} disabled={act.busy} onChange={(v) => toggle(c, v)} label={c.isActive ? 'Active' : 'Inactive'} />
              <button className="btn ghost" type="button" onClick={() => edit(c)}>
                Edit
              </button>
              <button className="btn bad" type="button" onClick={() => remove(c)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
