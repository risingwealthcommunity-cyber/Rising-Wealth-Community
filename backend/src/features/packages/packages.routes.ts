import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth';
import { validateBody } from '../../shared/middleware/validate.middleware';
import { readProof } from '../../shared/proof';
import { packagesService } from './packages.service';

const purchaseSchema = z.object({
  package: z.enum(['PRO', 'ELITE']),
  reference: z.string().trim().min(4, 'Enter the transaction ID').max(100),
  fileName: z.string().trim().max(120),
  fileData: z.string().min(20, 'Add the payment screenshot')
});

const router = Router();

router.get('/prices', (_req: Request, res: Response) => {
  res.json({ success: true, data: packagesService.prices() });
});

router.post('/purchase', requireAuth, validateBody(purchaseSchema), async (req: Request, res: Response) => {
  const proof = readProof(req.body.fileData);
  const purchase = await packagesService.createPurchase(req.user!.id, req.body.package, req.body.reference, { ...proof, name: req.body.fileName });
  res.status(201).json({
    success: true,
    message: 'Purchase request created. Your package activates once payment is confirmed.',
    data: { purchase }
  });
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
