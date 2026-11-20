import { Prisma, Leg } from '@prisma/client';

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
