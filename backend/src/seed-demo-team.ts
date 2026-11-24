/**
 * Four ready Trainee members, all direct members of the "Demo Member" account (DEMO_USER_EMAIL) on its RIGHT leg, so the income
 * distribution can be tested by upgrading them one by one (the sponsor and the seniors above get their share).
 *
 *   Demo Member -> trainee1..trainee4@rwcdemo.com (Demo One..Four, all Trainee, right side)
 *
 * Everyone has Rs 10,000 in the activation wallet and a transaction password. Without a Demo Member account they go under the admin.
 * Set DEMO_TEAM_PASSWORD (at least 10 characters; the password lives only in the server settings), and optionally DEMO_TEAM_TXN for the
 * transaction password (it defaults to the same). Safe to run again. Does nothing when DEMO_TEAM_PASSWORD is empty.
 */
import bcrypt from 'bcrypt';
import { Package } from '@prisma/client';
import { prisma } from './config/database';
import { generateReferralCode, generateSponsorCodes } from './features/auth/auth.tokens';
import { placeMember } from './features/auth/auth.placement';

const TEAM: { email: string; name: string; pkg: Package }[] = [
  { email: 'trainee1@rwcdemo.com', name: 'Demo One', pkg: 'TRAINEE' },
  { email: 'trainee2@rwcdemo.com', name: 'Demo Two', pkg: 'TRAINEE' },
  { email: 'trainee3@rwcdemo.com', name: 'Demo Three', pkg: 'TRAINEE' },
  { email: 'trainee4@rwcdemo.com', name: 'Demo Four', pkg: 'TRAINEE' }
];

async function main() {
  const password = process.env.DEMO_TEAM_PASSWORD ?? '';
  if (!password) return;
  if (password.length < 10) throw new Error('DEMO_TEAM_PASSWORD must be at least 10 characters.');
  const txn = process.env.DEMO_TEAM_TXN || password;
  const root = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!root) throw new Error('Create the admin first (seed), then the demo team.');

  const demoEmail = (process.env.DEMO_USER_EMAIL ?? '').trim().toLowerCase();
  const demoMember = demoEmail ? await prisma.user.findUnique({ where: { email: demoEmail } }) : null;
  const sponsorId = (demoMember ?? root).id; // every demo ID is a direct of the Demo Member (or of the admin when there is none)
  for (const m of TEAM) {
    const existing = await prisma.user.findUnique({ where: { email: m.email } });
    if (existing) continue;
    const created = await prisma.user.create({
      data: {
        name: m.name,
        email: m.email,
        passwordHash: await bcrypt.hash(password, 12),
        isVerified: false,
        referralCode: generateReferralCode(),
        ...generateSponsorCodes(),
        sponsorId,
        preferredLeg: 'RIGHT'
      }
    });
    await prisma.$transaction(
      async (tx) => {
        await placeMember(tx, created.id, sponsorId, 'RIGHT', { isVerified: true });
        await tx.user.update({
          where: { id: created.id },
          data: {
            package: m.pkg,
            activationBalance: 10000,
            txnPasswordHash: await bcrypt.hash(txn, 12),
            txnPasswordChangedAt: new Date(Date.now() - 3 * 86_400_000) // long enough ago that withdrawals are not paused
          }
        });
        await tx.activationEntry.create({ data: { userId: created.id, kind: 'FUND_ADDED', amount: 10000, note: 'Demo balance' } });
      },
      { timeout: 20_000 }
    );
    console.log(`Demo member created: ${m.email} (${m.pkg})`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
