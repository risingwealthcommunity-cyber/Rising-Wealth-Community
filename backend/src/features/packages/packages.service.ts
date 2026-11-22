import type { Package } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../shared/errors/AppError';
import { distributePackageSale, paiseToDecimal } from '../income/income.service';
import { PACKAGE_PRICE_PAISE, PACKAGE_TIER, type PaidPackage } from '../income/plan.config';

/** Packages a member may be on for an upgrade to the key to still be an upgrade. */
const LOWER_THAN: Record<PaidPackage, Package[]> = { PRO: ['TRAINEE'], ELITE: ['TRAINEE', 'PRO'] };

/** Purchase columns that are safe to send around. The payment screenshot is only ever served by its own endpoint. */
const PURCHASE_FIELDS = { id: true, userId: true, package: true, amount: true, status: true, reference: true, paidFromWallet: true, createdAt: true, confirmedAt: true, confirmedBy: true } as const;

const TX_OPTIONS = { timeout: 60_000, maxWait: 10_000 };

export const packagesService = {
  prices: () => ({
    PRO: PACKAGE_PRICE_PAISE.PRO / 100,
    ELITE: PACKAGE_PRICE_PAISE.ELITE / 100
  }),

  /** User asks for a package. The full price is always required (no partial upgrades). */
  async createPurchase(userId: string, pkg: PaidPackage, reference: string, file: { data: Buffer; mime: string; name: string }) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('User not found', 404);

    if (PACKAGE_TIER[pkg] <= PACKAGE_TIER[user.package]) {
      throw new AppError(`You already have ${user.package}. Choose a higher package.`, 400);
    }

    const pending = await prisma.packagePurchase.findFirst({ where: { userId, status: 'PENDING' } });
    if (pending) throw new AppError('You already have a purchase awaiting confirmation', 409);

    const used = await prisma.packagePurchase.findFirst({
      where: { reference: { equals: reference.trim(), mode: 'insensitive' }, status: { in: ['PENDING', 'CONFIRMED'] } }
    });
    if (used) throw new AppError('That transaction ID was already submitted.', 409);

    return prisma.packagePurchase.create({
      data: { userId, package: pkg, amount: paiseToDecimal(PACKAGE_PRICE_PAISE[pkg]), reference: reference.trim(), fileName: file.name, fileMime: file.mime, fileData: file.data },
      select: PURCHASE_FIELDS
    });
  },

  listMine: (userId: string) =>
    prisma.packagePurchase.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, select: PURCHASE_FIELDS }),

  /**
   * The member asks to move up a package and pay from their activation wallet. Nothing is taken now: the price leaves the
   * wallet when an admin approves, and the request can only be made while the wallet already holds the price.
   */
  async requestWithWallet(userId: string, pkg: PaidPackage) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (PACKAGE_TIER[pkg] <= PACKAGE_TIER[user.package]) throw new AppError(`You already have ${user.package}. Choose a higher package.`, 400);
    if (await prisma.packagePurchase.findFirst({ where: { userId, status: 'PENDING' } })) throw new AppError('You already have an upgrade waiting for approval.', 409);
    const price = paiseToDecimal(PACKAGE_PRICE_PAISE[pkg]);
    if (user.activationBalance.lt(price)) {
      throw new AppError(`Your activation wallet needs ${price.toFixed(2)} for ${pkg}. Add money to it first (Wallet > Add fund, or move money from your wallet).`, 400);
    }
    return prisma.packagePurchase.create({
      data: { userId, package: pkg, amount: price, reference: 'ACTIVATION_WALLET', paidFromWallet: true },
      select: PURCHASE_FIELDS
    });
  },

  async listForAdmin(status: 'PENDING' | 'CONFIRMED' | 'REJECTED') {
    const rows = await prisma.packagePurchase.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        ...PURCHASE_FIELDS,
        fileMime: true,
        user: { select: { id: true, name: true, email: true, package: true, referralCode: true, activationBalance: true } }
      }
    });
    return rows.map(({ fileMime, user, ...r }) => ({
      ...r,
      hasProof: Boolean(fileMime),
      user: { ...user, activationBalance: user.activationBalance.toFixed(2) }
    }));
  },

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

      if (buyer.id === adminId) throw new AppError('You cannot approve your own upgrade. Ask another admin.', 403);
      if (PACKAGE_TIER[pkg] <= PACKAGE_TIER[buyer.package]) {
        throw new AppError('User already has this package or higher', 409);
      }

      // a wallet request: the price leaves the member's activation wallet now (and the whole approval is undone if it cannot)
      if (purchase.paidFromWallet) {
        const paid = await tx.user.updateMany({
          where: { id: buyer.id, activationBalance: { gte: purchase.amount } },
          data: { activationBalance: { decrement: purchase.amount } }
        });
        if (paid.count !== 1) throw new AppError("The member's activation wallet no longer holds the price of this package.", 409);
        await tx.activationEntry.create({ data: { userId: buyer.id, kind: 'SPEND', amount: purchase.amount.neg(), note: `Upgrade to ${pkg} approved` } });
      }

      const upgraded = await tx.user.updateMany({ where: { id: buyer.id, package: { in: LOWER_THAN[pkg] } }, data: { package: pkg } });
      if (upgraded.count !== 1) throw new AppError('That member already has this package or higher.', 409);

      await distributePackageSale(tx, {
        purchaseId,
        buyerId: buyer.id,
        sponsorId: buyer.sponsorId,
        package: pkg
      });

      return tx.packagePurchase.findUniqueOrThrow({ where: { id: purchaseId }, select: PURCHASE_FIELDS });
    }, TX_OPTIONS);
  },

  /**
   * Pays for a package out of the payer's activation wallet, for themselves or for someone in their downline.
   * Confirmed on the spot: the same income plan runs as for an admin-confirmed purchase.
   */
  async activateFromWallet(payerId: string, targetAffiliateId: string, pkg: PaidPackage) {
    const payer = await prisma.user.findUniqueOrThrow({ where: { id: payerId }, select: { id: true, referralCode: true } });
    const code = targetAffiliateId.trim().toUpperCase();
    if (code === payer.referralCode.toUpperCase()) throw new AppError('To upgrade your own ID, send an upgrade request. An admin approves it.', 400);

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
      const upgraded = await tx.user.updateMany({ where: { id: buyer.id, package: { in: LOWER_THAN[pkg] } }, data: { package: pkg } });
      if (upgraded.count !== 1) throw new AppError('That member already has this package or higher.', 409);
      await distributePackageSale(tx, { purchaseId: purchase.id, buyerId: buyer.id, sponsorId: fresh.sponsorId, package: pkg });
      return { purchaseId: purchase.id, memberName: buyer.name, package: pkg };
    }, TX_OPTIONS);
  },

  /**
   * An admin moves a member up a package. WALLET takes the price from the member's activation wallet. MANUAL is for a
   * payment received outside the app (the reference is kept on the record). Either way the whole income plan runs.
   */
  async adminUpgrade(adminId: string, memberId: string, pkg: PaidPackage, mode: 'WALLET' | 'MANUAL', reference?: string) {
    const price = PACKAGE_PRICE_PAISE[pkg];
    return prisma.$transaction(async (tx) => {
      const buyer = await tx.user.findFirst({ where: { id: memberId, role: 'USER' } });
      if (!buyer) throw new AppError('Member not found', 404);
      if (PACKAGE_TIER[pkg] <= PACKAGE_TIER[buyer.package]) throw new AppError(`${buyer.name} already has ${buyer.package} or higher.`, 409);
      if (await tx.packagePurchase.findFirst({ where: { userId: buyer.id, status: 'PENDING' } })) {
        throw new AppError('This member has an upgrade waiting. Approve or reject it first.', 409);
      }

      if (mode === 'WALLET') {
        const paid = await tx.user.updateMany({ where: { id: buyer.id, activationBalance: { gte: paiseToDecimal(price) } }, data: { activationBalance: { decrement: paiseToDecimal(price) } } });
        if (paid.count !== 1) throw new AppError("The member's activation wallet does not hold the price of this package.", 400);
        await tx.activationEntry.create({ data: { userId: buyer.id, kind: 'SPEND', amount: paiseToDecimal(-price), note: `Upgraded to ${pkg} by admin` } });
      }

      const purchase = await tx.packagePurchase.create({
        data: {
          userId: buyer.id,
          package: pkg,
          amount: paiseToDecimal(price),
          status: 'CONFIRMED',
          reference: mode === 'WALLET' ? 'ACTIVATION_WALLET (admin)' : `ADMIN: ${(reference ?? '').trim()}`,
          paidFromWallet: mode === 'WALLET',
          confirmedAt: new Date(),
          confirmedBy: adminId
        }
      });
      const upgraded = await tx.user.updateMany({ where: { id: buyer.id, package: { in: LOWER_THAN[pkg] } }, data: { package: pkg } });
      if (upgraded.count !== 1) throw new AppError('That member already has this package or higher.', 409);
      await distributePackageSale(tx, { purchaseId: purchase.id, buyerId: buyer.id, sponsorId: buyer.sponsorId, package: pkg });
      return { memberName: buyer.name, package: pkg };
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
