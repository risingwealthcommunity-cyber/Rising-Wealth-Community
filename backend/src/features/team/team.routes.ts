import { Router, Request, Response } from 'express';
import type { Rank } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../shared/errors/AppError';
import { requireAuth } from '../auth';
import { PASSIVE_LEVELS_UNLOCKED, PASSIVE_PCT, RANKS } from '../income/plan.config';
import { bonusRewards, leadershipLevels } from '../income/income.service';

const router = Router();

router.get('/summary', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const [me, referrals, passiveByLevel] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { package: true, rank: true, rankLeftHalf: true, rankRightHalf: true, matchLeftHalf: true, matchRightHalf: true }
    }),
    prisma.user.findMany({
      where: { sponsorId: userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, avatar: true, package: true, leg: true, createdAt: true }
    }),
    prisma.ledgerEntry.groupBy({ by: ['level'], where: { userId, type: 'PASSIVE_INCOME' }, _sum: { amount: true } })
  ]);
  const earnedAt = new Map(passiveByLevel.map((r) => [r.level, Number(r._sum.amount ?? 0)]));

  const idx = me.rank === 'NONE' ? -1 : RANKS.findIndex((r) => r.rank === me.rank);
  const next = RANKS[idx + 1] ?? null;

  res.json({
    success: true,
    data: {
      rank: me.rank,
      package: me.package,
      // passive income from team levels: % of every package sale in your downline, per level
      passiveLevels: PASSIVE_PCT.map((pct, i) => ({ level: i + 1, pct, earned: earnedAt.get(i + 1) ?? 0, unlocked: PASSIVE_LEVELS_UNLOCKED[me.package] >= i + 1 })),
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

/**
 * How many direct sales of each package the member has made in the current weekly window (since the admin last closed it).
 * 3 sales of one package make 1 share (Single Weekly Bonus), 6 make 2 shares (Double Weekly Bonus).
 */
router.get('/weekly-progress', requireAuth, async (req: Request, res: Response) => {
  const last = await prisma.payoutPeriod.findFirst({ orderBy: { endsAt: 'desc' }, select: { endsAt: true } });
  const since = last?.endsAt ?? new Date(0);
  const rows = await prisma.packagePurchase.groupBy({
    by: ['package'],
    where: { status: 'CONFIRMED', confirmedAt: { gte: since }, user: { sponsorId: req.user!.id } },
    _count: { _all: true }
  });
  const count = (p: string) => rows.find((r) => r.package === p)?._count._all ?? 0;
  res.json({ success: true, data: { since, perShare: 3, maxShares: 2, PRO: count('PRO'), ELITE: count('ELITE') } });
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

  const [perkRow, perkClaims] = await Promise.all([
    prisma.siteSetting.findUnique({ where: { key: 'rankPerks' } }),
    prisma.perkClaim.findMany({ where: { userId }, select: { rank: true, status: true, note: true } })
  ]);
  const perks = ((perkRow?.value as { items?: { rank: string; title: string; description: string }[] } | null)?.items ?? []);
  const rewards = await bonusRewards(prisma);
  const team = rewards.team.map((t, i) => ({
    target: i + 1,
    // each target is a rank: its name, and the extra reward (a perk) the admin set for that rank
    rank: RANKS[i]?.rank ?? null,
    // the name the admin gave the level (or the plan's rank name), and its extra reward (set on the level, or the older rank perk)
    name: t.name?.trim() || null,
    extraReward: t.perkTitle?.trim() || perks.find((p) => p.rank === RANKS[i]?.rank)?.title || null,
    extraRewardText: t.perkText?.trim() || perks.find((p) => p.rank === RANKS[i]?.rank)?.description || null,
    claim: perkClaims.find((c) => c.rank === RANKS[i]?.rank) ?? null,
    members: t.members,
    reward: t.reward,
    status: i < me.teamTargetsDone ? 'DONE' : i === me.teamTargetsDone ? 'CURRENT' : 'LOCKED',
    completedAt: i < me.teamTargetsDone ? doneAt('TEAM_PERFORMANCE_BONUS', i + 1) : null
  }));
  const current = team.find((t) => t.status === 'CURRENT') ?? null;

  const lead = leadershipLevels(rewards).map((t) => ({
    target: t.index,
    size: t.size,
    threshold: t.threshold,
    reward: t.paise / 100,
    name: rewards.leadership[t.index - 1]?.name?.trim() || null,
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

const TREE_ROWS = 3; // levels shown below the top node (so 4 rows including it)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TreeNode {
  id: string;
  name: string;
  avatar: string | null;
  package: string;
  rank: string;
  joinedAt: Date;
  /** This member has people below them that are not drawn: open the branch to see them. */
  more: boolean;
  left: TreeNode | null;
  right: TreeNode | null;
}

/** First name + last initial, the same short form the leaderboard uses. */
const shortName = (name: string) => {
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest[rest.length - 1];
  return last ? `${first} ${last[0].toUpperCase()}.` : first;
};

/**
 * The binary tree under a member: a few levels at a time, each member's LEFT and RIGHT child as placed at signup.
 * `?root=<id>` re-centres it on someone in your own downline, so a deep tree can be walked branch by branch.
 */
router.get('/tree', requireAuth, async (req: Request, res: Response) => {
  const me = req.user!.id;
  const wanted = typeof req.query.root === 'string' ? req.query.root : '';
  if (wanted && !UUID.test(wanted)) {
    res.status(400).json({ success: false, message: 'Invalid branch.' });
    return;
  }
  const rootId = wanted || me;

  if (rootId !== me) {
    const inside = await prisma.$queryRaw<{ c: bigint }[]>`
      WITH RECURSIVE d AS (
        SELECT id FROM "User" WHERE "parentId" = ${me}
        UNION ALL
        SELECT u.id FROM "User" u JOIN d ON u."parentId" = d.id
      )
      SELECT COUNT(*) AS c FROM d WHERE id = ${rootId}`;
    if (Number(inside[0]?.c ?? 0) === 0) {
      res.status(404).json({ success: false, message: 'That member is not in your team.' });
      return;
    }
  }

  // one extra level is read only to know whether a drawn member has more below them
  const maxDepth = TREE_ROWS + 1;
  const [rows, sides, rootRow] = await Promise.all([
    prisma.$queryRaw<
      { id: string; parentId: string; leg: string; depth: number; name: string; avatar: string | null; package: string; rank: string; createdAt: Date }[]
    >`
      WITH RECURSIVE d AS (
        SELECT id, "parentId", leg, 1 AS depth FROM "User" WHERE "parentId" = ${rootId}
        UNION ALL
        SELECT u.id, u."parentId", u.leg, d.depth + 1 FROM "User" u JOIN d ON u."parentId" = d.id WHERE d.depth < ${maxDepth}
      )
      SELECT d.id, d."parentId", d.leg::text AS leg, d.depth, u.name, u.avatar, u.package::text AS package, u.rank::text AS rank, u."createdAt"
      FROM d JOIN "User" u ON u.id = d.id`,
    prisma.$queryRaw<{ side: string; c: bigint }[]>`
      WITH RECURSIVE d AS (
        SELECT id, leg AS side FROM "User" WHERE "parentId" = ${me}
        UNION ALL
        SELECT u.id, d.side FROM "User" u JOIN d ON u."parentId" = d.id
      )
      SELECT side::text AS side, COUNT(*) AS c FROM d GROUP BY side`,
    prisma.user.findUniqueOrThrow({
      where: { id: rootId },
      select: { id: true, name: true, avatar: true, package: true, rank: true, createdAt: true }
    })
  ]);

  const byParent = new Map<string, typeof rows>();
  for (const r of rows) byParent.set(r.parentId, [...(byParent.get(r.parentId) ?? []), r]);

  const build = (id: string, info: { name: string; avatar: string | null; package: string; rank: string; createdAt: Date }, depth: number): TreeNode => {
    const kids = byParent.get(id) ?? [];
    const child = (leg: string) => {
      const k = kids.find((x) => x.leg === leg);
      return k && depth < TREE_ROWS ? build(k.id, { ...k }, depth + 1) : null;
    };
    return {
      id,
      name: id === me ? 'You' : shortName(info.name),
      avatar: info.avatar,
      package: info.package,
      rank: info.rank,
      joinedAt: info.createdAt,
      more: depth >= TREE_ROWS && kids.length > 0,
      left: child('LEFT'),
      right: child('RIGHT')
    };
  };

  const count = (s: string) => Number(sides.find((x) => x.side === s)?.c ?? 0);
  const left = count('LEFT');
  const right = count('RIGHT');

  res.json({
    success: true,
    data: {
      tree: build(rootRow.id, rootRow, 0),
      isMe: rootId === me,
      counts: { left, right, total: left + right }
    }
  });
});

const RANK_KEYS = RANKS.map((r) => r.rank) as string[];

/** Every rank: what it needs, its one-time reward, the perk the admin set, and where this member stands. */
router.get('/ranks', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const [me, perkRow, claims] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { rank: true } }),
    prisma.siteSetting.findUnique({ where: { key: 'rankPerks' } }),
    prisma.perkClaim.findMany({ where: { userId }, select: { rank: true, status: true, note: true } })
  ]);
  const perks = ((perkRow?.value as { items?: { rank: string; title: string; description: string }[] } | null)?.items ?? []);
  const mine = me.rank === 'NONE' ? -1 : RANK_KEYS.indexOf(me.rank);

  res.json({
    success: true,
    data: {
      rank: me.rank,
      items: RANKS.map((r, i) => {
        const perk = perks.find((p) => p.rank === r.rank);
        const claim = claims.find((c) => c.rank === r.rank);
        return {
          rank: r.rank,
          points: r.points,
          reward: r.reward,
          status: i <= mine ? 'ACHIEVED' : i === mine + 1 ? 'NEXT' : 'LOCKED',
          perk: perk ? { title: perk.title, description: perk.description } : null,
          claim: claim ? { status: claim.status, note: claim.note } : null
        };
      })
    }
  });
});

/** Ask for the perk of a rank you have reached. One claim per rank; an admin approves it. */
router.post('/perks/:rank/claim', requireAuth, async (req: Request, res: Response) => {
  const rank = String(req.params.rank);
  const userId = req.user!.id;
  if (!RANK_KEYS.includes(rank)) throw new AppError('Unknown rank', 404);

  const me = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { rank: true, teamTargetsDone: true } });
  const at = RANK_KEYS.indexOf(rank);
  // done: the Team Performance level of this rank is completed (or the member holds this rank, as before)
  const reached = me.teamTargetsDone > at || (me.rank !== 'NONE' && RANK_KEYS.indexOf(me.rank) >= at);
  if (!reached) throw new AppError('You have not completed this level yet.', 403);

  const [perkRow, levels] = await Promise.all([prisma.siteSetting.findUnique({ where: { key: 'rankPerks' } }), bonusRewards(prisma)]);
  const perks = (perkRow?.value as { items?: { rank: string }[] } | null)?.items ?? [];
  if (!levels.team[at]?.perkTitle?.trim() && !perks.some((p) => p.rank === rank)) throw new AppError('There is no extra reward set for this level yet.', 404);

  try {
    await prisma.perkClaim.create({ data: { userId, rank: rank as Rank } });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') throw new AppError('You already asked for this perk.', 409);
    throw err;
  }
  res.status(201).json({ success: true, message: 'Claim sent. The team will contact you.' });
});

export default router;
