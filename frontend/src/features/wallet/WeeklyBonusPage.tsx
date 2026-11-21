import { useEffect, useState } from 'react';
import { api } from '../../shared/api/apiClient';
import { date, inr } from '../../shared/format';

interface Entry {
  id: string;
  amount: string;
  note: string | null;
  createdAt: string;
}
interface TxPage {
  total: number;
  items: Entry[];
}
interface Summary {
  earningsByType: Record<string, string>;
}

export default function WeeklyBonusPage() {
  const [tx, setTx] = useState<TxPage | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api<TxPage>('/wallet/transactions?type=WEEKLY_BONUS')
      .then((r) => setTx(r.data ?? null))
      .catch(() => setFailed(true));
    api<Summary>('/wallet')
      .then((r) => setSummary(r.data ?? null))
      .catch(() => undefined);
  }, []);

  const earned = summary?.earningsByType.WEEKLY_BONUS ?? '0';

  return (
    <>
      <div>
        <h1>Weekly Bonus</h1>
        <p className="muted">A share of the weekly pool, paid when the admin closes the week.</p>
      </div>

      <div className="grid">
        <div className="card stat">
          <span className="muted">Earned from weekly bonus</span>
          <strong>{summary ? inr(earned) : '...'}</strong>
        </div>
        <div className="card stat">
          <span className="muted">Times paid</span>
          <strong>{tx ? tx.total : '...'}</strong>
        </div>
      </div>

      <div className="card">
        <h2>How you earn shares</h2>
        <ul>
          <li>Every 3 direct sales of the same package in a week gives you 1 share (up to 2 shares per package).</li>
          <li>An ELITE share counts double.</li>
          <li>The weekly pool is 5% of that week&rsquo;s confirmed package revenue, split in proportion to shares.</li>
          <li>You need an active PRO or ELITE package to receive it.</li>
        </ul>
      </div>

      <div className="card">
        <h2>History</h2>
        {failed && <p className="muted">Could not load the history. Please try again.</p>}
        {tx && tx.items.length === 0 && (
          <div className="empty-state">
            <strong>No weekly bonus yet</strong>
            Make 3 direct sales in a week to earn your first share.
          </div>
        )}
        {tx && tx.items.length > 0 && (
          <table>
            <tbody>
              {tx.items.map((e) => (
                <tr key={e.id}>
                  <td className="muted">{date(e.createdAt)}</td>
                  <td className="muted">{e.note ?? 'Weekly bonus'}</td>
                  <td className="amount">+{inr(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
