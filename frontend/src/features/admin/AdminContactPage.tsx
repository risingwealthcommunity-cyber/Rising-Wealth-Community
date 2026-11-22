import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api/apiClient';
import { useRun } from '../../shared/useRun';

interface Msg {
  id: string;
  name: string;
  email: string;
  whatsapp: string;
  message: string;
  handled: boolean;
  createdAt: string;
}
interface Page {
  page: number;
  pageSize: number;
  total: number;
  unread: number;
  items: Msg[];
}

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const waLink = (raw: string) => {
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 8 ? `https://wa.me/${digits.length === 10 ? `91${digits}` : digits}` : null;
};

/** Messages sent through the contact form on the landing page. */
export default function AdminContactPage() {
  const [data, setData] = useState<Page | null>(null);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('');
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const act = useRun();

  const load = useCallback(() => {
    const qs = `page=${page}${filter ? `&handled=${filter}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
    api<Page>(`/admin/messages?${qs}`).then((r) => setData(r.data ?? null)).catch(() => setData(null));
  }, [page, filter, q]);
  useEffect(load, [load]);

  const setHandled = (m: Msg, handled: boolean) =>
    void act.run(async () => {
      const r = await api(`/admin/messages/${m.id}/handled`, { method: 'POST', body: { handled } });
      load();
      return r;
    });

  const remove = (m: Msg) => {
    if (!window.confirm(`Delete the message from ${m.name}?`)) return;
    void act.run(async () => {
      const r = await api(`/admin/messages/${m.id}`, { method: 'DELETE' });
      load();
      return r;
    });
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <h1>User inquiries</h1>
      <p className="muted">Messages submitted through the contact form on the landing page.{data ? ` ${data.unread} new.` : ''}</p>

      <div className="card">
        <form
          className="rep-tools"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setQ(typed.trim());
          }}
        >
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search name, email, WhatsApp or message..." aria-label="Search messages" />
          <select
            value={filter}
            onChange={(e) => {
              setPage(1);
              setFilter(e.target.value);
            }}
            aria-label="Show"
          >
            <option value="">All messages</option>
            <option value="false">New</option>
            <option value="true">Done</option>
          </select>
          <button className="btn ghost">Search</button>
        </form>
        {act.msg && <div className={`alert ${act.msg.type}`}>{act.msg.text}</div>}
        {data && data.items.length === 0 && <p className="muted">No messages.</p>}

        {data && data.items.length > 0 && (
          <div className="table-wrap">
            <table className="rep-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>From</th>
                  <th>Message</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {data.items.map((m) => (
                  <tr key={m.id} className={m.handled ? 'done-row' : undefined}>
                    <td>{when(m.createdAt)}</td>
                    <td>
                      <b>{m.name}</b>
                      <small>
                        <a href={`mailto:${m.email}`}>{m.email}</a>
                      </small>
                      {m.whatsapp && (
                        <small>
                          WhatsApp:{' '}
                          {waLink(m.whatsapp) ? (
                            <a href={waLink(m.whatsapp)!} target="_blank" rel="noopener noreferrer">
                              {m.whatsapp}
                            </a>
                          ) : (
                            m.whatsapp
                          )}
                        </small>
                      )}
                    </td>
                    <td className="msg-cell">{m.message}</td>
                    <td className="rep-actions">
                      <button className="btn ghost" type="button" disabled={act.busy} onClick={() => setHandled(m, !m.handled)}>
                        {m.handled ? 'Mark as new' : 'Mark as done'}
                      </button>
                      <button className="btn ghost danger" type="button" disabled={act.busy} onClick={() => remove(m)}>
                        Delete
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
