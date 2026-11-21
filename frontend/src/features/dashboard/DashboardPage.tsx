import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../shared/api/apiClient';
import { Avatar } from '../../shared/components/Avatar';
import AvatarPicker from '../../shared/components/AvatarPicker';
import { Icon } from '../../shared/components/ShellIcons';
import { inr, label, typeLabel } from '../../shared/format';
import { useAuth } from '../auth';

interface Point {
  label: string;
  amount: number;
}
interface Summary {
  profile: { name: string; package: string; rank: string; affiliateId: string; leftCode: string | null; rightCode: string | null };
  stats: { today: number; last7: number; last30: number; passive: number; total: number; wallet: number; team: number };
  chart: { today: Point[]; week: Point[]; month: Point[] };
  breakdown: { type: string; amount: number }[];
}

const TYPE_COLOR: Record<string, string> = {
  DEMAT_DIRECT: '#2a313c',
  DEMAT_PASSIVE: '#47505e',
  DIRECT_INCOME: '#1f2937',
  PASSIVE_INCOME: '#646e7d',
  WEEKLY_BONUS: '#a3abb8',
  PERFORMANCE_BONUS: '#bcc3ce',
  LEADERSHIP_BONUS: '#d3d8e0',
  LEADERSHIP_TARGET_BONUS: '#8a93a2',
  TEAM_PERFORMANCE_BONUS: '#0d1117',
  RANK_REWARD: '#5b6574'
};
const colorOf = (type: string) => TYPE_COLOR[type] ?? '#94a3b8';

/** Round the top of the chart up to a tidy number so the 5 axis labels read well. */
function niceTop(max: number): number {
  if (max <= 0) return 100;
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  return step * 4;
}
const short = (n: number) => (n >= 100000 ? `${+(n / 100000).toFixed(1)}L` : n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : String(Math.round(n)));

/** Counts a number up from 0 when it first appears (skipped for people who prefer reduced motion). */
function useCountUp(target: number, ms = 800): number {
  const [value, setValue] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || target === 0) {
      setValue(target);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setValue(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, ms]);
  return value;
}

function Money({ value }: { value: number }) {
  return <>{inr(useCountUp(value))}</>;
}
function Count({ value }: { value: number }) {
  return <>{Math.round(useCountUp(value))}</>;
}

type Range = 'today' | 'week' | 'month';
const RANGES: { key: Range; name: string }[] = [
  { key: 'today', name: 'TODAY' },
  { key: 'week', name: 'WEEKLY' },
  { key: 'month', name: 'MONTHLY' }
];

function BarChart({ points }: { points: Point[] }) {
  const top = niceTop(Math.max(...points.map((p) => p.amount)));
  const ticks = [0, 1, 2, 3, 4].map((i) => top - (top / 4) * i);
  const empty = points.every((p) => p.amount === 0);
  return (
    <>
      <div className="chart" role="img" aria-label="Earnings chart">
        <div className="chart-y">
          {ticks.map((t) => (
            <span key={t}>{short(t)}</span>
          ))}
        </div>
        <div className="chart-plot">
          {points.map((p) => {
            const h = `${Math.max(0, (p.amount / top) * 100)}%`;
            return (
              <div className="chart-col" key={p.label} tabIndex={0} style={{ ['--h' as string]: h }}>
                <div className={`chart-bar${p.amount === 0 ? ' zero' : ''}`} style={{ height: h }} />
                <span className="chart-tip">{inr(p.amount)}</span>
                <span className="chart-x">{p.label}</span>
              </div>
            );
          })}
        </div>
      </div>
      {empty && <p className="chart-empty">No earnings in this period yet.</p>}
    </>
  );
}

function Donut({ rows, total }: { rows: Summary['breakdown']; total: number }) {
  const R = 80;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="donut">
      <svg viewBox="0 0 200 200" role="img" aria-label="Income breakdown">
        <circle cx="100" cy="100" r={R} fill="none" stroke="#e1e5ea" strokeWidth="22" />
        {rows.map((r) => {
          const len = (r.amount / total) * C;
          const gap = rows.length > 1 ? 2.5 : 0;
          const el = (
            <circle
              key={r.type}
              className="seg"
              cx="100"
              cy="100"
              r={R}
              stroke={colorOf(r.type)}
              strokeDasharray={`${Math.max(0, len - gap)} ${C - Math.max(0, len - gap)}`}
              strokeDashoffset={-offset}
            >
              <title>{`${typeLabel(r.type)}: ${inr(r.amount)} (${Math.round((r.amount / total) * 100)}%)`}</title>
            </circle>
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="donut-mid">
        <small>TOTAL EARNINGS</small>
        <strong>{inr(total)}</strong>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user, refreshUser } = useAuth();
  const [picking, setPicking] = useState(false);
  const [data, setData] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);
  const [range, setRange] = useState<Range>('today');
  const [copied, setCopied] = useState('');

  useEffect(() => {
    api<Summary>('/dashboard/summary')
      .then((r) => setData(r.data ?? null))
      .catch(() => setFailed(true));
  }, []);

  if (!user) return null;

  const link = (code: string) => `${window.location.origin}/register?ref=${code}`;
  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(''), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const left = user.leftCode;
  const right = user.rightCode;
  const codes = [
    { side: 'LEFT', code: left, note: 'New members who use this code join your LEFT team.' },
    { side: 'RIGHT', code: right, note: 'New members who use this code join your RIGHT team.' }
  ] as const;

  const s = data?.stats;
  const cards: { k: string; v: JSX.Element; icon: JSX.Element; gold?: boolean }[] = [
    { k: "Today's Income", v: <Money value={s?.today ?? 0} />, icon: Icon.wallet },
    { k: 'Last 7 Days', v: <Money value={s?.last7 ?? 0} />, icon: Icon.calendar },
    { k: 'Last 30 Days', v: <Money value={s?.last30 ?? 0} />, icon: Icon.calendar },
    { k: 'Passive Income', v: <Money value={s?.passive ?? 0} />, icon: Icon.bars },
    { k: 'Total Income', v: <Money value={s?.total ?? 0} />, icon: Icon.trophy, gold: true },
    { k: 'Total Team', v: <Count value={s?.team ?? 0} />, icon: Icon.users }
  ];

  const pkg = user.package;
  const total = data?.stats.total ?? 0;

  return (
    <>
      <div className="card dash-profile">
        <button type="button" className="dash-avatar" aria-label="Change your avatar" onClick={() => setPicking(true)}>
          <Avatar avatar={user.avatar} name={user.name} size={108} />
          <span className="dash-avatar-edit" aria-hidden="true">
            {Icon.edit}
          </span>
        </button>
        {picking && (
          <AvatarPicker current={user.avatar} name={user.name} onSaved={refreshUser} onClose={() => setPicking(false)} />
        )}
        <span className="dash-hello">Welcome back</span>
        <h1 className="dash-name">{user.name}</h1>
        <div className="dash-tags">
          <span className="dash-pill">VERIFIED ACCOUNT</span>
          <span className={`dash-pill${pkg === 'TRAINEE' ? '' : ' gold'}`}>{pkg}</span>
          {user.rank !== 'NONE' && <span className="dash-pill gold">{label(user.rank).toUpperCase()}</span>}
        </div>
        <div className="dash-aff">
          Affiliate ID: <b>{user.referralCode}</b>
        </div>
        <div className="dash-copy">
          {(
            [
              { key: 'left', title: 'Copy Left Referral Link', side: 'LEFT', code: left },
              { key: 'right', title: 'Copy Right Referral Link', side: 'RIGHT', code: right }
            ] as const
          ).map((c) => (
            <div className="dash-copy-item" key={c.key} data-side={c.side}>
              <button className="btn" disabled={!c.code} onClick={() => c.code && copy(`${c.key}-link`, link(c.code))}>
                {copied === `${c.key}-link` ? 'Copied!' : c.title}
              </button>
              <button
                type="button"
                className="dash-code"
                disabled={!c.code}
                title="Click to copy the code"
                onClick={() => c.code && copy(`${c.key}-code`, c.code)}
              >
                <small>{c.side} CODE</small>
                <b>{copied === `${c.key}-code` ? 'Copied!' : (c.code ?? '...')}</b>
              </button>
            </div>
          ))}
        </div>
      </div>

      {failed && <div className="alert error">Could not load your earnings. Please refresh in a moment.</div>}

      {!user.hasPassword && (
        <div className="alert">
          You signed in with Google. <Link to="/set-password">Set a password</Link> to also log in with your email.
        </div>
      )}
      {pkg === 'TRAINEE' && (
        <div className="alert">
          You are a Trainee: you earn from Demat referrals only. <Link to="/activation">Activate PRO or ELITE</Link> to unlock package
          income, passive levels, bonuses and ranks.
        </div>
      )}

      <div className="dash-stats">
        {cards.map((c) => (
          <div className={`card dash-stat${c.gold ? ' gold' : ''}`} key={c.k}>
            <div>
              <span className="k">{c.k}</span>
              <strong>{data ? c.v : '...'}</strong>
            </div>
            <span className="ico">{c.icon}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="dash-head">
          <h2>Earnings Overview</h2>
          <div className="dash-tabs" role="group" aria-label="Chart range">
            {RANGES.map((r) => (
              <button key={r.key} aria-pressed={range === r.key} onClick={() => setRange(r.key)}>
                {r.name}
              </button>
            ))}
          </div>
        </div>
        {data ? <BarChart key={range} points={data.chart[range]} /> : <p className="muted">Loading...</p>}
      </div>

      <div className="card">
        <h2>Income Breakdown</h2>
        {!data ? (
          <p className="muted">Loading...</p>
        ) : data.breakdown.length === 0 ? (
          <div className="empty-state">
            <strong>No income yet</strong>
            Share your referral links. Every income type shows up here as soon as it is credited.
          </div>
        ) : (
          <div className="income">
            <Donut rows={data.breakdown} total={total} />
            <div className="income-list">
              {data.breakdown.map((b) => (
                <div className="income-item" key={b.type} style={{ ['--c' as string]: colorOf(b.type) }}>
                  <div>
                    <small>{typeLabel(b.type)}</small>
                    <strong>{inr(b.amount)}</strong>
                  </div>
                  <em>{Math.round((b.amount / total) * 100)}%</em>
                  <span className="dot" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Your sponsor codes</h2>
        <p className="muted">You have two codes, one for each side of your team. Share the one for the side you want.</p>
        <div className="code-grid">
          {codes.map((c) => (
            <div className="code-card" key={c.side} data-side={c.side}>
              <span className="badge">{c.side}</span>
              <strong className="code-value">{c.code ?? '...'}</strong>
              <span className="muted">{c.note}</span>
              <div className="copy-row">
                <button className="btn ghost" disabled={!c.code} onClick={() => c.code && copy(`${c.side}-code`, c.code)}>
                  {copied === `${c.side}-code` ? 'Copied!' : 'Copy code'}
                </button>
                <button className="btn" disabled={!c.code} onClick={() => c.code && copy(`${c.side}-link`, link(c.code))}>
                  {copied === `${c.side}-link` ? 'Copied!' : 'Copy invite link'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
