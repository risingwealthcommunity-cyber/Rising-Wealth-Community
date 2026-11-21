import { Router, Request, Response } from 'express';
import { prisma } from '../../config/database';
import { requireAuth } from '../auth';
import { RANKS, TEAM_TARGETS } from '../income/plan.config';
import { leadershipTargets } from '../income/income.engine';

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

/** Team Performance (binary targets) and Leadership Bonus: where the member stands, plus the bonus history. */
router.get('/bonuses', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const [me, history] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        package: true,
        teamLeftNew: true,
        teamRightNew: true,
        teamLeftTotal: true,
        teamRightTotal: true,
        teamTargetsDone: true,
        leadershipPoints: true,
        leadershipTargetsDone: true
      }
    }),
    prisma.ledgerEntry.findMany({
      where: { userId, type: { in: ['TEAM_PERFORMANCE_BONUS', 'LEADERSHIP_TARGET_BONUS'] } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { sourceUser: { select: { name: true } } }
    })
  ]);

  const doneAt = (type: string, n: number) => history.find((h) => h.type === type && h.level === n)?.createdAt ?? null;

  const team = TEAM_TARGETS.map((t, i) => ({
    target: i + 1,
    members: t.members,
    reward: t.reward,
    status: i < me.teamTargetsDone ? 'DONE' : i === me.teamTargetsDone ? 'CURRENT' : 'LOCKED',
    completedAt: i < me.teamTargetsDone ? doneAt('TEAM_PERFORMANCE_BONUS', i + 1) : null
  }));
  const current = team.find((t) => t.status === 'CURRENT') ?? null;

  const lead = leadershipTargets().map((t) => ({
    target: t.index,
    size: t.size,
    threshold: t.threshold,
    reward: t.paise / 100,
    status: t.index <= me.leadershipTargetsDone ? 'DONE' : t.index === me.leadershipTargetsDone + 1 ? 'CURRENT' : 'LOCKED',
    completedAt: t.index <= me.leadershipTargetsDone ? doneAt('LEADERSHIP_TARGET_BONUS', t.index) : null
  }));

  res.json({
    success: true,
    data: {
      eligible: me.package !== 'TRAINEE',
      team: {
        targets: team,
        current,
        pendingLeft: me.teamLeftNew,
        pendingRight: me.teamRightNew,
        totalLeft: me.teamLeftTotal,
        totalRight: me.teamRightTotal,
        completed: me.teamTargetsDone
      },
      leadership: {
        points: me.leadershipPoints,
        targets: lead,
        current: lead.find((t) => t.status === 'CURRENT') ?? null,
        completed: me.leadershipTargetsDone
      },
      history: history.map((h) => ({
        id: h.id,
        kind: h.type === 'TEAM_PERFORMANCE_BONUS' ? 'TEAM' : 'LEADERSHIP',
        target: h.level,
        amount: h.amount.toFixed(2),
        note: h.note,
        createdAt: h.createdAt
      }))
    }
  });
});

export default router;
