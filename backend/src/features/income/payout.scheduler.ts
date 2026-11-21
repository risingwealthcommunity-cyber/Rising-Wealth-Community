import { prisma } from '../../config/database';
import { closePayoutPeriod } from './income.service';

/** Members are in India: the payout week starts on Monday 00:00 Indian Standard Time (UTC+5:30, no daylight saving). */
const IST_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
/** One advisory lock for "closing a payout period", so two servers (or an admin click) can never close the same window twice. */
export const PAYOUT_LOCK = 7_301_002;

/** The most recent Monday 00:00 IST at or before `now`. */
export function istWeekStart(now: Date): Date {
  const shifted = now.getTime() + IST_MS;
  const dayStart = shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS);
  const dow = new Date(dayStart).getUTCDay(); // 0 = Sunday
  const sinceMonday = (dow + 6) % 7;
  return new Date(dayStart - sinceMonday * DAY_MS - IST_MS);
}

/**
 * Closes the payout window when a new week has started since the last one, and only if there was something sold.
 * Safe to call as often as you like: it does nothing until a Monday (IST) has passed with new sales.
 */
export async function closePayoutIfDue(now = new Date()): Promise<boolean> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PAYOUT_LOCK})`;
      const last = await tx.payoutPeriod.findFirst({ orderBy: { endsAt: 'desc' } });
      if (last && last.endsAt >= istWeekStart(now)) return false;

      const sales = await tx.packagePurchase.count({
        where: { status: 'CONFIRMED', confirmedAt: { gte: last?.endsAt ?? new Date(0), lt: now } }
      });
      if (sales === 0) return false;

      await closePayoutPeriod(tx, 'system');
      return true;
    },
    { timeout: 120_000, maxWait: 10_000 }
  );
}

/** Checks every half hour (and once at start-up). Turned on with AUTO_WEEKLY_PAYOUT=true, and on by default in production. */
export function startPayoutScheduler(everyMs = 30 * 60_000): () => void {
  const tick = () =>
    closePayoutIfDue()
      .then((done) => {
        if (done) console.log('Weekly payout period closed automatically');
      })
      .catch((err) => console.error('Automatic weekly payout failed:', err));
  void tick();
  const timer = setInterval(tick, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
