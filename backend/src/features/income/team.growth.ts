import { Prisma, type Package } from '@prisma/client';
import { advanceLeadership, advanceTeamTargets } from './income.engine';
import { bonusRewards, leadershipLevels, postBonus } from './income.service';

type Tx = Prisma.TransactionClient;

const TEAM_GROWTH_LOCK = 7_301_001;

/**
 * POINTS: a member counts for the Team Performance and Leadership bonuses by their package, not by simply being in the team:
 * Trainee 0 points, PRO 0.5, ELITE 1. Points arrive when a member buys or upgrades (Trainee to PRO +0.5, PRO to ELITE +0.5,
 * Trainee to ELITE +1), so a member counts exactly once at their current package.
 *
 *  1. Team Performance Bonus: every binary ancestor gets the points as NEW points on the side the member sits on;
 *     completed 2:2 / 4:4 / ... targets pay straight into the wallet.
 *  2. Leadership Bonus: the member's sponsor's sponsor gets the points as Leadership Points.
 *
 * Only active members with a paid package earn (same rule as the binary rank points). Growth updates are
 * serialised with a transaction-level advisory lock, so two members joining at the same moment can never
 * pay a target twice or lose a count (row locks would deadlock: Postgres does not lock in ORDER BY order).
 */
export async function lockTeamGrowth(tx: Tx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${TEAM_GROWTH_LOCK})`;
}

/** Points a package is worth for the Team Performance and Leadership bonuses. */
export const PACKAGE_POINTS: Record<Package, number> = { TRAINEE: 0, PRO: 0.5, ELITE: 1 };

/** Runs when a member is placed in the binary tree (once per member): only the whole-team head count grows, points come with a package. */
export async function awardTeamGrowth(tx: Tx, memberId: string): Promise<void> {
  await lockTeamGrowth(tx);
  const ancestors = await paidAncestors(tx, memberId);
  const left = ancestors.filter((a) => a.leg === 'LEFT').map((a) => a.id);
  const right = ancestors.filter((a) => a.leg === 'RIGHT').map((a) => a.id);
  if (left.length) await tx.user.updateMany({ where: { id: { in: left } }, data: { teamLeftTotal: { increment: 1 } } });
  if (right.length) await tx.user.updateMany({ where: { id: { in: right } }, data: { teamRightTotal: { increment: 1 } } });
}

async function paidAncestors(tx: Tx, memberId: string) {
  return tx.$queryRaw<{ id: string; leg: 'LEFT' | 'RIGHT' }[]>`
    WITH RECURSIVE up AS (
      SELECT "parentId" AS id, leg FROM "User" WHERE id = ${memberId} AND "parentId" IS NOT NULL
      UNION ALL
      SELECT u."parentId", u.leg FROM "User" u JOIN up ON u.id = up.id WHERE u."parentId" IS NOT NULL
    )
    SELECT up.id, up.leg::text AS leg
    FROM up JOIN "User" a ON a.id = up.id
    WHERE a.package <> 'TRAINEE' AND a."isActive" = true`;
}

/** Gives a member's uplines the points that moving from one package to a higher one adds (nothing when it is not an upgrade). */
export async function awardPackagePoints(tx: Tx, memberId: string, from: Package, to: Package): Promise<void> {
  const points = PACKAGE_POINTS[to] - PACKAGE_POINTS[from];
  if (points <= 0) return;
  await lockTeamGrowth(tx);
  const member = await tx.user.findUniqueOrThrow({ where: { id: memberId }, select: { sponsorId: true } });
  const ancestors = await paidAncestors(tx, memberId);

  // Leadership point goes to the sponsor of my sponsor.
  let leaderId: string | null = null;
  if (member.sponsorId) {
    const sponsor = await tx.user.findUnique({ where: { id: member.sponsorId }, select: { sponsorId: true } });
    if (sponsor?.sponsorId) {
      const leader = await tx.user.findUnique({ where: { id: sponsor.sponsorId }, select: { id: true, package: true, isActive: true } });
      if (leader && leader.isActive && leader.package !== 'TRAINEE') leaderId = leader.id;
    }
  }
  if (!ancestors.length && !leaderId) return;

  // ---- Team Performance Bonus
  const left = ancestors.filter((a) => a.leg === 'LEFT').map((a) => a.id);
  const right = ancestors.filter((a) => a.leg === 'RIGHT').map((a) => a.id);
  if (left.length) await tx.user.updateMany({ where: { id: { in: left } }, data: { teamLeftNew: { increment: points } } });
  if (right.length) await tx.user.updateMany({ where: { id: { in: right } }, data: { teamRightNew: { increment: points } } });

  const rewards = await bonusRewards(tx);
  const touched = await tx.user.findMany({
    where: { id: { in: [...left, ...right] } },
    select: { id: true, teamLeftNew: true, teamRightNew: true, teamTargetsDone: true }
  });
  for (const u of touched) {
    const r = advanceTeamTargets(u.teamTargetsDone, u.teamLeftNew, u.teamRightNew, rewards.team);
    if (!r.steps.length) continue;
    await tx.user.update({ where: { id: u.id }, data: { teamTargetsDone: r.done, teamLeftNew: r.left, teamRightNew: r.right } });
    for (const step of r.steps) {
      await postBonus(tx, {
        userId: u.id,
        type: 'TEAM_PERFORMANCE_BONUS',
        level: step.target,
        paise: step.paise,
        sourceUserId: memberId,
        note: `Team target ${step.target} completed: ${step.members} left : ${step.members} right points`
      });
    }
  }

  // ---- Leadership Bonus
  if (leaderId) {
    const l = await tx.user.update({
      where: { id: leaderId },
      data: { leadershipPoints: { increment: points } },
      select: { leadershipPoints: true, leadershipTargetsDone: true }
    });
    const r = advanceLeadership(l.leadershipTargetsDone, l.leadershipPoints, leadershipLevels(rewards));
    if (r.steps.length) {
      await tx.user.update({ where: { id: leaderId }, data: { leadershipTargetsDone: r.done } });
      for (const step of r.steps) {
        await postBonus(tx, {
          userId: leaderId,
          type: 'LEADERSHIP_TARGET_BONUS',
          level: step.index,
          paise: step.paise,
          sourceUserId: memberId,
          note: `Leadership target ${step.index} completed: ${step.threshold} points`
        });
      }
    }
  }
}
