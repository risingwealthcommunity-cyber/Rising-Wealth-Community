import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../shared/api/apiClient';
import { date, inr } from '../../shared/format';
import { useRun } from '../../shared/useRun';

interface Person {
  id?: string;
  name: string;
  email: string;
  referralCode: string;
}
interface Paid extends Person {
  amount: number;
}
interface Line extends Person {
  weight: number;
  amount: number;
  sales?: { PRO: number; ELITE: number };
}
interface Bonuses {
  periods: { id: string; startsAt: string; endsAt: string; revenue: number }[];
  period: { id: string; startsAt: string; endsAt: string; revenue: number } | null;
  paid: { weekly: Paid[]; performance: Paid[]; leadership: Paid[] };
  open: {
    startsAt: string;
    revenue: number;
    pools: { weekly: number; performance: number; leadership: number };
    weekly: Line[];
    performance: Line[];
    leadership: Line[];
  };
  settings: { minPerShare: number; rewards: { team: number[]; leadership: number[] } };
}

const SECTIONS = [
  {
    key: 'weekly' as const,
    title: 'Weekly bonus achievers',
    blurb: 'Members with 3 or 6 direct sales of a package in the week. The pool is shared by their shares, never below the minimum set above.',
    unit: 'Shares'
  },
  {
    key: 'performance' as const,
    title: 'Performance bonus achievers',
    blurb: 'Shared by the points of each member\'s direct sales (PRO 0.5, ELITE 1).',
    unit: 'Half-points'
  },
  {
    key: 'leadership' as const,
    title: 'Leadership bonus achievers',
    blurb: 'Silver and above, shared by matched binary points. Matched points are used up when paid.',
    unit: 'Half-points matched'
  }
];

/** "Single" for 3 direct sales of a package, "Double" for 6, in the weekly bonus. Other bonuses have no levels. */
const levelOf = (r: Paid | Line) => {
  const sales = 'sales' in r ? r.sales : undefined;
  if (!sales) return '-';
  const parts: string[] = [];
  for (const pkg of ['PRO', 'ELITE'] as const) {
    const shares = Math.min(2, Math.floor(sales[pkg] / 3));
    if (shares > 0) parts.push(`${shares === 2 ? 'Double' : 'Single'} ${pkg} (${sales[pkg]} sales)`);
  }
  return parts.join(' + ') || '-';
};

function Table({ rows, unit, estimate }: { rows: (Paid | Line)[]; unit: string; estimate?: boolean }) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  if (rows.length === 0) return <p className="muted">{estimate ? 'Nobody is in line yet this week.' : 'Nobody was paid in this period.'}</p>;
  return (
    <div className="table-wrap">
      <table className="rep-table">
        <thead>
          <tr>
            <th>User</th>
            {estimate && <th>{unit}</th>}
            {estimate && <th>Level</th>}
            <th>{estimate ? 'Estimated bonus' : 'Bonus paid'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.email}>
              <td>
                <b>{r.name}</b>
                <small className="muted">
                  {r.email} · {r.referralCode}
                </small>
              </td>
              {estimate && <td>{'weight' in r ? r.weight : ''}</td>}
              {estimate && <td>{levelOf(r)}</td>}
              <td>
                <b>{inr(r.amount)}</b>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>
              <b>Total</b> ({rows.length})
            </td>
            {estimate && <td />}
            {estimate && <td />}
            <td>
              <b>{inr(total)}</b>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Who earned each bonus: the weekly, performance and leadership lists, for a closed period and for the week in progress. */
export default function AdminBonusesPage() {
  const [data, setData] = useState<Bonuses | null>(null);
  const [periodId, setPeriodId] = useState('');
  const [min, setMin] = useState('');
  const [teamAmts, setTeamAmts] = useState<string[]>([]);
  const [leadAmts, setLeadAmts] = useState<string[]>([]);
  const rewards = useRun();
  const save = useRun();
  const close = useRun();

  const load = useCallback(() => {
    api<Bonuses>(`/admin/bonuses${periodId ? `?periodId=${periodId}` : ''}`)
      .then((r) => {
        setData(r.data ?? null);
        if (r.data) setMin((m) => m || String(r.data!.settings.minPerShare));
        if (r.data) {
          setTeamAmts((a) => (a.length ? a : r.data!.settings.rewards.team.map(String)));
          setLeadAmts((a) => (a.length ? a : r.data!.settings.rewards.leadership.map(String)));
        }
      })
      .catch(() => setData(null));
  }, [periodId]);
  useEffect(load, [load]);

  const saveMin = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(min);
    if (!Number.isFinite(n) || n < 0) return save.setMsg({ type: 'error', text: 'Enter the amount in rupees.' });
    void save.run(async () => {
      const r = await api('/site/content/weeklyBonus', { method: 'PUT', body: { minPerShare: n } });
      load();
      return r;
    }, 'Saved. It applies the next time a period is closed.');
  };

  const saveRewards = (e: FormEvent) => {
    e.preventDefault();
    const team = teamAmts.map(Number);
    const leadership = leadAmts.map(Number);
    if ([...team, ...leadership].some((n) => !Number.isFinite(n) || n < 0)) return rewards.setMsg({ type: 'error', text: 'Every amount must be a number in rupees, zero or more.' });
    void rewards.run(async () => {
      const r = await api('/site/content/bonusRewards', { method: 'PUT', body: { team, leadership } });
      load();
      return r;
    }, 'Saved. Members see the new amounts now, and they are paid for targets completed from now on.');
  };

  const closeNow = () => {
    if (!window.confirm('Close the current period now and pay out the three bonus pools?')) return;
    void close.run(async () => {
      const r = await api('/admin/periods/close', { method: 'POST' });
      setPeriodId('');
      load();
      return r;
    }, 'Period closed and the bonuses were paid.');
  };

  const m = Number(min);
  const shown = Number.isFinite(m) && m >= 0 ? m : 0;

  return (
    <>
      <h1>Bonuses</h1>

      <form className="card stack" onSubmit={saveRewards}>
        <h2>Team Performance and Leadership bonus amounts</h2>
        <p className="muted">The rupees paid when a member completes each target. Changing them affects only targets completed from now on.</p>
        <h3>Team Performance (new members on each side)</h3>
        <div className="reward-grid">
          {teamAmts.map((v, i) => (
            <label key={i}>
              Target {i + 1} ({2 ** (i + 1)} : {2 ** (i + 1)}) ₹
              <input value={v} inputMode="decimal" onChange={(e) => setTeamAmts((a) => a.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Team Performance target ${i + 1} amount`} />
            </label>
          ))}
        </div>
        <h3>Leadership (points from your directs&rsquo; new members)</h3>
        <div className="reward-grid">
          {leadAmts.map((v, i) => (
            <label key={i}>
              Target {i + 1} ₹
              <input value={v} inputMode="decimal" onChange={(e) => setLeadAmts((a) => a.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Leadership target ${i + 1} amount`} />
            </label>
          ))}
        </div>
        {rewards.msg && <div className={`alert ${rewards.msg.type}`}>{rewards.msg.text}</div>}
        <button className="btn" disabled={rewards.busy || teamAmts.length === 0}>
          {rewards.busy ? 'Saving...' : 'Save target amounts'}
        </button>
      </form>

      <div className="bonus-top">
        <form className="card stack" onSubmit={saveMin}>
          <h2>Weekly bonus settings</h2>
          <p className="muted">The least a member gets for each share. If the pool is smaller, the company fund tops it up.</p>
          <label>
            Minimum for one share (₹)
            <input value={min} inputMode="decimal" onChange={(e) => setMin(e.target.value)} aria-label="Minimum for one share" />
          </label>
          <ul className="bonus-tiers">
            <li>3 PRO sales (single weekly): <b>{inr(shown)}</b></li>
            <li>6 PRO sales (double weekly): <b>{inr(shown * 2)}</b></li>
            <li>3 ELITE sales (single weekly): <b>{inr(shown * 2)}</b></li>
            <li>6 ELITE sales (double weekly): <b>{inr(shown * 4)}</b></li>
          </ul>
          {save.msg && <div className={`alert ${save.msg.type}`}>{save.msg.text}</div>}
          <button className="btn" disabled={save.busy}>
            Save bonus amounts
          </button>
        </form>

        <div className="card stack">
          <h2>This week</h2>
          {data ? (
            <>
              <p className="muted">
                {new Date(data.open.startsAt).getTime() < 86_400_000 ? 'So far' : `Since ${date(data.open.startsAt)}`}: sales of <b>{inr(data.open.revenue)}</b>
              </p>
              <ul className="bonus-tiers">
                <li>Weekly pool (5%): <b>{inr(data.open.pools.weekly)}</b></li>
                <li>Performance pool (5%): <b>{inr(data.open.pools.performance)}</b></li>
                <li>Leadership pool (12%): <b>{inr(data.open.pools.leadership)}</b></li>
              </ul>
            </>
          ) : (
            <p className="muted">Loading...</p>
          )}
          <p className="muted">The period closes by itself every Monday (IST). You can also close it now.</p>
          {close.msg && <div className={`alert ${close.msg.type}`}>{close.msg.text}</div>}
          <button className="btn ghost" type="button" disabled={close.busy} onClick={closeNow}>
            Close period now
          </button>
        </div>
      </div>

      {SECTIONS.map((s) => (
        <div className="card" key={s.key}>
          <h2>{s.title}</h2>
          <p className="muted">{s.blurb}</p>

          <h3>In line this week (estimate)</h3>
          <Table rows={data?.open[s.key] ?? []} unit={s.unit} estimate />

          <div className="team-head">
            <h3>Paid</h3>
            {data && data.periods.length > 0 && (
              <select value={data.period?.id ?? ''} onChange={(e) => setPeriodId(e.target.value)} aria-label="Period">
                {data.periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {date(p.startsAt)} to {date(p.endsAt)}
                  </option>
                ))}
              </select>
            )}
          </div>
          {data && !data.period ? <p className="muted">No period has been closed yet.</p> : <Table rows={data?.paid[s.key] ?? []} unit={s.unit} />}
        </div>
      ))}
    </>
  );
}
