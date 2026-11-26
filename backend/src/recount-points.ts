/**
 * One-time fix after the points rule (Trainee 0, PRO 0.5, ELITE 1) came in: before it, every placed member counted as one, Trainees
 * included. This recounts each member's fresh Team Performance points (left and right) and Leadership points from the packages the
 * members have TODAY. Targets that were already paid stay paid; nothing is paid or taken back here. It runs once (it leaves a marker
 * in the site settings) and is safe to start again.
 */
import { prisma } from './config/database';
import { bonusRewards } from './features/income/income.service';
import { PACKAGE_POINTS } from './features/income/team.growth';

async function main() {
  const marker = await prisma.siteSetting.findUnique({ where: { key: 'pointsRecount3' } });
  if (marker) return;

  // The demo account only: its targets were completed with Trainees counted, so they start again (nobody real is touched).
  const demoEmail = (process.env.DEMO_USER_EMAIL ?? '').trim().toLowerCase();
  if (demoEmail) await prisma.user.updateMany({ where: { email: demoEmail }, data: { teamTargetsDone: 0 } });
  // and the Team Performance / Leadership bonuses of that account still waiting for a Release (earned while Trainees counted)
  if (demoEmail) await prisma.pendingBonus.deleteMany({ where: { releasedAt: null, type: { in: ['TEAM_PERFORMANCE_BONUS', 'LEADERSHIP_TARGET_BONUS'] }, user: { email: demoEmail } } });

  const users = await prisma.user.findMany({ select: { id: true, parentId: true, leg: true, sponsorId: true, package: true, teamTargetsDone: true } });
  const byId = new Map(users.map((u) => [u.id, u]));
  const children = new Map<string, { id: string; leg: string | null }[]>();
  for (const u of users) if (u.parentId) children.set(u.parentId, [...(children.get(u.parentId) ?? []), { id: u.id, leg: u.leg }]);

  // points of a whole branch (the member and everyone under them), worked out from the leaves up
  const branch = new Map<string, number>();
  const order: string[] = [];
  const stack = users.filter((u) => !u.parentId).map((u) => u.id);
  while (stack.length) {
    const id = stack.pop()!;
    order.push(id);
    for (const c of children.get(id) ?? []) stack.push(c.id);
  }
  for (const id of order.reverse()) {
    branch.set(id, PACKAGE_POINTS[byId.get(id)!.package] + (children.get(id) ?? []).reduce((sum, c) => sum + (branch.get(c.id) ?? 0), 0));
  }

  const rewards = await bonusRewards(prisma);
  const leadership = new Map<string, number>();
  for (const m of users) {
    const sponsor = m.sponsorId ? byId.get(m.sponsorId) : undefined;
    if (sponsor?.sponsorId) leadership.set(sponsor.sponsorId, (leadership.get(sponsor.sponsorId) ?? 0) + PACKAGE_POINTS[m.package]);
  }

  let changed = 0;
  for (const u of users) {
    const paid = u.package !== 'TRAINEE';
    const used = rewards.team.slice(0, u.teamTargetsDone).reduce((sum, t) => sum + t.members, 0);
    const side = (leg: 'LEFT' | 'RIGHT') => {
      const child = (children.get(u.id) ?? []).find((c) => c.leg === leg);
      return paid && child ? Math.max(0, (branch.get(child.id) ?? 0) - used) : 0;
    };
    await prisma.user.update({
      where: { id: u.id },
      data: { teamLeftNew: side('LEFT'), teamRightNew: side('RIGHT'), leadershipPoints: paid ? (leadership.get(u.id) ?? 0) : 0 }
    });
    changed += 1;
  }
  await prisma.siteSetting.create({ data: { key: 'pointsRecount3', value: { at: new Date().toISOString(), members: changed } } });
  console.log(`Points recounted for ${changed} members.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
