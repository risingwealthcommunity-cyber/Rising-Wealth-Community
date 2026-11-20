import { useEffect, useState } from 'react';
import { siteApi } from '../site';
import type { SiteAssets } from '../site';
import ImageSlot from './ImageSlot';

interface Field {
  key: string;
  label: string;
  max: number;
  multiline?: boolean;
  required?: boolean;
}

type Row = { id?: string } & Record<string, string | undefined>;

interface Props {
  block: 'team' | 'reviews';
  title: string;
  description: string;
  noun: string; // "member", "review"
  photoPrefix: 'team' | 'review';
  photoLabel: string;
  fields: Field[];
  items: ReadonlyArray<object>;
  assets: SiteAssets;
  maxItems: number;
  onSaved: () => void | Promise<void>;
}

/** Editable list (team members / reviews): add, reorder, remove, and a photo per saved item. */
export default function ListEditor(p: Props) {
  const [rows, setRows] = useState<Row[]>(p.items as Row[]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Pick up the saved version (new ids, removed rows) after every save or reload.
  const savedKey = JSON.stringify(p.items);
  useEffect(() => setRows(p.items as Row[]), [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (i: number, key: string, value: string) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [key]: value } : row)));
  const move = (i: number, d: -1 | 1) =>
    setRows((r) => {
      const j = i + d;
      if (j < 0 || j >= r.length) return r;
      const next = [...r];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const items = rows.map((row) => {
        const out: Record<string, string | undefined> = { id: row.id };
        for (const f of p.fields) out[f.key] = (row[f.key] ?? '').trim();
        return out;
      });
      await siteApi.save(p.block, { items });
      await p.onSaved();
      setMsg({ type: 'success', text: 'Saved. Add photos to the new rows below.' });
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

      {rows.length === 0 && <p className="muted">Nothing here yet. The section stays hidden on the home page until you add one.</p>}

      {rows.map((row, i) => (
        <div className="row-edit" key={row.id ?? `new-${i}`}>
          <div className="row-edit-fields">
            {p.fields.map((f) => (
              <label key={f.key}>
                {f.label}
                {f.multiline ? (
                  <textarea
                    value={row[f.key] ?? ''}
                    maxLength={f.max}
                    rows={3}
                    onChange={(e) => set(i, f.key, e.target.value)}
                  />
                ) : (
                  <input value={row[f.key] ?? ''} maxLength={f.max} onChange={(e) => set(i, f.key, e.target.value)} />
                )}
              </label>
            ))}
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
              <button className="btn ghost" type="button" onClick={() => setRows((r) => r.filter((_, idx) => idx !== i))}>
                Remove {p.noun}
              </button>
            </div>
          </div>
          <ImageSlot
            title={p.photoLabel}
            assetKey={`${p.photoPrefix}-${row.id}`}
            asset={row.id ? p.assets[`${p.photoPrefix}-${row.id}`] : undefined}
            lockedNote={row.id ? undefined : `Save first, then add the ${p.photoLabel.toLowerCase()}`}
            onChanged={p.onSaved}
          />
        </div>
      ))}

      <div className="site-img-actions">
        <button
          className="btn ghost"
          type="button"
          disabled={rows.length >= p.maxItems}
          onClick={() => setRows((r) => [...r, Object.fromEntries(p.fields.map((f) => [f.key, '']))])}
        >
          Add {p.noun}
        </button>
        <button className="btn" type="button" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving...' : `Save ${p.title.toLowerCase()}`}
        </button>
      </div>
    </div>
  );
}
