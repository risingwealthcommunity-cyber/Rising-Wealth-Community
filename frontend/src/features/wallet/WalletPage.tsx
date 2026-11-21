import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../shared/api/apiClient';
import { date, inr, label, typeLabel } from '../../shared/format';
import { useRef } from 'react';
import PaymentBox from '../../shared/components/PaymentBox';
import { compressImage } from '../../shared/compressImage';
import { toAmount, useRun } from '../../shared/useRun';

interface Summary {
  totalEarned: number;
  totalPaid: number;
  balance: string;
  available: number;
  pendingWithdrawals: number;
  activationBalance: number;
  hasTxnPassword: boolean;
  minWithdrawal: number;
}
interface Entry {
  id: string;
  type: string;
  amount: string;
  level: number | null;
  from: string | null;
  note: string | null;
  createdAt: string;
}
interface TxPage {
  page: number;
  pageSize: number;
  total: number;
  items: Entry[];
}
interface Req {
  id: string;
  amount: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reference?: string;
  note: string | null;
  createdAt: string;
}

const Status = ({ s }: { s: string }) => <span className={`badge ${s.toLowerCase()}`}>{label(s)}</span>;

export default function WalletPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [funds, setFunds] = useState<Req[]>([]);
  const [withdrawals, setWithdrawals] = useState<Req[]>([]);
  const [tx, setTx] = useState<TxPage | null>(null);
  const [page, setPage] = useState(1);
  const [showFund, setShowFund] = useState(false);

  const load = useCallback(async () => {
    const [s, f, w] = await Promise.all([api<Summary>('/wallet'), api<{ items: Req[] }>('/wallet/fund'), api<{ items: Req[] }>('/wallet/withdrawals')]);
    setSummary(s.data ?? null);
    setFunds(f.data?.items ?? []);
    setWithdrawals(w.data?.items ?? []);
  }, []);
  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);
  useEffect(() => {
    api<TxPage>(`/wallet/transactions?page=${page}`).then((r) => setTx(r.data ?? null)).catch(() => undefined);
  }, [page]);

  const fund = useRun();
  const wd = useRun();
  const [fAmount, setFAmount] = useState('');
  const [fRef, setFRef] = useState('');
  const [fFile, setFFile] = useState<File | null>(null);
  const fFileRef = useRef<HTMLInputElement>(null);
  const [wAmount, setWAmount] = useState('');
  const [wPass, setWPass] = useState('');

  const addFund = (e: FormEvent) => {
    e.preventDefault();
    const n = toAmount(fAmount);
    if (Number.isNaN(n)) return fund.setMsg({ type: 'error', text: 'Enter a valid amount.' });
    if (!fFile) return fund.setMsg({ type: 'error', text: 'Add the screenshot of your payment.' });
    void fund.run(async () => {
      const picture = await compressImage(fFile);
      const r = await api('/wallet/fund', { method: 'POST', body: { amount: n, reference: fRef, ...picture } });
      setFAmount('');
      setFRef('');
      setFFile(null);
      if (fFileRef.current) fFileRef.current.value = '';
      await load();
      return r;
    });
  };

  const withdraw = (e: FormEvent) => {
    e.preventDefault();
    const n = toAmount(wAmount);
    if (Number.isNaN(n)) return wd.setMsg({ type: 'error', text: 'Enter a valid amount.' });
    void wd.run(async () => {
      const r = await api('/wallet/withdraw', { method: 'POST', body: { amount: n, txnPassword: wPass } });
      setWAmount('');
      setWPass('');
      await load();
      return r;
    });
  };

  const pages = tx ? Math.max(1, Math.ceil(tx.total / tx.pageSize)) : 1;
  const money = (n?: number) => (summary && n !== undefined ? inr(n) : '...');

  return (
    <>
      <h1>Wallet</h1>

      <div className="dash-stats team-counts">
        <div className="card dash-stat">
          <div>
            <span>Total earned</span>
            <strong>{money(summary?.totalEarned)}</strong>
          </div>
        </div>
        <div className="card dash-stat">
          <div>
            <span>Available to withdraw</span>
            <strong>{money(summary?.available)}</strong>
            {summary && summary.pendingWithdrawals > 0 && <small className="muted">{inr(summary.pendingWithdrawals)} waiting for approval</small>}
          </div>
        </div>
        <div className="card dash-stat">
          <div>
            <span>Total paid</span>
            <strong>{money(summary?.totalPaid)}</strong>
          </div>
        </div>
      </div>

      <button className="btn wide" type="button" onClick={() => setShowFund((v) => !v)} aria-expanded={showFund}>
        {showFund ? 'Close' : '+ Add fund to wallet'}
      </button>

      {showFund && (
        <form className="card" onSubmit={addFund}>
          <h2>Add fund</h2>
          <PaymentBox />
          <p className="muted">
            Scan the QR and pay. Then enter the amount, the transaction ID and a screenshot of the payment. Once an admin has checked it, the money appears in your{' '}
            <Link to="/activation">activation wallet</Link>.
          </p>
          <div className="form-row">
            <input value={fAmount} inputMode="decimal" onChange={(e) => setFAmount(e.target.value)} placeholder="Amount paid" aria-label="Amount paid" />
            <input value={fRef} onChange={(e) => setFRef(e.target.value)} placeholder="Transaction ID (UTR)" aria-label="Transaction ID" maxLength={100} />
          </div>
          <label className="pay-file">
            Payment screenshot
            <input ref={fFileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFFile(e.target.files?.[0] ?? null)} />
          </label>
          <button className="btn" disabled={fund.busy || !fAmount || fRef.trim().length < 4 || !fFile}>
            {fund.busy ? 'Sending...' : 'Send for approval'}
          </button>
          {fund.msg && <div className={`alert ${fund.msg.type}`}>{fund.msg.text}</div>}
        </form>
      )}

      <div className="card">
        <h2>Add fund history</h2>
        {funds.length === 0 && <p className="muted">No funds added yet.</p>}
        <table>
          <tbody>
            {funds.map((f) => (
              <tr key={f.id}>
                <td className="amount">{inr(f.amount)}</td>
                <td className="muted">{f.reference}</td>
                <td>
                  <Status s={f.status} />
                </td>
                <td className="muted">{f.status === 'REJECTED' && f.note ? f.note : date(f.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form className="card" onSubmit={withdraw}>
        <h2>Withdrawal</h2>
        <p className="muted">
          Available balance: <b>{money(summary?.available)}</b>. Smallest withdrawal {summary ? inr(summary.minWithdrawal) : '...'}. Money is paid to the bank or UPI details in{' '}
          <Link to="/profile">My profile</Link>.
        </p>
        {summary && !summary.hasTxnPassword && (
          <div className="alert">
            Set a transaction password first. <Link to="/profile">Open My profile</Link>
          </div>
        )}
        <div className="form-row">
          <input value={wAmount} inputMode="decimal" onChange={(e) => setWAmount(e.target.value)} placeholder="Enter withdrawal amount" aria-label="Withdrawal amount" />
          <input type="password" value={wPass} onChange={(e) => setWPass(e.target.value)} placeholder="Transaction password" autoComplete="off" aria-label="Transaction password" />
          <button className="btn" disabled={wd.busy || !wAmount || !wPass}>
            Request withdrawal
          </button>
        </div>
        {wd.msg && <div className={`alert ${wd.msg.type}`}>{wd.msg.text}</div>}
      </form>

      <div className="card">
        <h2>Withdrawal history</h2>
        {withdrawals.length === 0 && <p className="muted">No withdrawal requests yet.</p>}
        <table>
          <tbody>
            {withdrawals.map((w) => (
              <tr key={w.id}>
                <td className="amount">{inr(w.amount)}</td>
                <td>
                  <Status s={w.status} />
                </td>
                <td className="muted">{w.status === 'REJECTED' && w.note ? w.note : ''}</td>
                <td className="muted">{date(w.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Transactions</h2>
        {tx && tx.items.length === 0 && <p className="muted">No income yet. Refer people to start earning.</p>}
        <table>
          <tbody>
            {tx?.items.map((e) => {
              const n = Number(e.amount);
              return (
                <tr key={e.id}>
                  <td>
                    {typeLabel(e.type)}
                    {e.level ? ` (L${e.level})` : ''}
                  </td>
                  <td className="muted">{e.from ?? e.note ?? ''}</td>
                  <td className="amount">
                    {n >= 0 ? '+' : '-'}
                    {inr(Math.abs(n))}
                  </td>
                  <td className="muted">{date(e.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {pages > 1 && (
          <div className="pager">
            <button className="btn ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <span className="muted">
              Page {page} of {pages}
            </span>
            <button className="btn ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Next
            </button>
          </div>
        )}
      </div>
    </>
  );
}
