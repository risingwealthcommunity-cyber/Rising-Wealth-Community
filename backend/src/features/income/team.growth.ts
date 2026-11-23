import { Prisma } from '@prisma/client';
import { advanceLeadership, advanceTeamTargets } from './income.engine';
import { bonusRewards, leadershipLevels, postLedger } from './income.service';

type Tx = Prisma.TransactionClient;

const TEAM_GROWTH_LOCK = 7_301_001;

/**
 * Runs when a member is placed in the binary tree (exactly once per member, inside the placement transaction).
 *
 *  1. Team Performance Bonus: every binary ancestor gets +1 NEW member on the side the newcomer sits on;
 *     completed 2:2 / 4:4 / ... targets pay straight into the wallet.
 *  2. Leadership Bonus: the newcomer's sponsor's sponsor gets +1 Leadership Point.
 *
 * Only active members with a paid package earn (same rule as the binary rank points). Growth updates are
 * serialised with a transaction-level advisory lock, so two members joining at the same moment can never
 * pay a target twice or lose a count (row locks would deadlock: Postgres does not lock in ORDER BY order).
 */
export async function lockTeamGrowth(tx: Tx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${TEAM_GROWTH_LOCK})`;
}

export async function awardTeamGrowth(tx: Tx, memberId: string): Promise<void> {
  await lockTeamGrowth(tx);
  const member = await tx.user.findUniqueOrThrow({ where: { id: memberId }, select: { sponsorId: true } });

  const ancestors = await tx.$queryRaw<{ id: string; leg: 'LEFT' | 'RIGHT' }[]>`
    WITH RECURSIVE up AS (
      SELECT "parentId" AS id, leg FROM "User" WHERE id = ${memberId} AND "parentId" IS NOT NULL
      UNION ALL
      SELECT u."parentId", u.leg FROM "User" u JOIN up ON u.id = up.id WHERE u."parentId" IS NOT NULL
    )
    SELECT up.id, up.leg::text AS leg
    FROM up JOIN "User" a ON a.id = up.id
    WHERE a.package <> 'TRAINEE' AND a."isActive" = true`;

  // Leadership point goes to the sponsor of my sponsor.
  let leaderId: string | null = null;
  if (member.sponsorId) {
    const sponsor = await tx.user.findUnique({ where: { id: member.sponsorId }, select: { sponsorId: true } });
    if (sponsor?.sponsorId) {
      const leader = await tx.user.findUnique({
        where: { id: sponsor.sponsorId },
        select: { id: true, package: true, isActive: true }
      });
      if (leader && leader.isActive && leader.package !== 'TRAINEE') leaderId = leader.id;
    }
  }

  if (!ancestors.length && !leaderId) return;

  // ---- Team Performance Bonus
  const left = ancestors.filter((a) => a.leg === 'LEFT').map((a) => a.id);
  const right = ancestors.filter((a) => a.leg === 'RIGHT').map((a) => a.id);
  if (left.length) {
    await tx.user.updateMany({ where: { id: { in: left } }, data: { teamLeftNew: { increment: 1 }, teamLeftTotal: { increment: 1 } } });
  }
  if (right.length) {
    await tx.user.updateMany({ where: { id: { in: right } }, data: { teamRightNew: { increment: 1 }, teamRightTotal: { increment: 1 } } });
  }

  const rewards = await bonusRewards(tx);
  const teamTargets = rewards.team;
  const touched = await tx.user.findMany({
    where: { id: { in: [...left, ...right] } },
    select: { id: true, teamLeftNew: true, teamRightNew: true, teamTargetsDone: true }
  });
  for (const u of touched) {
    const r = advanceTeamTargets(u.teamTargetsDone, u.teamLeftNew, u.teamRightNew, teamTargets);
    if (!r.steps.length) continue;
    await tx.user.update({
      where: { id: u.id },
      data: { teamTargetsDone: r.done, teamLeftNew: r.left, teamRightNew: r.right }
    });
    for (const step of r.steps) {
      await postLedger(tx, {
        payouts: [{ userId: u.id, type: 'TEAM_PERFORMANCE_BONUS', level: step.target, paise: step.paise }],
        sourceUserId: memberId,
        note: `Team target ${step.target} completed: ${step.members} left : ${step.members} right new members`
      });
    }
  }

  // ---- Leadership Bonus
  if (leaderId) {
    const l = await tx.user.update({
      where: { id: leaderId },
      data: { leadershipPoints: { increment: 1 } },
      select: { leadershipPoints: true, leadershipTargetsDone: true }
    });
    const leadTargets = leadershipLevels(rewards);
    const r = advanceLeadership(l.leadershipTargetsDone, l.leadershipPoints, leadTargets);
    if (r.steps.length) {
      await tx.user.update({ where: { id: leaderId }, data: { leadershipTargetsDone: r.done } });
      for (const step of r.steps) {
        await postLedger(tx, {
          payouts: [{ userId: leaderId, type: 'LEADERSHIP_TARGET_BONUS', level: step.index, paise: step.paise }],
          sourceUserId: memberId,
          note: `Leadership target ${step.index} completed: ${step.threshold} points`
        });
      }
    }
  }
}
