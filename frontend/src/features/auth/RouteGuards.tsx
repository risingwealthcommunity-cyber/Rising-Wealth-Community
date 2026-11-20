import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

const Loading = () => <div className="center-screen">Loading...</div>;

/** Only logged-in users can pass. */
export function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

/** Login/register pages: logged-in users are sent to the dashboard. */
export function GuestRoute() {
  const { user, loading } = useAuth();

  if (loading) return <Loading />;
  if (user) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}
