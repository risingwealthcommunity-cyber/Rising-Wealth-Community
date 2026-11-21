/**
 * Single source of truth for the RWC compensation plan.
 * Money is in PAISE (integers). Binary points are in HALF-points.
 */
import type { Package, Rank } from '@prisma/client';

export type PaidPackage = Exclude<Package, 'TRAINEE'>;

export const PACKAGE_PRICE_PAISE: Record<PaidPackage, number> = {
  PRO: 2499_00,
  ELITE: 4999_00
};

/** PRO = 0.5 point, ELITE = 1 point (stored as halves). */
export const PACKAGE_HALF_POINTS: Record<PaidPackage, number> = { PRO: 1, ELITE: 2 };

/** Used to compare package tiers for upgrades. */
export const PACKAGE_TIER: Record<Package, number> = { TRAINEE: 0, PRO: 1, ELITE: 2 };

/** 35% of a package sale, capped to the sponsor's own package. */
export const DIRECT_PCT = 35;

/** Passive level % of the sale price: L1=5, L2=3, L3=2, L4=2, L5..L12=1 (=> 15% for 7 levels, 20% for 12). */
export const PASSIVE_PCT = [5, 3, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1] as const;

/** How many passive levels each package unlocks. Locked levels go to the company fund. */
export const PASSIVE_LEVELS_UNLOCKED: Record<Package, number> = { TRAINEE: 0, PRO: 7, ELITE: 12 };

/** Pool percentages of total confirmed package revenue per payout period. */
export const POOL_PCT = { WEEKLY: 5, PERFORMANCE: 5, LEADERSHIP: 12 } as const;

/**
 * Demat referral income.
 * ASSUMPTION (plan gives no numbers): admin enters the amount payable to the referrer;
 * 5 passive levels pay these % of that amount, funded by the company.
 */
export const DEMAT_PASSIVE_PCT = [5, 3, 2, 2, 1] as const;

/** Weekly bonus: every 3 direct sales of a package = 1 share (max 2 shares per package). ELITE share weighs 2x. */
export const WEEKLY_SALES_PER_SHARE = 3;
export const WEEKLY_MAX_SHARES_PER_PACKAGE = 2;
export const WEEKLY_SHARE_WEIGHT: Record<PaidPackage, number> = { PRO: 1, ELITE: 2 };
/**
 * The plan's "Min" amounts: 3 PRO = Rs 375, 6 PRO = Rs 750, 3 ELITE = Rs 750, 6 ELITE = Rs 1,500, which is Rs 375 per
 * weight-1 share (an ELITE share weighs 2). If the pool is too small to pay that, the company fund tops it up.
 * Set to 0 to make the weekly bonus purely pool-based again.
 */
export const WEEKLY_MIN_PER_SHARE_PAISE = 375_00;

export interface RankDef {
  rank: Exclude<Rank, 'NONE'>;
  /** Required NEW points on EACH leg (left : right). */
  points: number;
  /** One-time reward in rupees. */
  reward: number;
}

/** Order matters. Requirements follow the "FINAL one-time rank income" table (125/250/... not 128/256/...). */
export const RANKS: RankDef[] = [
  { rank: 'SILVER', points: 2, reward: 750 },
  { rank: 'GOLD', points: 4, reward: 1_500 },
  { rank: 'PLATINUM', points: 8, reward: 3_000 },
  { rank: 'DIAMOND', points: 16, reward: 7_000 },
  { rank: 'BLUE_DIAMOND', points: 32, reward: 13_000 },
  { rank: 'BLACK_DIAMOND', points: 64, reward: 25_000 },
  { rank: 'ROYAL_DIAMOND', points: 125, reward: 50_000 },
  { rank: 'CROWN', points: 250, reward: 120_000 },
  { rank: 'DOUBLE_CROWN', points: 500, reward: 250_000 },
  { rank: 'TRIPLE_CROWN', points: 1_000, reward: 500_000 },
  { rank: 'IMPERIAL', points: 2_000, reward: 800_000 },
  { rank: 'IMPERIAL_PLUS', points: 4_000, reward: 1_300_000 },
  { rank: 'LEGACY', points: 8_000, reward: 2_500_000 },
  { rank: 'LEGACY_PLUS', points: 16_000, reward: 4_000_000 },
  { rank: 'DYNASTY', points: 32_800, reward: 6_500_000 },
  { rank: 'ETERNAL', points: 131_000, reward: 15_000_000 }
];

/**
 * Team Performance Bonus (binary targets). Each target needs `members` NEW members on EACH side
 * (left : right) that no earlier target has used. Targets are sequential.
 */
export interface TeamTarget {
  members: number;
  reward: number;
}
export const TEAM_TARGETS: TeamTarget[] = [
  { members: 2, reward: 750 },
  { members: 4, reward: 1_500 },
  { members: 8, reward: 3_000 },
  { members: 16, reward: 6_000 },
  { members: 32, reward: 12_000 }
];

/**
 * Leadership Bonus: 1 point for every new member sponsored by one of my DIRECT referrals.
 * Target sizes double (6, 12, 24, ...) and are CUMULATIVE: thresholds are 6, 18, 42, ...
 * ASSUMPTION (the brief gives sizes 6 and 12 but no rupee amounts): reward = LEADERSHIP_RUPEES_PER_POINT x size.
 * Change the number below (or the list) to set the real amounts.
 */
export const LEADERSHIP_RUPEES_PER_POINT = 100;
export const LEADERSHIP_TARGET_SIZES = [6, 12, 24, 48, 96, 192, 384, 768];
