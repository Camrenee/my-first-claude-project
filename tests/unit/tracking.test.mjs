import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { weekStart, weeklyGoal, inTab, entriesForTab } from '../../js/tracking.js';

// Minimal localStorage stand-in so store.js runs under Node.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
const store = await import('../../js/store.js');
beforeEach(() => mem.clear());

const at = (s) => new Date(s).toISOString(); // local-time strings
const job = (id, o = {}) => ({ id, company: `Co ${id}`, title: `Product Manager ${id}`, postedAt: at('2026-11-20T09:00'), ...o });

test('weeks run Monday to Sunday, local time', () => {
  const mon = new Date('2026-11-23T00:00').getTime();
  assert.equal(weekStart(new Date('2026-11-23T08:00')), mon); // Monday
  assert.equal(weekStart(new Date('2026-11-29T23:59')), mon); // Sunday night still this week
  assert.equal(weekStart(new Date('2026-11-30T00:00')), new Date('2026-11-30T00:00').getTime()); // next Monday
});

test('weekly goal counts this week only, and the streak counts full weeks hitting 2', () => {
  const now = new Date('2026-11-25T12:00'); // Wednesday
  const e = (d) => ({ appliedAt: at(d) });
  const entries = [
    e('2026-11-24T10:00'), // this week
    e('2026-11-22T21:00'), // last Sunday: last week
    e('2026-11-17T10:00'), // last week
    e('2026-11-10T10:00'), e('2026-11-12T10:00'), // two weeks ago
  ];
  let g = weeklyGoal(entries, now);
  assert.equal(g.count, 1);
  assert.equal(g.met, false);
  assert.equal(g.streak, 2); // last week + the week before, this week not hit yet
  g = weeklyGoal([...entries, e('2026-11-25T09:00')], now);
  assert.equal(g.count, 2);
  assert.equal(g.met, true);
  assert.equal(g.streak, 3);
  assert.equal(weeklyGoal([], now).streak, 0);
});

test('tabs: To apply, All, Applied, Referred; a job can be applied and referred', () => {
  const queued = { queuedAt: at('2026-11-20') };
  const appliedFromQueue = { queuedAt: at('2026-11-20'), appliedAt: at('2026-11-21') };
  const both = { appliedAt: at('2026-11-21'), referral: { status: 'in_progress', at: at('2026-11-21') } };
  const removed = { queuedAt: at('2026-11-20'), removedAt: at('2026-11-21') };
  assert.deepEqual(['to_apply', 'all', 'applied', 'referred'].map((t) => inTab(queued, t)), [true, true, false, false]);
  assert.deepEqual(['to_apply', 'all', 'applied', 'referred'].map((t) => inTab(appliedFromQueue, t)), [false, true, true, false]);
  assert.deepEqual(['to_apply', 'all', 'applied', 'referred'].map((t) => inTab(both, t)), [false, true, true, true]);
  assert.deepEqual(['to_apply', 'all', 'applied', 'referred'].map((t) => inTab(removed, t)), [false, false, false, false]);
  const sorted = entriesForTab([{ id: 'a', appliedAt: at('2026-11-20') }, { id: 'b', appliedAt: at('2026-11-22') }], 'applied');
  assert.deepEqual(sorted.map((x) => x.id), ['b', 'a']); // newest first
});

test('store: Applied takes a job out of the queue; un-applying puts it back', () => {
  const j = job('1');
  store.recordDecision(j, 'queued', 'k1');
  assert.equal(store.queuedJobs().length, 1);
  store.setApplied(j, true);
  assert.equal(store.queuedJobs().length, 0);
  assert.ok(store.trackerEntry('1').appliedAt);
  store.setApplied(j, false);
  assert.equal(store.queuedJobs().length, 1);
});

test('store: referral starts In progress, keeps status and name, and can be removed', () => {
  const j = job('2');
  store.setReferral(j, {});
  assert.equal(store.trackerEntry('2').referral.status, 'in_progress');
  store.setReferral(j, { by: 'Sam Lee' });
  store.setReferral(j, { status: 'completed' });
  const r = store.trackerEntry('2').referral;
  assert.equal(r.status, 'completed');
  assert.equal(r.by, 'Sam Lee');
  // Tracked jobs stay out of the feed
  assert.equal(store.loadDecisions().byId['2'].action, 'referred');
  // Saving later keeps the referral
  store.recordDecision(j, 'queued', 'k2');
  assert.equal(store.trackerEntry('2').referral.by, 'Sam Lee');
  store.setReferral(j, null);
  assert.equal(store.trackerEntry('2').referral, undefined);
});

test('store: Start over keeps application history, clears saved-only jobs and swipes', () => {
  store.recordDecision(job('a'), 'queued', 'ka'); // saved only
  store.recordDecision(job('b'), 'passed', 'kb'); // passed
  store.recordDecision(job('c'), 'queued', 'kc');
  store.setApplied(job('c'), true); // applied
  store.setReferral(job('d'), { by: 'Pat' }); // referred from the feed
  assert.deepEqual(store.activitySummary(), { swipes: 2, saved: 1 });
  store.resetActivity();
  assert.equal(store.trackerEntry('a'), null);
  assert.ok(store.trackerEntry('c').appliedAt);
  assert.equal(store.trackerEntry('c').queuedAt, undefined);
  assert.equal(store.trackerEntry('d').referral.by, 'Pat');
  const d = store.loadDecisions().byId;
  assert.equal(d.a, undefined);
  assert.equal(d.b, undefined);
  assert.ok(d.c && d.d); // applied / referred jobs stay out of the feed
});
