import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../shared/api/apiClient';
import { useRun } from '../../shared/useRun';
import ImageSlot from './ImageSlot';
import type { SiteAsset } from '../site';

/** The QR and UPI details members see wherever they pay (Add fund, package payments). */
export default function PaymentEditor({ asset, onChanged }: { asset?: SiteAsset; onChanged: () => void | Promise<void> }) {
  const [form, setForm] = useState({ upiId: '', payeeName: '', note: '' });
  const [loaded, setLoaded] = useState(false);
  const save = useRun();

  useEffect(() => {
    api<{ upiId: string; payeeName: string; note: string }>('/site/payment')
      .then((r) => setForm({ upiId: r.data?.upiId ?? '', payeeName: r.data?.payeeName ?? '', note: r.data?.note ?? '' }))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save.run(() => api('/site/content/payment', { method: 'PUT', body: form }), 'Payment details saved. Members see them now.');
  };

  return (
    <form className="card stack" onSubmit={submit} data-testid="payment-editor">
      <h2>Payment details</h2>
      <p className="muted">Members scan this QR to pay, then send you the transaction ID and a screenshot to approve in Operations.</p>
      <div className="site-imgs">
        <ImageSlot title="Payment QR" hint="PNG, JPEG or WebP" assetKey="payment-qr" asset={asset} onChanged={onChanged} />
      </div>
      <label>
        UPI ID
        <input value={form.upiId} onChange={(e) => setForm({ ...form, upiId: e.target.value })} placeholder="name@bank" maxLength={60} disabled={!loaded} />
      </label>
      <label>
        Name shown to members
        <input value={form.payeeName} onChange={(e) => setForm({ ...form, payeeName: e.target.value })} maxLength={60} disabled={!loaded} />
      </label>
      <label>
        Note (optional)
        <textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={300} disabled={!loaded} />
      </label>
      {save.msg && <div className={`alert ${save.msg.type}`}>{save.msg.text}</div>}
      <div className="profile-actions">
        <button className="btn" disabled={save.busy || !loaded}>
          Save payment details
        </button>
      </div>
    </form>
  );
}
