import { Fragment, useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api/apiClient';
import { compressImage } from '../../shared/compressImage';
import { inr, label } from '../../shared/format';
import { openProofAt } from '../../shared/openProof';
import { useRun } from '../../shared/useRun';

type Status = 'PENDING' | 'PROCESSING' | 'APPROVED' | 'REJECTED' | 'ALL';

interface Withdrawal {
  id: string;
  amount: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  inProgress: boolean;
  note: string | null;
  payoutRef: string | null;
  hasProof: boolean;
  createdAt: string;
  processedAt: string | null;
  user: { name: string; email: string; phone: string | null; city: string | null; referralCode: string; package: string; walletBalance: string };
  bank: { bankName: string; account: string; ifsc: string; upiId: string } | null;
}

const stamp = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function CopyText({ text }: { text: string }) {
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
      {done ? 'Copied!' : text}
    </button>
  );
}

/** The panel that opens under a row: the member's details, or the form that records the payment. */
function Panel({ w, mode, onClose, onDone }: { w: Withdrawal; mode: 'view' | 'pay'; onClose: () => void; onDone: () => void }) {
  const [ref, setRef] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const act = useRun();

  const pay = () => {
    if (!file) return act.setMsg({ type: 'error', text: 'Add the screenshot of the payment you made.' });
    void act.run(async () => {
      const picture = await compressImage(file);
      const r = await api(`/admin/withdrawals/${w.id}/approve`, { method: 'POST', body: { reference: ref.trim(), ...picture } });
      onDone();
      onClose();
      return r;
    });
  };

  /** Waiting <-> Processing. The member sees "Processing" and the message, if you write one. */
  const setProgress = (on: boolean) => {
    let note: string | undefined;
    if (on) {
      const answer = window.prompt('Message for the member (optional), for example "Paying by this evening".');
      if (answer === null) return;
      note = answer.trim() || undefined;
    }
    void act.run(async () => {
      const r = await api(`/admin/withdrawals/${w.id}/progress`, { method: 'POST', body: { on, ...(note ? { note } : {}) } });
      onDone();
      return r;
    });
  };

  return (
    <div className="wd-panel">
      {mode === 'pay' ? (
        <>
          <p className="muted">
            Pay <b>{inr(w.amount)}</b> to the account shown in the row, then record it. The amount leaves the member's wallet when you confirm.
          </p>
          <div className="wd-pay">
            <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Transaction ID of your payment" aria-label="Transaction ID" maxLength={100} />
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Payment screenshot" />
          </div>
        </>
      ) : (
        <div className="wd-details">
          <div>
            <small>Member</small>
            <b>{w.user.name}</b>
            <span>{w.user.email}</span>
            {w.user.phone && <span>{w.user.phone}</span>}
            {w.user.city && <span>{w.user.city}</span>}
          </div>
          <div>
            <small>Account</small>
            <span>
              ID <b>{w.user.referralCode}</b> · {label(w.user.package)}
            </span>
            <span>Wallet balance {inr(w.user.walletBalance)}</span>
          </div>
          <div>
            <small>Pay to</small>
            {w.bank ? (
              <>
                <span>{w.bank.bankName}</span>
                <span>
                  A/C <CopyText text={w.bank.account} />
                </span>
                <span>
                  IFSC <CopyText text={w.bank.ifsc} />
                </span>
                {w.bank.upiId && (
                  <span>
                    UPI <CopyText text={w.bank.upiId} />
                  </span>
                )}
              </>
            ) : (
              <span className="muted">No bank details saved</span>
            )}
          </div>
          <div>
            <small>State</small>
            <span>
              <span className={`badge ${w.status === 'PENDING' ? (w.inProgress ? 'processing' : 'pending') : w.status.toLowerCase()}`}>
                {w.status === 'PENDING' ? (w.inProgress ? 'Processing' : 'Waiting') : label(w.status)}
              </span>
            </span>
            {w.inProgress && w.note && <span className="muted">Message to member: {w.note}</span>}
            {w.status === 'REJECTED' && w.note && <span className="muted">Reason: {w.note}</span>}
            {w.status === 'APPROVED' && (
              <>
                <span>
                  Transaction ID <b>{w.payoutRef}</b>
                </span>
                {w.processedAt && <span className="muted">Paid {stamp(w.processedAt)}</span>}
              </>
            )}
          </div>
        </div>
      )}
      {act.msg && <div className={`alert ${act.msg.type}`}>{act.msg.text}</div>}
      <div className="wd-panel-actions">
        {mode === 'pay' && (
          <button className="btn" type="button" disabled={act.busy || ref.trim().length < 4 || !file} onClick={pay}>
            {act.busy ? 'Saving...' : 'Confirm paid'}
          </button>
        )}
        {mode === 'view' && w.status === 'PENDING' && (
          <button className="btn ghost" type="button" disabled={act.busy} onClick={() => setProgress(!w.inProgress)}>
            {w.inProgress ? 'Back to waiting' : 'Mark as processing'}
          </button>
        )}
        {mode === 'view' && w.status === 'APPROVED' && w.hasProof && (
          <button className="btn ghost" type="button" onClick={() => void openProofAt(`/admin/withdrawals/${w.id}/proof`)}>
            View payment screenshot
          </button>
        )}
        <button className="btn ghost" type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/** Withdrawals as a table: when, who and where to pay, how much, and View / Approve / Reject. */
export default function AdminWithdrawals({ onChanged }: { onChanged?: () => void }) {
  const [status, setStatus] = useState<Status>('PENDING');
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Withdrawal[] | null>(null);
  const [panel, setPanel] = useState<{ id: string; mode: 'view' | 'pay' } | null>(null);
  const act = useRun();

  const load = useCallback(() => {
    api<{ items: Withdrawal[] }>(`/admin/withdrawals?status=${status}${q ? `&q=${encodeURIComponent(q)}` : ''}`)
      .then((r) => setItems(r.data?.items ?? []))
      .catch(() => setItems([]));
  }, [status, q]);
  useEffect(load, [load]);
  const changed = () => {
    load();
    onChanged?.();
  };

  const reject = (w: Withdrawal) => {
    const answer = window.prompt('Reason (the member can see it). Leave empty for none.');
    if (answer === null) return;
    void act.run(async () => {
      const r = await api(`/admin/withdrawals/${w.id}/reject`, { method: 'POST', body: answer.trim() ? { note: answer.trim() } : {} });
      setPanel(null);
      changed();
      return r;
    });
  };

  const toggle = (id: string, mode: 'view' | 'pay') => setPanel((p) => (p && p.id === id && p.mode === mode ? null : { id, mode }));
  const total = items ? items.reduce((s, w) => s + Number(w.amount), 0) : 0;

  return (
    <div className="card">
      <div className="team-head">
        <div>
          <h2>{status === 'PENDING' ? 'Pending withdrawal requests' : 'Withdrawal requests'}</h2>
          <p className="muted">Review and process the withdrawal requests from members.</p>
        </div>
        <div className="wd-total">
          <small>{status === 'ALL' ? 'Total of all shown' : 'Total of the shown'}</small>
          <strong>{inr(total)}</strong>
          <small>{items ? `${items.length} request${items.length === 1 ? '' : 's'}` : 'Loading...'}</small>
        </div>
      </div>

      <div className="rep-tools">
        <select value={status} onChange={(e) => setStatus(e.target.value as Status)} aria-label="Status">
          <option value="PENDING">Waiting to be paid</option>
          <option value="PROCESSING">Processing</option>
          <option value="APPROVED">Paid</option>
          <option value="REJECTED">Rejected</option>
          <option value="ALL">All</option>
        </select>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setQ(typed.trim())} placeholder="Search name, email, mobile or Affiliate ID" aria-label="Search withdrawals" />
        <button className="btn ghost" type="button" onClick={() => setQ(typed.trim())}>
          Search
        </button>
      </div>
      {act.msg && <div className={`alert ${act.msg.type}`}>{act.msg.text}</div>}
      {items && items.length === 0 && <p className="muted">Nothing here.</p>}

      {items && items.length > 0 && (
        <div className="table-wrap">
          <table className="rep-table wd-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>User &amp; payment details</th>
                <th>Amount</th>
                <th className="center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((w) => (
                <Fragment key={w.id}>
                  <tr>
                    <td>{stamp(w.createdAt)}</td>
                    <td>
                      <b>{w.user.name}</b>
                      {w.bank ? (
                        <small className="muted wd-bank-lines">
                          A/C: {w.bank.account}
                          <br />
                          IFSC: {w.bank.ifsc}
                          {w.bank.upiId && (
                            <>
                              <br />
                              UPI: {w.bank.upiId}
                            </>
                          )}
                        </small>
                      ) : (
                        <small className="muted">No bank details</small>
                      )}
                      {w.status !== 'PENDING' && <span className={`badge ${w.status.toLowerCase()}`}>{w.status === 'APPROVED' ? 'Paid' : 'Rejected'}</span>}
                      {w.status === 'PENDING' && w.inProgress && <span className="badge processing">Processing</span>}
                    </td>
                    <td>
                      <b>{inr(w.amount)}</b>
                    </td>
                    <td className="rep-actions center">
                      <button className="btn ghost" type="button" onClick={() => toggle(w.id, 'view')}>
                        View
                      </button>
                      {w.status === 'PENDING' && (
                        <>
                          <button className="btn ok" type="button" disabled={act.busy} onClick={() => toggle(w.id, 'pay')}>
                            Approve
                          </button>
                          <button className="btn bad" type="button" disabled={act.busy} onClick={() => reject(w)}>
                            Reject
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                  {panel?.id === w.id && (
                    <tr className="wd-panel-row">
                      <td colSpan={4}>
                        <Panel w={w} mode={panel.mode} onClose={() => setPanel(null)} onDone={changed} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>
                  <b>Total</b>
                </td>
                <td colSpan={2}>
                  <b>{inr(total)}</b>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
