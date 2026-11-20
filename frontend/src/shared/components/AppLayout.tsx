import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../features/auth';

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  const onLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div>
      <header className="topbar">
        <strong>RWC</strong>
        <nav>
          <NavLink to="/dashboard">Dashboard</NavLink>
          <NavLink to="/packages">Packages</NavLink>
          <NavLink to="/wallet">Wallet</NavLink>
          <NavLink to="/team">Team</NavLink>
          {isAdmin && <NavLink to="/admin">Admin</NavLink>}
          <button className="btn ghost" onClick={onLogout}>
            Logout
          </button>
        </nav>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
