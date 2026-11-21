import { prisma } from '../../config/database';
import { AppError } from '../../shared/errors/AppError';
import { distributePackageSale, paiseToDecimal } from '../income/income.service';
import { PACKAGE_PRICE_PAISE, PACKAGE_TIER, type PaidPackage } from '../income/plan.config';

const TX_OPTIONS = { timeout: 60_000, maxWait: 10_000 };

export const packagesService = {
  prices: () => ({
    PRO: PACKAGE_PRICE_PAISE.PRO / 100,
    ELITE: PACKAGE_PRICE_PAISE.ELITE / 100
  }),

  /** User asks for a package. The full price is always required (no partial upgrades). */
  async createPurchase(userId: string, pkg: PaidPackage, reference?: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('User not found', 404);

    if (PACKAGE_TIER[pkg] <= PACKAGE_TIER[user.package]) {
      throw new AppError(`You already have ${user.package}. Choose a higher package.`, 400);
    }

    const pending = await prisma.packagePurchase.findFirst({ where: { userId, status: 'PENDING' } });
    if (pending) throw new AppError('You already have a purchase awaiting confirmation', 409);

    return prisma.packagePurchase.create({
      data: { userId, package: pkg, amount: paiseToDecimal(PACKAGE_PRICE_PAISE[pkg]), reference }
    });
  },

  listMine: (userId: string) =>
    prisma.packagePurchase.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),

  listForAdmin: (status: 'PENDING' | 'CONFIRMED' | 'REJECTED') =>
    prisma.packagePurchase.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { user: { select: { id: true, name: true, email: true, package: true, referralCode: true } } }
    }),

  /** Admin verified the payment: activate the package and run the whole income plan atomically. */
  async confirm(purchaseId: string, adminId: string) {
    return prisma.$transaction(async (tx) => {
      // Atomic claim: only one request can move PENDING -> CONFIRMED.
      const claimed = await tx.packagePurchase.updateMany({
        where: { id: purchaseId, status: 'PENDING' },
        data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmedBy: adminId }
      });
      if (claimed.count !== 1) throw new AppError('Purchase not found or already processed', 409);

      const purchase = await tx.packagePurchase.findUniqueOrThrow({ where: { id: purchaseId } });
      const buyer = await tx.user.findUniqueOrThrow({ where: { id: purchase.userId } });
      const pkg = purchase.package as PaidPackage;

      if (PACKAGE_TIER[pkg] <= PACKAGE_TIER[buyer.package]) {
        throw new AppError('User already has this package or higher', 409);
      }

      await tx.user.update({ where: { id: buyer.id }, data: { package: pkg } });

      await distributePackageSale(tx, {
        purchaseId,
        buyerId: buyer.id,
        sponsorId: buyer.sponsorId,
        package: pkg
      });

      return tx.packagePurchase.findUniqueOrThrow({ where: { id: purchaseId } });
    }, TX_OPTIONS);
  },

  /**
   * Pays for a package out of the payer's activation wallet, for themselves or for someone in their downline.
   * Confirmed on the spot: the same income plan runs as for an admin-confirmed purchase.
   */
  async activateFromWallet(payerId: string, targetAffiliateId: string, pkg: PaidPackage) {
    const payer = await prisma.user.findUniqueOrThrow({ where: { id: payerId }, select: { id: true, referralCode: true } });
    const code = targetAffiliateId.trim().toUpperCase();

    let target = await prisma.user.findUnique({ where: { referralCode: code } });
    if (!target || !target.isVerified || !target.isActive) throw new AppError('No active member has that Affiliate ID.', 404);
    if (target.id !== payer.id) {
      const inside = await prisma.$queryRaw<{ c: bigint }[]>`
        WITH RECURSIVE d AS (
          SELECT id FROM "User" WHERE "parentId" = ${payer.id}
          UNION ALL
          SELECT u.id FROM "User" u JOIN d ON u."parentId" = d.id
        )
        SELECT COUNT(*) AS c FROM d WHERE id = ${target.id}`;
      if (Number(inside[0]?.c ?? 0) === 0) throw new AppError('You can only activate yourself or members in your own team.', 403);
    }
    const buyer = target;
    const price = PACKAGE_PRICE_PAISE[pkg];

    return prisma.$transaction(async (tx) => {
      const fresh = await tx.user.findUniqueOrThrow({ where: { id: buyer.id } });
      if (PACKAGE_TIER[pkg] <= PACKAGE_TIER[fresh.package]) throw new AppError(`${fresh.name} already has ${fresh.package} or higher.`, 409);
      if (await tx.packagePurchase.findFirst({ where: { userId: buyer.id, status: 'PENDING' } })) {
        throw new AppError('That member already has a purchase waiting for confirmation.', 409);
      }

      const paid = await tx.user.updateMany({
        where: { id: payer.id, activationBalance: { gte: paiseToDecimal(price) } },
        data: { activationBalance: { decrement: paiseToDecimal(price) } }
      });
      if (paid.count !== 1) throw new AppError('Not enough money in your activation wallet.', 400);
      await tx.activationEntry.create({
        data: {
          userId: payer.id,
          kind: 'SPEND',
          amount: paiseToDecimal(-price),
          note: buyer.id === payer.id ? `Upgraded own ID to ${pkg}` : `Activated ${pkg} for ${buyer.name}`
        }
      });

      const purchase = await tx.packagePurchase.create({
        data: {
          userId: buyer.id,
          package: pkg,
          amount: paiseToDecimal(price),
          status: 'CONFIRMED',
          reference: 'ACTIVATION_WALLET',
          confirmedAt: new Date(),
          confirmedBy: payer.id
        }
      });
      await tx.user.update({ where: { id: buyer.id }, data: { package: pkg } });
      await distributePackageSale(tx, { purchaseId: purchase.id, buyerId: buyer.id, sponsorId: fresh.sponsorId, package: pkg });
      return { purchaseId: purchase.id, memberName: buyer.name, package: pkg };
    }, TX_OPTIONS);
  },

  async reject(purchaseId: string, adminId: string) {
    const res = await prisma.packagePurchase.updateMany({
      where: { id: purchaseId, status: 'PENDING' },
      data: { status: 'REJECTED', confirmedAt: new Date(), confirmedBy: adminId }
    });
    if (res.count !== 1) throw new AppError('Purchase not found or already processed', 409);
  }
};
