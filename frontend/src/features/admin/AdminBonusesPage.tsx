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
interface Achiever extends Person {
  level: number | null;
  amount: number;
  at: string;
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
  pools: {
    revenue: number;
    performance: { pct: number; total: number; paid: number; balance: number };
    leadership: { pct: number; total: number; paid: number; balance: number };
    company: { pct: number; total: number };
  };
  achievers: { performance: Achiever[]; leadership: Achiever[] };
  settings: { minPerShare: number; rewards: { team: { members: number; reward: number }[]; leadership: { size: number; reward: number }[] } };
}

const WEEKLY = {
  title: 'Weekly bonus achievers',
  blurb: 'Members with 3 or 6 direct sales of a package in the week. The weekly pool is shared by their shares, never below the minimum set above.',
  unit: 'Shares'
};

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
  const [teamLevels, setTeamLevels] = useState<{ members: string; reward: string }[]>([]);
  const [leadLevels, setLeadLevels] = useState<{ size: string; reward: string }[]>([]);
  const rewards = useRun();
  const save = useRun();
  const close = useRun();

  const load = useCallback(() => {
    api<Bonuses>(`/admin/bonuses${periodId ? `?periodId=${periodId}` : ''}`)
      .then((r) => {
        setData(r.data ?? null);
        if (r.data) setMin((m) => m || String(r.data!.settings.minPerShare));
        if (r.data) {
          setTeamLevels((a) => (a.length ? a : r.data!.settings.rewards.team.map((t) => ({ members: String(t.members), reward: String(t.reward) }))));
          setLeadLevels((a) => (a.length ? a : r.data!.settings.rewards.leadership.map((t) => ({ size: String(t.size), reward: String(t.reward) }))));
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
    const team = teamLevels.map((t) => ({ members: Number(t.members), reward: Number(t.reward) }));
    const leadership = leadLevels.map((t) => ({ size: Number(t.size), reward: Number(t.reward) }));
    const bad = [...team.map((t) => t.members), ...leadership.map((t) => t.size)].some((n) => !Number.isInteger(n) || n < 1);
    if (bad || [...team, ...leadership].some((t) => !Number.isFinite(t.reward) || t.reward < 0)) {
      return rewards.setMsg({ type: 'error', text: 'Every size must be a whole number of 1 or more, and every reward a number of rupees (0 or more).' });
    }
    void rewards.run(async () => {
      const r = await api('/site/content/bonusRewards', { method: 'PUT', body: { team, leadership } });
      load();
      return r;
    }, 'Saved. Members see the new levels now, and they are paid for targets completed from now on.');
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
        <h2>Team Performance and Leadership levels</h2>
        <p className="muted">Add, change or remove levels. A change affects only targets completed from now on. Members who are part-way keep their progress.</p>

        <h3>Team Performance (new members needed on each side)</h3>
        <div className="level-rows">
          {teamLevels.map((t, i) => (
            <div className="level-row" key={i}>
              <b>Level {i + 1}</b>
              <label>
                Members each side
                <input value={t.members} inputMode="numeric" onChange={(e) => setTeamLevels((a) => a.map((x, j) => (j === i ? { ...x, members: e.target.value } : x)))} aria-label={`Team Performance level ${i + 1} members`} />
              </label>
              <label>
                Bonus (₹)
                <input value={t.reward} inputMode="decimal" onChange={(e) => setTeamLevels((a) => a.map((x, j) => (j === i ? { ...x, reward: e.target.value } : x)))} aria-label={`Team Performance level ${i + 1} bonus`} />
              </label>
              <button className="btn ghost" type="button" disabled={teamLevels.length <= 1} onClick={() => setTeamLevels((a) => a.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
          ))}
        </div>
        <button className="btn ghost" type="button" disabled={teamLevels.length >= 40} onClick={() => setTeamLevels((a) => [...a, { members: String((Number(a[a.length - 1]?.members) || 1) * 2), reward: String((Number(a[a.length - 1]?.reward) || 0) * 2) }])}>
          + Add a level
        </button>

        <h3>Leadership (points needed on top of the level before)</h3>
        <div className="level-rows">
          {leadLevels.map((t, i) => {
            const total = leadLevels.slice(0, i + 1).reduce((s, x) => s + (Number(x.size) || 0), 0);
            return (
              <div className="level-row" key={i}>
                <b>Level {i + 1}</b>
                <label>
                  Points to add
                  <input value={t.size} inputMode="numeric" onChange={(e) => setLeadLevels((a) => a.map((x, j) => (j === i ? { ...x, size: e.target.value } : x)))} aria-label={`Leadership level ${i + 1} points`} />
                </label>
                <label>
                  Bonus (₹)
                  <input value={t.reward} inputMode="decimal" onChange={(e) => setLeadLevels((a) => a.map((x, j) => (j === i ? { ...x, reward: e.target.value } : x)))} aria-label={`Leadership level ${i + 1} bonus`} />
                </label>
                <small className="muted">{total} points in all</small>
                <button className="btn ghost" type="button" disabled={leadLevels.length <= 1} onClick={() => setLeadLevels((a) => a.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </div>
            );
          })}
        </div>
        <button className="btn ghost" type="button" disabled={leadLevels.length >= 40} onClick={() => setLeadLevels((a) => [...a, { size: String((Number(a[a.length - 1]?.size) || 3) * 2), reward: String((Number(a[a.length - 1]?.reward) || 0) * 2) }])}>
          + Add a level
        </button>

        {rewards.msg && <div className={`alert ${rewards.msg.type}`}>{rewards.msg.text}</div>}
        <button className="btn" disabled={rewards.busy || teamLevels.length === 0}>
          {rewards.busy ? 'Saving...' : 'Save levels'}
        </button>
      </form>

      <div className="bonus-top">
        <form className="card stack" onSubmit={saveMin}>
          <h2>Weekly bonus pool and settings</h2>
          {data ? (
            <>
              <p className="muted">
                {new Date(data.open.startsAt).getTime() < 86_400_000 ? 'So far' : `Since ${date(data.open.startsAt)}`}: sales of <b>{inr(data.open.revenue)}</b>
              </p>
              <p>
                Weekly pool (5% of this week&rsquo;s sales): <b>{inr(data.open.pools.weekly)}</b>
              </p>
            </>
          ) : (
            <p className="muted">Loading...</p>
          )}
          <p className="muted">
            This is the only pool that starts again: it is shared out and restarts every Sunday at midnight (IST). You can also close the week now.
          </p>
          <label>
            Minimum for one share (₹)
            <input value={min} inputMode="decimal" onChange={(e) => setMin(e.target.value)} aria-label="Minimum for one share" />
          </label>
          <p className="muted">The least a member gets for each share. If the pool is smaller, the company fund tops it up.</p>
          <ul className="bonus-tiers">
            <li>3 PRO sales (single weekly): <b>{inr(shown)}</b></li>
            <li>6 PRO sales (double weekly): <b>{inr(shown * 2)}</b></li>
            <li>3 ELITE sales (single weekly): <b>{inr(shown * 2)}</b></li>
            <li>6 ELITE sales (double weekly): <b>{inr(shown * 4)}</b></li>
          </ul>
          {save.msg && <div className={`alert ${save.msg.type}`}>{save.msg.text}</div>}
          {close.msg && <div className={`alert ${close.msg.type}`}>{close.msg.text}</div>}
          <div className="profile-actions">
            <button className="btn" disabled={save.busy}>
              Save bonus amounts
            </button>
            <button className="btn ghost" type="button" disabled={close.busy} onClick={closeNow}>
              Close the week now
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2>{WEEKLY.title}</h2>
        <p className="muted">{WEEKLY.blurb}</p>

        <h3>In line this week (estimate)</h3>
        <Table rows={data?.open.weekly ?? []} unit={WEEKLY.unit} estimate />

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
        {data && !data.period ? <p className="muted">No week has been closed yet.</p> : <Table rows={data?.paid.weekly ?? []} unit={WEEKLY.unit} />}
      </div>

      {(
        [
          { key: 'performance' as const, title: 'Team Performance bonus pool and achievers', blurb: 'Every package sale adds 20% to this pool. It never resets. Each Team Performance bonus paid to a member is taken out of it.' },
          { key: 'leadership' as const, title: 'Leadership bonus pool and achievers', blurb: 'Every package sale adds 5% to this pool. It never resets. Each Leadership bonus paid to a member is taken out of it.' }
        ]
      ).map((sec) => {
        const pool = data?.pools[sec.key];
        const rows = data?.achievers[sec.key] ?? [];
        return (
          <div className="card" key={sec.key}>
            <h2>{sec.title}</h2>
            <p className="muted">{sec.blurb}</p>
            {pool ? (
              <div className="levels admin-overview">
                <div className="level">
                  <small>Pool so far ({pool.pct}% of all sales)</small>
                  <strong>{inr(pool.total)}</strong>
                </div>
                <div className="level">
                  <small>Paid out as bonuses</small>
                  <strong>{inr(pool.paid)}</strong>
                </div>
                <div className="level">
                  <small>Left in the pool</small>
                  <strong className={pool.balance < 0 ? 'orange' : undefined}>{inr(pool.balance)}</strong>
                </div>
              </div>
            ) : (
              <p className="muted">Loading...</p>
            )}
            <h3>Achievers (latest first)</h3>
            {rows.length === 0 ? (
              <p className="muted">Nobody has completed a target yet.</p>
            ) : (
              <div className="table-wrap">
                <table className="rep-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Level</th>
                      <th>Bonus</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={`${r.email}-${i}`}>
                        <td>
                          <b>{r.name}</b>
                          <small className="muted">
                            {r.email} · {r.referralCode}
                          </small>
                        </td>
                        <td>{r.level ?? '-'}</td>
                        <td>
                          <b>{inr(r.amount)}</b>
                        </td>
                        <td>{date(r.at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      <div className="card">
        <h2>Company fund</h2>
        <p className="muted">The company keeps {data?.pools.company.pct ?? 20}% of every package sale.</p>
        <strong className="price">{data ? inr(data.pools.company.total) : '...'}</strong>
        <small className="muted">of {data ? inr(data.pools.revenue) : '...'} in package sales so far</small>
      </div>
    </>
  );
}
