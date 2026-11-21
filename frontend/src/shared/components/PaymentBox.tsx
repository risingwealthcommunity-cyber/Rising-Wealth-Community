import { useEffect, useState } from 'react';
import { api } from '../api/apiClient';

interface Payment {
  upiId: string;
  payeeName: string;
  note: string;
  qrUrl: string | null;
}

/** Shows how to pay: the QR the admin uploaded plus the UPI ID next to it. Used wherever a member sends a payment. */
export default function PaymentBox() {
  const [p, setP] = useState<Payment | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api<Payment>('/site/payment').then((r) => setP(r.data ?? null)).catch(() => setP(null));
  }, []);

  if (!p) return null;
  if (!p.qrUrl && !p.upiId) {
    return <div className="alert">Payment details are not set up yet. Please ask the team for the payment QR.</div>;
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(p.upiId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="pay-box">
      {p.qrUrl && <img className="pay-qr" src={p.qrUrl} alt="Scan this QR code to pay" width={200} height={200} />}
      <div className="pay-info">
        <strong>Scan &amp; pay</strong>
        {p.payeeName && <span>{p.payeeName}</span>}
        {p.upiId && (
          <button type="button" className="btn ghost" onClick={() => void copy()} aria-label="Copy the UPI ID">
            {copied ? 'Copied!' : `UPI ID: ${p.upiId}`}
          </button>
        )}
        {p.note && <small className="muted">{p.note}</small>}
        <small className="muted">After paying, enter the transaction ID and add a screenshot of the payment.</small>
      </div>
    </div>
  );
}
