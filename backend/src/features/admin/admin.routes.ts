import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
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

/** One screen of numbers: how many members, and how much is waiting for an admin. */
router.get('/overview', async (_req: Request, res: Response) => {
  const dayAgo = new Date(Date.now() - 86_400_000);
  const [members, active, newToday, byPackage, purchases, funds, withdrawals, reports, wallets, activation] = await Promise.all([
    prisma.user.count({ where: { role: 'USER' } }),
    prisma.user.count({ where: { role: 'USER', isActive: true, isVerified: true } }),
    prisma.user.count({ where: { role: 'USER', createdAt: { gte: dayAgo } } }),
    prisma.user.groupBy({ by: ['package'], where: { role: 'USER' }, _count: true }),
    prisma.packagePurchase.count({ where: { status: 'PENDING' } }),
    prisma.fundRequest.count({ where: { status: 'PENDING' } }),
    prisma.withdrawalRequest.count({ where: { status: 'PENDING' } }),
    prisma.campaignReport.count({ where: { status: 'PENDING' } }),
    prisma.user.aggregate({ _sum: { walletBalance: true } }),
    prisma.user.aggregate({ _sum: { activationBalance: true } })
  ]);
  res.json({
    success: true,
    data: {
      members,
      active,
      newToday,
      byPackage: Object.fromEntries(byPackage.map((b) => [b.package, b._count])),
      waiting: { purchases, funds, withdrawals, reports },
      walletTotal: Number(wallets._sum.walletBalance ?? 0),
      activationTotal: Number(activation._sum.activationBalance ?? 0)
    }
  });
});

/** Member list with search (name, email, phone or Affiliate ID). Never includes hashes or tokens. */
router.get('/members', async (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  const page = Math.min(100_000, Math.max(1, Math.floor(Number(req.query.page)) || 1));
  const pageSize = 25;
  const where: Prisma.UserWhereInput = {
    role: 'USER',
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
            { referralCode: { equals: q.toUpperCase() } }
          ]
        }
      : {})
  };
  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, name: true, email: true, phone: true, city: true, package: true, rank: true, referralCode: true,
        isActive: true, isVerified: true, createdAt: true, walletBalance: true, activationBalance: true,
        sponsor: { select: { name: true, referralCode: true } }
      }
    }),
    prisma.user.count({ where })
  ]);
  res.json({
    success: true,
    data: {
      page,
      pageSize,
      total,
      items: items.map((u) => ({ ...u, walletBalance: u.walletBalance.toFixed(2), activationBalance: u.activationBalance.toFixed(2) }))
    }
  });
});

/** Switch a member off (they are logged out and cannot sign in or act) or back on. Admin accounts are never touched here. */
router.post('/members/:id/active', validateBody(z.object({ isActive: z.boolean() })), async (req: Request, res: Response) => {
  const { isActive } = req.body as { isActive: boolean };
  const done = await prisma.user.updateMany({
    where: { id: String(req.params.id), role: 'USER' },
    data: { isActive, ...(isActive ? {} : { refreshTokenHash: null }) }
  });
  if (done.count !== 1) throw new AppError('Member not found', 404);
  res.json({ success: true, message: isActive ? 'Member switched on' : 'Member switched off and signed out' });
});

const statusOf = (v: unknown) => z.enum(['PENDING', 'APPROVED', 'REJECTED']).catch('PENDING').parse(v);
const noteOf = (body: unknown) => z.object({ note: z.string().trim().max(200).optional() }).catch({}).parse(body ?? {}).note;
const who = { select: { id: true, name: true, email: true, phone: true, referralCode: true } };

router.get('/fund-requests', async (req: Request, res: Response) => {
  const items = await prisma.fundRequest.findMany({
    where: { status: statusOf(req.query.status) },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { id: true, amount: true, reference: true, status: true, note: true, createdAt: true, user: who }
  });
  res.json({ success: true, data: { items: items.map((r) => ({ ...r, amount: r.amount.toFixed(2) })) } });
});

/** The screenshot a member sent with a payment (fund request or package purchase), as base64. */
const proofOf = (kind: 'fund' | 'purchase') => async (req: Request, res: Response) => {
  const where = { id: String(req.params.id) };
  const row =
    kind === 'fund'
      ? await prisma.fundRequest.findUnique({ where, select: { fileData: true, fileMime: true } })
      : await prisma.packagePurchase.findUnique({ where, select: { fileData: true, fileMime: true } });
  if (!row?.fileData || !row.fileMime) throw new AppError('No screenshot was sent with this one.', 404);
  res.json({ success: true, data: { mime: row.fileMime, data: Buffer.from(row.fileData).toString('base64') } });
};
router.get('/fund-requests/:id/proof', proofOf('fund'));
router.get('/purchases/:id/proof', proofOf('purchase'));
router.post('/fund-requests/:id/approve', async (req: Request, res: Response) => {
  await walletService.approveFund(String(req.params.id), req.user!.id);
  res.json({ success: true, message: 'Added to the activation wallet' });
});
router.post('/fund-requests/:id/reject', async (req: Request, res: Response) => {
  await walletService.rejectFund(String(req.params.id), req.user!.id, noteOf(req.body));
  res.json({ success: true, message: 'Request rejected' });
});

router.get('/perk-claims', async (req: Request, res: Response) => {
  const items = await prisma.perkClaim.findMany({
    where: { status: statusOf(req.query.status) },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { id: true, rank: true, status: true, note: true, createdAt: true, user: who }
  });
  res.json({ success: true, data: { items } });
});
router.post('/perk-claims/:id/approve', async (req: Request, res: Response) => {
  const done = await prisma.perkClaim.updateMany({ where: { id: String(req.params.id), status: 'PENDING' }, data: { status: 'APPROVED', processedAt: new Date(), processedBy: req.user!.id } });
  if (done.count !== 1) throw new AppError('Claim not found or already processed', 409);
  res.json({ success: true, message: 'Marked as approved' });
});
router.post('/perk-claims/:id/reject', async (req: Request, res: Response) => {
  const done = await prisma.perkClaim.updateMany({ where: { id: String(req.params.id), status: 'PENDING' }, data: { status: 'REJECTED', processedAt: new Date(), processedBy: req.user!.id, note: noteOf(req.body) || null } });
  if (done.count !== 1) throw new AppError('Claim not found or already processed', 409);
  res.json({ success: true, message: 'Claim rejected' });
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
