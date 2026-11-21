import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../shared/api/apiClient';
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

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

const TYPE_COLOR: Record<string, string> = {
  DEMAT_DIRECT: '#22d3c5',
  DEMAT_PASSIVE: '#2dd4bf',
  DIRECT_INCOME: '#60a5fa',
  PASSIVE_INCOME: '#a78bfa',
  WEEKLY_BONUS: '#34d399',
  PERFORMANCE_BONUS: '#fb923c',
  LEADERSHIP_BONUS: '#f5c542',
  LEADERSHIP_TARGET_BONUS: '#facc15',
  TEAM_PERFORMANCE_BONUS: '#fb7185',
  RANK_REWARD: '#f472b6'
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
        <circle cx="100" cy="100" r={R} fill="none" stroke="#17233b" strokeWidth="22" />
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
  const { user } = useAuth();
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
  const cards: { k: string; v: string; icon: JSX.Element; gold?: boolean }[] = [
    { k: "Today's Income", v: inr(s?.today ?? 0), icon: Icon.wallet },
    { k: 'Last 7 Days', v: inr(s?.last7 ?? 0), icon: Icon.calendar },
    { k: 'Last 30 Days', v: inr(s?.last30 ?? 0), icon: Icon.calendar },
    { k: 'Passive Income', v: inr(s?.passive ?? 0), icon: Icon.bars },
    { k: 'Total Income', v: inr(s?.total ?? 0), icon: Icon.trophy, gold: true },
    { k: 'Total Team', v: String(s?.team ?? 0), icon: Icon.users }
  ];

  const pkg = user.package;
  const total = data?.stats.total ?? 0;

  return (
    <>
      <div className="card dash-profile">
        <div className="dash-avatar" aria-hidden="true">
          {initials(user.name)}
        </div>
        <h1 className="dash-name">{user.name}</h1>
        <div className="dash-tags">
          <span className="dash-pill">VERIFIED ACCOUNT</span>
          <span className={`dash-pill ${pkg === 'ELITE' ? 'gold' : pkg === 'PRO' ? '' : 'silver'}`}>{pkg}</span>
          {user.rank !== 'NONE' && <span className="dash-pill gold">{label(user.rank).toUpperCase()}</span>}
        </div>
        <div className="dash-aff">Affiliate ID: {user.referralCode}</div>
        <div className="dash-copy">
          <button className="btn" disabled={!left} onClick={() => left && copy('left-link', link(left))}>
            {copied === 'left-link' ? 'Copied!' : 'Copy Left Referral Link'}
          </button>
          <button className="btn" disabled={!right} onClick={() => right && copy('right-link', link(right))}>
            {copied === 'right-link' ? 'Copied!' : 'Copy Right Referral Link'}
          </button>
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
        {data ? <BarChart points={data.chart[range]} /> : <p className="muted">Loading...</p>}
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
