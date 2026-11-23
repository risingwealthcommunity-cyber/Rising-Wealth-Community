import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../shared/api/apiClient';
import { useRun } from '../../shared/useRun';
import { PAGE_TEXTS } from '../landing/pageText';

/** Every written sentence on the home page: change it, reset it to the original, or leave it. */
export default function PageTextEditor({ saved, onSaved }: { saved: Record<string, string>; onSaved: () => void | Promise<void> }) {
  const [texts, setTexts] = useState<Record<string, string>>(saved);
  const [open, setOpen] = useState<string | null>(PAGE_TEXTS[0].group);
  const act = useRun();

  const groups = useMemo(() => {
    const out = new Map<string, typeof PAGE_TEXTS>();
    for (const t of PAGE_TEXTS) out.set(t.group, [...(out.get(t.group) ?? []), t]);
    return [...out.entries()];
  }, []);

  const value = (key: string, def: string) => (texts[key] !== undefined ? texts[key] : def);
  const changed = PAGE_TEXTS.filter((t) => texts[t.key] !== undefined && texts[t.key].trim() !== '' && texts[t.key] !== t.text).length;

  const save = (e: FormEvent) => {
    e.preventDefault();
    // only the sentences that differ from the original are kept, so a reset really goes back to the original
    const keep: Record<string, string> = {};
    for (const t of PAGE_TEXTS) {
      const v = texts[t.key];
      if (v !== undefined && v.trim() !== '' && v.trim() !== t.text) keep[t.key] = v.trim();
    }
    void act.run(async () => {
      const r = await api('/site/content/pageText', { method: 'PUT', body: { texts: keep } });
      await onSaved();
      return r;
    }, 'Saved. The home page shows the new text now.');
  };

  return (
    <form className="card stack" onSubmit={save}>
      <h2>Written content</h2>
      <p className="muted">
        Change the headings and sentences on the home page. What you do not touch stays as it is. {changed > 0 ? `${changed} text${changed === 1 ? ' is' : 's are'} changed.` : ''}
      </p>
      {groups.map(([group, items]) => (
        <div className="text-group" key={group}>
          <button type="button" className="text-group-head" aria-expanded={open === group} onClick={() => setOpen(open === group ? null : group)}>
            <b>{group}</b>
            <span aria-hidden="true">{open === group ? '−' : '+'}</span>
          </button>
          {open === group && (
            <div className="text-rows">
              {items.map((t) => (
                <label key={t.key} className="text-row">
                  <span>
                    {t.label}
                    {texts[t.key] !== undefined && texts[t.key] !== t.text && texts[t.key].trim() !== '' && (
                      <button type="button" className="link-btn" onClick={() => setTexts((o) => ({ ...o, [t.key]: t.text }))}>
                        Reset to original
                      </button>
                    )}
                  </span>
                  {t.long ? (
                    <textarea rows={3} maxLength={600} value={value(t.key, t.text)} onChange={(e) => setTexts((o) => ({ ...o, [t.key]: e.target.value }))} />
                  ) : (
                    <input maxLength={600} value={value(t.key, t.text)} onChange={(e) => setTexts((o) => ({ ...o, [t.key]: e.target.value }))} />
                  )}
                </label>
              ))}
            </div>
          )}
        </div>
      ))}
      {act.msg && <div className={`alert ${act.msg.type}`}>{act.msg.text}</div>}
      <button className="btn" disabled={act.busy}>
        {act.busy ? 'Saving...' : 'Save written content'}
      </button>
    </form>
  );
}
