import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../shared/api/apiClient';
import { Avatar } from '../../shared/components/Avatar';
import AvatarPicker from '../../shared/components/AvatarPicker';
import { Icon } from '../../shared/components/ShellIcons';
import { date, inr, label } from '../../shared/format';
import { useRun } from '../../shared/useRun';
import { useAuth } from '../auth';

interface Bank {
  bankName: string;
  account: string;
  ifsc: string;
  upiId: string;
}

export default function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const [picking, setPicking] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [place, setPlace] = useState<number | null>(null);
  const [directs, setDirects] = useState<number | null>(null);
  const [team, setTeam] = useState<number | null>(null);
  const [reports, setReports] = useState<{ total: number; approved: number; earnings: number } | null>(null);
  const [sponsor, setSponsor] = useState<string | null>(null);
  const [hasTxn, setHasTxn] = useState<boolean | null>(null);
  const [masked, setMasked] = useState<Bank | null>(null);

  const load = useCallback(() => {
    api<{ stats: { total: number; team: number }; profile: { sponsorName: string | null } }>('/dashboard/summary').then((r) => { setTotal(r.data?.stats.total ?? 0); setTeam(r.data?.stats.team ?? 0); setSponsor(r.data?.profile.sponsorName ?? ''); }).catch(() => undefined);
    api<{ me: { position: number } }>('/dashboard/leaderboard').then((r) => setPlace(r.data?.me.position ?? 0)).catch(() => undefined);
    api<{ directReferrals: unknown[] }>('/team/summary').then((r) => setDirects(r.data?.directReferrals.length ?? 0)).catch(() => undefined);
    api<{ total: number; approved: number; earnings: number }>('/campaigns/stats').then((r) => setReports(r.data ?? null)).catch(() => undefined);
    api<{ hasTxnPassword: boolean }>('/wallet').then((r) => setHasTxn(r.data?.hasTxnPassword ?? false)).catch(() => undefined);
    api<{ bank: Bank | null }>('/wallet/bank').then((r) => setMasked(r.data?.bank ?? null)).catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  // ---- account details
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', city: '' });
  const account = useRun();
  const startEdit = () => {
    if (!user) return;
    setForm({ name: user.name, phone: user.phone ?? '', city: user.city ?? '' });
    setEditing(true);
    account.setMsg(null);
  };
  const saveAccount = (e: FormEvent) => {
    e.preventDefault();
    void account.run(async () => {
      const r = await api('/dashboard/profile', { method: 'PUT', body: form });
      await refreshUser();
      setEditing(false);
      return r;
    });
  };

  // ---- bank & UPI
  const bank = useRun();
  const [unlockPass, setUnlockPass] = useState('');
  const [txnForBank, setTxnForBank] = useState<string | null>(null); // set while unlocked
  const [fields, setFields] = useState({ bankName: '', accountNumber: '', ifsc: '', upiId: '' });
  const unlock = (e: FormEvent) => {
    e.preventDefault();
    void bank.run(async () => {
      const r = await api<{ bank: Bank | null }>('/wallet/bank/unlock', { method: 'POST', body: { txnPassword: unlockPass } });
      const b = r.data?.bank;
      setFields({ bankName: b?.bankName ?? '', accountNumber: b?.account ?? '', ifsc: b?.ifsc ?? '', upiId: b?.upiId ?? '' });
      setTxnForBank(unlockPass);
      setUnlockPass('');
    }, 'Unlocked. You can edit your details now.');
  };
  const saveBank = (e: FormEvent) => {
    e.preventDefault();
    void bank.run(async () => {
      const r = await api('/wallet/bank', { method: 'PUT', body: { ...fields, txnPassword: txnForBank } });
      setTxnForBank(null);
      load();
      return r;
    });
  };

  // ---- transaction password
  const txn = useRun();
  const loginMail = useRun();
  const txnMail = useRun();
  const [tp, setTp] = useState({ login: '', current: '', next: '', again: '' });
  const saveTxn = (e: FormEvent) => {
    e.preventDefault();
    if (tp.next !== tp.again) return txn.setMsg({ type: 'error', text: 'The two new passwords do not match.' });
    void txn.run(async () => {
      const r = await api('/wallet/txn-password', {
        method: 'POST',
        body: { newPassword: tp.next, loginPassword: tp.login || undefined, currentTxnPassword: tp.current || undefined }
      });
      setTp({ login: '', current: '', next: '', again: '' });
      load();
      return r;
    });
  };

  if (!user) return null;

  const rows: [string, string][] = [
    ['Mobile', user.phone ?? 'Not added'],
    ['Email', user.email],
    ['City', user.city ?? 'Not added'],
    ['Package', label(user.package)],
    ['Affiliate ID', user.referralCode],
    ['Sponsor', sponsor === null ? '...' : sponsor || 'Rising Wealth Community'],
    ['Join date', date(user.createdAt)],
    ['Leaderboard rank', place === null ? '...' : place > 0 ? `#${place}` : 'Not ranked yet']
  ];
  const n = (v: number | null) => (v === null ? '...' : String(v));

  return (
    <>
      <h1>My profile</h1>

      <div className="profile-grid">
        <div className="card profile-card">
          <button type="button" className="dash-avatar profile-avatar" aria-label="Change your avatar" onClick={() => setPicking(true)}>
            <Avatar avatar={user.avatar} name={user.name} size={108} />
            <span className="dash-avatar-edit" aria-hidden="true">
              {Icon.edit}
            </span>
          </button>
          <h2>{user.name}</h2>
          <span className="muted">{user.email}</span>
          <div className="dash-tags">
            <span className="dash-pill">{label(user.package).toUpperCase()}</span>
            {user.rank !== 'NONE' && <span className="dash-pill">{label(user.rank).toUpperCase()}</span>}
          </div>
          <button className="btn ghost" type="button" onClick={() => setPicking(true)}>
            Change avatar
          </button>
        </div>

        <div className="card">
          <h2>Account details</h2>
          {!editing ? (
            <>
              <dl className="profile-rows">
                {rows.map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              {account.msg && <div className={`alert ${account.msg.type}`}>{account.msg.text}</div>}
              <div className="profile-actions">
                <button className="btn" type="button" onClick={startEdit}>
                  Edit account details
                </button>
                <Link className="btn ghost" to="/activation">
                  Upgrade package
                </Link>
              </div>
            </>
          ) : (
            <form className="stack" onSubmit={saveAccount}>
              <label>
                Name
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} required />
              </label>
              <label>
                Mobile number
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="numeric" maxLength={10} placeholder="10 digit mobile" />
              </label>
              <label>
                City
                <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} maxLength={60} />
              </label>
              <small className="muted">Your email is your login, so it cannot be changed here.</small>
              {account.msg && <div className={`alert ${account.msg.type}`}>{account.msg.text}</div>}
              <div className="profile-actions">
                <button className="btn" disabled={account.busy}>
                  Save
                </button>
                <button className="btn ghost" type="button" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Bank &amp; UPI details</h2>
        <p className="muted">Withdrawals are paid here. The account number is stored encrypted and shown hidden until you unlock it.</p>
        {txnForBank === null ? (
          <form className="stack" onSubmit={unlock}>
            <div className="bank-grid">
              <input readOnly value={masked?.bankName ?? ''} placeholder="Bank name" aria-label="Bank name" />
              <input readOnly value={masked?.account ?? ''} placeholder="Account number" aria-label="Account number" />
              <input readOnly value={masked?.ifsc ?? ''} placeholder="IFSC code" aria-label="IFSC code" />
              <input readOnly value={masked?.upiId ?? ''} placeholder="UPI ID" aria-label="UPI ID" />
            </div>
            {hasTxn === false ? (
              <div className="alert">Set a transaction password below first, then you can add your bank details.</div>
            ) : (
              <div className="form-row">
                <input type="password" value={unlockPass} onChange={(e) => setUnlockPass(e.target.value)} placeholder="Transaction password" autoComplete="new-password" aria-label="Transaction password" />
                <button className="btn" disabled={bank.busy || !unlockPass}>
                  Unlock bank details
                </button>
              </div>
            )}
            {bank.msg && <div className={`alert ${bank.msg.type}`}>{bank.msg.text}</div>}
          </form>
        ) : (
          <form className="stack" onSubmit={saveBank}>
            <div className="bank-grid">
              <input value={fields.bankName} onChange={(e) => setFields({ ...fields, bankName: e.target.value })} placeholder="Bank name" aria-label="Bank name" maxLength={60} required />
              <input value={fields.accountNumber} onChange={(e) => setFields({ ...fields, accountNumber: e.target.value })} placeholder="Account number" aria-label="Account number" inputMode="numeric" maxLength={20} required />
              <input value={fields.ifsc} onChange={(e) => setFields({ ...fields, ifsc: e.target.value.toUpperCase() })} placeholder="IFSC code" aria-label="IFSC code" maxLength={11} required />
              <input value={fields.upiId} onChange={(e) => setFields({ ...fields, upiId: e.target.value })} placeholder="UPI ID (optional)" aria-label="UPI ID" maxLength={60} />
            </div>
            {bank.msg && <div className={`alert ${bank.msg.type}`}>{bank.msg.text}</div>}
            <div className="profile-actions">
              <button className="btn" disabled={bank.busy}>
                Save bank details
              </button>
              <button className="btn ghost" type="button" onClick={() => setTxnForBank(null)}>
                Lock
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="card">
        <h2>Performance</h2>
        <div className="levels">
          <div className="level">
            <small>Total reports</small>
            <strong>{reports ? reports.total : '...'}</strong>
          </div>
          <div className="level">
            <small>Approved</small>
            <strong>{reports ? reports.approved : '...'}</strong>
          </div>
          <div className="level">
            <small>Campaign earnings</small>
            <strong>{reports ? inr(reports.earnings) : '...'}</strong>
          </div>
          <div className="level">
            <small>Total earnings</small>
            <strong>{total === null ? '...' : inr(total)}</strong>
          </div>
          <div className="level">
            <small>Report approval</small>
            <strong>{reports ? (reports.total > 0 ? `${Math.round((reports.approved / reports.total) * 100)}%` : '–') : '...'}</strong>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Security settings</h2>
        <div className="security-grid">
          <div className="level">
            <b>Login password</b>
            <small className="muted">{user.hasPassword ? 'Used to sign in.' : 'You sign in with Google. Add a password to also sign in with email.'}</small>
            {user.hasPassword ? (
              <button className="btn" type="button" disabled={loginMail.busy} onClick={() => void loginMail.run(async () => api('/auth/forgot-password', { method: 'POST', body: { email: user.email } }))}>
                {loginMail.busy ? 'Sending...' : 'Reset login password'}
              </button>
            ) : (
              <Link className="btn" to="/set-password">
                Set a login password
              </Link>
            )}
            {user.hasPassword && <small className="muted">We email you a link to choose a new one.</small>}
            {loginMail.msg && <div className={`alert ${loginMail.msg.type}`}>{loginMail.msg.text}</div>}
          </div>
          <form className="level stack" onSubmit={saveTxn}>
            <b>Transaction password</b>
            <small className="muted">Needed for transfers, activations, withdrawals and bank details. 5 wrong tries lock it for 15 minutes.</small>
            {user.hasPassword ? (
              <input type="password" value={tp.login} onChange={(e) => setTp({ ...tp, login: e.target.value })} placeholder="Your login password" autoComplete="current-password" aria-label="Login password" />
            ) : (
              hasTxn && <input type="password" value={tp.current} onChange={(e) => setTp({ ...tp, current: e.target.value })} placeholder="Current transaction password" autoComplete="off" aria-label="Current transaction password" />
            )}
            <input type="password" value={tp.next} onChange={(e) => setTp({ ...tp, next: e.target.value })} placeholder="New transaction password (8+ characters)" autoComplete="new-password" aria-label="New transaction password" />
            <input type="password" value={tp.again} onChange={(e) => setTp({ ...tp, again: e.target.value })} placeholder="Repeat the new password" autoComplete="new-password" aria-label="Repeat the new transaction password" />
            {txn.msg && <div className={`alert ${txn.msg.type}`}>{txn.msg.text}</div>}
            <button className="btn" disabled={txn.busy || tp.next.length < 8}>
              {hasTxn ? 'Change transaction password' : 'Set transaction password'}
            </button>
            {hasTxn && (
              <>
                <small className="muted">Forgot it? We email you a link to choose a new one.</small>
                <button className="btn ghost" type="button" disabled={txnMail.busy} onClick={() => void txnMail.run(async () => api('/wallet/txn-password/reset-request', { method: 'POST' }))}>
                  {txnMail.busy ? 'Sending...' : 'Reset transaction password'}
                </button>
                {txnMail.msg && <div className={`alert ${txnMail.msg.type}`}>{txnMail.msg.text}</div>}
              </>
            )}
          </form>
        </div>
      </div>

      {picking && <AvatarPicker current={user.avatar} name={user.name} onSaved={refreshUser} onClose={() => setPicking(false)} />}
    </>
  );
}
