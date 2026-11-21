import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api/apiClient';
import { compressImage } from '../../shared/compressImage';
import { date, inr, label } from '../../shared/format';
import { openProofAt } from '../../shared/openProof';
import { useRun } from '../../shared/useRun';

type Status = 'PENDING' | 'APPROVED' | 'REJECTED';

interface Withdrawal {
  id: string;
  amount: string;
  status: Status;
  note: string | null;
  payoutRef: string | null;
  hasProof: boolean;
  createdAt: string;
  processedAt: string | null;
  user: { name: string; email: string; phone: string | null; city: string | null; referralCode: string; package: string; walletBalance: string };
  bank: { bankName: string; account: string; ifsc: string; upiId: string } | null;
}

function CopyText({ text, children }: { text: string; children?: React.ReactNode }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="copy-chip"
      title="Copy"
      onClick={() => {
        void navigator.clipboard
          .writeText(text)
          .then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1200);
          })
          .catch(() => undefined);
      }}
    >
      {done ? 'Copied!' : children ?? text}
    </button>
  );
}

/** One withdrawal as the admin sees it: who, how much, where to pay, and a form to record the payment. */
function Row({ w, onDone }: { w: Withdrawal; onDone: () => void }) {
  const [ref, setRef] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const act = useRun();

  const pay = () => {
    if (!file) return act.setMsg({ type: 'error', text: 'Add the screenshot of the payment you made.' });
    void act.run(async () => {
      const picture = await compressImage(file);
      const r = await api(`/admin/withdrawals/${w.id}/approve`, { method: 'POST', body: { reference: ref.trim(), ...picture } });
      onDone();
      return r;
    });
  };

  const reject = () => {
    const answer = window.prompt('Reason (the member can see it). Leave empty for none.');
    if (answer === null) return;
    void act.run(async () => {
      const r = await api(`/admin/withdrawals/${w.id}/reject`, { method: 'POST', body: answer.trim() ? { note: answer.trim() } : {} });
      onDone();
      return r;
    });
  };

  return (
    <div className="wd-row">
      <div className="wd-main">
        <div className="wd-who">
          <b>{w.user.name}</b>
          <small className="muted">
            {w.user.email}
            {w.user.phone ? ` · ${w.user.phone}` : ''}
            {w.user.city ? ` · ${w.user.city}` : ''}
          </small>
          <small className="muted">
            ID {w.user.referralCode} · {label(w.user.package)} · wallet {inr(w.user.walletBalance)}
          </small>
        </div>
        <div className="wd-amount">
          <strong>{inr(w.amount)}</strong>
          <small className="muted">asked {date(w.createdAt)}</small>
        </div>
      </div>

      {w.bank ? (
        <div className="wd-bank">
          <span>
            <small>Bank</small> {w.bank.bankName}
          </span>
          <span>
            <small>Account no.</small> <CopyText text={w.bank.account} />
          </span>
          <span>
            <small>IFSC</small> <CopyText text={w.bank.ifsc} />
          </span>
          {w.bank.upiId && (
            <span>
              <small>UPI</small> <CopyText text={w.bank.upiId} />
            </span>
          )}
        </div>
      ) : (
        <div className="alert error">This member has no bank details saved.</div>
      )}

      {w.status === 'PENDING' && (
        <div className="wd-pay">
          <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Transaction ID of your payment" aria-label="Transaction ID" maxLength={100} />
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Payment screenshot" />
          <div className="report-actions">
            <button className="btn" type="button" disabled={act.busy || ref.trim().length < 4 || !file} onClick={pay}>
              {act.busy ? 'Saving...' : 'Mark as paid'}
            </button>
            <button className="btn ghost danger" type="button" disabled={act.busy} onClick={reject}>
              Reject
            </button>
          </div>
        </div>
      )}

      {w.status === 'APPROVED' && (
        <div className="wd-done">
          <span className="badge approved">Paid {w.processedAt ? date(w.processedAt) : ''}</span>
          <span>
            Transaction ID <b>{w.payoutRef}</b>
          </span>
          {w.hasProof && (
            <button className="btn ghost" type="button" onClick={() => void openProofAt(`/admin/withdrawals/${w.id}/proof`)}>
              View screenshot
            </button>
          )}
        </div>
      )}

      {w.status === 'REJECTED' && (
        <div className="wd-done">
          <span className="badge rejected">Rejected</span>
          {w.note && <span className="muted">{w.note}</span>}
        </div>
      )}

      {act.msg && <div className={`alert ${act.msg.type}`}>{act.msg.text}</div>}
    </div>
  );
}

/** All withdrawals, newest first. The default view is the ones waiting for the admin to pay. */
export default function AdminWithdrawals() {
  const [status, setStatus] = useState<Status>('PENDING');
  const [items, setItems] = useState<Withdrawal[] | null>(null);

  const load = useCallback(() => {
    api<{ items: Withdrawal[] }>(`/admin/withdrawals?status=${status}`)
      .then((r) => setItems(r.data?.items ?? []))
      .catch(() => setItems([]));
  }, [status]);
  useEffect(load, [load]);

  return (
    <div className="card">
      <div className="team-head">
        <select value={status} onChange={(e) => setStatus(e.target.value as Status)} aria-label="Status">
          <option value="PENDING">Waiting to be paid</option>
          <option value="APPROVED">Paid</option>
          <option value="REJECTED">Rejected</option>
        </select>
        <span className="muted">{items ? `${items.length} shown` : 'Loading...'}</span>
      </div>
      <p className="muted">Pay the member from your bank app using the details shown, then enter the transaction ID, add the payment screenshot and press "Mark as paid". The amount leaves the member's wallet at that moment.</p>
      {items && items.length === 0 && <p className="muted">Nothing here.</p>}
      <div className="wd-list">
        {items?.map((w) => (
          <Row w={w} key={w.id} onDone={load} />
        ))}
      </div>
    </div>
  );
}
