import { Prisma, LedgerType, Package } from '@prisma/client';
import { AppError } from '../../shared/errors/AppError';
import {
  computeDematIncome,
  computePackageSale,
  leadershipTargets,
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
import { COMPANY_FUND_PCT, PACKAGE_HALF_POINTS, POOL_PCT, RANK_CASH_REWARDS, TEAM_TARGETS, WEEKLY_MIN_PER_SHARE_PAISE, type PaidPackage } from './plan.config';

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
    if (RANK_CASH_REWARDS) {
      await postLedger(tx, {
        payouts: [{ userId: u.id, type: 'RANK_REWARD', paise: reached.reward * 100 }],
        sourceUserId: buyerId,
        purchaseId,
        note: `Rank achieved: ${reached.rank}`
      });
    }
  }
}

/** Runs the whole plan for one confirmed package sale. Must run inside a transaction. */
export async function distributePackageSale(
  tx: Tx,
  sale: { purchaseId: string; buyerId: string; sponsorId: string | null; package: PaidPackage }
) {
  const upline = await getSponsorUpline(tx, sale.sponsorId, 13); // the sponsor (direct income) and 12 seniors (passive levels)
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
  referral: { referrerId: string; sponsorId: string | null; directPaise: number; note?: string; directType?: 'DEMAT_DIRECT' | 'CAMPAIGN_REWARD' }
) {
  const upline = await getSponsorUpline(tx, referral.sponsorId, 5);
  const dist = computeDematIncome(referral.referrerId, referral.directPaise, upline, referral.directType);
  await postLedger(tx, { ...dist, sourceUserId: referral.referrerId, note: referral.note });
}

/** The weekly bonus minimum per share, in paise: the admin's setting, or the plan default. */
export async function weeklyMinPaise(tx: Tx): Promise<number> {
  const row = await tx.siteSetting.findUnique({ where: { key: 'weeklyBonus' } });
  const v = (row?.value as { minPerShare?: unknown } | null)?.minPerShare;
  return typeof v === 'number' && v >= 0 ? Math.round(v * 100) : WEEKLY_MIN_PER_SHARE_PAISE;
}

/**
 * The rupee reward of every Team Performance target and Leadership target: the admin's setting, or the plan default.
 * Changing it affects only targets completed afterwards.
 */
export type TeamLevel = { members: number; reward: number; name?: string; perkTitle?: string; perkText?: string };
export type LeadLevel = { size: number; reward: number; name?: string };
export type BonusLevels = { team: TeamLevel[]; leadership: LeadLevel[] };

export async function bonusRewards(tx: Tx): Promise<BonusLevels> {
  const row = await tx.siteSetting.findUnique({ where: { key: 'bonusRewards' } });
  const v = row?.value as { team?: unknown; leadership?: unknown } | null;
  const okRow = (x: unknown, key: 'members' | 'size'): x is Record<string, number> =>
    typeof x === 'object' && x !== null && typeof (x as Record<string, unknown>)[key] === 'number' && typeof (x as Record<string, unknown>).reward === 'number';
  const team = Array.isArray(v?.team) && v.team.length > 0 && v.team.every((x) => okRow(x, 'members')) ? (v.team as unknown as TeamLevel[]) : null;
  const leadership = Array.isArray(v?.leadership) && v.leadership.length > 0 && v.leadership.every((x) => okRow(x, 'size')) ? (v.leadership as unknown as LeadLevel[]) : null;
  return {
    team: team ?? TEAM_TARGETS.map((t) => ({ members: t.members, reward: t.reward })),
    leadership: leadership ?? leadershipTargets().map((t) => ({ size: t.size, reward: t.paise / 100 }))
  };
}

/** The leadership targets (thresholds are cumulative) with the admin's rewards in paise. */
export const leadershipLevels = (levels: BonusLevels) =>
  leadershipTargets(levels.leadership.map((t) => t.size)).map((t, i) => ({ ...t, paise: Math.round(levels.leadership[i].reward * 100) }));

/** True when bonuses wait for an admin to press Release (the default); false when they are credited at once. */
export async function manualRelease(tx: Tx): Promise<boolean> {
  const row = await tx.siteSetting.findUnique({ where: { key: 'bonusRelease' } });
  const v = (row?.value as { manual?: unknown } | null)?.manual;
  return typeof v === 'boolean' ? v : true;
}

export type BonusType = 'WEEKLY_BONUS' | 'TEAM_PERFORMANCE_BONUS' | 'LEADERSHIP_TARGET_BONUS';

/** A bonus a member earned: it waits for Release, or goes straight to the wallet, depending on the admin's setting. */
export async function postBonus(tx: Tx, input: { userId: string; type: BonusType; level?: number; paise: number; sourceUserId?: string; periodId?: string; note?: string }) {
  if (input.paise <= 0) return;
  if (await manualRelease(tx)) {
    await tx.pendingBonus.create({
      data: { userId: input.userId, type: input.type, level: input.level ?? null, amount: paiseToDecimal(input.paise), sourceUserId: input.sourceUserId, periodId: input.periodId, note: input.note }
    });
    return;
  }
  await postLedger(tx, { payouts: [{ userId: input.userId, type: input.type, level: input.level, paise: input.paise }], sourceUserId: input.sourceUserId, periodId: input.periodId, note: input.note });
}

/** An admin presses Release: the bonus is credited to the member's wallet, once. */
export async function releaseBonus(tx: Tx, adminId: string, id: string) {
  const row = await tx.pendingBonus.findUnique({ where: { id } });
  if (!row) throw new AppError('Bonus not found', 404);
  if (row.userId === adminId) throw new AppError('You cannot release your own bonus. Ask another admin.', 403);
  const claimed = await tx.pendingBonus.updateMany({ where: { id, releasedAt: null }, data: { releasedAt: new Date(), releasedBy: adminId } });
  if (claimed.count !== 1) throw new AppError('That bonus was already released.', 409);
  await postLedger(tx, {
    payouts: [{ userId: row.userId, type: row.type as BonusType, level: row.level ?? undefined, paise: decimalToPaise(row.amount) }],
    sourceUserId: row.sourceUserId ?? undefined,
    periodId: row.periodId ?? undefined,
    note: row.note ?? undefined
  });
  return { userId: row.userId };
}

/**
 * What an admin took out (deducted) or is holding in a member's wallet, in rupees. It comes off the Demat referral income the
 * member sees (first the Demat direct income, then the campaign rewards), and never takes that below zero.
 */
export async function incomeCuts(tx: Tx, userId: string): Promise<number> {
  const [deducted, held] = await Promise.all([
    tx.ledgerEntry.aggregate({ where: { userId, type: 'ADMIN_DEDUCTION' }, _sum: { amount: true } }),
    tx.walletHold.aggregate({ where: { userId, releasedAt: null }, _sum: { amount: true } })
  ]);
  return Math.round((Math.abs(Number(deducted._sum.amount ?? 0)) + Number(held._sum.amount ?? 0)) * 100) / 100;
}

/** Takes `cut` rupees off the Demat referral income (DEMAT_DIRECT, then CAMPAIGN_REWARD) in a list of income by type. */
export function applyCuts<T extends { type: string; amount: number }>(rows: T[], cut: number): T[] {
  let left = cut;
  const out = rows.map((r) => ({ ...r }));
  for (const type of ['DEMAT_DIRECT', 'CAMPAIGN_REWARD']) {
    const row = out.find((r) => r.type === type);
    if (!row || left <= 0) continue;
    const take = Math.min(left, row.amount);
    row.amount = Math.round((row.amount - take) * 100) / 100;
    left = Math.round((left - take) * 100) / 100;
  }
  return out.filter((r) => r.amount > 0);
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
  const rows = (paid: { id: string; paise: number }[], weights: { id: string; weight: number }[]) =>
    paid.map((p) => ({ userId: p.id, weight: weights.find((x) => x.id === p.id)?.weight ?? 0, paise: p.paise }));
  return {
    startsAt,
    revenue: w.revenue,
    pools: { weekly: w.weeklyPool, performance: w.performancePool, leadership: w.leadershipPool },
    minPerSharePaise: w.minPerSharePaise,
    weekly: rows(weekly.payouts, w.weeklyWeights).map((r) => ({ ...r, sales: w.direct.get(r.userId) ?? { PRO: 0, ELITE: 0 } })),
    // the Performance and Leadership pools are not shared out at the close: their bonuses are paid as targets are completed
    performance: [] as { userId: string; weight: number; paise: number }[],
    leadership: [] as { userId: string; weight: number; paise: number }[]
  };
}

/**
 * The two pools that never reset and the company fund, in rupees. Every confirmed package sale adds its percentage; every bonus
 * paid to a member (Team Performance targets, Leadership targets) is taken out of its pool.
 */
export async function poolBalances(tx: Tx) {
  const [sales, perf, lead] = await Promise.all([
    tx.packagePurchase.aggregate({ where: { status: 'CONFIRMED' }, _sum: { amount: true } }),
    tx.ledgerEntry.aggregate({ where: { type: 'TEAM_PERFORMANCE_BONUS', amount: { gt: 0 } }, _sum: { amount: true } }),
    tx.ledgerEntry.aggregate({ where: { type: 'LEADERSHIP_TARGET_BONUS', amount: { gt: 0 } }, _sum: { amount: true } })
  ]);
  const revenue = decimalToPaise(sales._sum.amount ?? 0);
  const part = (pct: number, paidDecimal: Prisma.Decimal | null) => {
    const total = pctOf(revenue, pct);
    const paid = decimalToPaise(paidDecimal ?? 0);
    return { pct, total: total / 100, paid: paid / 100, balance: (total - paid) / 100 };
  };
  return {
    revenue: revenue / 100,
    performance: part(POOL_PCT.PERFORMANCE, perf._sum.amount),
    leadership: part(POOL_PCT.LEADERSHIP, lead._sum.amount),
    company: { pct: COMPANY_FUND_PCT, total: pctOf(revenue, COMPANY_FUND_PCT) / 100 }
  };
}

/**
 * Closes the current payout window (every Sunday midnight, IST) and shares out the WEEKLY pool: 5% of that week's confirmed package
 * revenue. The Performance and Leadership pools are not shared out here: they keep growing with every sale and pay as targets are done.
 */
export async function closePayoutPeriod(tx: Tx, adminId: string, closeAt?: Date) {
  // the same lock the weekly scheduler takes: a window can only be closed once
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(7301002)`;
  const last = await tx.payoutPeriod.findFirst({ orderBy: { endsAt: 'desc' } });
  const startsAt = last?.endsAt ?? new Date(0);
  // sales take a shared lock on the same key, so none is still committing while the window closes
  // an admin closes it now; the scheduler closes it at the start of the new week (never later than now), so sales of the new week stay in the new week
  const now = new Date();
  const endsAt = closeAt && closeAt < now ? closeAt : now;

  if (endsAt <= startsAt) throw new AppError('Nothing to close yet', 400);

  const { revenue, weeklyPool, performancePool, leadershipPool, weeklyWeights, minPerSharePaise } = await computeWindow(tx, startsAt, endsAt);

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

  // Weekly bonus: the pool, but never less than the plan's minimum per share (the company fund covers any gap)
  const weekly = splitWeeklyPool(weeklyPool, weeklyWeights, minPerSharePaise);
  for (const p of weekly.payouts) await postBonus(tx, { userId: p.id, type: 'WEEKLY_BONUS', paise: p.paise, periodId: period.id, note: 'Weekly bonus' });
  await postLedger(tx, { payouts: [], company: [{ reason: 'WEEKLY_POOL_UNCLAIMED', paise: weekly.unclaimed }], periodId: period.id });
  if (weekly.topUp > 0) {
    await tx.ledgerEntry.create({
      data: { userId: null, type: 'COMPANY_FUND', amount: paiseToDecimal(-weekly.topUp), periodId: period.id, note: 'WEEKLY_MIN_TOPUP' }
    });
  }
  const weeklyPaid = weekly.payouts.reduce((sum, p) => sum + p.paise, 0);
  return tx.payoutPeriod.update({
    where: { id: period.id },
    data: {
      weeklyPaid: paiseToDecimal(weeklyPaid),
      performancePaid: 0,
      leadershipPaid: 0
    }
  });
}
