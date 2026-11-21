import { useEffect, useState } from 'react';
import { api } from '../api/apiClient';
import { Avatar, AVATAR_KEYS } from './Avatar';

/** A small dialog: tap an avatar to choose it, or "Use my initials" to remove it. Saves straight away. */
export default function AvatarPicker({
  current,
  name,
  onSaved,
  onClose
}: {
  current: string | null;
  name: string;
  onSaved: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const choose = async (avatar: string | null) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api('/dashboard/avatar', { method: 'PUT', body: { avatar } });
      await onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Could not save your avatar.');
      setBusy(false);
    }
  };

  return (
    <div className="avp-scrim" onClick={onClose}>
      <div className="avp" role="dialog" aria-modal="true" aria-label="Choose your avatar" onClick={(e) => e.stopPropagation()}>
        <div className="avp-head">
          <h2>Choose your avatar</h2>
          <button type="button" className="avp-x" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="avp-grid">
          {AVATAR_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              className={`avp-item${current === k ? ' on' : ''}`}
              aria-label={`Avatar ${k.slice(1)}`}
              aria-pressed={current === k}
              disabled={busy}
              onClick={() => void choose(k)}
            >
              <Avatar avatar={k} name={name} size={72} />
            </button>
          ))}
        </div>
        {error && <div className="alert error">{error}</div>}
        <button type="button" className="btn ghost avp-reset" disabled={busy || !current} onClick={() => void choose(null)}>
          Use my initials
        </button>
      </div>
    </div>
  );
}
