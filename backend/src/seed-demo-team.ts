/**
 * Four ready members, all direct members of the admin (root) on the admin's RIGHT leg, so the admin can test the income distribution:
 *
 *   admin (root) -> Demo One (ELITE), Demo Two (ELITE), Demo Three (PRO), Demo Four (TRAINEE)
 *
 * Everyone has Rs 10,000 in the activation wallet and a transaction password, so they can activate each other or upgrade themselves. Set DEMO_TEAM_PASSWORD (at least 10 characters; the password lives only
 * in the server settings), and optionally DEMO_TEAM_TXN for the transaction password (it defaults to the same). Safe to run again.
 * Does nothing when DEMO_TEAM_PASSWORD is empty.
 */
import bcrypt from 'bcrypt';
import { Package } from '@prisma/client';
import { prisma } from './config/database';
import { generateReferralCode, generateSponsorCodes } from './features/auth/auth.tokens';
import { placeMember } from './features/auth/auth.placement';

const TEAM: { email: string; name: string; pkg: Package }[] = [
  { email: 'demo.one@rwcdemo.com', name: 'Demo One', pkg: 'ELITE' },
  { email: 'demo.two@rwcdemo.com', name: 'Demo Two', pkg: 'ELITE' },
  { email: 'demo.three@rwcdemo.com', name: 'Demo Three', pkg: 'PRO' },
  { email: 'demo.four@rwcdemo.com', name: 'Demo Four', pkg: 'TRAINEE' }
];

async function main() {
  const password = process.env.DEMO_TEAM_PASSWORD ?? '';
  if (!password) return;
  if (password.length < 10) throw new Error('DEMO_TEAM_PASSWORD must be at least 10 characters.');
  const txn = process.env.DEMO_TEAM_TXN || password;
  const root = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!root) throw new Error('Create the admin first (seed), then the demo team.');

  const sponsorId = root.id; // every demo member is a direct of the admin
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
