import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../shared/api/apiClient';
import { inr } from '../../shared/format';
import AdminWithdrawals from './AdminWithdrawals';

interface Overview {
  waiting: { withdrawals: number };
  withdrawalsPendingAmount: number;
  withdrawalsPaidAmount: number;
}

/** One page for every withdrawal: who asked, how much, where to pay, and the payment proof once it is done. */
export default function AdminWithdrawalsPage() {
  const [o, setO] = useState<Overview | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    api<Overview>('/admin/overview').then((r) => setO(r.data ?? null)).catch(() => undefined);
  }, [tick]);

  return (
    <>
      <div className="team-head">
        <h1>Withdrawals</h1>
        <Link className="btn ghost" to="/admin">
          Back to admin
        </Link>
      </div>

      <div className="levels admin-overview">
        <div className="level">
          <small>Waiting to be paid</small>
          <strong>{o ? o.waiting.withdrawals : '...'}</strong>
          <em>requests</em>
        </div>
        <div className="level">
          <small>Amount to pay</small>
          <strong>{o ? inr(o.withdrawalsPendingAmount) : '...'}</strong>
          <em>in the waiting requests</em>
        </div>
        <div className="level">
          <small>Paid so far</small>
          <strong>{o ? inr(o.withdrawalsPaidAmount) : '...'}</strong>
          <em>all time</em>
        </div>
      </div>

      <AdminWithdrawals onChanged={() => setTick((t) => t + 1)} />
    </>
  );
}
