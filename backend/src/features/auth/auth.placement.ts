import { Prisma, Leg } from '@prisma/client';
import { awardTeamGrowth, lockTeamGrowth } from '../income/team.growth';

type Tx = Prisma.TransactionClient;

/**
 * Binary placement: start at the sponsor and walk down the chosen leg
 * until an empty slot is found (spillover).
 */
export async function findPlacement(
  tx: Tx,
  sponsorId: string,
  leg: Leg
): Promise<{ parentId: string; leg: Leg }> {
  let currentId = sponsorId;

  for (;;) {
    const child = await tx.user.findFirst({ where: { parentId: currentId, leg }, select: { id: true } });
    if (!child) return { parentId: currentId, leg };
    currentId = child.id;
  }
}

/** True when a unique-constraint failure was caused by two users racing for the same binary slot. */
export const isPlacementCollision = (err: unknown): boolean => {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  const target = String((err.meta as { target?: unknown } | undefined)?.target ?? '');
  return target.includes('parentId') || target.includes('leg');
};

/**
 * Puts a member in the binary tree and credits their upline (team counts + leadership points) in the same
 * transaction. A member is placed once and never moved, so this runs exactly once per member.
 */
export async function placeMember(tx: Tx, userId: string, sponsorId: string, leg: Leg, extra: Prisma.UserUpdateInput = {}) {
  // Take the placement lock first and look again: two verification requests for the same member (the emailed link and
  // the code, or a double click) must not place them twice, which would count them twice for the upline's bonuses.
  await lockTeamGrowth(tx);
  const current = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { parentId: true } });
  if (current.parentId) return tx.user.update({ where: { id: userId }, data: extra });

  const placement = await findPlacement(tx, sponsorId, leg);
  const user = await tx.user.update({
    where: { id: userId },
    data: { ...extra, parent: { connect: { id: placement.parentId } }, leg: placement.leg }
  });
  await awardTeamGrowth(tx, userId);
  return user;
}
