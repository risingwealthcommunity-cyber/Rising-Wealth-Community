import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api/apiClient';
import { date, inr, label } from '../../shared/format';
import { useAuth } from '../auth';

interface Purchase {
  id: string;
  package: 'PRO' | 'ELITE';
  amount: string;
  status: 'PENDING' | 'CONFIRMED' | 'REJECTED';
  createdAt: string;
}

const PLANS = [
  {
    key: 'PRO' as const,
    price: 2499,
    perks: ['35% direct income (on your own package limit)', 'Passive income levels 1-7', 'Weekly & performance bonus', 'Binary points: 0.5 per sale']
  },
  {
    key: 'ELITE' as const,
    price: 4999,
    perks: ['35% direct income (higher cap)', 'Passive income levels 1-12', 'Weekly & performance bonus', 'Binary points: 1 per sale']
  }
];

const TIER = { TRAINEE: 0, PRO: 1, ELITE: 2 };

export default function PackagesPage() {
  const { user } = useAuth();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [reference, setReference] = useState('');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api<{ purchases: Purchase[] }>('/packages/mine');
    setPurchases(res.data?.purchases ?? []);
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  if (!user) return null;
  const hasPending = purchases.some((p) => p.status === 'PENDING');

  const buy = async (pkg: 'PRO' | 'ELITE') => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api('/packages/purchase', {
        method: 'POST',
        body: { package: pkg, reference: reference || undefined }
      });
      setMsg({ type: 'success', text: res.message ?? 'Request created' });
      setReference('');
      await load();
    } catch (err) {
      setMsg({ type: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Packages</h1>
      <p className="muted">
        Current package: <strong>{user.package}</strong>. The full amount is required for every upgrade.
      </p>

      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}

      <div className="card">
        <label>
          Payment reference (UTR / transaction id)
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Enter after you pay" />
        </label>
        <small className="muted">
          Pay the amount to the company account, then request activation. An admin confirms your payment.
        </small>
      </div>

      <div className="grid">
        {PLANS.map((plan) => {
          const owned = TIER[user.package] >= TIER[plan.key];
          return (
            <div className="card" key={plan.key}>
              <h2>{plan.key}</h2>
              <strong className="price">{inr(plan.price)}</strong>
              <ul>
                {plan.perks.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              <button className="btn" disabled={busy || owned || hasPending} onClick={() => buy(plan.key)}>
                {owned ? 'Already active' : hasPending ? 'Request pending' : `Request ${plan.key}`}
              </button>
            </div>
          );
        })}
      </div>

      <div className="card">
        <h2>My requests</h2>
        {purchases.length === 0 && <p className="muted">No requests yet.</p>}
        <table>
          <tbody>
            {purchases.map((p) => (
              <tr key={p.id}>
                <td>{p.package}</td>
                <td>{inr(p.amount)}</td>
                <td>
                  <span className={`badge ${p.status.toLowerCase()}`}>{label(p.status)}</span>
                </td>
                <td className="muted">{date(p.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
