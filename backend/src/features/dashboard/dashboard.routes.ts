import { Router, Request, Response } from 'express';
import { prisma } from '../../config/database';
import { requireAuth } from '../auth';

const router = Router();

/** Members are in India: "today" and the chart buckets follow Indian Standard Time (UTC+5:30, no daylight saving). */
const IST_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const startOfIstDay = (d: Date) => {
  const shifted = d.getTime() + IST_MS;
  return shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS) - IST_MS;
};
const istDate = (ms: number) => new Date(ms + IST_MS);
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;

/** Money, as rupees (two decimals). Amounts are stored as Decimal; sums here stay far below float precision limits. */
const rupees = (n: number) => Math.round(n * 100) / 100;

router.get('/summary', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const now = new Date();
  const todayStart = startOfIstDay(now);
  const monthStart = todayStart - 29 * DAY_MS;

  const [me, recent, byType, teamRows] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, package: true, rank: true, referralCode: true, leftCode: true, rightCode: true, walletBalance: true }
    }),
    prisma.ledgerEntry.findMany({
      where: { userId, createdAt: { gte: new Date(monthStart) }, amount: { gt: 0 } },
      select: { amount: true, createdAt: true }
    }),
    prisma.ledgerEntry.groupBy({ by: ['type'], where: { userId }, _sum: { amount: true } }),
    prisma.$queryRaw<{ c: bigint }[]>`
      WITH RECURSIVE d AS (
        SELECT id FROM "User" WHERE "parentId" = ${userId}
        UNION ALL
        SELECT u.id FROM "User" u JOIN d ON u."parentId" = d.id
      )
      SELECT COUNT(*) AS c FROM d`
  ]);

  const sum = (from: number) =>
    rupees(recent.filter((r) => r.createdAt.getTime() >= from).reduce((s, r) => s + Number(r.amount), 0));

  // ---- charts
  const today = Array.from({ length: 8 }, (_, i) => ({ label: hourLabel(i * 3), amount: 0 }));
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = istDate(todayStart - (6 - i) * DAY_MS);
    return { label: `${DAYS[d.getUTCDay()]} ${d.getUTCDate()}`, amount: 0 };
  });
  const month = Array.from({ length: 6 }, (_, i) => {
    const d = istDate(monthStart + i * 5 * DAY_MS);
    return { label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`, amount: 0 };
  });
  for (const r of recent) {
    const t = r.createdAt.getTime();
    const amount = Number(r.amount);
    if (t >= todayStart) today[Math.floor(istDate(t).getUTCHours() / 3)].amount += amount;
    if (t >= todayStart - 6 * DAY_MS) week[Math.floor((t - (todayStart - 6 * DAY_MS)) / DAY_MS)].amount += amount;
    month[Math.min(5, Math.floor((t - monthStart) / (5 * DAY_MS)))].amount += amount;
  }
  const round = (rows: { label: string; amount: number }[]) => rows.map((r) => ({ ...r, amount: rupees(r.amount) }));

  const typeSum = (types: string[]) =>
    byType.filter((b) => types.includes(b.type)).reduce((s, b) => s + Number(b._sum.amount ?? 0), 0);
  const breakdown = byType
    .map((b) => ({ type: b.type, amount: rupees(Number(b._sum.amount ?? 0)) }))
    .filter((b) => b.amount > 0 && b.type !== 'COMPANY_FUND')
    .sort((a, b) => b.amount - a.amount);

  res.json({
    success: true,
    data: {
      profile: {
        name: me.name,
        package: me.package,
        rank: me.rank,
        affiliateId: me.referralCode,
        leftCode: me.leftCode,
        rightCode: me.rightCode
      },
      stats: {
        today: sum(todayStart),
        last7: sum(todayStart - 6 * DAY_MS),
        last30: sum(monthStart),
        passive: rupees(typeSum(['PASSIVE_INCOME', 'DEMAT_PASSIVE'])),
        total: rupees(breakdown.reduce((s, b) => s + b.amount, 0)),
        wallet: rupees(Number(me.walletBalance)),
        team: Number(teamRows[0]?.c ?? 0)
      },
      chart: { today: round(today), week: round(week), month: round(month) },
      breakdown
    }
  });
});

/** Top members by direct referrals. Only first name + last initial and rank are shown to other members. */
router.get('/leaderboard', requireAuth, async (req: Request, res: Response) => {
  const rows = await prisma.user.findMany({
    where: { isActive: true, isVerified: true, role: 'USER', referrals: { some: {} } },
    orderBy: [{ referrals: { _count: 'desc' } }, { createdAt: 'asc' }],
    take: 20,
    select: { id: true, name: true, rank: true, package: true, _count: { select: { referrals: true } } }
  });

  const short = (name: string) => {
    const [first, ...rest] = name.trim().split(/\s+/);
    const last = rest[rest.length - 1];
    return last ? `${first} ${last[0].toUpperCase()}.` : first;
  };

  res.json({
    success: true,
    data: {
      items: rows.map((r, i) => ({
        position: i + 1,
        name: short(r.name),
        rank: r.rank,
        package: r.package,
        directs: r._count.referrals,
        me: r.id === req.user!.id
      }))
    }
  });
});

export default router;
