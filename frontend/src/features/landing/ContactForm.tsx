import { useState } from 'react';
import type { FormEvent } from 'react';
import { apiUrl } from '../../shared/api/apiClient';

const ENDPOINT = 'https://api.web3forms.com/submit';

type Status = { kind: 'idle' } | { kind: 'sending' } | { kind: 'ok' } | { kind: 'error'; text: string };

/**
 * Get in Touch form. Messages go straight to Web3Forms, which emails them to the address the
 * admin registered there. The access key is public by design and comes from Website content.
 */
export default function ContactForm({ accessKey, isAdmin }: { accessKey: string; isAdmin: boolean }) {
  const [values, setValues] = useState({ name: '', email: '', whatsapp: '', message: '' });
  const [bot, setBot] = useState(false); // honeypot: real people never see or tick it
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const set = (key: keyof typeof values, v: string) => {
    setValues((s) => ({ ...s, [key]: v }));
    if (status.kind !== 'sending') setStatus({ kind: 'idle' });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (status.kind === 'sending') return;
    if (bot) return setStatus({ kind: 'ok' }); // pretend success to bots
    setStatus({ kind: 'sending' });
    try {
      // our own inbox first: it is what the admin panel shows, and it works without any outside key
      const saved = await fetch(apiUrl('/api/contact'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: values.name.trim(), email: values.email.trim(), whatsapp: values.whatsapp.trim(), message: values.message.trim() })
      });
      const savedJson = (await saved.json().catch(() => ({}))) as { message?: string };
      if (!saved.ok) throw new Error(savedJson.message || 'Could not send your message');
      if (!accessKey) {
        setValues({ name: '', email: '', whatsapp: '', message: '' });
        setStatus({ kind: 'ok' });
        return;
      }

      // optional email copy; the message is already saved, so a failure here is not shown
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          access_key: accessKey,
          subject: 'New message from the Rising Wealth Community website',
          from_name: 'RWC website',
          name: values.name.trim(),
          email: values.email.trim(),
          whatsapp: values.whatsapp.trim(),
          message: values.message.trim(),
          botcheck: false
        })
      });
      await res.json().catch(() => ({}));
      setValues({ name: '', email: '', whatsapp: '', message: '' });
      setStatus({ kind: 'ok' });
    } catch (err) {
      setStatus({ kind: 'error', text: (err as Error).message || 'Could not send your message. Please try again.' });
    }
  };

  return (
    <form className="lp-form" onSubmit={(e) => void submit(e)}>
      <label>
        <span>Your name</span>
        <input value={values.name} onChange={(e) => set('name', e.target.value)} required maxLength={80} autoComplete="name" />
      </label>
      <label>
        <span>Email address</span>
        <input type="email" value={values.email} onChange={(e) => set('email', e.target.value)} required maxLength={120} autoComplete="email" />
      </label>
      <label>
        <span>WhatsApp number</span>
        <input type="tel" value={values.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} maxLength={20} autoComplete="tel" />
      </label>
      <label>
        <span>Your message</span>
        <textarea value={values.message} onChange={(e) => set('message', e.target.value)} required minLength={5} maxLength={1500} rows={4} />
      </label>

      {/* honeypot */}
      <input type="checkbox" name="botcheck" tabIndex={-1} autoComplete="off" checked={bot} onChange={(e) => setBot(e.target.checked)} className="lp-hp" aria-hidden="true" />

      <button className="lp-cta" type="submit" disabled={status.kind === 'sending'}>
        {status.kind === 'sending' ? 'Sending...' : 'Send message'}
      </button>

      <div className="lp-form-status" role="status" aria-live="polite">
        {status.kind === 'ok' && <span className="ok">Thank you! Your message has been sent. We will get back to you soon.</span>}
        {status.kind === 'error' && <span className="err">{status.text}</span>}
      </div>
      {!accessKey && isAdmin && (
        <small className="lp-form-note">
          Admin: add your Web3Forms access key in Admin &gt; Website content &gt; Contact details (or VITE_WEB3FORMS_KEY in
          frontend/.env) to start receiving messages.
        </small>
      )}
      <small className="lp-form-note">Your message is sent securely to our team through Web3Forms.</small>
    </form>
  );
}
