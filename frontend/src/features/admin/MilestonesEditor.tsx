import { useEffect, useMemo, useState } from 'react';
import { siteApi } from '../site';
import type { Milestone, SiteAssets } from '../site';
import ImageSlot from './ImageSlot';
import PendingPhoto from './PendingPhoto';

interface Props {
  saved: Milestone[]; // what the home page currently shows
  assets: SiteAssets;
  onSaved: () => void | Promise<void>;
}

interface Row extends Milestone {
  file?: File; // photo chosen for a tile that is not saved yet
}

/**
 * The "Our Milestones" tiles: number text, label, and an optional background photo per tile.
 * Photos are stored by tile position, so only the LAST tile can be removed (removing one from
 * the middle would slide the other photos onto the wrong tiles).
 */
export default function MilestonesEditor({ saved, assets, onSaved }: Props) {
  const [rows, setRows] = useState<Row[]>(saved);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const savedKey = JSON.stringify(saved);
  useEffect(() => setRows(saved), [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = useMemo(
    () => rows.some((r) => r.file) || JSON.stringify(rows.map((r) => ({ value: r.value, label: r.label }))) !== savedKey,
    [rows, savedKey]
  );

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = (i: number, key: 'value' | 'label', v: string) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [key]: v } : row)));

  const save = async () => {
    setMsg(null);
    if (rows.some((r) => !r.value.trim() || !r.label.trim())) {
      setMsg({ type: 'error', text: 'Please fill in both the number and the label for every milestone.' });
      return;
    }
    setBusy(true);
    try {
      await siteApi.save('milestones', { items: rows.map((r) => ({ value: r.value.trim(), label: r.label.trim() })) });
      const failed: string[] = [];
      for (let i = 0; i < rows.length; i++) {
        if (!rows[i].file) continue;
        try {
          await siteApi.upload(`milestone-${i + 1}`, rows[i].file as File);
        } catch (err) {
          failed.push(`${rows[i].label}: ${(err as Error).message}`);
        }
      }
      await onSaved();
      setMsg(
        failed.length
          ? { type: 'error', text: `Saved, but some photos did not upload (${failed.join('; ')}). Use Replace on those tiles.` }
          : { type: 'success', text: 'Milestones saved. They are live on the home page.' }
      );
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
        <b>{'₹'}27L+</b> or <b>450+</b>. The number counts up when visitors scroll to it. Each tile can have its own
        background photo.
      </p>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}

      {rows.map((row, i) => {
        const isSaved = i < saved.length;
        return (
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
              {i === rows.length - 1 && rows.length > 1 && (
                <div className="row-edit-actions">
                  <button
                    className="btn ghost danger"
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Remove "${row.label || 'this milestone'}"? Its photo is deleted too when you press Save.`)) {
                        setRows((r) => r.slice(0, -1));
                      }
                    }}
                  >
                    Remove milestone
                  </button>
                </div>
              )}
            </div>

            {isSaved ? (
              <ImageSlot
                title="Background photo (optional)"
                assetKey={`milestone-${i + 1}`}
                asset={assets[`milestone-${i + 1}`]}
                onChanged={onSaved}
              />
            ) : (
              <PendingPhoto
                title="Background photo (optional)"
                file={row.file}
                onPick={(file) => setRows((r) => r.map((x, idx) => (idx === i ? { ...x, file } : x)))}
                onError={(text) => setMsg({ type: 'error', text })}
              />
            )}
          </div>
        );
      })}

      <div className="site-img-actions save-bar">
        <button
          className="btn ghost"
          type="button"
          disabled={rows.length >= 6}
          onClick={() => setRows((r) => [...r, { value: '', label: '' }])}
        >
          Add milestone
        </button>
        <button className="btn" type="button" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? 'Saving...' : 'Save milestones'}
        </button>
        {dirty && !busy && <span className="unsaved">Unsaved changes</span>}
      </div>
    </div>
  );
}
