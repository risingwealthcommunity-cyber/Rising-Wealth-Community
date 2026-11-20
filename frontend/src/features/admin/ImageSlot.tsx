import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES, siteApi } from '../site';
import type { SiteAsset } from '../site';

interface Props {
  title: string;
  hint?: string;
  assetKey: string;
  asset?: SiteAsset;
  /** When set, the slot is locked and shows this note instead (e.g. "Save first"). */
  lockedNote?: string;
  onChanged: () => void | Promise<void>;
}

/** One image slot: preview, Upload/Replace and Remove. Validates type and size before sending. */
export default function ImageSlot({ title, hint, assetKey, asset, lockedNote, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow choosing the same file again
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) return setError('Please choose a PNG, JPEG or WebP image.');
    if (file.size > MAX_UPLOAD_BYTES) return setError('Image is too large. Maximum size is 6 MB.');

    setBusy(true);
    setError('');
    try {
      await siteApi.upload(assetKey, file);
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      await siteApi.remove(assetKey);
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="site-img">
      <div className="site-img-preview">
        {asset ? <img src={asset.url} alt={title} /> : <span className="muted">{lockedNote ?? 'No image yet'}</span>}
      </div>
      <strong>{title}</strong>
      {hint && <span className="muted">{hint}</span>}
      {error && <div className="alert error">{error}</div>}
      {!lockedNote && (
        <div className="site-img-actions">
          <label className="btn" aria-disabled={busy}>
            {busy ? 'Working...' : asset ? 'Replace' : 'Upload'}
            <input
              type="file"
              accept={ACCEPTED_TYPES.join(',')}
              hidden
              disabled={busy}
              onChange={(e) => void pick(e)}
            />
          </label>
          {asset && (
            <button className="btn ghost" type="button" disabled={busy} onClick={() => void remove()}>
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  );
}
