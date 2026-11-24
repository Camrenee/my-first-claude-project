// US4 tracking, end to end at phone size.
//   node tests/e2e/us4-tracking.e2e.mjs      (needs Playwright + Chromium)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, openApp, job, profileWith, daysAgo } from './harness.mjs';

let env;
before(async () => (env = await startServer()));
after(async () => env?.stop());

const PROFILE = profileWith('Alex Rivera\n• Led payments roadmap for B2B invoicing and billing, growing ARR 40%');
const store = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
const queuedSeed = (jobs) => ({
  'jf.tracker': Object.fromEntries(jobs.map((j, i) => [j.id, { job: j, queuedAt: daysAgo(3 - i * 0.1) }])),
  'jf.decisions': {
    byId: Object.fromEntries(jobs.map((j) => [j.id, { action: 'queued', at: daysAgo(3), postedAt: j.postedAt }])),
    byKey: {},
  },
});
const item = (page, j) => page.locator(`.queue-item[data-id="${j.id}"]`);

async function openTracker(page) {
  await page.click('a[data-nav="tracker"]');
  await page.waitForSelector('#screen-tracker:not([hidden]) .goal-card');
}

test('Applied is one tap: the job leaves To apply, shows under Applied with its date, and counts toward the goal', async () => {
  const [a, b] = [job(1), job(2)];
  const { ctx, page, errors } = await openApp(env, { jobs: [], profile: PROFILE, seed: queuedSeed([a, b]) });
  await openTracker(page);
  assert.equal(await page.textContent('#goal-count'), '0 of 2');
  assert.match(await page.textContent('#tab-to_apply'), /To apply\s*2/);
  await item(page, a).locator('.qi-applied').click();
  await page.waitForFunction(() => /Applied! 1 of 2 this week/.test(document.querySelector('#app-live').textContent));
  assert.equal(await page.textContent('#goal-count'), '1 of 2');
  assert.equal(await item(page, a).count(), 0); // left To apply
  assert.match(await page.textContent('#tab-applied'), /Applied\s*1/);
  await page.click('#tab-applied');
  assert.match(await item(page, a).locator('.qi-dates').textContent(), /Saved .* · Applied [A-Z][a-z]{2} \d+/);
  assert.equal(await item(page, a).locator('.qi-applied').getAttribute('aria-pressed'), 'true');
  // Second application hits the goal
  await page.click('#tab-to_apply');
  await item(page, b).locator('.qi-applied').click();
  assert.equal(await page.textContent('#goal-count'), '2 of 2');
  assert.match(await page.textContent('#goal-note'), /Goal hit/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Referred: one tap, then status and "Referred by" persist; a job can be both applied and referred', async () => {
  const a = job(3);
  const { ctx, page } = await openApp(env, { jobs: [], profile: PROFILE, seed: queuedSeed([a]) });
  await openTracker(page);
  await item(page, a).locator('.qi-referred').click();
  const editor = item(page, a).locator('.ref-editor');
  assert.equal(await editor.locator('input[value="in_progress"]').isChecked(), true);
  await editor.locator('label.chip', { hasText: 'Completed' }).click();
  await item(page, a).locator('.ref-by').fill('Sam Lee');
  await item(page, a).locator('.ref-by').blur();
  await item(page, a).locator('.qi-applied').click(); // now both
  await page.reload();
  await openTracker(page);
  await page.click('#tab-referred');
  const ref = item(page, a);
  assert.match(await ref.locator('.qi-dates').textContent(), /Applied .* Referred .* · Completed · by Sam Lee/);
  assert.equal(await ref.locator('input[value="completed"]').isChecked(), true);
  assert.equal(await ref.locator('.ref-by').inputValue(), 'Sam Lee');
  await page.click('#tab-applied');
  assert.equal(await item(page, a).count(), 1);
  await page.click('#tab-all');
  assert.equal(await item(page, a).count(), 1);
  const r = (await store(page, 'jf.tracker'))[a.id].referral;
  assert.equal(r.status, 'completed');
  // Removing a referral asks once
  await page.click('#tab-referred');
  await item(page, a).locator('.qi-referred').click();
  assert.match(await item(page, a).locator('.qi-referred').textContent(), /Tap again/);
  await item(page, a).locator('.qi-referred').click();
  assert.equal(await page.locator('.queue-item').count(), 0);
  await ctx.close();
});

test('Applied from the job details in the feed: card leaves the deck and the job is tracked', async () => {
  const [a, b] = [job(4), job(5)];
  const { ctx, page } = await openApp(env, { jobs: [a, b], profile: PROFILE });
  const first = await page.locator('#deck .job-card.is-top').getAttribute('data-id');
  await page.click('#deck .job-card.is-top .jc-more');
  await page.locator('#job-sheet').waitFor({ state: 'visible' });
  await page.click('#job-sheet .js-track-applied');
  await page.locator('#job-sheet').waitFor({ state: 'hidden' });
  await page.waitForTimeout(300);
  assert.notEqual(await page.locator('#deck .job-card.is-top').getAttribute('data-id'), first);
  assert.match(await page.textContent('#deck-status'), /0 of 5 in your queue/);
  await openTracker(page);
  assert.equal(await page.textContent('#goal-count'), '1 of 2');
  await page.click('#tab-applied');
  assert.equal(await page.locator(`.queue-item[data-id="${first}"]`).count(), 1);
  await ctx.close();
});

test('Referred from the feed also saves the job to apply', async () => {
  const [a, b] = [job(6), job(7)];
  const { ctx, page } = await openApp(env, { jobs: [a, b], profile: PROFILE });
  const first = await page.locator('#deck .job-card.is-top').getAttribute('data-id');
  await page.click('#deck .job-card.is-top .jc-more');
  await page.click('#job-sheet .js-track-referred');
  await page.locator('#job-sheet').waitFor({ state: 'hidden' });
  await openTracker(page);
  await page.click('#tab-to_apply');
  const it = page.locator(`.queue-item[data-id="${first}"]`);
  assert.equal(await it.locator('.qi-referred').getAttribute('aria-pressed'), 'true');
  assert.equal(await it.locator('.ref-editor input[value="in_progress"]').isChecked(), true);
  await ctx.close();
});

test('a full queue unblocks when a queued job is marked Applied', async () => {
  const queued = Array.from({ length: 5 }, (_, i) => job(20 + i));
  const fresh = job(30);
  const { ctx, page } = await openApp(env, { jobs: [...queued, fresh], profile: PROFILE, seed: queuedSeed(queued) });
  assert.equal(await page.textContent('#deck .deck-panel h2'), 'Your queue is full');
  await openTracker(page);
  await item(page, queued[0]).locator('.qi-applied').click();
  await page.click('a[data-nav="today"]');
  await page.waitForSelector('#deck .job-card.is-top');
  assert.equal(await page.locator('#deck .job-card.is-top').getAttribute('data-id'), fresh.id);
  await ctx.close();
});

test('weekly goal counts Monday–Sunday only and shows a streak', async () => {
  // Applied twice last week and twice the week before; once this week.
  const mon = new Date();
  mon.setHours(12, 0, 0, 0);
  mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7)); // this Monday, noon
  const d = (offsetDays) => new Date(mon.getTime() + offsetDays * 864e5).toISOString();
  const entries = [d(0), d(-1), d(-3), d(-8), d(-10)].map((t, i) => [`j${i}`, { job: job(40 + i), appliedAt: t }]);
  const { ctx, page } = await openApp(env, { jobs: [], profile: PROFILE, seed: { 'jf.tracker': Object.fromEntries(entries) } });
  await openTracker(page);
  assert.equal(await page.textContent('#goal-count'), '1 of 2');
  assert.match(await page.textContent('#goal-note'), /1 more to hit this week's goal\. 2 weeks in a row\./);
  assert.match(await page.textContent('#goal-week'), /^Mon, [A-Z][a-z]{2} \d+ – Sun, [A-Z][a-z]{2} \d+$/);
  assert.equal(await page.getAttribute('#goal-bar', 'aria-valuenow'), '1');
  await ctx.close();
});

test('tabs remember the last one, have empty states, and fit a 320px screen', async () => {
  const a = job(8);
  const { ctx, page } = await openApp(env, { jobs: [], profile: PROFILE, seed: queuedSeed([a]) });
  await openTracker(page);
  await page.click('#tab-referred');
  assert.match(await page.textContent('#tracker-list'), /No referrals yet/);
  await page.click('a[data-nav="profile"]');
  await openTracker(page);
  assert.equal(await page.getAttribute('#tab-referred', 'aria-selected'), 'true');
  await page.click('#tab-to_apply');
  await item(page, a).locator('.qi-referred').click();
  await page.setViewportSize({ width: 320, height: 640 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  const small = await page.$$eval('#screen-tracker button, #screen-tracker a, #screen-tracker input', (els) =>
    els.filter((e) => e.offsetParent !== null && e.type !== 'radio').map((e) => [e.id || e.className, Math.round(e.getBoundingClientRect().height)]).filter(([, h]) => h < 44)
  );
  assert.deepEqual(small, []);
  await ctx.close();
});
