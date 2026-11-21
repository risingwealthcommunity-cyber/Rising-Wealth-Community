/**
 * Creates the root account (top of both the sponsor tree and the binary tree).
 * Usage: npm run seed   (set ROOT_EMAIL / ROOT_PASSWORD in .env for real use)
 */
import bcrypt from 'bcrypt';
import { prisma } from './config/database';
import { generateSponsorCodes } from './features/auth/auth.tokens';

async function main() {
  const email = (process.env.ROOT_EMAIL ?? 'admin@rwc.local').toLowerCase();
  if (process.env.NODE_ENV === 'production' && !process.env.ROOT_PASSWORD) {
    throw new Error('Set ROOT_PASSWORD before seeding in production: the default password is public.');
  }
  const password = process.env.ROOT_PASSWORD ?? 'Admin12345';
  const referralCode = process.env.ROOT_REFERRAL_CODE ?? 'RWCROOT';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Root user already exists: ${email} (LEFT ${existing.leftCode ?? 'none yet'}, RIGHT ${existing.rightCode ?? 'none yet'})`);
    return;
  }

  const user = await prisma.user.create({
    data: {
      name: 'RWC Admin',
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: 'SUPER_ADMIN',
      package: 'ELITE',
      isVerified: true,
      referralCode,
      ...generateSponsorCodes()
    }
  });
  console.log(`Root user created: ${user.email} | LEFT code: ${user.leftCode} | RIGHT code: ${user.rightCode}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
