/**
 * Demo data for trying the Team Performance and Leadership bonuses without building a team by hand.
 *
 *   npm run seed:demo            create the demo account + a small team (safe to run again)
 *   npm run seed:demo -- --remove  delete the demo account and everyone in its team
 *
 * Login:  demo@rwc.local  /  Demo@12345
 * The team is created through the real placement code, so the bonuses in the demo wallet were
 * earned by the real rules (2:2 and 4:4 team targets, first Leadership target).
 *
 * Development only: it refuses to run with NODE_ENV=production (a known password must never exist there).
 */
import bcrypt from 'bcrypt';
import { Leg } from '@prisma/client';
import { prisma } from './config/database';
import { config } from './config/env';
import { generateReferralCode, generateSponsorCodes } from './features/auth/auth.tokens';
import { placeMember } from './features/auth/auth.placement';

const DEMO_EMAIL = 'demo@rwc.local';
const DEMO_PASSWORD = 'Demo@12345';
const domain = '@demo.rwc.local';

async function remove() {
  const users = await prisma.user.findMany({
    where: { OR: [{ email: DEMO_EMAIL }, { email: { endsWith: domain } }] },
    select: { id: true }
  });
  const ids = users.map((u) => u.id);
  await prisma.ledgerEntry.deleteMany({ where: { OR: [{ userId: { in: ids } }, { sourceUserId: { in: ids } }] } });
  await prisma.packagePurchase.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  console.log(`Removed ${ids.length} demo accounts.`);
}

async function addMember(name: string, sponsorId: string, leg: Leg) {
  const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}${domain}`;
  const created = await prisma.user.create({
    data: {
      name,
      email,
      isVerified: false,
      referralCode: generateReferralCode(),
      ...generateSponsorCodes(),
      sponsorId,
      preferredLeg: leg
    }
  });
  // same code path as a real member verifying their email
  await prisma.$transaction((tx) => placeMember(tx, created.id, sponsorId, leg, { isVerified: true }), { timeout: 20_000 });
  return prisma.user.findUniqueOrThrow({ where: { id: created.id } });
}

async function create() {
  if (await prisma.user.findUnique({ where: { email: DEMO_EMAIL } })) {
    console.log(`Demo account already exists. Login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
    return;
  }

  const demo = await prisma.user.create({
    data: {
      name: 'Demo Leader',
      email: DEMO_EMAIL,
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 12),
      package: 'ELITE',
      isVerified: true,
      referralCode: generateReferralCode(),
      ...generateSponsorCodes()
    }
  });

  // Direct referrals: 3 on the LEFT, 2 on the RIGHT (chosen by which code they joined with).
  const left = [await addMember('Demo Left One', demo.id, 'LEFT'), await addMember('Demo Left Two', demo.id, 'LEFT'), await addMember('Demo Left Three', demo.id, 'LEFT')];
  const right = [await addMember('Demo Right One', demo.id, 'RIGHT'), await addMember('Demo Right Two', demo.id, 'RIGHT')];

  // Four of the directs each sponsor 2 people (LEFT code + RIGHT code): these earn the demo's Leadership points
  // and sit deeper in the demo's LEFT / RIGHT team.
  for (const d of [left[0], left[1], right[0], right[1]]) {
    await addMember(`${d.name} Friend A`, d.id, 'LEFT');
    await addMember(`${d.name} Friend B`, d.id, 'RIGHT');
  }

  const me = await prisma.user.findUniqueOrThrow({ where: { id: demo.id } });
  console.log('\nDemo account ready');
  console.log(`  Login:       ${DEMO_EMAIL}  /  ${DEMO_PASSWORD}`);
  console.log(`  LEFT code:   ${me.leftCode}`);
  console.log(`  RIGHT code:  ${me.rightCode}`);
  console.log(`  Team:        ${me.teamLeftTotal} left / ${me.teamRightTotal} right, ${me.teamTargetsDone} team targets done`);
  console.log(`  Leadership:  ${me.leadershipPoints} points, ${me.leadershipTargetsDone} target(s) done`);
  console.log(`  Wallet:      Rs ${me.walletBalance}`);
}

async function main() {
  if (config.nodeEnv === 'production') throw new Error('seed:demo is for development only (NODE_ENV=production).');
  if (process.argv.includes('--remove')) await remove();
  else await create();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
