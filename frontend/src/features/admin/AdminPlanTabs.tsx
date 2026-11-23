import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../shared/api/apiClient';
import { date, inr, label } from '../../shared/format';
import { useRun } from '../../shared/useRun';
import ImageSlot from './ImageSlot';

interface Level {
  members: number;
  reward: number;
  name?: string;
  perkTitle?: string;
  perkText?: string;
}

/**
 * The rank of every Team Performance level: its name, cash reward and extra reward (bike, trip, gadget...). It is the same list as the
 * levels on the Bonuses page: add a level there and it appears here, remove one and it is gone from here too.
 */
export function RankPerksEditor() {
  const [levels, setLevels] = useState<Level[] | null>(null);
  const [leadership, setLeadership] = useState<unknown[]>([]);
  const save = useRun();

  const load = useCallback(() => {
    api<{ settings: { rewards: { team: Level[]; leadership: unknown[] } } }>('/admin/bonuses')
      .then((r) => {
        setLevels(r.data?.settings.rewards.team ?? []);
        setLeadership(r.data?.settings.rewards.leadership ?? []);
      })
      .catch(() => setLevels([]));
  }, []);
  useEffect(load, [load]);

  const set = (i: number, patch: Partial<Level>) => setLevels((l) => l && l.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const team = (levels ?? []).map((r) => ({
      members: r.members,
      reward: Number(r.reward),
      name: (r.name ?? '').trim(),
      perkTitle: (r.perkTitle ?? '').trim(),
      perkText: (r.perkText ?? '').trim()
    }));
    if (team.some((t) => !Number.isFinite(t.reward) || t.reward < 0)) return save.setMsg({ type: 'error', text: 'Every cash reward must be a number of rupees, zero or more.' });
    void save.run(async () => {
      const r = await api('/site/content/bonusRewards', { method: 'PUT', body: { team, leadership } });
      load();
      return r;
    }, 'Saved. Members see the new names and extra rewards on the Team Performance Bonus page.');
  };

  return (
    <form className="card stack" onSubmit={submit}>
      <h2>Rank perks</h2>
      <p className="muted">
        One section for each Team Performance level. Give the rank a name, set its cash reward, and write its extra reward (for example "Goa trip, up to ₹25,000"; leave empty for none). Members who complete the level can claim it, and claims appear below.
        To add or remove a rank, add or remove a level on the Bonuses page: it appears here, or disappears, by itself.
      </p>
      {levels === null && <p className="muted">Loading...</p>}
      {levels?.map((r, i) => (
        <div className="row-edit" key={i}>
          <div className="row-edit-fields">
            <b>
              Level {i + 1} <span className="muted">· {r.members} : {r.members} new members</span>
            </b>
            <div className="form-row">
              <label>
                Rank name
                <input value={r.name ?? ''} onChange={(e) => set(i, { name: e.target.value })} placeholder="e.g. Silver" maxLength={40} />
              </label>
              <label>
                Cash reward (₹)
                <input value={String(r.reward)} inputMode="decimal" onChange={(e) => set(i, { reward: e.target.value as unknown as number })} />
              </label>
            </div>
            <input value={r.perkTitle ?? ''} onChange={(e) => set(i, { perkTitle: e.target.value })} placeholder="Extra reward (empty = none)" maxLength={80} />
            <textarea rows={2} value={r.perkText ?? ''} onChange={(e) => set(i, { perkText: e.target.value })} placeholder="Details (optional)" maxLength={300} />
          </div>
        </div>
      ))}
      {save.msg && <div className={`alert ${save.msg.type}`}>{save.msg.text}</div>}
      <div className="profile-actions">
        <button className="btn" disabled={save.busy || levels === null || levels.length === 0}>
          Save rank perks
        </button>
      </div>
    </form>
  );
}

interface Session {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  link: string;
  minTier: 'TRAINEE' | 'PRO' | 'ELITE';
  isActive: boolean;
  posterUrl?: string | null;
}

/** `<input type="datetime-local">` wants the local time without a zone. */
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const EMPTY = { title: '', description: '', startsAt: '', link: '', minTier: 'TRAINEE', isActive: true };

/** Live trainings: when, the join link, and who may join. */
export function LiveEditor() {
  const [items, setItems] = useState<Session[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const act = useRun();

  const load = useCallback(() => {
    api<{ items: Session[] }>('/admin/live').then((r) => setItems(r.data?.items ?? [])).catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  const reset = () => {
    setEditId(null);
    setForm(EMPTY);
  };
  const edit = (s: Session) => {
    setEditId(s.id);
    setForm({ title: s.title, description: s.description, startsAt: toLocalInput(s.startsAt), link: s.link, minTier: s.minTier, isActive: s.isActive });
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!form.startsAt) return act.setMsg({ type: 'error', text: 'Choose the date and time.' });
    void act.run(async () => {
      const body = { ...form, startsAt: new Date(form.startsAt).toISOString() };
      const r = await api(editId ? `/admin/live/${editId}` : '/admin/live', { method: editId ? 'PUT' : 'POST', body });
      reset();
      load();
      return r;
    });
  };
  const remove = (s: Session) => {
    if (!window.confirm(`Delete "${s.title}"?`)) return;
    void act.run(async () => {
      const r = await api(`/admin/live/${s.id}`, { method: 'DELETE' });
      load();
      return r;
    });
  };

  return (
    <>
      <form className="card stack" onSubmit={save}>
        <h2>{editId ? 'Edit live training' : 'New live training'}</h2>
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
            Date and time
            <input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} required />
          </label>
          <label>
            Join link (https)
            <input value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="https://" required />
          </label>
          <label>
            Who can join
            <select value={form.minTier} onChange={(e) => setForm({ ...form, minTier: e.target.value })}>
              <option value="TRAINEE">Everyone</option>
              <option value="PRO">PRO and ELITE</option>
              <option value="ELITE">ELITE only</option>
            </select>
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Visible to members
        </label>
        {editId ? (
          <ImageSlot
            title="Poster (thumbnail)"
            hint="PNG, JPEG or WebP. Shown on the training in the members' Live Trainings list."
            assetKey={`live-${editId}`}
            asset={items.find((s) => s.id === editId)?.posterUrl ? { url: items.find((s) => s.id === editId)!.posterUrl as string, updatedAt: '' } : undefined}
            onChanged={load}
          />
        ) : (
          <p className="muted">Poster: add the training first, then edit it to add a poster.</p>
        )}
        {act.msg && <div className={`alert ${act.msg.type}`}>{act.msg.text}</div>}
        <div className="profile-actions">
          <button className="btn" disabled={act.busy}>
            {editId ? 'Save' : 'Add live training'}
          </button>
          {editId && (
            <button className="btn ghost" type="button" onClick={reset}>
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="card">
        <h2>Schedule</h2>
        {items.length === 0 && <p className="muted">Nothing scheduled.</p>}
        <div className="report-list">
          {items.map((s) => (
            <div className="report-row ops-row" key={s.id}>
              <div>
                {s.posterUrl && <img className="camp-thumb" src={s.posterUrl} alt="" width={48} height={48} />}
                <b>{s.title}</b>
                <small className="muted">
                  {date(s.startsAt)} · {s.minTier === 'TRAINEE' ? 'everyone' : `${s.minTier}+`} · {s.isActive ? 'visible' : 'hidden'}
                </small>
              </div>
              <span />
              <div className="report-actions">
                <button className="btn ghost" type="button" onClick={() => edit(s)}>
                  Edit
                </button>
                <button className="btn ghost danger" type="button" onClick={() => remove(s)}>
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
