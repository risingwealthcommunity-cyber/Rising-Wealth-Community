import { NavLink, Outlet } from 'react-router-dom';

const TABS: { to: string; label: string; end?: boolean }[] = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/site', label: 'Landing page' },
  { to: '/admin/campaigns', label: 'Campaigns' },
  { to: '/admin/reports', label: 'Reports' },
  { to: '/admin/members', label: 'Users' },
  { to: '/admin/withdrawals', label: 'Funds & withdrawals' },
  { to: '/admin/bonuses', label: 'Bonuses' },
  { to: '/admin/contact', label: 'Contact' },
  { to: '/admin/operations', label: 'Perks & live' }
];

/** The admin panel: one row of sections on top, the chosen section below. */
export default function AdminLayout() {
  return (
    <>
      <nav className="admin-tabs" aria-label="Admin sections">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  );
}
