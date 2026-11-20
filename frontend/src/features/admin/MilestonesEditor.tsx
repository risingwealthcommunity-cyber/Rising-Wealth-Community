import { useEffect, useState } from 'react';
import { siteApi } from '../site';
import type { Milestone, SiteAssets } from '../site';
import ImageSlot from './ImageSlot';

interface Props {
  saved: Milestone[]; // what the home page currently shows
  assets: SiteAssets;
  onSaved: () => void | Promise<void>;
}

/** The "Our Milestones" numbers: value text, label, and an optional background photo per tile. */
export default function MilestonesEditor({ saved, assets, onSaved }: Props) {
  const [rows, setRows] = useState<Milestone[]>(saved);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const savedKey = JSON.stringify(saved);
  useEffect(() => setRows(saved), [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (i: number, key: keyof Milestone, v: string) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [key]: v } : row)));

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await siteApi.save('milestones', { items: rows.map((r) => ({ value: r.value.trim(), label: r.label.trim() })) });
      await onSaved();
      setMsg({ type: 'success', text: 'Milestones saved. They are live on the home page.' });
    } catch (err) {
      setMsg({ type: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>Milestones</h2>
      <p className="muted">
        The big numbers on the home page. Type them exactly as you want them shown, for example <b>9K+</b>,{' '}
        <b>{'₹'}27L+</b> or <b>450+</b>. The number counts up when visitors scroll to it.
      </p>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}

      {rows.map((row, i) => (
        <div className="row-edit" key={i}>
          <div className="row-edit-fields">
            <label>
              Number
              <input value={row.value} maxLength={12} onChange={(e) => set(i, 'value', e.target.value)} />
            </label>
            <label>
              Label
              <input value={row.label} maxLength={40} onChange={(e) => set(i, 'label', e.target.value)} />
            </label>
            <div className="row-edit-actions">
              <button
                className="btn ghost"
                type="button"
                disabled={rows.length <= 1}
                onClick={() => setRows((r) => r.filter((_, idx) => idx !== i))}
              >
                Remove milestone
              </button>
            </div>
          </div>
          <ImageSlot
            title="Background photo (optional)"
            assetKey={`milestone-${i + 1}`}
            asset={assets[`milestone-${i + 1}`]}
            lockedNote={i < saved.length ? undefined : 'Save first, then add a photo'}
            onChanged={onSaved}
          />
        </div>
      ))}

      <div className="site-img-actions">
        <button
          className="btn ghost"
          type="button"
          disabled={rows.length >= 6}
          onClick={() => setRows((r) => [...r, { value: '', label: '' }])}
        >
          Add milestone
        </button>
        <button className="btn" type="button" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving...' : 'Save milestones'}
        </button>
      </div>
    </div>
  );
}
