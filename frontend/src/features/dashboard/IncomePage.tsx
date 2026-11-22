import { useEffect, useState } from 'react';
import { api } from '../../shared/api/apiClient';
import { inr, typeLabel } from '../../shared/format';
import { STREAMS, streamsOf } from '../../shared/streams';

interface Day {
  date: string;
  total: number;
  byType: Record<string, number>;
}
interface Income {
  range: string;
  total: number;
  byType: Record<string, number>;
  days: Day[];
}

const RANGES: [string, string][] = [
  ['7', 'Last 7 days'],
  ['30', 'Last 30 days'],
  ['90', 'Last 90 days'],
  ['all', 'All time']
];

/** "2026-11-20" -> "Fri, 20 Nov 2026" (the date is already an Indian calendar day, so no time zone maths). */
const dayLabel = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

const streamOfType = (type: string) => STREAMS.find((s) => s.types.includes(type));

/** Everything the member earned: totals per income type and a day by day list. */
export default function IncomePage() {
  const [range, setRange] = useState('30');
  const [data, setData] = useState<Income | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setData(null);
    api<Income>(`/dashboard/income?range=${range}`)
      .then((r) => setData(r.data ?? null))
      .catch(() => setFailed(true));
  }, [range]);

  const streams = data ? streamsOf(Object.entries(data.byType).map(([type, amount]) => ({ type, amount }))) : [];
  const other = data ? Object.entries(data.byType).filter(([t]) => !streamOfType(t)) : [];

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

      {failed && <div className="alert error">Could not load your income. Please try again.</div>}
      {!failed && !data && <p className="muted">Loading...</p>}

      {data && (
        <>
          <div className="card dash-stat income-total">
            <div>
              <span>Total income · {RANGES.find(([k]) => k === range)?.[1]}</span>
              <strong>{inr(data.total)}</strong>
            </div>
          </div>

          <div className="levels">
            {streams.map((s) => (
              <div className="level" key={s.key} style={{ borderLeft: `4px solid ${s.color}` }}>
                <small>{s.label}</small>
                <strong>{inr(s.amount)}</strong>
              </div>
            ))}
          </div>

          <div className="card">
            <h2>Day by day</h2>
            {data.days.length === 0 && (
              <div className="empty-state">
                <strong>No income in this period</strong>
                Share your links and every rupee you earn will be listed here.
              </div>
            )}
            {data.days.length > 0 && (
              <div className="table-wrap">
                <table className="rep-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>What you earned</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.days.map((d) => (
                      <tr key={d.date}>
                        <td>{dayLabel(d.date)}</td>
                        <td>
                          <div className="chips">
                            {Object.entries(d.byType).map(([t, amount]) => (
                              <span className="chip" key={t} style={{ borderColor: streamOfType(t)?.color ?? '#94a3b8' }}>
                                {streamOfType(t)?.label ?? typeLabel(t)}: <b>{inr(amount)}</b>
                              </span>
                            ))}
                          </div>
                        </td>
                        <td>
                          <b>{inr(d.total)}</b>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {other.length > 0 && <p className="muted">Other income is included in the total: {other.map(([t, a]) => `${typeLabel(t)} ${inr(a)}`).join(', ')}.</p>}
          </div>
        </>
      )}
    </>
  );
}
