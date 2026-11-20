import { useEffect, useState } from 'react';
import { api } from '../../shared/api/apiClient';
import { date, inr, label } from '../../shared/format';

interface Summary {
  balance: string;
  earningsByType: Record<string, string>;
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

export default function WalletPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [tx, setTx] = useState<TxPage | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    api<Summary>('/wallet').then((r) => setSummary(r.data ?? null)).catch(() => undefined);
  }, []);

  useEffect(() => {
    api<TxPage>(`/wallet/transactions?page=${page}`).then((r) => setTx(r.data ?? null)).catch(() => undefined);
  }, [page]);

  const pages = tx ? Math.max(1, Math.ceil(tx.total / tx.pageSize)) : 1;

  return (
    <>
      <h1>Wallet</h1>

      <div className="card stat">
        <span className="muted">Available balance</span>
        <strong className="price">{summary ? inr(summary.balance) : '...'}</strong>
      </div>

      {summary && Object.keys(summary.earningsByType).length > 0 && (
        <div className="grid">
          {Object.entries(summary.earningsByType).map(([type, amount]) => (
            <div className="card stat" key={type}>
              <span className="muted">{label(type)}</span>
              <strong>{inr(amount)}</strong>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>Transactions</h2>
        {tx && tx.items.length === 0 && <p className="muted">No income yet. Refer people to start earning.</p>}
        <table>
          <tbody>
            {tx?.items.map((e) => (
              <tr key={e.id}>
                <td>
                  {label(e.type)}
                  {e.level ? ` (L${e.level})` : ''}
                </td>
                <td className="muted">{e.from ?? e.note ?? ''}</td>
                <td className="amount">+{inr(e.amount)}</td>
                <td className="muted">{date(e.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {pages > 1 && (
          <div className="pager">
            <button className="btn ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Prev
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
