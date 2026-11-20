/**
 * Creates the root account (top of both the sponsor tree and the binary tree).
 * Usage: npm run seed   (set ROOT_EMAIL / ROOT_PASSWORD in .env for real use)
 */
import bcrypt from 'bcrypt';
import { prisma } from './config/database';

async function main() {
  const email = (process.env.ROOT_EMAIL ?? 'admin@rwc.local').toLowerCase();
  const password = process.env.ROOT_PASSWORD ?? 'Admin12345';
  const referralCode = process.env.ROOT_REFERRAL_CODE ?? 'RWCROOT';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Root user already exists: ${email} (code ${existing.referralCode})`);
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
      referralCode
    }
  });
  console.log(`Root user created: ${user.email} | sponsor code: ${user.referralCode}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
