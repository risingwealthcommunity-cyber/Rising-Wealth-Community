import { Router, Request, Response } from 'express';
import { prisma } from '../../config/database';
import { requireAuth } from '../auth';
import { RANKS } from '../income/plan.config';

const router = Router();

router.get('/summary', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const [me, referrals] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { rank: true, rankLeftHalf: true, rankRightHalf: true, matchLeftHalf: true, matchRightHalf: true }
    }),
    prisma.user.findMany({
      where: { sponsorId: userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, package: true, leg: true, createdAt: true }
    })
  ]);

  const idx = me.rank === 'NONE' ? -1 : RANKS.findIndex((r) => r.rank === me.rank);
  const next = RANKS[idx + 1] ?? null;

  res.json({
    success: true,
    data: {
      rank: me.rank,
      points: {
        left: me.rankLeftHalf / 2,
        right: me.rankRightHalf / 2,
        unmatchedLeft: me.matchLeftHalf / 2,
        unmatchedRight: me.matchRightHalf / 2
      },
      nextRank: next && { rank: next.rank, requiredEachLeg: next.points, reward: next.reward },
      directReferrals: referrals
    }
  });
});

export default router;
