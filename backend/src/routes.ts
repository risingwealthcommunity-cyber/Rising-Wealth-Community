import { Router } from 'express';
import { authRoutes } from './features/auth';
import { packagesRoutes } from './features/packages';
import { walletRoutes } from './features/wallet';
import { teamRoutes } from './features/team';
import { adminRoutes } from './features/admin';
import { siteRoutes } from './features/site';
import dashboardRoutes from './features/dashboard/dashboard.routes';
import { campaignRoutes, campaignAdminRoutes } from './features/campaigns/campaigns.routes';
import { liveRoutes, liveAdminRoutes } from './features/live/live.routes';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ success: true, message: 'OK' });
});

// Each feature mounts its own router here.
router.use('/auth', authRoutes);
router.use('/packages', packagesRoutes);
router.use('/wallet', walletRoutes);
router.use('/team', teamRoutes);
router.use('/admin', campaignAdminRoutes);
router.use('/admin', liveAdminRoutes);
router.use('/admin', adminRoutes);
router.use('/campaigns', campaignRoutes);
router.use('/live', liveRoutes);
router.use('/site', siteRoutes);
router.use('/dashboard', dashboardRoutes);

export default router;
