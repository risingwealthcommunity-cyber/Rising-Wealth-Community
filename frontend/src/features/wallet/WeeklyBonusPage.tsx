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
interface Progress {
  perShare: number;
  maxShares: number;
  PRO: number;
  ELITE: number;
  awaiting?: number;
}

/**
 * One package's weekly bar: 3 direct sales = Single Weekly Bonus (the star), 6 = Double Weekly Bonus (the diamond).
 * The pointer sits at the number of sales made this week, and shows that number.
 */
function SalesBar({ name, sales, perShare, maxShares }: { name: string; sales: number; perShare: number; maxShares: number }) {
  const max = perShare * maxShares;
  const shown = Math.min(sales, max);
  const pct = (shown / max) * 100;
  const single = sales >= perShare;
  const double = sales >= max;
  return (
    <div className="card wb-card">
      <h2>{name} package</h2>
      <p className="muted">
        This week&rsquo;s direct sales: <b>{sales}</b>
        {double ? ' · Double Weekly Bonus reached' : single ? ' · Single Weekly Bonus reached' : ''}
      </p>
      <div className="wb-track" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={shown} aria-label={`${name} sales this week`}>
        <div className={`wb-fill${double ? ' double' : ''}`} style={{ width: `${pct}%` }} />
        <span className={`wb-mark${single ? ' on' : ''}`} style={{ left: `${(perShare / max) * 100}%` }} aria-hidden="true">
          ★
        </span>
        <span className={`wb-mark end${double ? ' on pulse' : ''}`} aria-hidden="true">
          ◆
        </span>
        <span className="wb-pointer" style={{ left: `${pct}%` }}>
          <b>{sales}</b>
        </span>
      </div>
      <div className="wb-scale" aria-hidden="true">
        {Array.from({ length: max + 1 }, (_, i) => (
          <span key={i}>{i}</span>
        ))}
      </div>
    </div>
  );
}

export default function WeeklyBonusPage() {
  const [tx, setTx] = useState<TxPage | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);

  useEffect(() => {
    api<TxPage>('/wallet/transactions?type=WEEKLY_BONUS')
      .then((r) => setTx(r.data ?? null))
      .catch(() => setFailed(true));
    api<Progress>('/team/weekly-progress')
      .then((r) => setProgress(r.data ?? null))
      .catch(() => undefined);
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

      {progress && (progress.awaiting ?? 0) > 0 && (
        <div className="alert">You have earned {inr(progress.awaiting ?? 0)} of weekly bonus. It reaches your wallet when the admin releases it.</div>
      )}

      {progress && (
        <div className="wb-bars">
          <SalesBar name="PRO" sales={progress.PRO} perShare={progress.perShare} maxShares={progress.maxShares} />
          <SalesBar name="ELITE" sales={progress.ELITE} perShare={progress.perShare} maxShares={progress.maxShares} />
        </div>
      )}

      <div className="card">
        <h2>How you earn shares</h2>
        <ul>
          <li>Every 3 direct sales of the same package in a week gives you 1 share (up to 2 shares per package).</li>
          <li>An ELITE share counts double.</li>
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
