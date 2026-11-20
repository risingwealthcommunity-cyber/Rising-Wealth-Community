import { useEffect, useMemo } from 'react';
import type { ChangeEvent } from 'react';
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES } from '../site';

interface Props {
  title: string;
  file?: File;
  onPick: (file: File | undefined) => void;
  onError: (message: string) => void;
}

/**
 * Photo chooser for a row that has not been saved yet. The file is kept in the browser and is
 * uploaded automatically when the admin presses Save, so adding someone takes one step.
 */
export default function PendingPhoto({ title, file, onPick, onError }: Props) {
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file]);
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);

  const choose = (e: ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0];
    e.target.value = ''; // allow choosing the same file again
    if (!chosen) return;
    if (!ACCEPTED_TYPES.includes(chosen.type)) return onError('Please choose a PNG, JPEG or WebP image.');
    if (chosen.size > MAX_UPLOAD_BYTES) return onError('Image is too large. Maximum size is 6 MB.');
    onPick(chosen);
  };

  return (
    <div className="site-img">
      <div className="site-img-preview">
        {preview ? <img src={preview} alt={title} /> : <span className="muted">No photo chosen yet</span>}
      </div>
      <strong>{title}</strong>
      <div className="site-img-actions">
        <label className="btn">
          {file ? 'Change photo' : 'Choose photo'}
          <input type="file" accept={ACCEPTED_TYPES.join(',')} hidden onChange={choose} />
        </label>
        {file && (
          <button className="btn ghost" type="button" onClick={() => onPick(undefined)}>
            Clear
          </button>
        )}
      </div>
      <span className="muted">It uploads when you press Save.</span>
    </div>
  );
}
