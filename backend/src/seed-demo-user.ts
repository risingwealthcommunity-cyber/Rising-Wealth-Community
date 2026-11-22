/**
 * A ready member account for people who are shown the app, so they can look around without signing up.
 * Set DEMO_USER_EMAIL and DEMO_USER_PASSWORD (the password lives only in the server's settings, never in the code).
 * It creates a verified Trainee under the root account with Rs 5,000 in the activation wallet, so the upgrade request can be tried.
 * Safe to run again: it does nothing if the account exists. Does nothing at all when the two settings are empty.
 */
import bcrypt from 'bcrypt';
import { prisma } from './config/database';
import { generateReferralCode, generateSponsorCodes } from './features/auth/auth.tokens';
import { placeMember } from './features/auth/auth.placement';

async function main() {
  const email = (process.env.DEMO_USER_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.DEMO_USER_PASSWORD ?? '';
  if (!email || !password) return;
  if (password.length < 10) throw new Error('DEMO_USER_PASSWORD must be at least 10 characters.');
  if (await prisma.user.findUnique({ where: { email } })) {
    console.log(`Demo member already exists: ${email}`);
    return;
  }
  const root = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!root) throw new Error('Create the admin first (seed), then the demo member.');

  const created = await prisma.user.create({
    data: {
      name: 'Demo Member',
      email,
      passwordHash: await bcrypt.hash(password, 12),
      isVerified: false,
      referralCode: generateReferralCode(),
      ...generateSponsorCodes(),
      sponsorId: root.id,
      preferredLeg: 'LEFT'
    }
  });
  await prisma.$transaction(
    async (tx) => {
      await placeMember(tx, created.id, root.id, 'LEFT', { isVerified: true });
      await tx.user.update({ where: { id: created.id }, data: { activationBalance: 5000 } });
      await tx.activationEntry.create({ data: { userId: created.id, kind: 'FUND_ADDED', amount: 5000, note: 'Demo balance' } });
    },
    { timeout: 20_000 }
  );
  console.log(`Demo member created: ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
