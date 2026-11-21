import { useEffect, useMemo, useState } from 'react';
import { api } from '../../shared/api/apiClient';
import type { Lesson, Tier } from '../dashboard/TrainingPage';

/** The lessons members see in the Training Library: a title, a short note and an https link (video, doc or folder). */
export default function TrainingEditor() {
  const [saved, setSaved] = useState<Lesson[] | null>(null);
  const [rows, setRows] = useState<Lesson[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    api<{ items: Lesson[] }>('/site/training')
      .then((r) => {
        // admins receive every link; only the fields that are edited are kept
        const items = (r.data?.items ?? []).map((l) => ({ title: l.title, description: l.description, url: l.url ?? '', tier: l.tier ?? 'TRAINEE' }));
        setSaved(items);
        setRows(items);
      })
      .catch(() => setMsg({ type: 'error', text: 'Could not load the lessons.' }));
  }, []);

  const dirty = useMemo(() => saved !== null && JSON.stringify(rows) !== JSON.stringify(saved), [rows, saved]);

  const set = (i: number, key: 'title' | 'description' | 'url' | 'tier', v: string) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [key]: v } : row)));

  const move = (i: number, dir: -1 | 1) =>
    setRows((r) => {
      const j = i + dir;
      if (j < 0 || j >= r.length) return r;
      const copy = [...r];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  const save = async () => {
    setMsg(null);
    const clean = rows.map((r) => ({ title: r.title.trim(), description: r.description.trim(), url: (r.url ?? '').trim(), tier: r.tier }));
    const bad = clean.findIndex((r) => !r.title || !/^https:\/\/\S+$/i.test(r.url));
    if (bad >= 0) {
      setMsg({ type: 'error', text: `Lesson ${bad + 1}: add a title and a link that starts with https://` });
      return;
    }
    setBusy(true);
    try {
      await api('/site/content/training', { method: 'PUT', body: { items: clean } });
      setSaved(clean);
      setRows(clean);
      setMsg({ type: 'success', text: 'Training lessons saved. Members see them now.' });
    } catch (err) {
      setMsg({ type: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" data-testid="training-editor">
      <h2>Training Library</h2>
      <p className="muted">
        Lessons for signed-in members. Choose which package unlocks each lesson: members on a lower package see it locked, and the
        link is only sent once they upgrade. A YouTube link also shows its cover image.
      </p>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}
      {saved === null && !msg && <p className="muted">Loading...</p>}

      {rows.map((row, i) => (
        <div className="row-edit lesson-edit" key={i}>
          <div className="row-edit-fields">
            <label>
              Title
              <input value={row.title} maxLength={80} onChange={(e) => set(i, 'title', e.target.value)} />
            </label>
            <label>
              Unlocks with
              <select value={row.tier} onChange={(e) => set(i, 'tier', e.target.value as Tier)}>
                <option value="TRAINEE">Everyone (Trainee and above)</option>
                <option value="PRO">PRO package and above</option>
                <option value="ELITE">ELITE package only</option>
              </select>
            </label>
            <label>
              Link (https)
              <input value={row.url ?? ''} maxLength={200} placeholder="https://" onChange={(e) => set(i, 'url', e.target.value)} />
            </label>
            <label>
              Short note (optional)
              <textarea rows={2} value={row.description} maxLength={300} onChange={(e) => set(i, 'description', e.target.value)} />
            </label>
          </div>
          <div className="row-edit-actions">
            <button className="btn ghost" type="button" disabled={i === 0} onClick={() => move(i, -1)}>
              Move up
            </button>
            <button className="btn ghost" type="button" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
              Move down
            </button>
            <button
              className="btn ghost danger"
              type="button"
              onClick={() => {
                if (window.confirm(`Remove "${row.title || 'this lesson'}"?`)) setRows((r) => r.filter((_, idx) => idx !== i));
              }}
            >
              Remove
            </button>
          </div>
        </div>
      ))}

      <div className="site-img-actions save-bar">
        <button
          className="btn ghost"
          type="button"
          disabled={saved === null || rows.length >= 50}
          onClick={() => setRows((r) => [...r, { title: '', description: '', url: '', tier: 'TRAINEE' }])}
        >
          Add lesson
        </button>
        <button className="btn" type="button" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? 'Saving...' : 'Save lessons'}
        </button>
        {dirty && !busy && <span className="unsaved">Unsaved changes</span>}
      </div>
    </div>
  );
}
