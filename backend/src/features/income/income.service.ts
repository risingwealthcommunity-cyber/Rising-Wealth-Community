import { Prisma, LedgerType, Package } from '@prisma/client';
import { AppError } from '../../shared/errors/AppError';
import {
  computeDematIncome,
  computePackageSale,
  nextRankReached,
  performanceWeight,
  pctOf,
  splitPool,
  splitWeeklyPool,
  weeklyShares,
  type CompanyEntry,
  type Payout,
  type UplineMember
} from './income.engine';
import { PACKAGE_HALF_POINTS, POOL_PCT, WEEKLY_MIN_PER_SHARE_PAISE, type PaidPackage } from './plan.config';

type Tx = Prisma.TransactionClient;

export const paiseToDecimal = (paise: number) => new Prisma.Decimal(paise).div(100);
export const decimalToPaise = (d: Prisma.Decimal | number | string) =>
  new Prisma.Decimal(d).mul(100).toDecimalPlaces(0).toNumber();

interface LedgerInput {
  payouts: Payout[];
  company?: CompanyEntry[];
  sourceUserId?: string;
  purchaseId?: string;
  periodId?: string;
  note?: string;
}

/** Writes ledger rows and updates wallet balances. Zero amounts are skipped. */
export async function postLedger(tx: Tx, input: LedgerInput): Promise<void> {
  const rows: Prisma.LedgerEntryCreateManyInput[] = [];
  const balance = new Map<string, number>();

  for (const p of input.payouts) {
    if (p.paise <= 0) continue;
    rows.push({
      userId: p.userId,
      type: p.type,
      amount: paiseToDecimal(p.paise),
      level: p.level,
      sourceUserId: input.sourceUserId,
      purchaseId: input.purchaseId,
      periodId: input.periodId,
      note: input.note
    });
    balance.set(p.userId, (balance.get(p.userId) ?? 0) + p.paise);
  }

  for (const c of input.company ?? []) {
    if (c.paise <= 0) continue;
    rows.push({
      userId: null,
      type: LedgerType.COMPANY_FUND,
      amount: paiseToDecimal(c.paise),
      level: c.level,
      sourceUserId: input.sourceUserId,
      purchaseId: input.purchaseId,
      periodId: input.periodId,
      note: c.reason
    });
  }

  if (rows.length) await tx.ledgerEntry.createMany({ data: rows });

  for (const [userId, paise] of balance) {
    await tx.user.update({
      where: { id: userId },
      data: { walletBalance: { increment: paiseToDecimal(paise) } }
    });
  }
}

/** Sponsor chain above `startId` (startId itself is level 1). */
async function getSponsorUpline(tx: Tx, startId: string | null, maxLevels: number): Promise<UplineMember[]> {
  if (!startId) return [];
  const rows = await tx.$queryRaw<{ id: string; package: Package; active: boolean }[]>`
    WITH RECURSIVE chain AS (
      SELECT id, "sponsorId", package::text AS package, "isActive" AS active, 1 AS lvl
      FROM "User" WHERE id = ${startId}
      UNION ALL
      SELECT u.id, u."sponsorId", u.package::text, u."isActive", c.lvl + 1
      FROM "User" u JOIN chain c ON u.id = c."sponsorId"
      WHERE c.lvl < ${maxLevels}
    )
    SELECT id, package, active FROM chain ORDER BY lvl`;
  return rows;
}

/** Credits binary points up the placement tree and pays any rank rewards that become due. */
async function awardBinaryPoints(tx: Tx, buyerId: string, pkg: PaidPackage, purchaseId: string) {
  const half = PACKAGE_HALF_POINTS[pkg];

  // Every placement ancestor with a paid package, plus the leg the points arrive through.
  const ancestors = await tx.$queryRaw<{ id: string; leg: 'LEFT' | 'RIGHT' }[]>`
    WITH RECURSIVE up AS (
      SELECT "parentId" AS id, leg FROM "User" WHERE id = ${buyerId} AND "parentId" IS NOT NULL
      UNION ALL
      SELECT u."parentId", u.leg FROM "User" u JOIN up ON u.id = up.id WHERE u."parentId" IS NOT NULL
    )
    SELECT up.id, up.leg::text AS leg
    FROM up JOIN "User" a ON a.id = up.id
    WHERE a.package <> 'TRAINEE' AND a."isActive" = true`;

  const left = ancestors.filter((a) => a.leg === 'LEFT').map((a) => a.id);
  const right = ancestors.filter((a) => a.leg === 'RIGHT').map((a) => a.id);

  if (left.length) {
    await tx.user.updateMany({
      where: { id: { in: left } },
      data: { rankLeftHalf: { increment: half }, matchLeftHalf: { increment: half } }
    });
  }
  if (right.length) {
    await tx.user.updateMany({
      where: { id: { in: right } },
      data: { rankRightHalf: { increment: half }, matchRightHalf: { increment: half } }
    });
  }

  // Rank-ups (reward paid once, "new points" reset to zero afterwards).
  const touched = await tx.user.findMany({
    where: { id: { in: [...left, ...right] } },
    select: { id: true, rank: true, rankLeftHalf: true, rankRightHalf: true }
  });

  for (const u of touched) {
    const reached = nextRankReached(u.rank, u.rankLeftHalf, u.rankRightHalf);
    if (!reached) continue;

    await tx.user.update({
      where: { id: u.id },
      data: { rank: reached.rank, rankLeftHalf: 0, rankRightHalf: 0 }
    });
    await postLedger(tx, {
      payouts: [{ userId: u.id, type: 'RANK_REWARD', paise: reached.reward * 100 }],
      sourceUserId: buyerId,
      purchaseId,
      note: `Rank achieved: ${reached.rank}`
    });
  }
}

/** Runs the whole plan for one confirmed package sale. Must run inside a transaction. */
export async function distributePackageSale(
  tx: Tx,
  sale: { purchaseId: string; buyerId: string; sponsorId: string | null; package: PaidPackage }
) {
  const upline = await getSponsorUpline(tx, sale.sponsorId, 12);
  const dist = computePackageSale(sale.package, upline);

  await postLedger(tx, {
    ...dist,
    sourceUserId: sale.buyerId,
    purchaseId: sale.purchaseId
  });

  await awardBinaryPoints(tx, sale.buyerId, sale.package, sale.purchaseId);
}

/** Records a Demat referral and pays the referrer plus 5 passive levels. */
export async function distributeDematReferral(
  tx: Tx,
  referral: { referrerId: string; sponsorId: string | null; directPaise: number; note?: string }
) {
  const upline = await getSponsorUpline(tx, referral.sponsorId, 5);
  const dist = computeDematIncome(referral.referrerId, referral.directPaise, upline);
  await postLedger(tx, { ...dist, sourceUserId: referral.referrerId, note: referral.note });
}

/** The weekly bonus minimum per share, in paise: the admin's setting, or the plan default. */
export async function weeklyMinPaise(tx: Tx): Promise<number> {
  const row = await tx.siteSetting.findUnique({ where: { key: 'weeklyBonus' } });
  const v = (row?.value as { minPerShare?: unknown } | null)?.minPerShare;
  return typeof v === 'number' && v >= 0 ? Math.round(v * 100) : WEEKLY_MIN_PER_SHARE_PAISE;
}

/** What a payout window holds: the revenue, the three pools, and who is in line for each. Read-only. */
async function computeWindow(tx: Tx, startsAt: Date, endsAt: Date) {
  const sales = await tx.packagePurchase.findMany({
    where: { status: 'CONFIRMED', confirmedAt: { gte: startsAt, lt: endsAt } },
    select: { amount: true, package: true, user: { select: { sponsorId: true } } }
  });

  const revenue = sales.reduce((sum, s) => sum + decimalToPaise(s.amount), 0);
  const weeklyPool = pctOf(revenue, POOL_PCT.WEEKLY);
  const performancePool = pctOf(revenue, POOL_PCT.PERFORMANCE);
  const leadershipPool = pctOf(revenue, POOL_PCT.LEADERSHIP);

  // Direct sales per sponsor in this window
  const direct = new Map<string, Record<PaidPackage, number>>();
  for (const s of sales) {
    const sponsorId = s.user.sponsorId;
    if (!sponsorId || s.package === 'TRAINEE') continue;
    const row = direct.get(sponsorId) ?? { PRO: 0, ELITE: 0 };
    row[s.package as PaidPackage] += 1;
    direct.set(sponsorId, row);
  }

  const sponsors = await tx.user.findMany({
    where: { id: { in: [...direct.keys()] }, isActive: true, package: { not: 'TRAINEE' } },
    select: { id: true }
  });
  const eligibleSponsors = new Set(sponsors.map((s) => s.id));

  const weeklyWeights: { id: string; weight: number }[] = [];
  const perfWeights: { id: string; weight: number }[] = [];
  for (const [id, counts] of direct) {
    if (!eligibleSponsors.has(id)) continue;
    weeklyWeights.push({ id, weight: weeklyShares(counts) });
    perfWeights.push({ id, weight: performanceWeight(counts) });
  }

  // Leadership: Silver+ members, proportional to matched points (min of the two legs).
  const leaders = await tx.user.findMany({
    where: { isActive: true, rank: { not: 'NONE' } },
    select: { id: true, matchLeftHalf: true, matchRightHalf: true }
  });
  const matched = leaders
    .map((l) => ({ id: l.id, weight: Math.min(l.matchLeftHalf, l.matchRightHalf) }))
    .filter((l) => l.weight > 0);

  const minPerSharePaise = await weeklyMinPaise(tx);
  return { revenue, weeklyPool, performancePool, leadershipPool, weeklyWeights, perfWeights, matched, minPerSharePaise, direct };
}

/** The window that is open right now (since the last close): pools so far and the members who would be paid, with estimates. */
export async function previewPayoutWindow(tx: Tx) {
  const last = await tx.payoutPeriod.findFirst({ orderBy: { endsAt: 'desc' } });
  const startsAt = last?.endsAt ?? new Date(0);
  const w = await computeWindow(tx, startsAt, new Date());
  const weekly = splitWeeklyPool(w.weeklyPool, w.weeklyWeights, w.minPerSharePaise);
  const performance = splitPool(w.performancePool, w.perfWeights);
  const leadership = splitPool(w.leadershipPool, w.matched);
  const rows = (paid: { id: string; paise: number }[], weights: { id: string; weight: number }[]) =>
    paid.map((p) => ({ userId: p.id, weight: weights.find((x) => x.id === p.id)?.weight ?? 0, paise: p.paise }));
  return {
    startsAt,
    revenue: w.revenue,
    pools: { weekly: w.weeklyPool, performance: w.performancePool, leadership: w.leadershipPool },
    minPerSharePaise: w.minPerSharePaise,
    weekly: rows(weekly.payouts, w.weeklyWeights).map((r) => ({ ...r, sales: w.direct.get(r.userId) ?? { PRO: 0, ELITE: 0 } })),
    performance: rows(performance.payouts, w.perfWeights),
    leadership: rows(leadership.payouts, w.matched)
  };
}

/**
 * Closes the current payout window and distributes the three pools:
 *  - Weekly bonus 5%, Performance bonus 5%, Leadership (binary) 12% of confirmed package revenue.
 * Nothing is ever paid beyond a pool; anything unclaimed stays with the company.
 */
export async function closePayoutPeriod(tx: Tx, adminId: string) {
  // the same lock the weekly scheduler takes: a window can only be closed once
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(7301002)`;
  const last = await tx.payoutPeriod.findFirst({ orderBy: { endsAt: 'desc' } });
  const startsAt = last?.endsAt ?? new Date(0);
  // sales take a shared lock on the same key, so none is still committing while the window closes
  const endsAt = new Date();

  if (endsAt <= startsAt) throw new AppError('Nothing to close yet', 400);

  const { revenue, weeklyPool, performancePool, leadershipPool, weeklyWeights, perfWeights, matched, minPerSharePaise } = await computeWindow(tx, startsAt, endsAt);

  const period = await tx.payoutPeriod.create({
    data: {
      startsAt,
      endsAt,
      revenue: paiseToDecimal(revenue),
      weeklyPool: paiseToDecimal(weeklyPool),
      performancePool: paiseToDecimal(performancePool),
      leadershipPool: paiseToDecimal(leadershipPool),
      weeklyPaid: 0,
      performancePaid: 0,
      leadershipPaid: 0,
      closedBy: adminId
    }
  });

  const pay = async (
    type: LedgerType,
    pool: number,
    weights: { id: string; weight: number }[],
    label: string
  ) => {
    const { payouts, unclaimed } = splitPool(pool, weights);
    await postLedger(tx, {
      payouts: payouts.map((p) => ({ userId: p.id, type, paise: p.paise })),
      company: [{ reason: `${label}_UNCLAIMED`, paise: unclaimed }],
      periodId: period.id
    });
    return pool - unclaimed;
  };

  // Weekly bonus: the pool, but never less than the plan's minimum per share (the company fund covers any gap)
  const weekly = splitWeeklyPool(weeklyPool, weeklyWeights, minPerSharePaise);
  await postLedger(tx, {
    payouts: weekly.payouts.map((p) => ({ userId: p.id, type: 'WEEKLY_BONUS' as const, paise: p.paise })),
    company: [{ reason: 'WEEKLY_POOL_UNCLAIMED', paise: weekly.unclaimed }],
    periodId: period.id
  });
  if (weekly.topUp > 0) {
    await tx.ledgerEntry.create({
      data: { userId: null, type: 'COMPANY_FUND', amount: paiseToDecimal(-weekly.topUp), periodId: period.id, note: 'WEEKLY_MIN_TOPUP' }
    });
  }
  const weeklyPaid = weekly.payouts.reduce((sum, p) => sum + p.paise, 0);
  const performancePaid = await pay('PERFORMANCE_BONUS', performancePool, perfWeights, 'PERFORMANCE_POOL');
  const leadershipPaid = await pay('LEADERSHIP_BONUS', leadershipPool, matched, 'LEADERSHIP_POOL');

  // Points that were matched are consumed: no reuse. Only when there was a pool to pay from.
  if (leadershipPool > 0) {
    for (const l of matched) {
      await tx.user.update({
        where: { id: l.id },
        data: { matchLeftHalf: { decrement: l.weight }, matchRightHalf: { decrement: l.weight } }
      });
    }
  }

  return tx.payoutPeriod.update({
    where: { id: period.id },
    data: {
      weeklyPaid: paiseToDecimal(weeklyPaid),
      performancePaid: paiseToDecimal(performancePaid),
      leadershipPaid: paiseToDecimal(leadershipPaid)
    }
  });
}
