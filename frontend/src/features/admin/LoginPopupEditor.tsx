import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../shared/api/apiClient';
import { useRun } from '../../shared/useRun';
import ImageSlot from './ImageSlot';
import type { SiteAssets } from '../site';

/** The poster members see in a popup right after they log in: the picture, an optional link, and an on/off switch. */
export default function LoginPopupEditor({ saved, assets, onSaved }: { saved: { enabled: boolean; link: string } | null; assets: SiteAssets; onSaved: () => void | Promise<void> }) {
  const [enabled, setEnabled] = useState(Boolean(saved?.enabled));
  const [link, setLink] = useState(saved?.link ?? '');
  const act = useRun();

  const save = (e: FormEvent) => {
    e.preventDefault();
    const clean = link.trim();
    if (clean && !/^https:\/\/\S+$/i.test(clean)) return act.setMsg({ type: 'error', text: 'The link must start with https://' });
    void act.run(async () => {
      const r = await api('/site/content/loginPopup', { method: 'PUT', body: { enabled, link: clean } });
      await onSaved();
      return r;
    }, enabled ? 'Saved. Members see the poster after they log in.' : 'Saved. The popup is off.');
  };

  return (
    <form className="card stack" onSubmit={save}>
      <h2>Login popup poster</h2>
      <p className="muted">A poster that opens in front of a member right after they log in (once each time). Upload the picture, switch it on, and optionally add a link to open when they tap it.</p>
      <ImageSlot title="Poster" hint="PNG, JPEG or WebP. A tall or square picture works best on phones." assetKey="login-poster" asset={assets['login-poster']} onChanged={onSaved} />
      <label className="check">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Show the poster after login
      </label>
      <label>
        Link when tapped (optional, https)
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" maxLength={300} />
      </label>
      {act.msg && <div className={`alert ${act.msg.type}`}>{act.msg.text}</div>}
      <button className="btn" disabled={act.busy}>
        {act.busy ? 'Saving...' : 'Save'}
      </button>
    </form>
  );
}
