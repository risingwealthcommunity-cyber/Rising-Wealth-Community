import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../shared/api/apiClient';
import { date, inr, label } from '../../shared/format';
import { toAmount, useRun } from '../../shared/useRun';
import { useAuth } from '../auth';
import ActivationPopup from '../../shared/components/ActivationPopup';
import type { Activated } from '../../shared/components/ActivationPopup';
import PasswordInput from '../../shared/components/PasswordInput';

interface Activation {
  wallet: number;
  activation: number;
  hasTxnPassword: boolean;
  entries: { id: string; kind: 'FUND_ADDED' | 'TRANSFER_IN' | 'SPEND'; amount: string; note: string | null; createdAt: string }[];
}

interface Purchase {
  id: string;
  package: 'PRO' | 'ELITE';
  amount: string;
  status: 'PENDING' | 'CONFIRMED' | 'REJECTED';
  paidFromWallet: boolean;
  createdAt: string;
}

const KIND: Record<string, string> = { FUND_ADDED: 'Fund added', TRANSFER_IN: 'Transfer in', SPEND: 'Activation' };
const TIER = { TRAINEE: 0, PRO: 1, ELITE: 2 } as const;

/** Upgrade your own ID from your own activation wallet, at once. The price leaves the wallet now; no admin has to approve it. */
function UpgradeSelf({ activation, prices, onChanged, onDone }: { activation: number; prices: { PRO: number; ELITE: number } | null; onChanged: () => Promise<void>; onDone: (a: Activated) => void }) {
  const { user, refreshUser } = useAuth();
  const [pkg, setPkg] = useState('');
  const [pass, setPass] = useState('');
  const act = useRun();

  if (!user) return null;
  const options = (['PRO', 'ELITE'] as const).filter((k) => TIER[k] > TIER[user.package]);
  const price = pkg && prices ? prices[pkg as 'PRO' | 'ELITE'] : 0;

  const send = (e: FormEvent) => {
    e.preventDefault();
    void act.run(async () => {
      const r = await api<Activated>('/packages/upgrade-self', { method: 'POST', body: { package: pkg, txnPassword: pass } });
      setPkg('');
      setPass('');
      await Promise.all([refreshUser(), onChanged()]);
      if (r.data) onDone(r.data);
      return r;
    });
  };

  return (
    <form className="card stack" onSubmit={send} autoComplete="off">
      <h2>Upgrade your own ID</h2>
      <p className="muted">
        You are on <strong>{label(user.package)}</strong>. Your Affiliate ID: <b>{user.referralCode}</b>. The price is taken from your activation wallet and your package is upgraded at once.
      </p>
      {options.length === 0 ? (
        <p className="muted">You are on the highest package.</p>
      ) : (
        <>
          <div className="form-row">
            <select value={pkg} onChange={(e) => setPkg(e.target.value)} aria-label="Package">
              <option value="">Select package</option>
              {options.map((k) => (
                <option key={k} value={k}>
                  {k} {prices ? `(${inr(prices[k])})` : ''}
                </option>
              ))}
            </select>
            <PasswordInput value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Transaction password" autoComplete="new-password" aria-label="Transaction password" />
            <button className="btn" disabled={act.busy || !pkg || !pass}>
              {act.busy ? 'Upgrading...' : 'Upgrade now'}
            </button>
          </div>
          {pkg && prices && activation < price && (
            <div className="alert error">
              Your activation wallet has {inr(activation)}, and {pkg} needs {inr(price)}. Add {inr(price - activation)} first: <Link to="/wallet">Wallet &gt; Add fund</Link>, or move money from your wallet above.
            </div>
          )}
        </>
      )}
      {act.msg && <div className={`alert ${act.msg.type}`}>{act.msg.text}</div>}
    </form>
  );
}

export default function ActivationPage() {
  const { user } = useAuth();
  const [data, setData] = useState<Activation | null>(null);
  const [prices, setPrices] = useState<{ PRO: number; ELITE: number } | null>(null);

  const load = useCallback(async () => {
    const [a, p] = await Promise.all([api<Activation>('/wallet/activation'), api<{ PRO: number; ELITE: number }>('/packages/prices')]);
    setData(a.data ?? null);
    setPrices(p.data ?? null);
  }, []);
  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const transfer = useRun();
  const downline = useRun();
  const [amount, setAmount] = useState('');
  const [tPass, setTPass] = useState('');
  const [memberId, setMemberId] = useState('');
  const [memberPkg, setMemberPkg] = useState('');
  const [dPass, setDPass] = useState('');
  const [popup, setPopup] = useState<Activated | null>(null);

  if (!user) return null;
  const noTxn = data && !data.hasTxnPassword;
  const options = (['PRO', 'ELITE'] as const).map((k) => (
    <option key={k} value={k}>
      {k} {prices ? `(${inr(prices[k])})` : ''}
    </option>
  ));

  const doTransfer = (e: FormEvent) => {
    e.preventDefault();
    const n = toAmount(amount);
    if (Number.isNaN(n)) return transfer.setMsg({ type: 'error', text: 'Enter a valid amount.' });
    void transfer.run(async () => {
      await api('/wallet/transfer', { method: 'POST', body: { amount: n, txnPassword: tPass } });
      setAmount('');
      setTPass('');
      await load();
    }, `Moved ${inr(n)} to your activation wallet.`);
  };

  const doActivate = (e: FormEvent) => {
    e.preventDefault();
    void downline.run(async () => {
      const r = await api<Activated>('/wallet/activate', { method: 'POST', body: { affiliateId: memberId, package: memberPkg, txnPassword: dPass } });
      setMemberId('');
      setDPass('');
      await load();
      if (r.data) setPopup(r.data);
      return r;
    });
  };

  return (
    <>
      <h1>Activation Center</h1>

      <div className="wallet-pair">
        <div className="card dash-stat">
          <div>
            <span>Main wallet</span>
            <strong>{data ? inr(data.wallet) : '...'}</strong>
          </div>
        </div>
        <div className="card dash-stat">
          <div>
            <span>Activation wallet</span>
            <strong>{data ? inr(data.activation) : '...'}</strong>
          </div>
        </div>
      </div>

      {noTxn && (
        <div className="alert">
          Set a transaction password first, you need it to move money. <Link to="/profile">Open My profile</Link>
        </div>
      )}
      <p className="muted">
        The activation wallet can only be spent on activating IDs. Fill it from <Link to="/wallet">Wallet &gt; Add fund</Link> or by moving money from your main wallet.
      </p>

      <form className="card" onSubmit={doTransfer}>
        <h2>Transfer to activation wallet</h2>
        <div className="form-row">
          <input value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} placeholder="Amount" aria-label="Amount to transfer" />
          <PasswordInput value={tPass} onChange={(e) => setTPass(e.target.value)} placeholder="Transaction password" autoComplete="new-password" aria-label="Transaction password" />
          <button className="btn" disabled={transfer.busy || !amount || !tPass}>
            Transfer
          </button>
        </div>
        {transfer.msg && <div className={`alert ${transfer.msg.type}`}>{transfer.msg.text}</div>}
      </form>

      <UpgradeSelf activation={data?.activation ?? 0} prices={prices} onChanged={load} onDone={setPopup} />

      <form className="card" onSubmit={doActivate}>
        <h2>Activate / upgrade a member of your team</h2>
        <p className="muted">This is done at once from your activation wallet. To upgrade your own ID, use the box above.</p>
        <div className="form-row">
          <input value={memberId} onChange={(e) => setMemberId(e.target.value)} placeholder="Their Affiliate ID" aria-label="Affiliate ID of the member" />
          <select value={memberPkg} onChange={(e) => setMemberPkg(e.target.value)} aria-label="Package">
            <option value="">Select package</option>
            {options}
          </select>
          <PasswordInput value={dPass} onChange={(e) => setDPass(e.target.value)} placeholder="Transaction password" autoComplete="new-password" aria-label="Transaction password" />
          <button className="btn" disabled={downline.busy || !memberId || !memberPkg || !dPass}>
            Activate
          </button>
        </div>
        {downline.msg && <div className={`alert ${downline.msg.type}`}>{downline.msg.text}</div>}
      </form>

      {popup && <ActivationPopup info={popup} onClose={() => setPopup(null)} />}

      <div className="card">
        <h2>Transaction history</h2>
        {data && data.entries.length === 0 && <p className="muted">No transactions yet.</p>}
        <table>
          <tbody>
            {data?.entries.map((e) => (
              <tr key={e.id}>
                <td>{KIND[e.kind]}</td>
                <td className="muted">{e.note}</td>
                <td className="amount">
                  {Number(e.amount) > 0 ? '+' : '-'}
                  {inr(Math.abs(Number(e.amount)))}
                </td>
                <td className="muted">{date(e.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted tree-hint">
          Prefer to pay by bank transfer? <Link to="/packages">Request a package here</Link>.
        </p>
      </div>
    </>
  );
}
