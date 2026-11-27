/**
 * One-time repair for a weekly payout window that was closed too early.
 *
 * Before the fix, a fresh server closed its very first payout window the moment it started (it counted every sale since the
 * beginning), so the sales of the week that was still running were swallowed and the new week showed 0.
 *
 * It only touches ONE period, and only when all of these are true: it is the only period there is, it was closed during the
 * running IST week, and no sale is older than this week's Monday. It refuses when any weekly bonus of that period was already
 * released to a wallet. By default it only PRINTS what it would do. Run with  --apply  to do it.
 *
 *   docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec api npx ts-node src/repair-weekly-window.ts
 *   docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec api npx ts-node src/repair-weekly-window.ts --apply
 */
import { prisma } from './config/database';
import { istWeekStart } from './features/income/payout.scheduler';

async function main() {
  const apply = process.argv.includes('--apply');
  const weekStart = istWeekStart(new Date());

  const periods = await prisma.payoutPeriod.findMany({ orderBy: { endsAt: 'desc' } });
  if (periods.length !== 1) {
    console.log(`Nothing to repair: there are ${periods.length} closed periods (this repair is only for the case of exactly one).`);
    return;
  }
  const period = periods[0];
  console.log(`Period ${period.id}: ${period.startsAt.toISOString()} to ${period.endsAt.toISOString()}, closed by ${period.closedBy}, revenue ${period.revenue}, weekly pool ${period.weeklyPool}.`);
  console.log(`This IST week started at ${weekStart.toISOString()}.`);

  if (period.endsAt < weekStart) {
    console.log('Not repaired: that period was closed in an earlier week, so it was closed on time.');
    return;
  }
  const older = await prisma.packagePurchase.count({ where: { status: 'CONFIRMED', confirmedAt: { lt: weekStart } } });
  if (older > 0) {
    console.log(`Not repaired: ${older} confirmed sale(s) are older than this week, so the period holds real earlier-week sales.`);
    return;
  }

  const released = await prisma.ledgerEntry.count({ where: { periodId: period.id, userId: { not: null } } });
  if (released > 0) {
    console.log(`Not repaired: ${released} bonus(es) of this period were already paid into wallets. Do not undo this by script.`);
    return;
  }
  const waiting = await prisma.pendingBonus.findMany({ where: { periodId: period.id }, select: { id: true, userId: true, amount: true, releasedAt: true } });
  const company = await prisma.ledgerEntry.findMany({ where: { periodId: period.id, userId: null }, select: { id: true, type: true, amount: true, note: true } });

  console.log(`Would delete: ${waiting.length} waiting weekly bonus(es), ${company.length} company-fund line(s), and the period itself.`);
  for (const w of waiting) console.log(`  waiting bonus ${w.id}: user ${w.userId}, amount ${w.amount}`);
  for (const c of company) console.log(`  company line ${c.id}: ${c.type} ${c.amount} ${c.note ?? ''}`);

  if (!apply) {
    console.log('Dry run only. Nothing was changed. Run again with --apply to do it.');
    return;
  }
  await prisma.$transaction([
    prisma.pendingBonus.deleteMany({ where: { periodId: period.id } }),
    prisma.ledgerEntry.deleteMany({ where: { periodId: period.id, userId: null } }),
    prisma.payoutPeriod.delete({ where: { id: period.id } })
  ]);
  console.log('Done. The running week is open again and counts all of its sales.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
