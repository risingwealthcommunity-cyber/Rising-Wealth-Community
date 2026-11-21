import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../shared/api/apiClient';
import { date, inr } from '../../shared/format';
import { Link } from 'react-router-dom';

interface PendingPurchase {
  id: string;
  package: string;
  amount: string;
  reference: string | null;
  createdAt: string;
  user: { name: string; email: string; package: string };
}
interface Overview {
  members: number;
  active: number;
  newToday: number;
  byPackage: Record<string, number>;
  waiting: { purchases: number; funds: number; withdrawals: number; reports: number };
  walletTotal: number;
  activationTotal: number;
}
interface Period {
  id: string;
  startsAt: string;
  endsAt: string;
  revenue: string;
  weeklyPaid: string;
  performancePaid: string;
  leadershipPaid: string;
}

type Msg = { type: 'success' | 'error'; text: string } | null;

export default function AdminPage() {
  const [pending, setPending] = useState<PendingPurchase[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [fund, setFund] = useState('0');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [demat, setDemat] = useState({ referrerEmail: '', clientName: '', amount: '' });

  const load = useCallback(async () => {
    api<Overview>('/admin/overview').then((r) => setOverview(r.data ?? null)).catch(() => undefined);
    const [p, per, f] = await Promise.all([
      api<{ purchases: PendingPurchase[] }>('/admin/purchases?status=PENDING'),
      api<{ periods: Period[] }>('/admin/periods'),
      api<{ total: string }>('/admin/company-fund')
    ]);
    setPending(p.data?.purchases ?? []);
    setPeriods(per.data?.periods ?? []);
    setFund(f.data?.total ?? '0');
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const run = async (fn: () => Promise<{ message?: string }>) => {
    setMsg(null);
    try {
      const res = await fn();
      setMsg({ type: 'success', text: res.message ?? 'Done' });
      await load();
    } catch (err) {
      setMsg({ type: 'error', text: (err as Error).message });
    }
  };

  const submitDemat = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const res = await api('/admin/demat', {
        method: 'POST',
        body: {
          referrerEmail: demat.referrerEmail,
          clientName: demat.clientName || undefined,
          amount: Number(demat.amount)
        }
      });
      setDemat({ referrerEmail: '', clientName: '', amount: '' });
      return res;
    });
  };

  return (
    <>
      <h1>Admin</h1>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}

      <div className="levels admin-overview">
        <Link className="level" to="/admin/members">
          <small>Members</small>
          <strong>{overview ? overview.members : '...'}</strong>
          <em>{overview ? `${overview.active} active · ${overview.newToday} new in 24h` : ''}</em>
        </Link>
        <Link className="level" to="/admin/operations">
          <small>Fund requests</small>
          <strong>{overview ? overview.waiting.funds : '...'}</strong>
          <em>waiting</em>
        </Link>
        <Link className="level" to="/admin/operations">
          <small>Withdrawals</small>
          <strong>{overview ? overview.waiting.withdrawals : '...'}</strong>
          <em>waiting</em>
        </Link>
        <Link className="level" to="/admin/operations">
          <small>Reports</small>
          <strong>{overview ? overview.waiting.reports : '...'}</strong>
          <em>waiting</em>
        </Link>
        <div className="level">
          <small>Package payments</small>
          <strong>{overview ? overview.waiting.purchases : '...'}</strong>
          <em>waiting (below)</em>
        </div>
        <div className="level">
          <small>Owed in wallets</small>
          <strong>{overview ? inr(overview.walletTotal) : '...'}</strong>
          <em>{overview ? `Activation wallets ${inr(overview.activationTotal)}` : ''}</em>
        </div>
      </div>

      <div className="card">
        <h2>Website content</h2>
        <p className="muted">
          Change the milestone numbers, add team members and member reviews, set contact details, and upload the
          photos and certificate shown on the home page.
        </p>
        <div>
          <Link className="btn" to="/admin/members">
            Members
          </Link>
          <Link className="btn" to="/admin/operations">
            Operations
          </Link>
          <Link className="btn" to="/admin/site">
            Open website content
          </Link>
        </div>
      </div>

      <div className="card stat">
        <span className="muted">Company fund (excess, locked levels, unclaimed pools)</span>
        <strong className="price">{inr(fund)}</strong>
      </div>

      <div className="card">
        <h2>Pending package payments ({pending.length})</h2>
        {pending.length === 0 && <p className="muted">Nothing waiting.</p>}
        <table>
          <tbody>
            {pending.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.user.name}
                  <br />
                  <small className="muted">{p.user.email}</small>
                </td>
                <td>
                  {p.package} {inr(p.amount)}
                </td>
                <td className="muted">{p.reference ?? 'no reference'}</td>
                <td className="muted">{date(p.createdAt)}</td>
                <td className="actions">
                  <button
                    className="btn"
                    onClick={() => run(() => api(`/admin/purchases/${p.id}/confirm`, { method: 'POST' }))}
                  >
                    Confirm
                  </button>
                  <button
                    className="btn ghost"
                    onClick={() => run(() => api(`/admin/purchases/${p.id}/reject`, { method: 'POST' }))}
                  >
                    Reject
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form className="card" onSubmit={submitDemat}>
        <h2>Record Demat referral</h2>
        <label>
          Referrer email
          <input
            type="email"
            required
            value={demat.referrerEmail}
            onChange={(e) => setDemat({ ...demat, referrerEmail: e.target.value })}
          />
        </label>
        <label>
          Client name
          <input value={demat.clientName} onChange={(e) => setDemat({ ...demat, clientName: e.target.value })} />
        </label>
        <label>
          Amount payable to referrer (₹)
          <input
            type="number"
            min="1"
            step="0.01"
            required
            value={demat.amount}
            onChange={(e) => setDemat({ ...demat, amount: e.target.value })}
          />
        </label>
        <button className="btn">Record and pay</button>
      </form>

      <div className="card">
        <h2>Weekly pools</h2>
        <p className="muted">
          Closes the window since the last close and shares Weekly (5%), Performance (5%) and Leadership (12%) pools.
        </p>
        <button
          className="btn"
          onClick={() => {
            if (window.confirm('Close the current period and pay out the pools?')) {
              void run(() => api('/admin/periods/close', { method: 'POST' }));
            }
          }}
        >
          Close period and distribute
        </button>
        <table>
          <tbody>
            {periods.map((p) => (
              <tr key={p.id}>
                <td className="muted">{date(p.endsAt)}</td>
                <td>Revenue {inr(p.revenue)}</td>
                <td>Weekly {inr(p.weeklyPaid)}</td>
                <td>Perf {inr(p.performancePaid)}</td>
                <td>Leadership {inr(p.leadershipPaid)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
