/**
 * Pure plan logic: no database, no I/O. Everything here is unit-tested.
 * Money = paise (integers). Points = half-points (integers).
 */
import type { LedgerType, Package, Rank } from '@prisma/client';
import {
  DEMAT_PASSIVE_PCT,
  DIRECT_PCT,
  PACKAGE_PRICE_PAISE,
  PASSIVE_LEVELS_UNLOCKED,
  PASSIVE_PCT,
  RANKS,
  WEEKLY_MAX_SHARES_PER_PACKAGE,
  WEEKLY_SALES_PER_SHARE,
  WEEKLY_SHARE_WEIGHT,
  type PaidPackage,
  type RankDef
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
 * Package sale: 35% direct (capped to sponsor's own package) + passive levels 1..12
 * (unlocked by the RECEIVER's package; locked levels go to the company fund).
 *
 * `upline[0]` is the direct sponsor (level 1), `upline[1]` the sponsor's sponsor, and so on.
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
    const member = upline[i];
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
export function computeDematIncome(referrerId: string, directPaise: number, upline: UplineMember[]): Distribution {
  const payouts: Payout[] = [{ userId: referrerId, type: 'DEMAT_DIRECT', paise: directPaise }];

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
