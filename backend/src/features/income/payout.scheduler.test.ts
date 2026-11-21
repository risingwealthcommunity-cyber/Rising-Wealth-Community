import test from 'node:test';
import assert from 'node:assert/strict';
import { splitWeeklyPool } from './income.engine';
import { WEEKLY_MIN_PER_SHARE_PAISE } from './plan.config';
import { istWeekStart } from './payout.scheduler';

const MIN = WEEKLY_MIN_PER_SHARE_PAISE;

test('week start is Monday 00:00 IST, whatever day or time it is now', () => {
  // Monday 2026-11-23 00:00 IST == Sunday 2026-11-22 18:30 UTC
  const monday = new Date('2026-11-22T18:30:00.000Z');
  assert.equal(istWeekStart(monday).toISOString(), monday.toISOString(), 'exactly on the start');
  assert.equal(istWeekStart(new Date('2026-11-22T18:29:59.999Z')).toISOString(), '2026-11-15T18:30:00.000Z', 'one ms earlier is the previous week');
  assert.equal(istWeekStart(new Date('2026-11-25T10:00:00.000Z')).toISOString(), monday.toISOString(), 'Wednesday');
  assert.equal(istWeekStart(new Date('2026-11-29T18:00:00.000Z')).toISOString(), monday.toISOString(), 'Sunday 23:30 IST is still that week');
  // 21 Nov 2026 is a Saturday (IST): its week began Monday 16 Nov
  assert.equal(istWeekStart(new Date('2026-11-21T13:42:00.000Z')).toISOString(), '2026-11-15T18:30:00.000Z');
});

test('weekly bonus: the plan minimums (375 / 750 / 750 / 1500) are paid when the pool is small', () => {
  // weights: 1 PRO share = 1, 2 PRO shares = 2, 1 ELITE share = 2, 2 ELITE shares = 4
  const r = splitWeeklyPool(10_000, [{ id: 'a', weight: 1 }, { id: 'b', weight: 2 }, { id: 'c', weight: 2 }, { id: 'd', weight: 4 }], MIN);
  assert.deepEqual(Object.fromEntries(r.payouts.map((p) => [p.id, p.paise / 100])), { a: 375, b: 750, c: 750, d: 1500 });
  assert.equal(r.unclaimed, 0);
  assert.equal(r.topUp, 9 * MIN - 10_000, 'the company fund covers what the pool could not');
});

test('weekly bonus: a big pool pays more than the minimum, never more than the pool, and dust stays with the company', () => {
  const pool = 100_000_00; // Rs 1,00,000
  const r = splitWeeklyPool(pool, [{ id: 'a', weight: 1 }, { id: 'b', weight: 3 }], MIN);
  const paid = r.payouts.reduce((s, p) => s + p.paise, 0);
  assert.ok(paid <= pool);
  assert.equal(r.topUp, 0);
  assert.equal(paid + r.unclaimed, pool, 'every paisa is either paid or unclaimed');
  assert.equal(r.payouts[1].paise, 3 * r.payouts[0].paise, 'proportional to shares');
  assert.ok(r.payouts[0].paise > MIN);
});

test('weekly bonus: nobody qualified, or a zero minimum, falls back to the plain pool', () => {
  assert.deepEqual(splitWeeklyPool(5_000, [], MIN), { payouts: [], unclaimed: 5_000, topUp: 0 });
  assert.deepEqual(splitWeeklyPool(5_000, [{ id: 'a', weight: 0 }], MIN), { payouts: [], unclaimed: 5_000, topUp: 0 });
  const plain = splitWeeklyPool(9_000, [{ id: 'a', weight: 1 }, { id: 'b', weight: 2 }], 0);
  assert.equal(plain.topUp, 0);
  assert.deepEqual(plain.payouts.map((p) => p.paise), [3_000, 6_000]);
});
