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

/** Smooth line through the points: each step eases flat at both ends, so the curve never overshoots the data. */
function linePath(pts: { x: number; y: number }[]): string {
  return pts
    .map((p, i) => {
      if (i === 0) return `M${p.x} ${p.y}`;
      const q = pts[i - 1];
      const mx = (q.x + p.x) / 2;
      return `C${mx} ${q.y} ${mx} ${p.y} ${p.x} ${p.y}`;
    })
    .join(' ');
}

function LineChart({ points }: { points: Point[] }) {
  const top = niceTop(Math.max(...points.map((p) => p.amount)));
  const ticks = [0, 1, 2, 3, 4].map((i) => top - (top / 4) * i);
  const empty = points.every((p) => p.amount === 0);
  const n = points.length;
  const xy = points.map((p, i) => ({ x: ((i + 0.5) / n) * 100, y: 100 - Math.max(0, Math.min(100, (p.amount / top) * 100)) }));
  const line = linePath(xy);
  const area = `${line} L${xy[n - 1].x} 100 L${xy[0].x} 100 Z`;
  return (
    <>
      <div className="chart" role="img" aria-label="Earnings line chart">
        <div className="chart-y">
          {ticks.map((t) => (
            <span key={t}>{short(t)}</span>
          ))}
        </div>
        <div className="chart-plot">
          <svg className="chart-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#0d1117" stopOpacity="0.18" />
                <stop offset="1" stopColor="#0d1117" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path className="chart-area" d={area} fill="url(#chart-fill)" />
            <path className="chart-line" d={line} pathLength={1} fill="none" />
          </svg>
          {points.map((p) => {
            const h = `${Math.max(0, Math.min(100, (p.amount / top) * 100))}%`;
            return (
              <div className="chart-col" key={p.label} tabIndex={0} style={{ ['--h' as string]: h }}>
                <span className={`chart-dot${p.amount === 0 ? ' zero' : ''}`} />
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

/** The income streams members see, always all of them (a stream with nothing earned yet shows Rs 0). */
const STREAMS: { key: string; label: string; types: string[]; color: string }[] = [
  { key: 'demat', label: 'Demat Referral Income', types: ['DEMAT_DIRECT'], color: '#14b8a6' },
  { key: 'direct', label: 'Direct Package Income', types: ['DIRECT_INCOME'], color: '#3b82f6' },
  { key: 'passive', label: 'Passive Income', types: ['PASSIVE_INCOME', 'DEMAT_PASSIVE'], color: '#8b5cf6' },
  { key: 'weekly', label: 'Weekly Bonus', types: ['WEEKLY_BONUS'], color: '#22c55e' },
  { key: 'leadership', label: 'Leadership Bonus', types: ['LEADERSHIP_TARGET_BONUS', 'LEADERSHIP_BONUS'], color: '#f59e0b' },
  { key: 'team', label: 'Team Performance Bonus', types: ['TEAM_PERFORMANCE_BONUS'], color: '#f43f5e' },
  { key: 'campaign', label: 'Campaign Reward', types: ['CAMPAIGN_REWARD'], color: '#0ea5e9' }
];

interface Stream {
  key: string;
  label: string;
  color: string;
  amount: number;
}

function streamsOf(breakdown: Summary['breakdown']): Stream[] {
  const known = new Set(STREAMS.flatMap((x) => x.types));
  const rows: Stream[] = STREAMS.map((x) => ({
    key: x.key,
    label: x.label,
    color: x.color,
    amount: breakdown.filter((b) => x.types.includes(b.type)).reduce((sum, b) => sum + b.amount, 0)
  }));
  const other = breakdown.filter((b) => !known.has(b.type)).reduce((sum, b) => sum + b.amount, 0);
  if (other > 0) rows.push({ key: 'other', label: 'Other bonuses', color: '#e3e6ea', amount: other });
  return rows;
}

function Donut({ rows, total, active, onActive }: { rows: Stream[]; total: number; active: string | null; onActive: (k: string | null) => void }) {
  const R = 72;
  const C = 2 * Math.PI * R;
  let offset = 0;
  const shown = rows.filter((r) => r.amount > 0);
  const hot = rows.find((r) => r.key === active);
  const labels = shown.map((r) => {
    const frac = r.amount / total;
    const mid = (offset + (frac * C) / 2) / C; // 0..1 clockwise from the top
    offset += frac * C;
    const ang = mid * 2 * Math.PI - Math.PI / 2;
    return { r, pct: Math.round(frac * 100), x: 50 + 45 * Math.cos(ang), y: 50 + 45 * Math.sin(ang) };
  });
  offset = 0;
  return (
    <div className="donut">
      <svg viewBox="0 0 200 200" role="img" aria-label="Income breakdown">
        <circle cx="100" cy="100" r={R} fill="none" stroke="#eceff3" strokeWidth="3" />
        {shown.map((r) => {
          const len = (r.amount / total) * C;
          const gap = shown.length > 1 ? 2.5 : 0;
          const el = (
            <circle
              key={r.key}
              className={`seg${active && active !== r.key ? ' dim' : ''}${active === r.key ? ' hot' : ''}`}
              cx="100"
              cy="100"
              r={R}
              stroke={r.color}
              strokeDasharray={`${Math.max(0, len - gap)} ${C - Math.max(0, len - gap)}`}
              strokeDashoffset={-offset}
              onMouseEnter={() => onActive(r.key)}
              onMouseLeave={() => onActive(null)}
            >
              <title>{`${r.label}: ${inr(r.amount)} (${Math.round((r.amount / total) * 100)}%)`}</title>
            </circle>
          );
          offset += len;
          return el;
        })}
      </svg>
      {labels.map(({ r, pct, x, y }) => (
        pct >= 3 && (
          <span key={r.key} className="donut-pct" style={{ left: `${x}%`, top: `${y}%` }}>
            {pct}%
          </span>
        )
      ))}
      <div className="donut-mid">
        <small>{hot ? hot.label.toUpperCase() : 'TOTAL EARNINGS'}</small>
        <strong>{inr(hot ? hot.amount : total)}</strong>
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
  const [activeStream, setActiveStream] = useState<string | null>(null);

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
        {data ? <LineChart key={range} points={data.chart[range]} /> : <p className="muted">Loading...</p>}
      </div>

      <div className="card">
        <h2>Income Breakdown</h2>
        {!data ? (
          <p className="muted">Loading...</p>
        ) : (
          <div className="income">
            <Donut rows={streamsOf(data.breakdown)} total={total} active={activeStream} onActive={setActiveStream} />
            <div className="income-list">
              {streamsOf(data.breakdown).map((b) => (
                <div
                  className={`income-item${activeStream === b.key ? ' hot' : ''}`}
                  key={b.key}
                  style={{ ['--c' as string]: b.color }}
                  onMouseEnter={() => setActiveStream(b.key)}
                  onMouseLeave={() => setActiveStream(null)}
                >
                  <div>
                    <small>{b.label}</small>
                    <strong>{inr(b.amount)}</strong>
                  </div>
                  <em>{total > 0 ? Math.round((b.amount / total) * 100) : 0}%</em>
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
