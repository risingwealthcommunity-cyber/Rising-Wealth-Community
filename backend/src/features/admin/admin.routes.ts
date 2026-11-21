import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { AppError } from '../../shared/errors/AppError';
import { validateBody } from '../../shared/middleware/validate.middleware';
import { requireAuth, requireRole } from '../auth';
import { packagesService } from '../packages';
import { walletService } from '../wallet/wallet.service';
import { closePayoutPeriod, distributeDematReferral, paiseToDecimal } from '../income/income.service';

const dematSchema = z.object({
  referrerEmail: z.string().trim().toLowerCase().email(),
  clientName: z.string().trim().max(100).optional(),
  /** Rupees payable to the referrer for this Demat account. */
  amount: z.number().positive().max(1_000_000),
  note: z.string().trim().max(200).optional()
});

const router = Router();
router.use(requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'));

router.get('/purchases', async (req: Request, res: Response) => {
  const status = z.enum(['PENDING', 'CONFIRMED', 'REJECTED']).catch('PENDING').parse(req.query.status);
  res.json({ success: true, data: { purchases: await packagesService.listForAdmin(status) } });
});

router.post('/purchases/:id/confirm', async (req: Request, res: Response) => {
  const purchase = await packagesService.confirm(String(req.params.id), req.user!.id);
  res.json({ success: true, message: 'Package activated and income distributed', data: { purchase } });
});

router.post('/purchases/:id/reject', async (req: Request, res: Response) => {
  await packagesService.reject(String(req.params.id), req.user!.id);
  res.json({ success: true, message: 'Purchase rejected' });
});

const statusOf = (v: unknown) => z.enum(['PENDING', 'APPROVED', 'REJECTED']).catch('PENDING').parse(v);
const noteOf = (body: unknown) => z.object({ note: z.string().trim().max(200).optional() }).catch({}).parse(body ?? {}).note;
const who = { select: { id: true, name: true, email: true, phone: true, referralCode: true } };

router.get('/fund-requests', async (req: Request, res: Response) => {
  const items = await prisma.fundRequest.findMany({ where: { status: statusOf(req.query.status) }, orderBy: { createdAt: 'desc' }, take: 200, include: { user: who } });
  res.json({ success: true, data: { items: items.map((r) => ({ ...r, amount: r.amount.toFixed(2) })) } });
});
router.post('/fund-requests/:id/approve', async (req: Request, res: Response) => {
  await walletService.approveFund(String(req.params.id), req.user!.id);
  res.json({ success: true, message: 'Added to the activation wallet' });
});
router.post('/fund-requests/:id/reject', async (req: Request, res: Response) => {
  await walletService.rejectFund(String(req.params.id), req.user!.id, noteOf(req.body));
  res.json({ success: true, message: 'Request rejected' });
});

router.get('/withdrawals', async (req: Request, res: Response) => {
  const items = await prisma.withdrawalRequest.findMany({ where: { status: statusOf(req.query.status) }, orderBy: { createdAt: 'desc' }, take: 200, include: { user: who } });
  const withBank = await Promise.all(items.map(async (r) => ({ ...r, amount: r.amount.toFixed(2), bank: await walletService.bankForAdmin(r.userId) })));
  res.json({ success: true, data: { items: withBank } });
});
router.post('/withdrawals/:id/approve', async (req: Request, res: Response) => {
  await walletService.approveWithdrawal(String(req.params.id), req.user!.id);
  res.json({ success: true, message: 'Approved. The amount left the member wallet.' });
});
router.post('/withdrawals/:id/reject', async (req: Request, res: Response) => {
  await walletService.rejectWithdrawal(String(req.params.id), req.user!.id, noteOf(req.body));
  res.json({ success: true, message: 'Request rejected' });
});

router.post('/demat', validateBody(dematSchema), async (req: Request, res: Response) => {
  const { referrerEmail, clientName, amount, note } = req.body as z.infer<typeof dematSchema>;
  const directPaise = Math.round(amount * 100);

  await prisma.$transaction(async (tx) => {
    const referrer = await tx.user.findUnique({ where: { email: referrerEmail } });
    if (!referrer) throw new AppError('Referrer not found', 404);

    await tx.dematReferral.create({
      data: {
        referrerId: referrer.id,
        clientName,
        directAmount: paiseToDecimal(directPaise),
        note,
        createdBy: req.user!.id
      }
    });

    await distributeDematReferral(tx, {
      referrerId: referrer.id,
      sponsorId: referrer.sponsorId,
      directPaise,
      note: clientName ? `Demat: ${clientName}` : 'Demat referral'
    });
  });

  res.status(201).json({ success: true, message: 'Demat referral recorded and income distributed' });
});

router.post('/periods/close', async (req: Request, res: Response) => {
  const period = await prisma.$transaction((tx) => closePayoutPeriod(tx, req.user!.id), {
    timeout: 120_000,
    maxWait: 10_000
  });
  res.status(201).json({ success: true, message: 'Period closed and pools distributed', data: { period } });
});

router.get('/periods', async (_req: Request, res: Response) => {
  const periods = await prisma.payoutPeriod.findMany({ orderBy: { endsAt: 'desc' }, take: 50 });
  res.json({ success: true, data: { periods } });
});

router.get('/company-fund', async (_req: Request, res: Response) => {
  const total = await prisma.ledgerEntry.aggregate({
    where: { type: 'COMPANY_FUND' },
    _sum: { amount: true }
  });
  res.json({ success: true, data: { total: (total._sum.amount ?? 0).toString() } });
});

export default router;
