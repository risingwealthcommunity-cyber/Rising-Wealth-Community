import { Fragment, useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api/apiClient';
import { compressImage } from '../../shared/compressImage';
import { inr, label } from '../../shared/format';
import { openProofAt } from '../../shared/openProof';
import { toAmount, useRun } from '../../shared/useRun';

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
  earned: number;
  paid: number;
  pending: number;
  sponsor: { name: string; referralCode: string } | null;
}
interface Page {
  page: number;
  pageSize: number;
  total: number;
  totals: { earned: number; paid: number; pending: number };
  items: Member[];
}

interface Request {
  id: string;
  package: 'PRO' | 'ELITE';
  amount: string;
  reference: string | null;
  paidFromWallet: boolean;
  hasProof: boolean;
  createdAt: string;
  user: { id: string; name: string; email: string; package: string; referralCode: string; activationBalance: string };
}

const when = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** The form that pays a member part or all of their wallet and records the transaction. */
function PayPanel({ m, onClose, onDone }: { m: Member; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(String(m.pending));
  const [ref, setRef] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const act = useRun();

  const submit = () => {
    const n = toAmount(amount);
    if (Number.isNaN(n)) return act.setMsg({ type: 'error', text: 'Enter a valid amount.' });
    if (!file) return act.setMsg({ type: 'error', text: 'Add the screenshot of the payment you made.' });
    void act.run(async () => {
      const picture = await compressImage(file);
      const r = await api(`/admin/members/${m.id}/pay`, { method: 'POST', body: { amount: n, reference: ref.trim(), ...picture } });
      onDone();
      onClose();
      return r;
    });
  };

  return (
    <div className="wd-panel">
      <p className="muted">
        Pay <b>{m.name}</b> from the app wallet. Pending now: <b>{inr(m.pending)}</b>. Pay them first from your bank app, then record it here.
      </p>
      <div className="wd-pay">
        <input value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} placeholder="Amount (₹)" aria-label="Amount to pay" />
        <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Transaction ID of your payment" aria-label="Transaction ID" maxLength={100} />
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Payment screenshot" />
      </div>
      {act.msg && <div className={`alert ${act.msg.type}`}>{act.msg.text}</div>}
      <div className="wd-panel-actions">
        <button className="btn ok" type="button" disabled={act.busy || !amount || ref.trim().length < 4 || !file} onClick={submit}>
          {act.busy ? 'Saving...' : 'Confirm payment'}
        </button>
        <button className="btn ghost" type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Upgrade a member from their activation wallet, or for a payment received outside the app. */
function UpgradePanel({ m, onClose, onDone }: { m: Member; onClose: () => void; onDone: () => void }) {
  const higher = m.package === 'TRAINEE' ? ['PRO', 'ELITE'] : m.package === 'PRO' ? ['ELITE'] : [];
  const [pkg, setPkg] = useState(higher[0] ?? '');
  const [mode, setMode] = useState<'WALLET' | 'MANUAL'>('MANUAL');
  const [ref, setRef] = useState('');
  const act = useRun();

  const submit = () => {
    if (!window.confirm(`Upgrade ${m.name} to ${pkg}? ${mode === 'WALLET' ? 'The price is taken from their activation wallet.' : 'This records a payment you received outside the app.'} It cannot be undone.`)) return;
    void act.run(async () => {
      const r = await api(`/admin/members/${m.id}/upgrade`, { method: 'POST', body: { package: pkg, mode, ...(mode === 'MANUAL' ? { reference: ref.trim() } : {}) } });
      onDone();
      onClose();
      return r;
    });
  };

  if (higher.length === 0) return <div className="wd-panel"><p className="muted">{m.name} is already on the highest package.</p></div>;
  return (
    <div className="wd-panel">
      <p className="muted">
        Upgrade <b>{m.name}</b> (now {label(m.package)}). Activation wallet: <b>{inr(Number(m.activationBalance))}</b>. The sponsor and team income run exactly as for a normal purchase.
      </p>
      <div className="wd-pay">
        <select value={pkg} onChange={(e) => setPkg(e.target.value)} aria-label="Package">
          {higher.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <select value={mode} onChange={(e) => setMode(e.target.value as 'WALLET' | 'MANUAL')} aria-label="How it is paid">
          <option value="MANUAL">Payment received outside the app</option>
          <option value="WALLET">Take from their activation wallet</option>
        </select>
        {mode === 'MANUAL' && <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Payment reference / note (unique)" aria-label="Payment reference" maxLength={100} />}
      </div>
      {act.msg && <div className={`alert ${act.msg.type}`}>{act.msg.text}</div>}
      <div className="wd-panel-actions">
        <button className="btn ok" type="button" disabled={act.busy || !pkg || (mode === 'MANUAL' && ref.trim().length < 4)} onClick={submit}>
          {act.busy ? 'Upgrading...' : `Upgrade to ${pkg}`}
        </button>
        <button className="btn ghost" type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Members who asked to move up a package, with what they will pay from and what their activation wallet holds. */
function UpgradeRequests({ onChanged }: { onChanged: () => void }) {
  const [items, setItems] = useState<Request[] | null>(null);
  const act = useRun();
  const load = useCallback(() => {
    api<{ purchases: Request[] }>('/admin/purchases?status=PENDING')
      .then((r) => setItems(r.data?.purchases ?? []))
      .catch(() => setItems([]));
  }, []);
  useEffect(load, [load]);

  const decide = (id: string, what: 'confirm' | 'reject') =>
    void act.run(async () => {
      const r = await api(`/admin/purchases/${id}/${what}`, { method: 'POST' });
      load();
      onChanged();
      return r;
    }, what === 'confirm' ? 'Approved. The package is upgraded.' : 'Request rejected. Nothing was taken.');

  return (
    <div className="card">
      <h2>Membership upgrade requests {items && items.length > 0 ? `(${items.length})` : ''}</h2>
      <p className="muted">Approving a wallet request takes the price from the member's activation wallet and upgrades them at once.</p>
      {act.msg && <div className={`alert ${act.msg.type}`}>{act.msg.text}</div>}
      {items && items.length === 0 && <p className="muted">No upgrade request is waiting.</p>}
      {items && items.length > 0 && (
        <div className="table-wrap">
          <table className="rep-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Upgrade</th>
                <th>Pays by</th>
                <th>Asked</th>
                <th className="center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => {
                const short = p.paidFromWallet && Number(p.user.activationBalance) < Number(p.amount);
                return (
                  <tr key={p.id}>
                    <td>
                      <b>{p.user.name}</b>
                      <small className="muted">{p.user.email}</small>
                      <small className="muted">ID {p.user.referralCode}</small>
                    </td>
                    <td>
                      {label(p.user.package)} → <b>{p.package}</b>
                      <small className="muted">{inr(Number(p.amount))}</small>
                    </td>
                    <td>
                      {p.paidFromWallet ? (
                        <>
                          Activation wallet
                          <small className={short ? 'orange' : 'green'}>has {inr(Number(p.user.activationBalance))}{short ? ' (not enough)' : ''}</small>
                        </>
                      ) : (
                        <>
                          Bank payment
                          <small className="muted">{p.reference ?? 'no reference'}</small>
                        </>
                      )}
                    </td>
                    <td>{when(p.createdAt)}</td>
                    <td className="rep-actions center">
                      {p.hasProof && (
                        <button className="btn ghost" type="button" onClick={() => void openProofAt(`/admin/purchases/${p.id}/proof`).catch(() => undefined)}>
                          View screenshot
                        </button>
                      )}
                      <button className="btn ok" type="button" disabled={act.busy || short} onClick={() => decide(p.id, 'confirm')}>
                        Approve
                      </button>
                      <button className="btn bad" type="button" disabled={act.busy} onClick={() => decide(p.id, 'reject')}>
                        Reject
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** User income management: what every member earned, was paid and has pending, with Pay, Block and Delete. */
export default function AdminMembersPage() {
  const [q, setQ] = useState('');
  const [typed, setTyped] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [paying, setPaying] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const act = useRun();

  const load = useCallback(() => {
    api<Page>(`/admin/members?page=${page}${q ? `&q=${encodeURIComponent(q)}` : ''}`)
      .then((r) => setData(r.data ?? null))
      .catch(() => setData(null));
  }, [page, q]);
  useEffect(load, [load]);

  const block = (m: Member) => {
    if (m.isActive && !window.confirm(`Block ${m.name}? They are signed out and cannot use the app until you unblock them.`)) return;
    void act.run(async () => {
      const r = await api(`/admin/members/${m.id}/active`, { method: 'POST', body: { isActive: !m.isActive } });
      load();
      return r;
    }, m.isActive ? 'Member blocked and signed out.' : 'Member unblocked.');
  };

  const remove = (m: Member) => {
    if (!window.confirm(`Delete ${m.name} permanently? This cannot be undone. It only works for an account with no team, money, purchases or reports.`)) return;
    void act.run(async () => {
      const r = await api(`/admin/members/${m.id}`, { method: 'DELETE' });
      load();
      return r;
    });
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <h1>User income management</h1>

      <div className="levels admin-overview">
        <div className="level">
          <small>Total income on platform</small>
          <strong>{data ? inr(data.totals.earned) : '...'}</strong>
          <em>earned by all members, all time</em>
        </div>
        <div className="level">
          <small>Total amount pending in wallets</small>
          <strong>{data ? inr(data.totals.pending) : '...'}</strong>
          <em>still to be paid, all members</em>
        </div>
        <div className="level">
          <small>Total paid out</small>
          <strong>{data ? inr(data.totals.paid) : '...'}</strong>
          <em>already paid to members</em>
        </div>
      </div>

      <UpgradeRequests onChanged={load} />

      <div className="card">
        <div className="team-head">
          <div>
            <h2>All members</h2>
            <p className="muted">View all users, manage their payouts, and administer accounts. Deleting a user is permanent and cannot be undone.</p>
          </div>
          <span className="muted">{data ? `${data.total} member${data.total === 1 ? '' : 's'}` : 'Loading...'}</span>
        </div>
        <form
          className="rep-tools"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setQ(typed.trim());
          }}
        >
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Filter by name or email..." aria-label="Search members" />
          <button className="btn ghost">Search</button>
        </form>
        {act.msg && <div className={`alert ${act.msg.type}`}>{act.msg.text}</div>}
        {data && data.items.length === 0 && <p className="muted">No member found.</p>}

        {data && data.items.length > 0 && (
          <div className="table-wrap">
            <table className="rep-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th className="num">Total earned</th>
                  <th className="num">Total paid</th>
                  <th className="num">Pending</th>
                  <th>Package</th>
                  <th>Joined</th>
                  <th className="center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((m) => (
                  <Fragment key={m.id}>
                    <tr className={m.isActive ? undefined : 'done-row'}>
                      <td>
                        <b>{m.name}</b> {!m.isActive && <span className="badge rejected">Blocked</span>} {m.isActive && !m.isVerified && <span className="badge pending">Not verified</span>}
                        <small className="muted">{m.email}</small>
                        <small className="muted">
                          ID {m.referralCode}
                          {m.phone ? ` · ${m.phone}` : ''}
                          {m.sponsor ? ` · sponsor ${m.sponsor.name}` : ''}
                        </small>
                      </td>
                      <td className="num">{inr(m.earned)}</td>
                      <td className="num green">{inr(m.paid)}</td>
                      <td className="num orange">{inr(m.pending)}</td>
                      <td>
                        {label(m.package)}
                        {m.rank !== 'NONE' && <small className="muted">{label(m.rank)}</small>}
                      </td>
                      <td>{when(m.createdAt)}</td>
                      <td className="rep-actions center">
                        <button className="btn solid" type="button" disabled={m.pending <= 0 || act.busy} onClick={() => setPaying(paying === m.id ? null : m.id)}>
                          Pay
                        </button>
                        <button className="btn ghost" type="button" disabled={act.busy} onClick={() => setUpgrading(upgrading === m.id ? null : m.id)}>
                          Upgrade
                        </button>
                        <button className="btn ghost" type="button" disabled={act.busy} onClick={() => block(m)} title={m.isActive ? 'Block this member' : 'Unblock this member'} aria-label={m.isActive ? `Block ${m.name}` : `Unblock ${m.name}`}>
                          {m.isActive ? '⊘' : '↺'}
                        </button>
                        <button className="btn bad" type="button" disabled={act.busy} onClick={() => remove(m)} title="Delete permanently" aria-label={`Delete ${m.name}`}>
                          🗑
                        </button>
                      </td>
                    </tr>
                    {paying === m.id && (
                      <tr className="wd-panel-row">
                        <td colSpan={7}>
                          <PayPanel m={m} onClose={() => setPaying(null)} onDone={load} />
                        </td>
                      </tr>
                    )}
                    {upgrading === m.id && (
                      <tr className="wd-panel-row">
                        <td colSpan={7}>
                          <UpgradePanel m={m} onClose={() => setUpgrading(null)} onDone={load} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>
                    <b>Total (all members)</b>
                  </td>
                  <td className="num">
                    <b>{inr(data.totals.earned)}</b>
                  </td>
                  <td className="num">
                    <b>{inr(data.totals.paid)}</b>
                  </td>
                  <td className="num">
                    <b>{inr(data.totals.pending)}</b>
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
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
