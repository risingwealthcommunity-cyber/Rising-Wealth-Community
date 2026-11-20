import { useEffect, useMemo, useState } from 'react';
import { siteApi } from '../site';
import type { SiteAssets, SiteContent } from '../site';
import ImageSlot from './ImageSlot';
import PendingPhoto from './PendingPhoto';

interface Field {
  key: string;
  label: string;
  max: number;
  multiline?: boolean;
  required?: boolean;
}

type Values = Record<string, string>;
interface Draft {
  k: string; // local key, stable while rows are reordered
  id?: string; // server id, present once saved
  values: Values;
  file?: File; // photo chosen for a row that is not saved yet
}

interface Props {
  block: 'team' | 'reviews';
  title: string;
  description: string;
  noun: string; // "member", "review"
  photoPrefix: 'team' | 'review';
  photoLabel: string;
  /** When true, a row without a photo is flagged: it will not be shown on the website. */
  photoRequired?: boolean;
  fields: Field[];
  items: ReadonlyArray<object>;
  assets: SiteAssets;
  maxItems: number;
  onSaved: () => void | Promise<void>;
}

let counter = 0;
const newKey = () => `k${Date.now().toString(36)}${counter++}`;

const toDrafts = (items: ReadonlyArray<object>, fields: Field[]): Draft[] =>
  (items as Array<Record<string, string | undefined>>).map((it) => ({
    k: it.id ?? newKey(),
    id: it.id,
    values: Object.fromEntries(fields.map((f) => [f.key, it[f.key] ?? '']))
  }));

/** Editable list (team members / reviews): add, reorder, remove, and a photo for each row. */
export default function ListEditor(p: Props) {
  const [rows, setRows] = useState<Draft[]>(() => toDrafts(p.items, p.fields));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // pick up the saved version (new ids, removed rows) after every save or reload
  const savedKey = JSON.stringify(p.items);
  useEffect(() => setRows(toDrafts(p.items, p.fields)), [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = useMemo(() => {
    if (rows.some((r) => r.file)) return true;
    const now = JSON.stringify(rows.map((r) => ({ id: r.id, ...r.values })));
    const before = JSON.stringify(toDrafts(p.items, p.fields).map((r) => ({ id: r.id, ...r.values })));
    return now !== before;
  }, [rows, savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // do not lose work by accident
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const patch = (k: string, change: Partial<Draft> | ((d: Draft) => Draft)) =>
    setRows((all) => all.map((r) => (r.k === k ? (typeof change === 'function' ? change(r) : { ...r, ...change }) : r)));
  const setValue = (k: string, key: string, value: string) => patch(k, (d) => ({ ...d, values: { ...d.values, [key]: value } }));
  const move = (index: number, dir: -1 | 1) =>
    setRows((all) => {
      const j = index + dir;
      if (j < 0 || j >= all.length) return all;
      const next = [...all];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });

  const label = (r: Draft) => r.values[p.fields[0].key]?.trim() || `this ${p.noun}`;
  const hasPhoto = (r: Draft) => Boolean(r.file || (r.id && p.assets[`${p.photoPrefix}-${r.id}`]));

  const remove = (r: Draft) => {
    const extra = r.id ? ' Their photo is deleted too when you press Save.' : '';
    if (window.confirm(`Remove ${label(r)}?${extra}`)) setRows((all) => all.filter((x) => x.k !== r.k));
  };

  const save = async () => {
    setMsg(null);
    for (const r of rows) {
      const missing = p.fields.find((f) => f.required && !r.values[f.key]?.trim());
      if (missing) {
        setMsg({ type: 'error', text: `Please fill in "${missing.label}" for every ${p.noun}.` });
        return;
      }
    }

    setBusy(true);
    try {
      const items = rows.map((r) => ({
        id: r.id,
        ...Object.fromEntries(p.fields.map((f) => [f.key, (r.values[f.key] ?? '').trim()]))
      }));
      const saved: SiteContent = await siteApi.save(p.block, { items });
      const list = (p.block === 'team' ? saved.team : saved.reviews) ?? [];

      // the server keeps the order we sent, so row i is list[i]; upload any photos chosen before saving
      const failed: string[] = [];
      for (let i = 0; i < rows.length; i++) {
        const file = rows[i].file;
        const id = list[i]?.id;
        if (!file || !id) continue;
        try {
          await siteApi.upload(`${p.photoPrefix}-${id}`, file);
        } catch (err) {
          failed.push(`${label(rows[i])}: ${(err as Error).message}`);
        }
      }
      await p.onSaved();
      setMsg(
        failed.length
          ? { type: 'error', text: `Saved, but some photos did not upload (${failed.join('; ')}). Use Replace on those rows.` }
          : { type: 'success', text: 'Saved. It is live on the home page.' }
      );
    } catch (err) {
      setMsg({ type: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>{p.title}</h2>
      <p className="muted">{p.description}</p>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}

      {rows.length === 0 && <p className="muted">Nothing here yet. Press &ldquo;Add {p.noun}&rdquo; to start.</p>}

      {rows.map((r, i) => (
        <div className="row-edit" key={r.k}>
          <div className="row-edit-fields">
            {p.fields.map((f) => (
              <label key={f.key}>
                {f.label}
                {f.multiline ? (
                  <textarea
                    value={r.values[f.key] ?? ''}
                    maxLength={f.max}
                    rows={4}
                    onChange={(e) => setValue(r.k, f.key, e.target.value)}
                  />
                ) : (
                  <input value={r.values[f.key] ?? ''} maxLength={f.max} onChange={(e) => setValue(r.k, f.key, e.target.value)} />
                )}
              </label>
            ))}
            {p.photoRequired && !hasPhoto(r) && (
              <div className="alert">This {p.noun} will not appear on the website until it has a photo.</div>
            )}
            <div className="row-edit-actions">
              <button className="btn ghost" type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                {'↑'}
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === rows.length - 1}
                aria-label="Move down"
              >
                {'↓'}
              </button>
              <button className="btn ghost danger" type="button" onClick={() => remove(r)}>
                Remove {p.noun}
              </button>
            </div>
          </div>

          {r.id ? (
            <ImageSlot
              title={p.photoLabel}
              assetKey={`${p.photoPrefix}-${r.id}`}
              asset={p.assets[`${p.photoPrefix}-${r.id}`]}
              onChanged={p.onSaved}
            />
          ) : (
            <PendingPhoto
              title={p.photoLabel}
              file={r.file}
              onPick={(file) => patch(r.k, { file })}
              onError={(text) => setMsg({ type: 'error', text })}
            />
          )}
        </div>
      ))}

      <div className="site-img-actions save-bar">
        <button
          className="btn ghost"
          type="button"
          disabled={rows.length >= p.maxItems}
          onClick={() => setRows((all) => [...all, { k: newKey(), values: Object.fromEntries(p.fields.map((f) => [f.key, ''])) }])}
        >
          Add {p.noun}
        </button>
        <button className="btn" type="button" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? 'Saving...' : `Save ${p.title.toLowerCase()}`}
        </button>
        {dirty && !busy && <span className="unsaved">Unsaved changes</span>}
      </div>
    </div>
  );
}
