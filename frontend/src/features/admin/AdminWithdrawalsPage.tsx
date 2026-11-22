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

type Tab = 'withdrawals' | 'funds';

/** Money in and out on one page: withdrawals to pay, and add-fund payments to approve. */
export default function AdminWithdrawalsPage() {
  const [o, setO] = useState<Overview | null>(null);
  const [tick, setTick] = useState(0);
  const [tab, setTab] = useState<Tab>('withdrawals');

  useEffect(() => {
    api<Overview>('/admin/overview').then((r) => setO(r.data ?? null)).catch(() => undefined);
  }, [tick, tab]);

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

      <div className="dash-tabs ops-tabs">
        <button type="button" aria-pressed={tab === 'withdrawals'} onClick={() => setTab('withdrawals')}>
          Withdrawals
        </button>
        <button type="button" aria-pressed={tab === 'funds'} onClick={() => setTab('funds')}>
          Add fund approvals
        </button>
      </div>

      {tab === 'withdrawals' && <AdminWithdrawals onChanged={() => setTick((t) => t + 1)} />}
      {tab === 'funds' && (
        <>
          <p className="muted">Members pay by QR and send the amount, the transaction ID and a screenshot. Check the screenshot, then approve to add the money to their activation wallet.</p>
          <Queue<FundReq>
            path="/admin/fund-requests"
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
        </>
      )}
    </>
  );
}
