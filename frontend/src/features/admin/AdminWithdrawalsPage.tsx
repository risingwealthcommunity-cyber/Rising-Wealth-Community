import { useEffect, useState } from 'react';
import { api } from '../../shared/api/apiClient';
import { inr } from '../../shared/format';
import { openProofAt } from '../../shared/openProof';
import AdminWithdrawals from './AdminWithdrawals';
import { Queue, who } from './AdminQueue';
import type { Person, Status } from './AdminQueue';

interface Overview {
  waiting: { withdrawals: number; funds: number };
  withdrawalsPendingAmount: number;
  withdrawalsPaidAmount: number;
  fundsPendingAmount: number;
}

interface FundReq {
  id: string;
  amount: string;
  reference: string;
  status: Status;
  createdAt: string;
  user: Person;
}

/** Money in and out on one page: withdrawals to pay, then the add-fund payments to approve. */
export default function AdminWithdrawalsPage() {
  const [o, setO] = useState<Overview | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    api<Overview>('/admin/overview').then((r) => setO(r.data ?? null)).catch(() => undefined);
  }, [tick]);
  const refresh = () => setTick((t) => t + 1);

  return (
    <>
      <h1>Funds &amp; withdrawals</h1>

      <div className="levels admin-overview">
        <div className="level">
          <small>Withdrawals waiting</small>
          <strong>{o ? o.waiting.withdrawals : '...'}</strong>
          <em>{o ? `${inr(o.withdrawalsPendingAmount)} to pay` : 'requests'}</em>
        </div>
        <div className="level">
          <small>Paid out so far</small>
          <strong>{o ? inr(o.withdrawalsPaidAmount) : '...'}</strong>
          <em>all time</em>
        </div>
        <div className="level">
          <small>Add-fund payments waiting</small>
          <strong>{o ? o.waiting.funds : '...'}</strong>
          <em>{o ? `${inr(o.fundsPendingAmount)} to approve` : 'requests'}</em>
        </div>
      </div>

      <AdminWithdrawals onChanged={refresh} />

      <div className="admin-section-gap" />
      <Queue<FundReq>
        path="/admin/fund-requests"
        title="Add fund approvals"
        amountOf={(r) => Number(r.amount)}
        row={(r) => (
          <>
            {who(r.user)}
            <small>
              <b>{inr(r.amount)}</b> · transaction ID <b>{r.reference}</b>
            </small>
          </>
        )}
        extra={(r) => (
          <button className="btn ghost" type="button" onClick={() => void openProofAt(`/admin/fund-requests/${r.id}/proof`)}>
            View screenshot
          </button>
        )}
      />
      <p className="muted" onClick={refresh} />
    </>
  );
}
