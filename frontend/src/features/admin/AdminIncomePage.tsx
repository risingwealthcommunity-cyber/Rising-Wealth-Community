import { useEffect, useState } from 'react';
import { api } from '../../shared/api/apiClient';
import { inr, typeLabel } from '../../shared/format';
import { STREAMS } from '../../shared/streams';

interface Day {
  date: string;
  sales: number;
  salesCount: number;
  paid: number;
  byType: Record<string, number>;
  companyFund: number;
  withdrawn: number;
}
interface Income {
  range: string;
  totals: { sales: number; salesCount: number; paid: number; byType: Record<string, number>; companyFund: number; withdrawn: number };
  days: Day[];
}

const RANGES: [string, string][] = [
  ['7', 'Last 7 days'],
  ['30', 'Last 30 days'],
  ['90', 'Last 90 days'],
  ['all', 'All time']
];

const dayLabel = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const streamOf = (type: string) => STREAMS.find((s) => s.types.includes(type));

/** Where the platform's money went: sales in, income credited to members, the company fund, and withdrawals paid out. */
export default function AdminIncomePage() {
  const [range, setRange] = useState('30');
  const [data, setData] = useState<Income | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setData(null);
    api<Income>(`/admin/income?range=${range}`).then((r) => setData(r.data ?? null)).catch(() => setFailed(true));
  }, [range]);

  return (
    <>
      <div className="team-head">
        <h1>Income summary</h1>
        <div className="dash-tabs" role="group" aria-label="Range">
          {RANGES.map(([k, name]) => (
            <button key={k} type="button" aria-pressed={range === k} onClick={() => setRange(k)}>
              {name}
            </button>
          ))}
        </div>
      </div>
      <p className="muted">The platform as a whole: package sales, the income credited to members, what went to the company fund, and withdrawals paid out.</p>

      {failed && <div className="alert error">Could not load the summary. Please try again.</div>}
      {!failed && !data && <p className="muted">Loading...</p>}

      {data && (
        <>
          <div className="levels admin-overview">
            <div className="level">
              <small>Package sales</small>
              <strong>{inr(data.totals.sales)}</strong>
              <em>{data.totals.salesCount} sale{data.totals.salesCount === 1 ? '' : 's'}</em>
            </div>
            <div className="level">
              <small>Income credited to members</small>
              <strong>{inr(data.totals.paid)}</strong>
              <em>all income types</em>
            </div>
            <div className="level">
              <small>Company fund</small>
              <strong>{inr(data.totals.companyFund)}</strong>
              <em>excess, locked levels, unclaimed pools</em>
            </div>
            <div className="level">
              <small>Withdrawals paid</small>
              <strong>{inr(data.totals.withdrawn)}</strong>
              <em>money that left the wallets</em>
            </div>
          </div>

          <div className="card">
            <h2>Income credited, by type</h2>
            {Object.keys(data.totals.byType).length === 0 && <p className="muted">Nothing was credited in this period.</p>}
            <div className="levels">
              {Object.entries(data.totals.byType)
                .sort((a, b) => b[1] - a[1])
                .map(([t, amount]) => (
                  <div className="level" key={t} style={{ borderLeft: `4px solid ${streamOf(t)?.color ?? '#94a3b8'}` }}>
                    <small>{streamOf(t)?.label ?? typeLabel(t)}</small>
                    <strong>{inr(amount)}</strong>
                  </div>
                ))}
            </div>
          </div>

          <div className="card">
            <h2>Day by day</h2>
            {data.days.length === 0 && <p className="muted">No activity in this period.</p>}
            {data.days.length > 0 && (
              <div className="table-wrap">
                <table className="rep-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Sales</th>
                      <th>Credited to members</th>
                      <th>Company fund</th>
                      <th>Withdrawn</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.days.map((d) => (
                      <tr key={d.date}>
                        <td>{dayLabel(d.date)}</td>
                        <td>
                          <b>{inr(d.sales)}</b>
                          {d.salesCount > 0 && <small className="muted">{d.salesCount} sale{d.salesCount === 1 ? '' : 's'}</small>}
                        </td>
                        <td>
                          <b>{inr(d.paid)}</b>
                          <div className="chips">
                            {Object.entries(d.byType).map(([t, amount]) => (
                              <span className="chip" key={t} style={{ borderColor: streamOf(t)?.color ?? '#94a3b8' }}>
                                {streamOf(t)?.label ?? typeLabel(t)}: <b>{inr(amount)}</b>
                              </span>
                            ))}
                          </div>
                        </td>
                        <td>{inr(d.companyFund)}</td>
                        <td>{inr(d.withdrawn)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>
                        <b>Total</b>
                      </td>
                      <td>
                        <b>{inr(data.totals.sales)}</b>
                      </td>
                      <td>
                        <b>{inr(data.totals.paid)}</b>
                      </td>
                      <td>
                        <b>{inr(data.totals.companyFund)}</b>
                      </td>
                      <td>
                        <b>{inr(data.totals.withdrawn)}</b>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
