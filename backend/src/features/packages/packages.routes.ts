import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth';
import { validateBody } from '../../shared/middleware/validate.middleware';
import { proofFrom } from '../../shared/proof';
import { packagesService } from './packages.service';
import { walletService } from '../wallet/wallet.service';
import { strictAuthLimiter } from '../../shared/middleware/rateLimit.middleware';
import { prisma } from '../../config/database';

const purchaseSchema = z.object({
  package: z.enum(['PRO', 'ELITE']),
  reference: z.string().trim().min(4, 'Enter the transaction ID').max(100),
  fileName: z.string().trim().max(120),
  fileData: z.string().min(20).optional(),
  fileKey: z.string().max(200).optional()
});

const router = Router();

router.get('/prices', (_req: Request, res: Response) => {
  res.json({ success: true, data: packagesService.prices() });
});

router.post('/purchase', requireAuth, validateBody(purchaseSchema), async (req: Request, res: Response) => {
  const proof = await proofFrom(req.user!.id, req.body);
  const purchase = await packagesService.createPurchase(req.user!.id, req.body.package, req.body.reference, { ...proof, name: req.body.fileName });
  res.status(201).json({
    success: true,
    message: 'Purchase request created. Your package activates once payment is confirmed.',
    data: { purchase }
  });
});

/**
 * Upgrade my own package from my own activation wallet, at once: no admin has to approve it. The transaction password is asked, and the
 * whole income plan runs exactly as for any other purchase.
 */
router.post('/upgrade-self', requireAuth, strictAuthLimiter, validateBody(z.object({ package: z.enum(['PRO', 'ELITE']), txnPassword: z.string().min(1).max(100) })), async (req: Request, res: Response) => {
  await walletService.verifyTxnPassword(req.user!.id, req.body.txnPassword);
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { referralCode: true } });
  const done = await packagesService.activateFromWallet(req.user!.id, me.referralCode, req.body.package, true);
  res.status(201).json({ success: true, message: `Your ID is now on ${done.package}.`, data: done });
});

/** Ask to upgrade my own package and pay from my activation wallet. An admin approves, and only then is the price taken. */
router.post('/wallet-request', requireAuth, validateBody(z.object({ package: z.enum(['PRO', 'ELITE']) })), async (req: Request, res: Response) => {
  await packagesService.requestWithWallet(req.user!.id, req.body.package);
  res.status(201).json({ success: true, message: 'Request sent. When an admin approves it, the price is taken from your activation wallet and your package is upgraded.' });
});

router.get('/mine', requireAuth, async (req: Request, res: Response) => {
  res.json({ success: true, data: { purchases: await packagesService.listMine(req.user!.id) } });
});

export default router;
