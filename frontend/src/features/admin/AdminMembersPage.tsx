import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api/apiClient';
import { inr, label } from '../../shared/format';
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

const when = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** Every member as a table, with search and a switch to turn someone off (they are signed out at once) or back on. */
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
      <h1>Users</h1>

      <div className="card">
        <div className="team-head">
          <div>
            <h2>All members</h2>
            <p className="muted">{data ? `${data.total} member${data.total === 1 ? '' : 's'}` : 'Loading...'}</p>
          </div>
        </div>
        <form
          className="rep-tools"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setQ(typed.trim());
          }}
        >
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search by name, email, mobile or Affiliate ID" aria-label="Search members" />
          <button className="btn ghost">Search</button>
        </form>
        {act.msg && <div className={`alert ${act.msg.type}`}>{act.msg.text}</div>}
        {data && data.items.length === 0 && <p className="muted">No member found.</p>}

        {data && data.items.length > 0 && (
          <div className="table-wrap">
            <table className="rep-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Contact</th>
                  <th>Package</th>
                  <th>Sponsor</th>
                  <th>Wallet</th>
                  <th>Joined</th>
                  <th>Status</th>
                  <th className="center">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((m) => (
                  <tr key={m.id} className={m.isActive ? undefined : 'done-row'}>
                    <td>
                      <b>{m.name}</b>
                      <small className="muted">ID {m.referralCode}</small>
                    </td>
                    <td>
                      {m.email}
                      {m.phone && <small className="muted">{m.phone}</small>}
                      {m.city && <small className="muted">{m.city}</small>}
                    </td>
                    <td>
                      {label(m.package)}
                      {m.rank !== 'NONE' && <small className="muted">{label(m.rank)}</small>}
                    </td>
                    <td>{m.sponsor ? <>{m.sponsor.name}<small className="muted">{m.sponsor.referralCode}</small></> : <span className="muted">-</span>}</td>
                    <td>
                      <b>{inr(m.walletBalance)}</b>
                      <small className="muted">Activation {inr(m.activationBalance)}</small>
                    </td>
                    <td>{when(m.createdAt)}</td>
                    <td>
                      {!m.isActive ? <span className="badge rejected">Off</span> : !m.isVerified ? <span className="badge pending">Not verified</span> : <span className="badge approved">Active</span>}
                    </td>
                    <td className="rep-actions center">
                      <button className={m.isActive ? 'btn bad' : 'btn ok'} type="button" disabled={act.busy} onClick={() => toggle(m)}>
                        {m.isActive ? 'Switch off' : 'Switch on'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

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
