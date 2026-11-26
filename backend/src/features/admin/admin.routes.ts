import { loadFile } from '../../shared/storage';
import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { AppError } from '../../shared/errors/AppError';
import { validateBody } from '../../shared/middleware/validate.middleware';
import { requireAuth, requireRole } from '../auth';
import { packagesService } from '../packages';
import { parseRupees, walletService } from '../wallet/wallet.service';
import { proofFrom } from '../../shared/proof';
import { COMPANY_FUND_PCT } from '../income/plan.config';
import { bonusRewards, closePayoutPeriod, manualRelease, paiseToDecimal, poolBalances, postLedger, releaseBonus, previewPayoutWindow, weeklyMinPaise } from '../income/income.service';

/** The incomes an admin can credit to a member by hand. */
const CREDIT_TYPES = ['DEMAT_DIRECT', 'DIRECT_INCOME', 'PASSIVE_INCOME', 'WEEKLY_BONUS', 'LEADERSHIP_TARGET_BONUS', 'TEAM_PERFORMANCE_BONUS', 'MONTHLY_ROYALTY'] as const;

const dematSchema = z.object({
  referrerEmail: z.string().trim().toLowerCase().email(),
  clientName: z.string().trim().max(100).optional(),
  /** Rupees credited to the member. */
  amount: z.number().positive().max(1_000_000),
  /** Which income it is added under. Only this member is paid, nobody above them gets a passive share. */
  incomeType: z.enum(CREDIT_TYPES).default('DEMAT_DIRECT'),
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

/** The little numbers on the admin sidebar: how many things in each section are waiting for an admin. */
router.get('/badges', async (_req: Request, res: Response) => {
  const [purchases, funds, withdrawals, reports, bonuses] = await Promise.all([
    prisma.packagePurchase.count({ where: { status: 'PENDING' } }),
    prisma.fundRequest.count({ where: { status: 'PENDING' } }),
    prisma.withdrawalRequest.count({ where: { status: 'PENDING' } }),
    prisma.campaignReport.count({ where: { status: 'PENDING' } }),
    prisma.pendingBonus.count({ where: { releasedAt: null } })
  ]);
  res.json({ success: true, data: { '/admin/members': purchases, '/admin/withdrawals': funds + withdrawals, '/admin/reports': reports, '/admin/bonuses': bonuses } });
});

/** One screen of numbers: how many members, and how much is waiting for an admin. */
router.get('/overview', async (_req: Request, res: Response) => {
  const dayAgo = new Date(Date.now() - 86_400_000);
  const [members, active, newToday, byPackage, purchases, funds, withdrawals, reports, wallets, activation, wdPending, wdPaid, fundPending] = await Promise.all([
    prisma.user.count({ where: { role: 'USER' } }),
    prisma.user.count({ where: { role: 'USER', isActive: true, isVerified: true } }),
    prisma.user.count({ where: { role: 'USER', createdAt: { gte: dayAgo } } }),
    prisma.user.groupBy({ by: ['package'], where: { role: 'USER' }, _count: true }),
    prisma.packagePurchase.count({ where: { status: 'PENDING' } }),
    prisma.fundRequest.count({ where: { status: 'PENDING' } }),
    prisma.withdrawalRequest.count({ where: { status: 'PENDING' } }),
    prisma.campaignReport.count({ where: { status: 'PENDING' } }),
    prisma.user.aggregate({ _sum: { walletBalance: true } }),
    prisma.user.aggregate({ _sum: { activationBalance: true } }),
    prisma.withdrawalRequest.aggregate({ where: { status: 'PENDING' }, _sum: { amount: true } }),
    prisma.withdrawalRequest.aggregate({ where: { status: 'APPROVED' }, _sum: { amount: true } }),
    prisma.fundRequest.aggregate({ where: { status: 'PENDING' }, _sum: { amount: true } })
  ]);
  res.json({
    success: true,
    data: {
      members,
      active,
      newToday,
      byPackage: Object.fromEntries(byPackage.map((b) => [b.package, b._count])),
      waiting: { purchases, funds, withdrawals, reports },
      withdrawalsPendingAmount: Number(wdPending._sum.amount ?? 0),
      withdrawalsPaidAmount: Number(wdPaid._sum.amount ?? 0),
      fundsPendingAmount: Number(fundPending._sum.amount ?? 0),
      walletTotal: Number(wallets._sum.walletBalance ?? 0),
      activationTotal: Number(activation._sum.activationBalance ?? 0)
    }
  });
});

/**
 * User income management: members with search, and for each one what they earned, what was paid out to them and what is
 * still in their wallet. Also the totals for the whole platform. Never includes hashes or tokens.
 */
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
  const [items, total, tEarned, tPaid, tWallet] = await Promise.all([
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
    prisma.user.count({ where }),
    prisma.ledgerEntry.aggregate({ where: { OR: [{ amount: { gt: 0 } }, { type: 'ADMIN_DEDUCTION' }], type: { not: 'COMPANY_FUND' }, user: { role: 'USER' } }, _sum: { amount: true } }),
    prisma.ledgerEntry.aggregate({ where: { type: 'WITHDRAWAL', user: { role: 'USER' } }, _sum: { amount: true } }),
    prisma.user.aggregate({ where: { role: 'USER' }, _sum: { walletBalance: true } })
  ]);
  const ids = items.map((i) => i.id);
  const [earnedRows, paidRows] = await Promise.all([
    prisma.ledgerEntry.groupBy({ by: ['userId'], where: { userId: { in: ids }, OR: [{ amount: { gt: 0 } }, { type: 'ADMIN_DEDUCTION' }], type: { not: 'COMPANY_FUND' } }, _sum: { amount: true } }),
    prisma.ledgerEntry.groupBy({ by: ['userId'], where: { userId: { in: ids }, type: 'WITHDRAWAL' }, _sum: { amount: true } })
  ]);
  const earned = new Map(earnedRows.map((r) => [r.userId, Number(r._sum.amount ?? 0)]));
  const paid = new Map(paidRows.map((r) => [r.userId, Math.abs(Number(r._sum.amount ?? 0))]));

  res.json({
    success: true,
    data: {
      page,
      pageSize,
      total,
      totals: { earned: money(tEarned._sum.amount), paid: money(Math.abs(Number(tPaid._sum.amount ?? 0))), pending: money(tWallet._sum.walletBalance) },
      items: items.map((u) => ({
        ...u,
        walletBalance: u.walletBalance.toFixed(2),
        activationBalance: u.activationBalance.toFixed(2),
        earned: money(earned.get(u.id)),
        paid: money(paid.get(u.id)),
        pending: money(u.walletBalance)
      }))
    }
  });
});

const memberPaySchema = z.object({
  amount: z.number({ message: 'Enter the amount' }),
  reference: z.string().trim().min(4, 'Enter the transaction ID of the payment').max(100),
  fileName: z.string().trim().max(120),
  fileData: z.string().min(20).optional(),
  fileKey: z.string().max(200).optional()
});

/** Pay a member from their wallet (part or all of it) with the transaction ID and screenshot. */
router.post('/members/:id/pay', validateBody(memberPaySchema), async (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof memberPaySchema>;
  const rupees = parseRupees(body.amount);
  const file = { ...await proofFrom(req.user!.id, body), name: body.fileName };
  await walletService.payMember(String(req.params.id), req.user!.id, rupees, { reference: body.reference, file });
  res.json({ success: true, message: 'Payment recorded and taken from the member wallet.' });
});

/**
 * Permanently delete a member. Only allowed for an account with no history at all (no money, purchases, requests,
 * reports or team), such as a spam sign-up. Anyone with activity must be switched off instead, because their records
 * and the people placed under them have to stay.
 */
router.delete('/members/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (id === req.user!.id) throw new AppError('You cannot delete your own account.', 403);
  await prisma.$transaction(async (tx) => {
    const m = await tx.user.findFirst({ where: { id, role: 'USER' }, select: { id: true, walletBalance: true, activationBalance: true } });
    if (!m) throw new AppError('Member not found', 404);
    const [sponsored, placed, ledger, bySource, purchases, withdrawals, funds, activation, reports, claims, demat] = await Promise.all([
      tx.user.count({ where: { sponsorId: id } }),
      tx.user.count({ where: { parentId: id } }),
      tx.ledgerEntry.count({ where: { userId: id } }),
      tx.ledgerEntry.count({ where: { sourceUserId: id } }),
      tx.packagePurchase.count({ where: { userId: id } }),
      tx.withdrawalRequest.count({ where: { userId: id } }),
      tx.fundRequest.count({ where: { userId: id } }),
      tx.activationEntry.count({ where: { userId: id } }),
      tx.campaignReport.count({ where: { userId: id } }),
      tx.perkClaim.count({ where: { userId: id } }),
      tx.dematReferral.count({ where: { referrerId: id } })
    ]);
    const history = sponsored + placed + ledger + bySource + purchases + withdrawals + funds + activation + reports + claims + demat;
    if (history > 0 || m.walletBalance.gt(0) || m.activationBalance.gt(0)) {
      throw new AppError('This member has activity (team, money, purchases or reports), so it cannot be deleted. Switch them off instead.', 409);
    }
    await tx.bankDetails.deleteMany({ where: { userId: id } });
    await tx.user.delete({ where: { id } });
  });
  res.json({ success: true, message: 'Member deleted' });
});

const moneySchema = z.object({ amount: z.number({ message: 'Enter the amount' }), reason: z.string().trim().min(4, 'Write the reason (at least 4 characters)').max(200) });

/** What a member wallet holds, what is on hold, and what can still be moved. */
router.get('/members/:id/holds', async (req: Request, res: Response) => {
  res.json({ success: true, data: await walletService.holdsOf(String(req.params.id)) });
});

/** Take money out of a member wallet. The member sees the reason in their transactions. */
router.post('/members/:id/deduct', validateBody(moneySchema), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof moneySchema>;
  const done = await walletService.adminDeduct(req.user!.id, String(req.params.id), parseRupees(b.amount), b.reason);
  res.json({ success: true, message: `Deducted from the wallet of ${done.memberName}.` });
});

/** Put part of a member wallet on hold (they cannot withdraw or move it) until you release it. */
router.post('/members/:id/hold', validateBody(moneySchema), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof moneySchema>;
  const done = await walletService.adminHold(req.user!.id, String(req.params.id), parseRupees(b.amount), b.reason);
  res.json({ success: true, message: `Put on hold in the wallet of ${done.memberName}.` });
});

router.post('/holds/:id/release', async (req: Request, res: Response) => {
  await walletService.adminRelease(req.user!.id, String(req.params.id));
  res.json({ success: true, message: 'Released. The member can use that money again.' });
});

const upgradeSchema = z.object({
  package: z.enum(['PRO', 'ELITE']),
  mode: z.enum(['WALLET', 'MANUAL']),
  reference: z.string().trim().max(100).optional()
});

/** Move a member up a package: from their activation wallet, or for a payment you received outside the app. */
router.post('/members/:id/upgrade', validateBody(upgradeSchema), async (req: Request, res: Response) => {
  const { package: pkg, mode, reference } = req.body as z.infer<typeof upgradeSchema>;
  if (mode === 'MANUAL' && (reference ?? '').length < 4) throw new AppError('Write the payment reference or a note (at least 4 characters) for a payment received outside the app.', 400);
  const done = await packagesService.adminUpgrade(req.user!.id, String(req.params.id), pkg, mode, reference);
  res.json({ success: true, message: `${done.memberName} is now on ${done.package}.` });
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
  res.json({ success: true, data: { mime: row.fileMime, data: (await loadFile(row.fileData)).toString('base64') } });
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
  // ?status=PENDING|APPROVED|REJECTED|ALL and ?q= (member name, email, mobile or Affiliate ID)
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  const items = await prisma.withdrawalRequest.findMany({
    where: {
      // PROCESSING = waiting, but an admin has started on it
      ...(req.query.status === 'ALL'
        ? {}
        : req.query.status === 'PROCESSING'
          ? { status: 'PENDING' as const, inProgress: true }
          : req.query.status === 'PENDING'
            ? { status: 'PENDING' as const, inProgress: false }
            : { status: statusOf(req.query.status) }),
      ...(q
        ? {
            user: {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
                { phone: { contains: q } },
                { referralCode: { equals: q.toUpperCase() } }
              ]
            }
          }
        : {})
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true, userId: true, amount: true, status: true, inProgress: true, note: true, payoutRef: true, fileMime: true, createdAt: true, processedAt: true,
      user: { select: { id: true, name: true, email: true, phone: true, city: true, referralCode: true, package: true, walletBalance: true } }
    }
  });
  const withBank = await Promise.all(
    items.map(async ({ fileMime, user, ...r }) => ({
      ...r,
      amount: r.amount.toFixed(2),
      hasProof: Boolean(fileMime),
      user: { ...user, walletBalance: user.walletBalance.toFixed(2) },
      bank: await walletService.bankForAdmin(r.userId)
    }))
  );
  res.json({ success: true, data: { items: withBank } });
});

/** The screenshot an admin attached when paying a withdrawal. */
router.get('/withdrawals/:id/proof', async (req: Request, res: Response) => {
  const row = await prisma.withdrawalRequest.findUnique({ where: { id: String(req.params.id) }, select: { fileData: true, fileMime: true } });
  if (!row?.fileData || !row.fileMime) throw new AppError('No payment screenshot on this one.', 404);
  res.json({ success: true, data: { mime: row.fileMime, data: (await loadFile(row.fileData)).toString('base64') } });
});

/** Start working on a waiting withdrawal ("Processing", optionally with a message for the member), or put it back to waiting. */
router.post('/withdrawals/:id/progress', validateBody(z.object({ on: z.boolean(), note: z.string().trim().max(200).optional() })), async (req: Request, res: Response) => {
  const { on, note } = req.body as { on: boolean; note?: string };
  await walletService.setWithdrawalProgress(String(req.params.id), on, note);
  res.json({ success: true, message: on ? 'Marked as processing. The member can see it.' : 'Back to waiting.' });
});

const payoutSchema = z.object({
  reference: z.string().trim().min(4, 'Enter the transaction ID of the payment').max(100),
  fileName: z.string().trim().max(120),
  fileData: z.string().min(20).optional(),
  fileKey: z.string().max(200).optional()
});
router.post('/withdrawals/:id/approve', validateBody(payoutSchema), async (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof payoutSchema>;
  const file = { ...await proofFrom(req.user!.id, body), name: body.fileName };
  await walletService.approveWithdrawal(String(req.params.id), req.user!.id, { reference: body.reference, file });
  res.json({ success: true, message: 'Marked as paid. The amount left the member wallet.' });
});
router.post('/withdrawals/:id/reject', async (req: Request, res: Response) => {
  await walletService.rejectWithdrawal(String(req.params.id), req.user!.id, noteOf(req.body));
  res.json({ success: true, message: 'Request rejected' });
});

/**
 * Who earned the weekly, performance and leadership bonuses: for a closed period (the latest by default), and for the
 * window that is open now with an estimate of what each member would get if it closed this moment.
 */
router.get('/bonuses', async (req: Request, res: Response) => {
  const periods = await prisma.payoutPeriod.findMany({ orderBy: { endsAt: 'desc' }, take: 30 });
  const wanted = typeof req.query.periodId === 'string' ? req.query.periodId : '';
  const period = (wanted && periods.find((p) => p.id === wanted)) || periods[0] || null;

  const types = ['WEEKLY_BONUS'] as const;
  const paidRows = period
    ? await prisma.ledgerEntry.findMany({
        where: { periodId: period.id, type: { in: [...types] }, userId: { not: null } },
        orderBy: { amount: 'desc' },
        select: { type: true, amount: true, user: { select: { id: true, name: true, email: true, referralCode: true } } }
      })
    : [];
  const paid = (type: (typeof types)[number]) =>
    paidRows.filter((r) => r.type === type && r.user).map((r) => ({ ...r.user!, amount: Number(r.amount) }));

  const open = await prisma.$transaction((tx) => previewPayoutWindow(tx));

  // the two pools that never reset, and who completed targets (their bonuses came out of those pools)
  const [pools, perfRows, leadRows] = await Promise.all([
    poolBalances(prisma),
    prisma.ledgerEntry.findMany({
      where: { type: 'TEAM_PERFORMANCE_BONUS', userId: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { amount: true, level: true, createdAt: true, user: { select: { id: true, name: true, email: true, referralCode: true } } }
    }),
    prisma.ledgerEntry.findMany({
      where: { type: 'LEADERSHIP_TARGET_BONUS', userId: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { amount: true, level: true, createdAt: true, user: { select: { id: true, name: true, email: true, referralCode: true } } }
    })
  ]);
  const waiting = await prisma.pendingBonus.findMany({
    where: { releasedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 300,
    select: { id: true, type: true, level: true, amount: true, createdAt: true, user: { select: { id: true, name: true, email: true, referralCode: true } } }
  });
  const pendingOf = (type: string) => waiting.filter((w) => w.type === type).map((w) => ({ ...w.user, bonusId: w.id, level: w.level, amount: Number(w.amount), at: w.createdAt }));
  const achieved = (rows: typeof perfRows) =>
    rows.filter((r) => r.user).map((r) => ({ ...r.user!, level: r.level, amount: Number(r.amount), at: r.createdAt }));

  const ids = [...new Set([...open.weekly, ...open.performance, ...open.leadership].map((x) => x.userId))];
  const people = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true, referralCode: true } });
  const withUser = (list: { userId: string; weight: number; paise: number; sales?: { PRO: number; ELITE: number } }[]) =>
    list.flatMap((x) => {
      const u = people.find((p) => p.id === x.userId);
      return u ? [{ ...u, weight: x.weight, amount: x.paise / 100, ...(x.sales ? { sales: x.sales } : {}) }] : [];
    });

  res.json({
    success: true,
    data: {
      periods: periods.map((p) => ({ id: p.id, startsAt: p.startsAt, endsAt: p.endsAt, revenue: Number(p.revenue) })),
      period: period && { id: period.id, startsAt: period.startsAt, endsAt: period.endsAt, revenue: Number(period.revenue) },
      paid: { weekly: paid('WEEKLY_BONUS'), performance: [] as ReturnType<typeof paid>, leadership: [] as ReturnType<typeof paid> },
      pools,
      pending: { weekly: pendingOf('WEEKLY_BONUS'), performance: pendingOf('TEAM_PERFORMANCE_BONUS'), leadership: pendingOf('LEADERSHIP_TARGET_BONUS') },
      achievers: { performance: achieved(perfRows), leadership: achieved(leadRows) },
      open: {
        startsAt: open.startsAt,
        revenue: open.revenue / 100,
        pools: { weekly: open.pools.weekly / 100, performance: open.pools.performance / 100, leadership: open.pools.leadership / 100 },
        weekly: withUser(open.weekly),
        performance: withUser(open.performance),
        leadership: withUser(open.leadership)
      },
      settings: { minPerShare: (await weeklyMinPaise(prisma)) / 100, rewards: await bonusRewards(prisma), manualRelease: await manualRelease(prisma) }
    }
  });
});

const IST_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
const money = (n: unknown) => Math.round(Number(n ?? 0) * 100) / 100;

/**
 * The platform money picture by Indian day: package sales, income credited to members (per type), what the company fund
 * got, and withdrawals paid out. ?range=7 | 30 | 90 | all (default 30).
 */
router.get('/income', async (req: Request, res: Response) => {
  const raw = String(req.query.range ?? '30');
  const days = raw === 'all' ? null : [7, 30, 90].includes(Number(raw)) ? Number(raw) : 30;
  const startOfToday = Math.floor((Date.now() + IST_MS) / DAY_MS) * DAY_MS - IST_MS;
  const from = days === null ? new Date(0) : new Date(startOfToday - (days - 1) * DAY_MS);

  const [sales, paid, withdrawn] = await Promise.all([
    prisma.$queryRaw<{ day: string; n: bigint; total: unknown }[]>`
      SELECT to_char("confirmedAt" + interval '330 minutes', 'YYYY-MM-DD') AS day, COUNT(*) AS n, SUM(amount) AS total
      FROM "PackagePurchase" WHERE status = 'CONFIRMED' AND "confirmedAt" >= ${from} GROUP BY 1`,
    prisma.$queryRaw<{ day: string; type: string; total: unknown }[]>`
      SELECT to_char("createdAt" + interval '330 minutes', 'YYYY-MM-DD') AS day, type::text AS type, SUM(amount) AS total
      FROM "LedgerEntry" WHERE "userId" IS NOT NULL AND (amount > 0 OR type = 'ADMIN_DEDUCTION') AND type <> 'COMPANY_FUND' AND "createdAt" >= ${from} GROUP BY 1, 2`,
    prisma.$queryRaw<{ day: string; total: unknown }[]>`
      SELECT to_char("createdAt" + interval '330 minutes', 'YYYY-MM-DD') AS day, SUM(-amount) AS total
      FROM "LedgerEntry" WHERE type = 'WITHDRAWAL' AND "createdAt" >= ${from} GROUP BY 1`
  ]);

  type Day = { date: string; sales: number; salesCount: number; paid: number; byType: Record<string, number>; companyFund: number; withdrawn: number };
  const byDay = new Map<string, Day>();
  const day = (d: string) => {
    let row = byDay.get(d);
    if (!row) byDay.set(d, (row = { date: d, sales: 0, salesCount: 0, paid: 0, byType: {}, companyFund: 0, withdrawn: 0 }));
    return row;
  };
  const totals = { sales: 0, salesCount: 0, paid: 0, byType: {} as Record<string, number>, companyFund: 0, withdrawn: 0 };

  for (const r of sales) {
    const d = day(r.day);
    d.sales = money(r.total);
    d.salesCount = Number(r.n);
    d.companyFund = money((d.sales * COMPANY_FUND_PCT) / 100); // the company keeps 20% of every package sale
    totals.sales = money(totals.sales + d.sales);
    totals.salesCount += d.salesCount;
    totals.companyFund = money(totals.companyFund + d.companyFund);
  }
  for (const r of paid) {
    const d = day(r.day);
    const v = money(r.total);
    d.byType[r.type] = v;
    d.paid = money(d.paid + v);
    totals.byType[r.type] = money((totals.byType[r.type] ?? 0) + v);
    totals.paid = money(totals.paid + v);
  }
  for (const r of withdrawn) {
    const d = day(r.day);
    d.withdrawn = money(r.total);
    totals.withdrawn = money(totals.withdrawn + d.withdrawn);
  }

  res.json({
    success: true,
    data: { range: days === null ? 'all' : String(days), totals, days: [...byDay.values()].sort((a, b) => (a.date < b.date ? 1 : -1)) }
  });
});

router.post('/demat', validateBody(dematSchema), async (req: Request, res: Response) => {
  const { referrerEmail, clientName, amount, incomeType, note } = req.body as z.infer<typeof dematSchema>;
  const paise = Math.round(amount * 100);

  await prisma.$transaction(async (tx) => {
    const member = await tx.user.findUnique({ where: { email: referrerEmail } });
    if (!member) throw new AppError('Member not found', 404);
    if (member.id === req.user!.id) throw new AppError('You cannot add income to your own account. Ask another admin.', 403);

    if (incomeType === 'DEMAT_DIRECT') {
      await tx.dematReferral.create({
        data: { referrerId: member.id, clientName, directAmount: paiseToDecimal(paise), note, createdBy: req.user!.id }
      });
    }
    // only the chosen member is paid, under the income chosen: nobody above them earns a passive share of it
    await postLedger(tx, {
      payouts: [{ userId: member.id, type: incomeType, paise }],
      sourceUserId: member.id,
      note: clientName ? `${clientName} (added by admin)` : note ?? 'Added by admin'
    });
  });

  res.status(201).json({ success: true, message: 'Income added to the member.' });
});

/** Release one waiting bonus: it is credited to the member's wallet now. */
router.post('/bonus-releases/:id/release', async (req: Request, res: Response) => {
  await prisma.$transaction((tx) => releaseBonus(tx, req.user!.id, String(req.params.id)), { timeout: 20_000 });
  res.json({ success: true, message: 'Released. It is in the member\'s wallet now.' });
});

/** Release every waiting bonus of one kind (never your own). */
router.post('/bonus-releases/release-all', validateBody(z.object({ type: z.enum(['WEEKLY_BONUS', 'TEAM_PERFORMANCE_BONUS', 'LEADERSHIP_TARGET_BONUS']) })), async (req: Request, res: Response) => {
  const rows = await prisma.pendingBonus.findMany({ where: { releasedAt: null, type: req.body.type, userId: { not: req.user!.id } }, select: { id: true }, take: 500 });
  let n = 0;
  for (const r of rows) {
    try {
      await prisma.$transaction((tx) => releaseBonus(tx, req.user!.id, r.id), { timeout: 20_000 });
      n++;
    } catch (e) {
      if (!(e instanceof AppError)) throw e; // already released by someone else: skip it
    }
  }
  res.json({ success: true, message: n === 1 ? '1 bonus released.' : `${n} bonuses released.` });
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

/** The company fund: 20% of every confirmed package sale. */
router.get('/company-fund', async (_req: Request, res: Response) => {
  const pools = await poolBalances(prisma);
  res.json({ success: true, data: { total: pools.company.total.toFixed(2), pct: pools.company.pct } });
});

export default router;
