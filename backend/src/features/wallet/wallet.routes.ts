import { Router, Request, Response } from 'express';
import { LedgerType } from '@prisma/client';
import { prisma } from '../../config/database';
import { requireAuth } from '../auth';

const router = Router();

router.get('/', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const [user, byType] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalance: true } }),
    prisma.ledgerEntry.groupBy({ by: ['type'], where: { userId }, _sum: { amount: true } })
  ]);

  res.json({
    success: true,
    data: {
      balance: user.walletBalance.toFixed(2),
      earningsByType: Object.fromEntries(byType.map((r) => [r.type, (r._sum.amount ?? 0).toString()]))
    }
  });
});

router.get('/transactions', requireAuth, async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
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
