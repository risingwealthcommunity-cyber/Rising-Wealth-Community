/**
 * Gives every existing member their two sponsor codes (LEFT and RIGHT). New members get them when the
 * account is created; this is only for accounts that existed before. Safe to run again.
 * Usage: npm run backfill:codes
 */
import { Prisma } from '@prisma/client';
import { prisma } from './config/database';
import { generateSponsorCodes } from './features/auth/auth.tokens';

async function main() {
  const members = await prisma.user.findMany({
    where: { OR: [{ leftCode: null }, { rightCode: null }] },
    select: { id: true, email: true, leftCode: true, rightCode: true }
  });

  let done = 0;
  for (const m of members) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const fresh = generateSponsorCodes();
      try {
        await prisma.user.update({
          where: { id: m.id },
          data: { leftCode: m.leftCode ?? fresh.leftCode, rightCode: m.rightCode ?? fresh.rightCode }
        });
        done++;
        break;
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
      }
    }
  }
  console.log(`Added sponsor codes to ${done} of ${members.length} member(s) that were missing them.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
