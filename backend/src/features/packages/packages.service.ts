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

  async reject(purchaseId: string, adminId: string) {
    const res = await prisma.packagePurchase.updateMany({
      where: { id: purchaseId, status: 'PENDING' },
      data: { status: 'REJECTED', confirmedAt: new Date(), confirmedBy: adminId }
    });
    if (res.count !== 1) throw new AppError('Purchase not found or already processed', 409);
  }
};
