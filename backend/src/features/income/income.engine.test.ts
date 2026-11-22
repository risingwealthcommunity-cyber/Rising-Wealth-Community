import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceLeadership,
  advanceTeamTargets,
  leadershipTargets,
  computeDematIncome,
  computePackageSale,
  nextRankReached,
  performanceWeight,
  splitPool,
  weeklyShares,
  type UplineMember
} from './income.engine';
import { PACKAGE_PRICE_PAISE, PASSIVE_PCT, RANKS } from './plan.config';

const m = (id: string, pkg: UplineMember['package'], active = true): UplineMember => ({ id, package: pkg, active });
const sum = (xs: { paise: number }[]) => xs.reduce((a, b) => a + b.paise, 0);

// Every rupee of the (direct + passive) share must be accounted for: paid to users or company.
const accounted = (pkg: 'PRO' | 'ELITE') => {
  const price = PACKAGE_PRICE_PAISE[pkg];
  const passive = PASSIVE_PCT.reduce((a, p) => a + Math.floor((price * p) / 100), 0);
  return Math.floor((price * 35) / 100) + passive;
};

test('PRO sale: sponsor PRO gets full 35% direct = 874.65', () => {
  const d = computePackageSale('PRO', [m('s', 'PRO')]);
  const direct = d.payouts.find((p) => p.type === 'DIRECT_INCOME')!;
  assert.equal(direct.paise, 87465);
});

test('passive amounts match the plan table for PRO price (125,75,50,50,25...)', () => {
  const upline = Array.from({ length: 13 }, (_, i) => m(`u${i}`, 'ELITE'));
  const d = computePackageSale('PRO', upline);
  const levels = d.payouts.filter((p) => p.type === 'PASSIVE_INCOME').map((p) => p.paise / 100);
  assert.deepEqual(levels.slice(0, 5), [124.95, 74.97, 49.98, 49.98, 24.99]);
  assert.equal(levels.length, 12);
});

test('direct is capped to sponsor package: PRO sponsor, ELITE sale', () => {
  const d = computePackageSale('ELITE', [m('s', 'PRO')]);
  const direct = d.payouts.find((p) => p.type === 'DIRECT_INCOME')!;
  assert.equal(direct.paise, 87465); // 35% of 2499, not of 4999
  const excess = d.company.find((c) => c.reason === 'DIRECT_CAPPED_TO_SPONSOR_PACKAGE')!;
  assert.equal(excess.paise, 174965 - 87465);
});

test('Trainee sponsor earns no package income; everything flows to company', () => {
  const d = computePackageSale('PRO', [m('t', 'TRAINEE'), m('t2', 'TRAINEE')]);
  assert.equal(d.payouts.length, 0);
});

test('PRO receiver unlocks levels 1-7 only; levels 8-12 go to company', () => {
  const upline = Array.from({ length: 13 }, (_, i) => m(`u${i}`, 'PRO'));
  const d = computePackageSale('PRO', upline);
  const passive = d.payouts.filter((p) => p.type === 'PASSIVE_INCOME');
  assert.equal(passive.length, 7);
  assert.equal(d.company.filter((c) => c.reason === 'PASSIVE_LEVEL_LOCKED').length, 5);
});

test('inactive upline is treated as locked (company fund)', () => {
  const d = computePackageSale('PRO', [m('s', 'ELITE', false)]);
  assert.equal(d.payouts.length, 0);
});

test('conservation: payouts + company == direct + passive allocation (no money lost or created)', () => {
  for (const pkg of ['PRO', 'ELITE'] as const) {
    for (const upline of [
      [],
      [m('a', 'PRO')],
      [m('a', 'ELITE'), m('b', 'PRO'), m('c', 'TRAINEE')],
      Array.from({ length: 12 }, (_, i) => m(`u${i}`, i % 2 ? 'PRO' : 'ELITE'))
    ]) {
      const d = computePackageSale(pkg, upline);
      assert.equal(sum(d.payouts) + sum(d.company), accounted(pkg));
    }
  }
});

test('demat: referrer + 5 passive levels (Trainees earn too), nothing beyond level 5', () => {
  const upline = Array.from({ length: 8 }, (_, i) => m(`u${i}`, 'TRAINEE'));
  const d = computeDematIncome('r', 100_00, upline);
  assert.equal(d.payouts.filter((p) => p.type === 'DEMAT_DIRECT')[0].paise, 100_00);
  assert.equal(d.payouts.filter((p) => p.type === 'DEMAT_PASSIVE').length, 5);
});

test('rank: needs BOTH legs; one step at a time; uses NEW points', () => {
  assert.equal(nextRankReached('NONE', 4, 3), null); // 2:2 points = 4:4 halves
  assert.equal(nextRankReached('NONE', 4, 4)?.rank, 'SILVER');
  assert.equal(nextRankReached('SILVER', 100, 100)?.rank, 'GOLD'); // never skips ahead
  assert.equal(nextRankReached('ETERNAL', 1e9, 1e9), null);
});

test('rank rewards follow the final table', () => {
  assert.equal(RANKS[0].reward, 750);
  assert.equal(RANKS[RANKS.length - 1].reward, 15_000_000);
  assert.equal(RANKS.length, 16);
});

test('weekly shares: 3 PRO=1, 6 PRO=2 (cap), 3 ELITE=2 weight, 6 ELITE=4', () => {
  assert.equal(weeklyShares({ PRO: 2, ELITE: 0 }), 0);
  assert.equal(weeklyShares({ PRO: 3, ELITE: 0 }), 1);
  assert.equal(weeklyShares({ PRO: 9, ELITE: 0 }), 2);
  assert.equal(weeklyShares({ PRO: 0, ELITE: 3 }), 2);
  assert.equal(weeklyShares({ PRO: 0, ELITE: 6 }), 4);
});

test('performance weight = half-points of direct sales', () => {
  assert.equal(performanceWeight({ PRO: 2, ELITE: 3 }), 8);
});

test('splitPool never overpays, even with awkward numbers', () => {
  const pool = 1_000_003;
  const { payouts, unclaimed } = splitPool(pool, [
    { id: 'a', weight: 1 },
    { id: 'b', weight: 1 },
    { id: 'c', weight: 1 }
  ]);
  assert.ok(sum(payouts.map((p) => ({ paise: p.paise }))) <= pool);
  assert.equal(sum(payouts.map((p) => ({ paise: p.paise }))) + unclaimed, pool);
});

test('splitPool with nobody eligible leaves the whole pool unclaimed', () => {
  assert.deepEqual(splitPool(5000, [{ id: 'a', weight: 0 }]), { payouts: [], unclaimed: 5000 });
});

test('splitPool is proportional', () => {
  const { payouts } = splitPool(1000, [
    { id: 'a', weight: 1 },
    { id: 'b', weight: 3 }
  ]);
  assert.deepEqual(payouts, [
    { id: 'a', paise: 250 },
    { id: 'b', paise: 750 }
  ]);
});

/* ---------------- Team Performance Bonus (binary targets) ---------------- */

test('team: 2 left + 2 right completes target 1 and pays Rs 750', () => {
  const r = advanceTeamTargets(0, 2, 2);
  assert.deepEqual(r.steps.map((s) => [s.target, s.paise / 100]), [[1, 750]]);
  assert.deepEqual([r.done, r.left, r.right], [1, 0, 0]);
});

test('team: both sides are needed, 2:1 pays nothing', () => {
  const r = advanceTeamTargets(0, 2, 1);
  assert.equal(r.steps.length, 0);
  assert.deepEqual([r.done, r.left, r.right], [0, 2, 1]);
});

test('team: after target 1 the next one needs 4:4 NEW members, the old 2:2 are not counted again', () => {
  let r = advanceTeamTargets(0, 2, 2);
  r = advanceTeamTargets(r.done, r.left + 3, r.right + 3); // 3:3 new members is not enough for 4:4
  assert.equal(r.steps.length, 0);
  r = advanceTeamTargets(r.done, r.left + 1, r.right + 1); // now 4:4 fresh
  assert.deepEqual(r.steps.map((s) => [s.target, s.paise / 100]), [[2, 1500]]);
  assert.deepEqual([r.done, r.left, r.right], [2, 0, 0]);
});

test('team: members beyond what a target needs are kept for the next target, not lost', () => {
  const r = advanceTeamTargets(0, 5, 2);
  assert.deepEqual([r.done, r.left, r.right], [1, 3, 0]);
});

test('team: one big jump can complete several targets in order (2:2 then 4:4 from 6:6)', () => {
  const r = advanceTeamTargets(0, 6, 6);
  assert.deepEqual(r.steps.map((s) => s.target), [1, 2]);
  assert.equal(r.steps.reduce((a, s) => a + s.paise, 0) / 100, 2250);
  assert.deepEqual([r.left, r.right], [0, 0]);
});

test('team: the ladder is 750, 1500, 3000, 6000, 12000 and stops after the fifth', () => {
  const r = advanceTeamTargets(0, 62, 62); // 2+4+8+16+32
  assert.deepEqual(r.steps.map((s) => s.paise / 100), [750, 1500, 3000, 6000, 12000]);
  assert.equal(advanceTeamTargets(r.done, 500, 500).steps.length, 0);
});

/* ---------------------------- Leadership Bonus ---------------------------- */

test('leadership: thresholds are cumulative (6, 18, 42 ...)', () => {
  assert.deepEqual(leadershipTargets().slice(0, 4).map((t) => t.threshold), [6, 18, 42, 90]);
});

test('leadership (brief example): 8 points completes the 6-point target only', () => {
  const r = advanceLeadership(0, 8);
  assert.deepEqual(r.steps.map((s) => s.index), [1]);
});

test('leadership (brief example): 24 points completes the 6 and the 12 point targets', () => {
  const r = advanceLeadership(1, 24);
  assert.deepEqual(r.steps.map((s) => s.index), [2]);
  assert.equal(advanceLeadership(0, 24).steps.length, 2);
  assert.equal(advanceLeadership(2, 24).steps.length, 0);
});

test('leadership: a target is paid once however many points follow', () => {
  assert.equal(advanceLeadership(1, 17).steps.length, 0);
  assert.equal(advanceLeadership(1, 18).steps.length, 1);
});
