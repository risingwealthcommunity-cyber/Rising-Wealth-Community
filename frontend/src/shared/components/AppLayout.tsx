import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../features/auth';
import { Avatar } from './Avatar';
import MemberFooter from './MemberFooter';
import { Icon } from './ShellIcons';

const BONUS_LINKS = [
  { to: '/bonuses/leadership', label: 'Leadership Bonus', icon: Icon.star },
  { to: '/bonuses/team', label: 'Team Performance Bonus', icon: Icon.bars },
  { to: '/bonuses/weekly', label: 'Weekly Bonus', icon: Icon.calendar }
];

const readCollapsed = () => {
  try {
    return localStorage.getItem('rwc-sidebar') === 'closed';
  } catch {
    return false;
  }
};

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  // desktop: sidebar can be collapsed (remembered); phone: it slides over the page
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [bonusOpen, setBonusOpen] = useState(pathname.startsWith('/bonuses'));

  useEffect(() => setMobileOpen(false), [pathname]);
  useEffect(() => {
    if (pathname.startsWith('/bonuses')) setBonusOpen(true);
  }, [pathname]);

  const toggle = () => {
    if (window.matchMedia('(max-width: 900px)').matches) {
      setMobileOpen((v) => !v);
      return;
    }
    setCollapsed((v) => {
      try {
        localStorage.setItem('rwc-sidebar', v ? 'open' : 'closed');
      } catch {
        /* storage unavailable */
      }
      return !v;
    });
  };

  const onLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className={`shell${collapsed ? ' collapsed' : ''}${mobileOpen ? ' mobile-open' : ''}`}>
      <header className="shell-top">
        <button className="shell-burger" aria-label="Toggle menu" aria-expanded={mobileOpen || !collapsed} onClick={toggle}>
          {Icon.menu}
        </button>
        <img className="shell-logo" src="/logo.png" alt="" width="44" height="44" />
        <div className="shell-brand">
          <strong>Rising Wealth</strong>
          <span>COMMUNITY</span>
        </div>
        <Link className="shell-user" to="/profile" aria-label="My profile" title="My profile">
          <div className="shell-user-text">
            <b>{user?.name}</b>
            <small>{user?.package}</small>
          </div>
          <div className="shell-avatar" title={user?.name}>
            <Avatar avatar={user?.avatar} name={user?.name ?? ''} size={46} />
          </div>
        </Link>
      </header>

      <div className="shell-body">
        <aside className="shell-side" aria-label="Main menu">
          <nav>
            <div className="shell-label">MENU</div>
            <NavLink to="/dashboard">
              {Icon.dashboard}
              <span>Dashboard</span>
            </NavLink>
            <NavLink to="/training">
              {Icon.book}
              <span>Training Library</span>
            </NavLink>
            <NavLink to="/leaderboard">
              {Icon.trophy}
              <span>Leaderboard</span>
            </NavLink>
            <NavLink to="/team">
              {Icon.users}
              <span>My Team</span>
            </NavLink>

            <button
              type="button"
              className={`shell-group${pathname.startsWith('/bonuses') ? ' active' : ''}`}
              aria-expanded={bonusOpen}
              onClick={() => setBonusOpen((v) => !v)}
            >
              {Icon.plus}
              <span>Bonuses</span>
              <i className={`shell-caret${bonusOpen ? ' open' : ''}`}>{Icon.chevron}</i>
            </button>
            {bonusOpen && (
              <div className="shell-sub">
                {BONUS_LINKS.map((l) => (
                  <NavLink key={l.to} to={l.to}>
                    {l.icon}
                    <span>{l.label}</span>
                  </NavLink>
                ))}
              </div>
            )}

            <NavLink to="/campaigns">
              {Icon.megaphone}
              <span>Active Campaigns</span>
            </NavLink>
            <NavLink to="/reports">
              {Icon.upload}
              <span>Submit Reports</span>
            </NavLink>
            <NavLink to="/activation">
              {Icon.bolt}
              <span>Activation</span>
            </NavLink>
            <NavLink to="/wallet">
              {Icon.wallet}
              <span>Wallet</span>
            </NavLink>
            {isAdmin && (
              <NavLink to="/admin">
                {Icon.shield}
                <span>Admin</span>
              </NavLink>
            )}
          </nav>

          <div className="shell-foot">
            <NavLink to="/set-password">
              {Icon.key}
              <span>Password</span>
            </NavLink>
            <button type="button" onClick={onLogout}>
              {Icon.logout}
              <span>Logout</span>
            </button>
          </div>
        </aside>
        <div className="shell-scrim" onClick={() => setMobileOpen(false)} />

        <main className="shell-main">
          <Outlet />
          <MemberFooter />
        </main>
      </div>
    </div>
  );
}
