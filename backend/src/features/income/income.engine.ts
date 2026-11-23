/**
 * Pure plan logic: no database, no I/O. Everything here is unit-tested.
 * Money = paise (integers). Points = half-points (integers).
 */
import type { LedgerType, Package, Rank } from '@prisma/client';
import {
  DEMAT_PASSIVE_PCT,
  DIRECT_PCT,
  LEADERSHIP_RUPEES_PER_POINT,
  LEADERSHIP_TARGET_SIZES,
  PACKAGE_PRICE_PAISE,
  PASSIVE_LEVELS_UNLOCKED,
  PASSIVE_PCT,
  RANKS,
  TEAM_TARGETS,
  WEEKLY_MAX_SHARES_PER_PACKAGE,
  WEEKLY_SALES_PER_SHARE,
  WEEKLY_SHARE_WEIGHT,
  type PaidPackage,
  type RankDef,
  type TeamTarget
} from './plan.config';

export interface UplineMember {
  id: string;
  package: Package;
  active: boolean;
}

export interface Payout {
  userId: string;
  type: LedgerType;
  level?: number;
  paise: number;
}

export interface CompanyEntry {
  reason: string;
  level?: number;
  paise: number;
}

export interface Distribution {
  payouts: Payout[];
  company: CompanyEntry[];
}

export const pctOf = (paise: number, pct: number): number => Math.floor((paise * pct) / 100);

/**
 * Package sale: the direct sponsor gets ONLY the 35% direct income (capped to their own package). The passive levels 1..12
 * go to the sponsor's seniors: level 1 is the sponsor's sponsor, level 2 the one above, and so on
 * (unlocked by the RECEIVER's package; locked levels go to the company fund).
 *
 * `upline[0]` is the direct sponsor, `upline[1]` the sponsor's sponsor (passive level 1), and so on.
 */
export function computePackageSale(pkg: PaidPackage, upline: UplineMember[]): Distribution {
  const price = PACKAGE_PRICE_PAISE[pkg];
  const payouts: Payout[] = [];
  const company: CompanyEntry[] = [];

  // 1) Direct income
  const directGross = pctOf(price, DIRECT_PCT);
  const sponsor = upline[0];
  if (sponsor && sponsor.active && sponsor.package !== 'TRAINEE') {
    const cap = pctOf(PACKAGE_PRICE_PAISE[sponsor.package as PaidPackage], DIRECT_PCT);
    const paid = Math.min(directGross, cap);
    payouts.push({ userId: sponsor.id, type: 'DIRECT_INCOME', paise: paid });
    if (directGross > paid) company.push({ reason: 'DIRECT_CAPPED_TO_SPONSOR_PACKAGE', paise: directGross - paid });
  } else {
    company.push({ reason: 'DIRECT_NO_ELIGIBLE_SPONSOR', paise: directGross });
  }

  // 2) Passive income
  PASSIVE_PCT.forEach((pct, i) => {
    const level = i + 1;
    const amount = pctOf(price, pct);
    const member = upline[i + 1];
    if (member && member.active && PASSIVE_LEVELS_UNLOCKED[member.package] >= level) {
      payouts.push({ userId: member.id, type: 'PASSIVE_INCOME', level, paise: amount });
    } else {
      company.push({ reason: member ? 'PASSIVE_LEVEL_LOCKED' : 'PASSIVE_NO_UPLINE', level, paise: amount });
    }
  });

  return { payouts, company };
}

/**
 * Demat referral: the referrer gets `directPaise` (active income). Up to 5 sponsor levels earn a
 * passive % of it, whatever their package (Trainees included). Passive levels with nobody go unpaid.
 */
export function computeDematIncome(referrerId: string, directPaise: number, upline: UplineMember[], directType: 'DEMAT_DIRECT' | 'CAMPAIGN_REWARD' = 'DEMAT_DIRECT'): Distribution {
  const payouts: Payout[] = [{ userId: referrerId, type: directType, paise: directPaise }];

  DEMAT_PASSIVE_PCT.forEach((pct, i) => {
    const member = upline[i];
    const paise = pctOf(directPaise, pct);
    if (member && member.active && paise > 0) {
      payouts.push({ userId: member.id, type: 'DEMAT_PASSIVE', level: i + 1, paise });
    }
  });

  return { payouts, company: [] };
}

/** Next rank a member qualifies for, or null. Both legs need the NEW points. Ranks are won one step at a time. */
export function nextRankReached(
  current: Rank,
  rankLeftHalf: number,
  rankRightHalf: number
): RankDef | null {
  const idx = current === 'NONE' ? -1 : RANKS.findIndex((r) => r.rank === current);
  const next = RANKS[idx + 1];
  if (!next) return null;
  const need = next.points * 2;
  return rankLeftHalf >= need && rankRightHalf >= need ? next : null;
}

/** Weekly-bonus shares from the week's DIRECT sales: 3 => 1 share, 6 => 2 shares (max), ELITE shares weigh double. */
export function weeklyShares(directSales: Record<PaidPackage, number>): number {
  let shares = 0;
  for (const pkg of ['PRO', 'ELITE'] as PaidPackage[]) {
    const n = Math.min(
      WEEKLY_MAX_SHARES_PER_PACKAGE,
      Math.floor(directSales[pkg] / WEEKLY_SALES_PER_SHARE)
    );
    shares += n * WEEKLY_SHARE_WEIGHT[pkg];
  }
  return shares;
}

/**
 * Weekly bonus split: everyone gets at least `minPerSharePaise` per share (the plan's minimum), otherwise an equal
 * slice of the pool. `topUp` is what the company fund has to add when the pool alone could not pay the minimum.
 */
export function splitWeeklyPool(
  poolPaise: number,
  weights: { id: string; weight: number }[],
  minPerSharePaise: number
): { payouts: { id: string; paise: number }[]; unclaimed: number; topUp: number } {
  const eligible = weights.filter((w) => w.weight > 0);
  const total = eligible.reduce((sum, w) => sum + w.weight, 0);
  if (total === 0) return { payouts: [], unclaimed: Math.max(poolPaise, 0), topUp: 0 };

  const perShare = Math.max(Math.floor(Math.max(poolPaise, 0) / total), minPerSharePaise);
  const payouts = eligible.map((w) => ({ id: w.id, paise: w.weight * perShare })).filter((p) => p.paise > 0);
  const paid = payouts.reduce((sum, p) => sum + p.paise, 0);
  return paid >= poolPaise ? { payouts, unclaimed: 0, topUp: paid - Math.max(poolPaise, 0) } : { payouts, unclaimed: poolPaise - paid, topUp: 0 };
}

/** Performance weight = half-points earned from direct sales (PRO 1, ELITE 2). */
export function performanceWeight(directSales: Record<PaidPackage, number>): number {
  return directSales.PRO * 1 + directSales.ELITE * 2;
}

/**
 * Proportional split of a pool. Uses floor so the total paid can NEVER exceed the pool.
 * Returns payouts plus whatever was left unclaimed (rounding dust or nobody eligible).
 */
export function splitPool(
  poolPaise: number,
  weights: { id: string; weight: number }[]
): { payouts: { id: string; paise: number }[]; unclaimed: number } {
  const eligible = weights.filter((w) => w.weight > 0);
  const total = eligible.reduce((sum, w) => sum + w.weight, 0);
  if (poolPaise <= 0 || total === 0) return { payouts: [], unclaimed: Math.max(poolPaise, 0) };

  let paid = 0;
  const payouts = eligible
    .map((w) => {
      const paise = Number((BigInt(poolPaise) * BigInt(w.weight)) / BigInt(total));
      paid += paise;
      return { id: w.id, paise };
    })
    .filter((p) => p.paise > 0);

  return { payouts, unclaimed: poolPaise - paid };
}

/* ----------------------------- Team Performance Bonus ----------------------------- */

export interface TeamStep {
  /** 1-based number of the target that was just completed. */
  target: number;
  members: number;
  paise: number;
}

/**
 * Applies the sequential binary targets to a member's NEW (unused) left/right counts.
 * A target needs `members` on EACH side; those members are then used up (never counted again).
 * Anything beyond what the target needed stays available for the next one.
 */
export function advanceTeamTargets(
  done: number,
  left: number,
  right: number,
  targets: readonly TeamTarget[] = TEAM_TARGETS
): { steps: TeamStep[]; done: number; left: number; right: number } {
  const steps: TeamStep[] = [];
  let l = left;
  let r = right;
  let d = done;
  for (;;) {
    const t = targets[d];
    if (!t || l < t.members || r < t.members) break;
    l -= t.members;
    r -= t.members;
    d += 1;
    steps.push({ target: d, members: t.members, paise: t.reward * 100 });
  }
  return { steps, done: d, left: l, right: r };
}

/* ------------------------------- Leadership Bonus -------------------------------- */

export interface LeadershipTarget {
  index: number;
  size: number;
  /** Total points needed (cumulative). */
  threshold: number;
  paise: number;
}

export function leadershipTargets(
  sizes: readonly number[] = LEADERSHIP_TARGET_SIZES,
  perPoint: number = LEADERSHIP_RUPEES_PER_POINT
): LeadershipTarget[] {
  let total = 0;
  return sizes.map((size, i) => {
    total += size;
    return { index: i + 1, size, threshold: total, paise: size * perPoint * 100 };
  });
}

/** Targets newly reached when a member's cumulative points go up. */
export function advanceLeadership(
  done: number,
  points: number,
  targets: readonly LeadershipTarget[] = leadershipTargets()
): { steps: LeadershipTarget[]; done: number } {
  const steps: LeadershipTarget[] = [];
  let d = done;
  while (targets[d] && points >= targets[d].threshold) {
    steps.push(targets[d]);
    d += 1;
  }
  return { steps, done: d };
}
