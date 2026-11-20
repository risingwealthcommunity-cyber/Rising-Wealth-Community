import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES, siteApi, useSiteAssets } from '../site';
import type { AssetKey } from '../site';

const ITEMS: { key: AssetKey; title: string; hint: string }[] = [
  {
    key: 'about-image',
    title: 'About section image',
    hint: 'Shown beside the About text on the home page. Landscape works best, e.g. 1200 x 800.'
  },
  {
    key: 'certificate',
    title: 'Registration certificate',
    hint: 'Shown in the "Trusted & registered" block. Use a clear scan or photo.'
  }
];

type Msg = { type: 'success' | 'error'; text: string } | null;

/** Lets an admin upload, replace or remove the images used on the public About section. */
export default function SiteImages() {
  const { assets, reload } = useSiteAssets();
  const [busy, setBusy] = useState<AssetKey | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  const onPick = async (key: AssetKey, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow picking the same file again
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setMsg({ type: 'error', text: 'Please choose a PNG, JPEG or WebP image.' });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setMsg({ type: 'error', text: 'Image is too large. Maximum size is 6 MB.' });
      return;
    }

    setBusy(key);
    setMsg(null);
    try {
      await siteApi.upload(key, file);
      await reload();
      setMsg({ type: 'success', text: 'Image saved. It is live on the home page.' });
    } catch (err) {
      setMsg({ type: 'error', text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const onRemove = async (key: AssetKey) => {
    setBusy(key);
    setMsg(null);
    try {
      await siteApi.remove(key);
      await reload();
      setMsg({ type: 'success', text: 'Image removed.' });
    } catch (err) {
      setMsg({ type: 'error', text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card">
      <h2>Website images</h2>
      <p className="muted">Controls the About section on the public home page.</p>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}
      <div className="site-imgs">
        {ITEMS.map(({ key, title, hint }) => {
          const asset = assets[key];
          return (
            <div className="site-img" key={key}>
              <div className="site-img-preview">
                {asset ? <img src={asset.url} alt={title} /> : <span className="muted">No image yet</span>}
              </div>
              <strong>{title}</strong>
              <span className="muted">{hint}</span>
              <div className="site-img-actions">
                <label className="btn" aria-disabled={busy === key}>
                  {busy === key ? 'Working...' : asset ? 'Replace' : 'Upload'}
                  <input
                    type="file"
                    accept={ACCEPTED_TYPES.join(',')}
                    hidden
                    disabled={busy === key}
                    onChange={(e) => void onPick(key, e)}
                  />
                </label>
                {asset && (
                  <button className="btn ghost" disabled={busy === key} onClick={() => void onRemove(key)}>
                    Remove
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
