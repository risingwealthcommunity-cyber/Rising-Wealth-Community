import { useEffect, useState } from 'react';
import { siteApi } from '../site';
import type { Contact } from '../site';

const FIELDS: { key: keyof Contact; label: string; placeholder: string }[] = [
  { key: 'phone', label: 'Phone', placeholder: '+91 98765 43210' },
  { key: 'whatsapp', label: 'WhatsApp number', placeholder: '+91 98765 43210' },
  { key: 'email', label: 'Email', placeholder: 'hello@yourdomain.com' },
  { key: 'instagram', label: 'Instagram link', placeholder: 'https://instagram.com/...' },
  { key: 'youtube', label: 'YouTube link', placeholder: 'https://youtube.com/...' },
  { key: 'facebook', label: 'Facebook link', placeholder: 'https://facebook.com/...' },
  { key: 'telegram', label: 'Telegram link', placeholder: 'https://t.me/...' },
  { key: 'formKey', label: 'Web3Forms access key (turns on the contact form)', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' }
];

/** Contact details and social links shown in the Get in Touch section and the footer. */
export default function ContactEditor({ saved, onSaved }: { saved: Contact; onSaved: () => void | Promise<void> }) {
  const [draft, setDraft] = useState<Contact>(saved);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const savedKey = JSON.stringify(saved);
  useEffect(() => setDraft(saved), [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const body = Object.fromEntries(FIELDS.map((f) => [f.key, draft[f.key].trim()]));
      await siteApi.save('contact', body);
      await onSaved();
      setMsg({ type: 'success', text: 'Contact details saved.' });
    } catch (err) {
      setMsg({ type: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>Contact details</h2>
      <p className="muted">Leave a field empty to hide it. Social links must start with https://. Paste the access key from web3forms.com to show the Get in Touch form; messages are emailed to the address you registered there.</p>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}
      <div className="contact-fields">
        {FIELDS.map((f) => (
          <label key={f.key}>
            {f.label}
            <input
              value={draft[f.key]}
              placeholder={f.placeholder}
              maxLength={f.key === 'phone' || f.key === 'whatsapp' ? 20 : f.key === 'formKey' ? 60 : 200}
              onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <div className="site-img-actions">
        <button className="btn" type="button" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving...' : 'Save contact details'}
        </button>
      </div>
    </div>
  );
}
