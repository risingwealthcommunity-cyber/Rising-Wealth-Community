import { loadFile } from '../../shared/storage';
import { Router, Request, Response } from 'express';
import { LedgerType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { AppError } from '../../shared/errors/AppError';
import { validateBody } from '../../shared/middleware/validate.middleware';
import { strictAuthLimiter } from '../../shared/middleware/rateLimit.middleware';
import { requireAuth } from '../auth';
import { packagesService } from '../packages';
import { proofFrom } from '../../shared/proof';
import { parseRupees, walletService, MIN_WITHDRAWAL } from './wallet.service';

const router = Router();

router.get('/', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const [summary, byType] = await Promise.all([
    walletService.summary(userId),
    prisma.ledgerEntry.groupBy({ by: ['type'], where: { userId }, _sum: { amount: true } })
  ]);

  res.json({
    success: true,
    data: {
      ...summary,
      balance: summary.balance.toFixed(2),
      earningsByType: Object.fromEntries(byType.map((r) => [r.type, (r._sum.amount ?? 0).toString()])),
      minWithdrawal: MIN_WITHDRAWAL
    }
  });
});

// ---------------------------------------------------------------- money movement (transaction password required)

const amountField = z.number({ message: 'Enter an amount' });
const txnField = z.string().min(1, 'Enter your transaction password').max(100);

router.post(
  '/txn-password',
  requireAuth,
  strictAuthLimiter,
  validateBody(
    z.object({
      newPassword: z.string().min(8, 'At least 8 characters').max(72),
      loginPassword: z.string().max(100).optional(),
      currentTxnPassword: z.string().max(100).optional()
    })
  ),
  async (req: Request, res: Response) => {
    await walletService.setTxnPassword(req.user!.id, req.body);
    res.json({ success: true, message: 'Transaction password saved.' });
  }
);

router.post('/transfer', requireAuth, strictAuthLimiter, validateBody(z.object({ amount: amountField, txnPassword: txnField })), async (req: Request, res: Response) => {
  await walletService.transferToActivation(req.user!.id, parseRupees(req.body.amount), req.body.txnPassword);
  res.json({ success: true, message: 'Moved to your activation wallet.' });
});

router.get('/activation', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const [summary, entries] = await Promise.all([
    walletService.summary(userId),
    prisma.activationEntry.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 })
  ]);
  res.json({
    success: true,
    data: {
      wallet: summary.available,
      activation: summary.activationBalance,
      hasTxnPassword: summary.hasTxnPassword,
      entries: entries.map((e) => ({ id: e.id, kind: e.kind, amount: e.amount.toFixed(2), note: e.note, createdAt: e.createdAt }))
    }
  });
});

router.post(
  '/activate',
  requireAuth,
  strictAuthLimiter,
  validateBody(z.object({ affiliateId: z.string().trim().min(3).max(40), package: z.enum(['PRO', 'ELITE']), txnPassword: txnField })),
  async (req: Request, res: Response) => {
    await walletService.verifyTxnPassword(req.user!.id, req.body.txnPassword);
    const done = await packagesService.activateFromWallet(req.user!.id, req.body.affiliateId, req.body.package);
    res.status(201).json({ success: true, message: `${done.memberName} is now on ${done.package}.`, data: done });
  }
);

router.post(
  '/fund',
  requireAuth,
  validateBody(
    z.object({
      amount: amountField,
      reference: z.string().trim().min(4, 'Enter the transaction ID').max(100),
      fileName: z.string().trim().max(120),
      fileData: z.string().min(20).optional(),
  fileKey: z.string().max(200).optional()
    })
  ),
  async (req: Request, res: Response) => {
    const proof = await proofFrom(req.user!.id, req.body);
    const r = await walletService.createFundRequest(req.user!.id, parseRupees(req.body.amount), req.body.reference, { ...proof, name: req.body.fileName });
    res.status(201).json({ success: true, message: 'Request sent. The money is added once we have checked the payment.', data: { id: r.id } });
  }
);

router.get('/fund', requireAuth, async (req: Request, res: Response) => {
  const items = await prisma.fundRequest.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 50 });
  res.json({
    success: true,
    data: { items: items.map((r) => ({ id: r.id, amount: r.amount.toFixed(2), reference: r.reference, status: r.status, note: r.note, createdAt: r.createdAt })) }
  });
});

router.post('/withdraw', requireAuth, strictAuthLimiter, validateBody(z.object({ amount: amountField, txnPassword: txnField })), async (req: Request, res: Response) => {
  const r = await walletService.createWithdrawal(req.user!.id, parseRupees(req.body.amount), req.body.txnPassword);
  res.status(201).json({ success: true, message: 'Withdrawal requested. You will be paid after it is approved.', data: { id: r.id } });
});

router.get('/withdrawals', requireAuth, async (req: Request, res: Response) => {
  const items = await prisma.withdrawalRequest.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, amount: true, status: true, inProgress: true, note: true, payoutRef: true, fileMime: true, createdAt: true, processedAt: true }
  });
  res.json({
    success: true,
    data: {
      items: items.map((r) => ({
        id: r.id,
        amount: r.amount.toFixed(2),
        status: r.status,
        processing: r.status === 'PENDING' && r.inProgress,
        note: r.note,
        transactionId: r.payoutRef,
        hasProof: Boolean(r.fileMime),
        createdAt: r.createdAt,
        processedAt: r.processedAt
      }))
    }
  });
});

/** The screenshot of the payment made for one of my withdrawals. Only I (and the admins) can see it. */
router.get('/withdrawals/:id/proof', requireAuth, async (req: Request, res: Response) => {
  const row = await prisma.withdrawalRequest.findFirst({ where: { id: String(req.params.id), userId: req.user!.id }, select: { fileData: true, fileMime: true } });
  if (!row?.fileData || !row.fileMime) throw new AppError('No payment screenshot yet.', 404);
  res.json({ success: true, data: { mime: row.fileMime, data: (await loadFile(row.fileData)).toString('base64') } });
});

// ---------------------------------------------------------------- bank / UPI details

const bankSchema = z.object({
  bankName: z.string().trim().min(2).max(60),
  accountNumber: z.string().trim().regex(/^[0-9]{6,20}$/, 'Account number must be 6 to 20 digits'),
  ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC code'),
  upiId: z.string().trim().max(60).regex(/^([A-Za-z0-9._-]{2,}@[A-Za-z]{2,})?$/, 'Enter a valid UPI ID'),
  txnPassword: txnField
});

router.get('/bank', requireAuth, async (req: Request, res: Response) => {
  res.json({ success: true, data: { bank: await walletService.bankMasked(req.user!.id) } });
});

router.post('/bank/unlock', requireAuth, strictAuthLimiter, validateBody(z.object({ txnPassword: txnField })), async (req: Request, res: Response) => {
  res.json({ success: true, data: { bank: await walletService.bankFull(req.user!.id, req.body.txnPassword) } });
});

router.put('/bank', requireAuth, strictAuthLimiter, validateBody(bankSchema), async (req: Request, res: Response) => {
  const { txnPassword, ...details } = req.body as z.infer<typeof bankSchema>;
  await walletService.saveBank(req.user!.id, details, txnPassword);
  res.json({ success: true, message: 'Bank details saved.' });
});

router.get('/transactions', requireAuth, async (req: Request, res: Response) => {
  const page = Math.min(100_000, Math.max(1, Math.floor(Number(req.query.page)) || 1));
  const pageSize = 25;
  // optional filter by income type (only real ledger types are accepted)
  const type = typeof req.query.type === 'string' && req.query.type in LedgerType ? (req.query.type as LedgerType) : undefined;
  const where = { userId: req.user!.id, ...(type ? { type } : {}) };

  const [items, total] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { sourceUser: { select: { name: true } } }
    }),
    prisma.ledgerEntry.count({ where })
  ]);

  res.json({
    success: true,
    data: {
      page,
      pageSize,
      total,
      items: items.map((e) => ({
        id: e.id,
        type: e.type,
        amount: e.amount.toFixed(2),
        level: e.level,
        from: e.sourceUser?.name ?? null,
        note: e.note,
        createdAt: e.createdAt
      }))
    }
  });
});

export default router;
