import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../shared/api/apiClient';
import { date, inr, label } from '../../shared/format';
import { useRun } from '../../shared/useRun';

interface Member {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  city: string | null;
  package: string;
  rank: string;
  referralCode: string;
  isActive: boolean;
  isVerified: boolean;
  createdAt: string;
  walletBalance: string;
  activationBalance: string;
  sponsor: { name: string; referralCode: string } | null;
}
interface Page {
  page: number;
  pageSize: number;
  total: number;
  items: Member[];
}

export default function AdminMembersPage() {
  const [q, setQ] = useState('');
  const [typed, setTyped] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const act = useRun();

  const load = useCallback(() => {
    api<Page>(`/admin/members?page=${page}${q ? `&q=${encodeURIComponent(q)}` : ''}`)
      .then((r) => setData(r.data ?? null))
      .catch(() => setData(null));
  }, [page, q]);
  useEffect(load, [load]);

  const toggle = (m: Member) => {
    if (m.isActive && !window.confirm(`Switch off ${m.name}? They are signed out and cannot use the app until you switch them on again.`)) return;
    void act.run(async () => {
      const r = await api(`/admin/members/${m.id}/active`, { method: 'POST', body: { isActive: !m.isActive } });
      load();
      return r;
    });
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <div className="team-head">
        <h1>Members</h1>
        <Link className="btn ghost" to="/admin">
          Back to admin
        </Link>
      </div>

      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQ(typed.trim());
        }}
      >
        <div className="form-row">
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search by name, email, mobile or Affiliate ID" aria-label="Search members" />
          <button className="btn">Search</button>
        </div>
        {act.msg && <div className={`alert ${act.msg.type}`}>{act.msg.text}</div>}
        <p className="muted">{data ? `${data.total} member${data.total === 1 ? '' : 's'}` : 'Loading...'}</p>
      </form>

      <div className="card">
        {data && data.items.length === 0 && <p className="muted">No member found.</p>}
        <div className="report-list">
          {data?.items.map((m) => (
            <div className="report-row ops-row" key={m.id}>
              <div>
                <b>
                  {m.name} {!m.isActive && <span className="badge rejected">Off</span>} {!m.isVerified && <span className="badge pending">Not verified</span>}
                </b>
                <small className="muted">
                  {m.email}
                  {m.phone ? ` · ${m.phone}` : ''}
                  {m.city ? ` · ${m.city}` : ''}
                </small>
                <small className="muted">
                  {label(m.package)} · ID {m.referralCode} · joined {date(m.createdAt)}
                  {m.sponsor ? ` · sponsor ${m.sponsor.name} (${m.sponsor.referralCode})` : ''}
                </small>
                <small>
                  Wallet <b>{inr(m.walletBalance)}</b> · Activation <b>{inr(m.activationBalance)}</b>
                </small>
              </div>
              <span />
              <div className="report-actions">
                <button className={`btn ghost${m.isActive ? ' danger' : ''}`} type="button" disabled={act.busy} onClick={() => toggle(m)}>
                  {m.isActive ? 'Switch off' : 'Switch on'}
                </button>
              </div>
            </div>
          ))}
        </div>
        {pages > 1 && (
          <div className="pager">
            <button className="btn ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
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
