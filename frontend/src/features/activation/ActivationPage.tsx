import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../shared/api/apiClient';
import { date, inr, label } from '../../shared/format';
import { toAmount, useRun } from '../../shared/useRun';
import { useAuth } from '../auth';

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

/** Ask to move up a package. The price is taken from the activation wallet only when an admin approves. */
function UpgradeRequest({ activation, prices, onChanged }: { activation: number; prices: { PRO: number; ELITE: number } | null; onChanged: () => Promise<void> }) {
  const { user, refreshUser } = useAuth();
  const [mine, setMine] = useState<Purchase[]>([]);
  const [pkg, setPkg] = useState('');
  const act = useRun();

  const load = useCallback(async () => {
    const r = await api<{ purchases: Purchase[] }>('/packages/mine');
    setMine(r.data?.purchases ?? []);
  }, []);
  useEffect(() => {
    // the package may have been upgraded since the page was last loaded
    void load().then(() => refreshUser());
  }, [load, refreshUser]);

  if (!user) return null;
  const waiting = mine.find((p) => p.status === 'PENDING');
  const last = mine.find((p) => p.status !== 'PENDING' && p.paidFromWallet);
  const options = (['PRO', 'ELITE'] as const).filter((k) => TIER[k] > TIER[user.package]);
  const price = pkg && prices ? prices[pkg as 'PRO' | 'ELITE'] : 0;

  const send = (e: FormEvent) => {
    e.preventDefault();
    void act.run(async () => {
      const r = await api('/packages/wallet-request', { method: 'POST', body: { package: pkg } });
      setPkg('');
      await Promise.all([load(), onChanged()]);
      return r;
    });
  };

  return (
    <div className="card stack">
      <h2>Upgrade your own ID</h2>
      <p className="muted">
        You are on <strong>{label(user.package)}</strong>. Your Affiliate ID: <b>{user.referralCode}</b>. Send a request: when an admin approves it, the price is taken from your activation wallet and your package is upgraded.
      </p>

      {waiting && (
        <div className="alert">
          Your request for <b>{waiting.package}</b> ({inr(waiting.amount)}) is waiting for an admin to approve it. Sent {date(waiting.createdAt)}. Keep at least {inr(waiting.amount)} in your activation wallet until then.
        </div>
      )}
      {!waiting && last && (
        <div className={`alert ${last.status === 'CONFIRMED' ? 'success' : 'error'}`}>
          {last.status === 'CONFIRMED' ? `Your upgrade to ${last.package} was approved.` : `Your request for ${last.package} was not approved. Nothing was taken from your wallet.`}
        </div>
      )}

      {!waiting && options.length === 0 && <p className="muted">You are on the highest package.</p>}
      {!waiting && options.length > 0 && (
        <form className="stack" onSubmit={send}>
          <div className="form-row">
            <select value={pkg} onChange={(e) => setPkg(e.target.value)} aria-label="Package">
              <option value="">Select package</option>
              {options.map((k) => (
                <option key={k} value={k}>
                  {k} {prices ? `(${inr(prices[k])})` : ''}
                </option>
              ))}
            </select>
            <button className="btn" disabled={act.busy || !pkg}>
              Send upgrade request
            </button>
          </div>
          {pkg && prices && activation < price && (
            <div className="alert error">
              Your activation wallet has {inr(activation)}, and {pkg} needs {inr(price)}. Add {inr(price - activation)} first: <Link to="/wallet">Wallet &gt; Add fund</Link>, or move money from your wallet above.
            </div>
          )}
          {act.msg && <div className={`alert ${act.msg.type}`}>{act.msg.text}</div>}
        </form>
      )}
    </div>
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
      const r = await api('/wallet/activate', { method: 'POST', body: { affiliateId: memberId, package: memberPkg, txnPassword: dPass } });
      setMemberId('');
      setDPass('');
      await load();
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
          <input type="password" value={tPass} onChange={(e) => setTPass(e.target.value)} placeholder="Transaction password" autoComplete="new-password" aria-label="Transaction password" />
          <button className="btn" disabled={transfer.busy || !amount || !tPass}>
            Transfer
          </button>
        </div>
        {transfer.msg && <div className={`alert ${transfer.msg.type}`}>{transfer.msg.text}</div>}
      </form>

      <UpgradeRequest activation={data?.activation ?? 0} prices={prices} onChanged={load} />

      <form className="card" onSubmit={doActivate}>
        <h2>Activate / upgrade a member of your team</h2>
        <p className="muted">This is done at once from your activation wallet. Upgrading your own ID needs an admin to approve (above).</p>
        <div className="form-row">
          <input value={memberId} onChange={(e) => setMemberId(e.target.value)} placeholder="Their Affiliate ID" aria-label="Affiliate ID of the member" />
          <select value={memberPkg} onChange={(e) => setMemberPkg(e.target.value)} aria-label="Package">
            <option value="">Select package</option>
            {options}
          </select>
          <input type="password" value={dPass} onChange={(e) => setDPass(e.target.value)} placeholder="Transaction password" autoComplete="new-password" aria-label="Transaction password" />
          <button className="btn" disabled={downline.busy || !memberId || !memberPkg || !dPass}>
            Activate
          </button>
        </div>
        {downline.msg && <div className={`alert ${downline.msg.type}`}>{downline.msg.text}</div>}
      </form>

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
