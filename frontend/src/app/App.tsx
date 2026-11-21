import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import {
  ForgotPasswordPage,
  GuestRoute,
  LoginPage,
  ProtectedRoute,
  RegisterPage,
  ResetPasswordPage,
  SetPasswordPage,
  VerifyEmailCodePage,
  VerifyEmailPage,
  useAuth
} from '../features/auth';
import AppLayout from '../shared/components/AppLayout';
import { ActivationPage } from '../features/activation';
import { AdminMembersPage, AdminOpsPage, AdminPage, SiteContentPage } from '../features/admin';
import { CampaignsPage, ReportsPage } from '../features/campaigns';
import { DashboardPage, LeaderboardPage, ProfilePage, TrainingPage } from '../features/dashboard';
import { LandingPage } from '../features/landing';
import { PackagesPage } from '../features/packages';
import { LivePage } from '../features/live';
import { BonusesPage, RanksPage, TeamPage } from '../features/team';
import { WalletPage, WeeklyBonusPage } from '../features/wallet';

function AdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN' ? <>{children}</> : <Navigate to="/dashboard" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />

      {/* Opened from an email: must work whether or not the visitor is logged in. */}
      <Route path="/verify-email/:token" element={<VerifyEmailPage />} />
      <Route path="/reset-password/:token" element={<ResetPasswordPage />} />

      <Route element={<GuestRoute />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailCodePage />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/packages" element={<PackagesPage />} />
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="/team" element={<TeamPage />} />
          <Route path="/bonuses" element={<Navigate to="/bonuses/team" replace />} />
          <Route path="/bonuses/team" element={<BonusesPage view="team" />} />
          <Route path="/bonuses/leadership" element={<BonusesPage view="leadership" />} />
          <Route path="/bonuses/weekly" element={<WeeklyBonusPage />} />
          <Route path="/training" element={<TrainingPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/activation" element={<ActivationPage />} />
          <Route path="/campaigns" element={<CampaignsPage />} />
          <Route path="/ranks" element={<RanksPage />} />
          <Route path="/live" element={<LivePage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/set-password" element={<SetPasswordPage />} />
          <Route path="/admin" element={<AdminOnly><AdminPage /></AdminOnly>} />
          <Route path="/admin/site" element={<AdminOnly><SiteContentPage /></AdminOnly>} />
          <Route path="/admin/members" element={<AdminOnly><AdminMembersPage /></AdminOnly>} />
          <Route path="/admin/operations" element={<AdminOnly><AdminOpsPage /></AdminOnly>} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
