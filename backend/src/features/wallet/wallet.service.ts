import bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../shared/errors/AppError';
import { decryptField, encryptField } from '../../shared/crypto/field';
import { paiseToDecimal } from '../income/income.service';
import { storeFile } from '../../shared/storage';

const ROUNDS = process.env.NODE_ENV === 'test' ? 4 : 12;
const TX = { timeout: 30_000, maxWait: 10_000 };
const MAX_TXN_ATTEMPTS = 5;
const PAUSE_AFTER_PASSWORD_MS = 24 * 3_600_000;
const MAX_WAITING_WITHDRAWALS = 5;

/** Serialises work on one payment reference (a bank transaction ID) so it cannot be used twice by requests that race. */
const lockReference = (tx: Prisma.TransactionClient, ref: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ref.trim().toLowerCase()}, 11))`;
const TXN_LOCK_MS = 15 * 60_000;

/** Smallest withdrawal, in rupees. */
export const MIN_WITHDRAWAL = 300;
/** The smallest amount a member can add to the activation wallet in one request. */
export const MIN_FUND = 100;

const dec = (rupees: number) => paiseToDecimal(Math.round(rupees * 100));
const num = (d: Prisma.Decimal | null | undefined) => Number(d ?? 0);

/** Rupees as typed by a member: positive, at most 2 decimals, bounded. */
export function parseRupees(value: unknown, max = 10_000_000): number {
  const n = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(n) || n <= 0 || n > max || Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) {
    throw new AppError('Enter a valid amount (up to 2 decimals).', 400);
  }
  return Math.round(n * 100) / 100;
}

export const walletService = {
  // ------------------------------------------------------------------ transaction password

  /** Checks the transaction password. Failed guesses are counted outside any money transaction so they always stick. */
  async verifyTxnPassword(userId: string, password: string): Promise<void> {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { txnPasswordHash: true, txnLockedUntil: true }
    });
    const now = new Date();
    if (user.txnLockedUntil) {
      if (user.txnLockedUntil > now) throw new AppError('Too many wrong attempts. Try your transaction password again in a few minutes.', 429);
      // the lock has run out: start counting from zero again
      await prisma.user.updateMany({ where: { id: userId, txnLockedUntil: { lte: now } }, data: { txnFailedAttempts: 0, txnLockedUntil: null } });
    }
    if (!user.txnPasswordHash) throw new AppError('Set a transaction password first (My profile > Security).', 400);

    const lock = () => prisma.user.update({ where: { id: userId }, data: { txnLockedUntil: new Date(Date.now() + TXN_LOCK_MS) } });
    const lockedError = () => new AppError('Too many wrong attempts. Your transaction password is locked for 15 minutes.', 429);

    // Every try is counted first, atomically, and the counter stays above the limit while locked, so guesses sent in
    // parallel cannot get extra tries. A correct password resets it.
    const tried = await prisma.user.update({ where: { id: userId }, data: { txnFailedAttempts: { increment: 1 } }, select: { txnFailedAttempts: true } });
    if (tried.txnFailedAttempts > MAX_TXN_ATTEMPTS) {
      await lock();
      throw lockedError();
    }
    if (typeof password === 'string' && (await bcrypt.compare(password, user.txnPasswordHash))) {
      await prisma.user.update({ where: { id: userId }, data: { txnFailedAttempts: 0, txnLockedUntil: null } });
      return;
    }
    if (tried.txnFailedAttempts >= MAX_TXN_ATTEMPTS) {
      await lock();
      throw lockedError();
    }
    throw new AppError('Wrong transaction password.', 401);
  },

  /**
   * Sets or changes the transaction password. Proof of identity: the login password if the account has one,
   * otherwise the current transaction password (a Google-only account setting it for the first time needs neither).
   */
  async setTxnPassword(userId: string, input: { newPassword: string; loginPassword?: string; currentTxnPassword?: string }) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true, txnPasswordHash: true }
    });
    if (user.passwordHash) {
      if (!input.loginPassword || !(await bcrypt.compare(input.loginPassword, user.passwordHash))) {
        throw new AppError('Your login password is wrong.', 401);
      }
    } else if (user.txnPasswordHash) {
      await this.verifyTxnPassword(userId, input.currentTxnPassword ?? '');
    }
    await prisma.user.update({
      where: { id: userId },
      data: { txnPasswordHash: await bcrypt.hash(input.newPassword, ROUNDS), txnFailedAttempts: 0, txnLockedUntil: null, txnPasswordChangedAt: new Date() }
    });
  },

  // ------------------------------------------------------------------ balances

  async summary(userId: string) {
    const [user, earned, paid, pending] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalance: true, activationBalance: true, txnPasswordHash: true } }),
      prisma.ledgerEntry.aggregate({ where: { userId, amount: { gt: 0 } }, _sum: { amount: true } }),
      prisma.ledgerEntry.aggregate({ where: { userId, type: 'WITHDRAWAL' }, _sum: { amount: true } }),
      prisma.withdrawalRequest.aggregate({ where: { userId, status: 'PENDING' }, _sum: { amount: true } })
    ]);
    const balance = num(user.walletBalance);
    const reserved = num(pending._sum.amount);
    return {
      totalEarned: num(earned._sum.amount),
      totalPaid: Math.abs(num(paid._sum.amount)),
      balance,
      pendingWithdrawals: reserved,
      available: Math.max(0, Math.round((balance - reserved) * 100) / 100),
      activationBalance: num(user.activationBalance),
      hasTxnPassword: Boolean(user.txnPasswordHash)
    };
  },

  async available(tx: Prisma.TransactionClient, userId: string): Promise<number> {
    const [u, pending] = await Promise.all([
      tx.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalance: true } }),
      tx.withdrawalRequest.aggregate({ where: { userId, status: 'PENDING' }, _sum: { amount: true } })
    ]);
    return Math.round((num(u.walletBalance) - num(pending._sum.amount)) * 100) / 100;
  },

  // ------------------------------------------------------------------ wallet -> activation wallet

  async transferToActivation(userId: string, rupees: number, txnPassword: string) {
    await this.verifyTxnPassword(userId, txnPassword);
    await prisma.$transaction(async (tx) => {
      if ((await this.available(tx, userId)) < rupees) throw new AppError('Not enough available balance in your wallet.', 400);
      const taken = await tx.user.updateMany({
        where: { id: userId, walletBalance: { gte: dec(rupees) } },
        data: { walletBalance: { decrement: dec(rupees) }, activationBalance: { increment: dec(rupees) } }
      });
      if (taken.count !== 1) throw new AppError('Not enough available balance in your wallet.', 400);
      await tx.ledgerEntry.create({ data: { userId, type: 'WALLET_TRANSFER', amount: dec(-rupees), note: 'Moved to activation wallet' } });
      await tx.activationEntry.create({ data: { userId, kind: 'TRANSFER_IN', amount: dec(rupees), note: 'From main wallet' } });
    }, TX);
  },

  // ------------------------------------------------------------------ add fund (activation wallet)

  async createFundRequest(userId: string, rupees: number, reference: string, file: { data: Buffer; mime: string; name: string }) {
    if (rupees < MIN_FUND) throw new AppError(`The smallest amount you can add is Rs ${MIN_FUND}.`, 400);
    const open = await prisma.fundRequest.count({ where: { userId, status: 'PENDING' } });
    if (open >= 3) throw new AppError('You already have 3 requests waiting. Please wait for them to be checked.', 409);
    const used = await prisma.fundRequest.findFirst({
      where: { reference: { equals: reference.trim(), mode: 'insensitive' }, status: { in: ['PENDING', 'APPROVED'] } }
    });
    if (used) throw new AppError('That payment reference was already submitted.', 409);
    const fileData = await storeFile(file.data, file.mime, 'funds');
    return prisma.fundRequest.create({
      data: { userId, amount: dec(rupees), reference: reference.trim(), fileName: file.name, fileMime: file.mime, fileData },
      select: { id: true }
    });
  },

  async approveFund(id: string, adminId: string) {
    const own = await prisma.fundRequest.findUnique({ where: { id }, select: { userId: true, reference: true } });
    if (own?.userId === adminId) throw new AppError('You cannot approve your own request. Ask another admin.', 403);
    await prisma.$transaction(async (tx) => {
      if (own) await lockReference(tx, own.reference);
      if (own && (await tx.fundRequest.count({ where: { reference: { equals: own.reference, mode: 'insensitive' }, status: 'APPROVED' } })) > 0) {
        throw new AppError('This payment reference was already credited.', 409);
      }
      const claimed = await tx.fundRequest.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'APPROVED', processedAt: new Date(), processedBy: adminId } });
      if (claimed.count !== 1) throw new AppError('Request not found or already processed', 409);
      const r = await tx.fundRequest.findUniqueOrThrow({ where: { id } });
      await tx.user.update({ where: { id: r.userId }, data: { activationBalance: { increment: r.amount } } });
      await tx.activationEntry.create({ data: { userId: r.userId, kind: 'FUND_ADDED', amount: r.amount, note: `Fund added (ref ${r.reference})` } });
    }, TX);
  },

  async rejectFund(id: string, adminId: string, note?: string) {
    const res = await prisma.fundRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'REJECTED', processedAt: new Date(), processedBy: adminId, note: note || null }
    });
    if (res.count !== 1) throw new AppError('Request not found or already processed', 409);
  },

  // ------------------------------------------------------------------ withdrawals

  /** Withdrawals and bank changes wait 24 hours after the transaction password was set or changed. */
  async assertNotJustChanged(userId: string) {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { txnPasswordChangedAt: true } });
    if (u.txnPasswordChangedAt && Date.now() - u.txnPasswordChangedAt.getTime() < PAUSE_AFTER_PASSWORD_MS) {
      throw new AppError('For your safety, withdrawals and bank changes are paused for 24 hours after the transaction password is set or changed.', 403);
    }
  },

  async createWithdrawal(userId: string, rupees: number, txnPassword: string) {
    if (rupees < MIN_WITHDRAWAL) throw new AppError(`The smallest withdrawal is Rs ${MIN_WITHDRAWAL}.`, 400);
    await this.assertNotJustChanged(userId);
    const bank = await prisma.bankDetails.findUnique({ where: { userId } });
    if (!bank) throw new AppError('Add your bank details in My profile first, so we know where to pay.', 400);
    await this.verifyTxnPassword(userId, txnPassword);
    return prisma.$transaction(async (tx) => {
      // one request at a time per member: the balance check and the insert cannot interleave
      await tx.$executeRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      if ((await tx.withdrawalRequest.count({ where: { userId, status: 'PENDING' } })) >= MAX_WAITING_WITHDRAWALS) {
        throw new AppError(`You already have ${MAX_WAITING_WITHDRAWALS} withdrawals waiting. Please wait for them to be paid.`, 409);
      }
      if ((await this.available(tx, userId)) < rupees) throw new AppError('That is more than your available balance.', 400);
      return tx.withdrawalRequest.create({ data: { userId, amount: dec(rupees) } });
    }, TX);
  },

  /**
   * An admin approves after paying the member: only now does the money leave the wallet. The admin records the bank
   * transaction ID and a screenshot of the payment, so there is proof of every payout (the member can see it too).
   */
  async approveWithdrawal(id: string, adminId: string, payout: { reference: string; file: { data: Buffer; mime: string; name: string } }) {
    const own = await prisma.withdrawalRequest.findUnique({ where: { id }, select: { userId: true } });
    if (own?.userId === adminId) throw new AppError('You cannot approve your own withdrawal. Ask another admin.', 403);
    const reference = payout.reference.trim();
    const payoutFile = await storeFile(payout.file.data, payout.file.mime, 'payouts');
    await prisma.$transaction(async (tx) => {
      await lockReference(tx, reference);
      const reused = await tx.withdrawalRequest.findFirst({ where: { payoutRef: { equals: reference, mode: 'insensitive' }, status: 'APPROVED' }, select: { id: true } });
      if (reused) throw new AppError('That transaction ID was already used for another withdrawal.', 409);
      const claimed = await tx.withdrawalRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'APPROVED',
          inProgress: false,
          note: null,
          processedAt: new Date(),
          processedBy: adminId,
          payoutRef: reference,
          fileName: payout.file.name,
          fileMime: payout.file.mime,
          fileData: payoutFile
        }
      });
      if (claimed.count !== 1) throw new AppError('Request not found or already processed', 409);
      const r = await tx.withdrawalRequest.findUniqueOrThrow({ where: { id } });
      const taken = await tx.user.updateMany({ where: { id: r.userId, walletBalance: { gte: r.amount } }, data: { walletBalance: { decrement: r.amount } } });
      if (taken.count !== 1) throw new AppError('The wallet no longer holds this amount.', 409);
      await tx.ledgerEntry.create({ data: { userId: r.userId, type: 'WITHDRAWAL', amount: r.amount.neg(), note: 'Withdrawal paid' } });
    }, TX);
  },

  /** Moves a waiting withdrawal to "Processing" (with an optional message for the member) or back to waiting. */
  async setWithdrawalProgress(id: string, on: boolean, note?: string) {
    const res = await prisma.withdrawalRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { inProgress: on, note: on ? note || null : null }
    });
    if (res.count !== 1) throw new AppError('Only a withdrawal that is still waiting can change state.', 409);
  },

  /**
   * An admin pays a member part or all of their wallet from the Users page, with the bank transaction ID and screenshot.
   * It is recorded as a paid withdrawal, so the member sees it in their history like any other payout.
   */
  async payMember(memberId: string, adminId: string, rupees: number, payout: { reference: string; file: { data: Buffer; mime: string; name: string } }) {
    if (memberId === adminId) throw new AppError('You cannot pay out your own wallet. Ask another admin.', 403);
    const reference = payout.reference.trim();
    const payoutFile = await storeFile(payout.file.data, payout.file.mime, 'payouts');
    return prisma.$transaction(async (tx) => {
      await lockReference(tx, reference);
      const reused = await tx.withdrawalRequest.findFirst({ where: { payoutRef: { equals: reference, mode: 'insensitive' }, status: 'APPROVED' }, select: { id: true } });
      if (reused) throw new AppError('That transaction ID was already used for another payment.', 409);
      const member = await tx.user.findFirst({ where: { id: memberId, role: 'USER' }, select: { id: true } });
      if (!member) throw new AppError('Member not found', 404);
      if ((await this.available(tx, memberId)) < rupees) throw new AppError('That is more than the member has available (money reserved for waiting withdrawals is not counted).', 400);
      const taken = await tx.user.updateMany({ where: { id: memberId, walletBalance: { gte: dec(rupees) } }, data: { walletBalance: { decrement: dec(rupees) } } });
      if (taken.count !== 1) throw new AppError('The wallet no longer holds this amount.', 409);
      const w = await tx.withdrawalRequest.create({
        data: {
          userId: memberId,
          amount: dec(rupees),
          status: 'APPROVED',
          processedAt: new Date(),
          processedBy: adminId,
          payoutRef: reference,
          fileName: payout.file.name,
          fileMime: payout.file.mime,
          fileData: payoutFile,
          note: null
        },
        select: { id: true }
      });
      await tx.ledgerEntry.create({ data: { userId: memberId, type: 'WITHDRAWAL', amount: dec(-rupees), note: 'Paid by admin' } });
      return w;
    }, TX);
  },

  async rejectWithdrawal(id: string, adminId: string, note?: string) {
    const res = await prisma.withdrawalRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'REJECTED', inProgress: false, processedAt: new Date(), processedBy: adminId, note: note || null }
    });
    if (res.count !== 1) throw new AppError('Request not found or already processed', 409);
  },

  // ------------------------------------------------------------------ bank details

  async bankMasked(userId: string) {
    const b = await prisma.bankDetails.findUnique({ where: { userId } });
    if (!b) return null;
    const acct = decryptField(b.accountEnc);
    return { bankName: b.bankName, account: `${'•'.repeat(Math.max(0, acct.length - 4))}${acct.slice(-4)}`, ifsc: b.ifsc, upiId: b.upiId ? b.upiId.replace(/^(.{2}).*(@.*)$/, '$1•••$2') : '' };
  },

  async bankFull(userId: string, txnPassword: string) {
    await this.verifyTxnPassword(userId, txnPassword);
    const b = await prisma.bankDetails.findUnique({ where: { userId } });
    return b && { bankName: b.bankName, account: decryptField(b.accountEnc), ifsc: b.ifsc, upiId: b.upiId };
  },

  async saveBank(userId: string, input: { bankName: string; accountNumber: string; ifsc: string; upiId: string }, txnPassword: string) {
    await this.assertNotJustChanged(userId);
    await this.verifyTxnPassword(userId, txnPassword);
    const data = { bankName: input.bankName, accountEnc: encryptField(input.accountNumber), ifsc: input.ifsc, upiId: input.upiId };
    await prisma.bankDetails.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  },

  /** For admins paying a withdrawal. */
  async bankForAdmin(userId: string) {
    const b = await prisma.bankDetails.findUnique({ where: { userId } });
    return b && { bankName: b.bankName, account: decryptField(b.accountEnc), ifsc: b.ifsc, upiId: b.upiId };
  }
};
