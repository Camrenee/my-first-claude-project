// US5 "Why you're a great fit", end to end at phone size.
//   node tests/e2e/us5-fit.e2e.mjs      (needs Playwright + Chromium)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, openApp, job, profileWith } from './harness.mjs';

let env;
before(async () => (env = await startServer()));
after(async () => env?.stop());

const RESUME = `Alex Rivera
Senior Product Manager, Acme Payments — 2021–Present
• Led payments roadmap for B2B invoicing and billing, growing ARR 40%
• Ran pricing experiments and A/B tests with SQL and Amplitude
Product Manager, Northwind Health — 2018–2021
• Launched patient scheduling used by 200 clinics`;
const PROFILE = profileWith(RESUME);

const BILLING = job(1, {
  company: 'Figma',
  title: 'Product Manager, Billing',
  descriptionHtml: `<p>Figma helps teams design together, everywhere in the world, every single day.</p>
    <h2>What you'll do</h2>
    <ul><li>You will own our billing platform and invoicing for B2B customers.</li>
    <li>You have experience running pricing experiments and A/B tests, and you are fluent in SQL.</li>
    <li>Partner with payments infrastructure teams to ship reliable systems.</li>
    <li>Experience with crypto custody and blockchain settlement is a plus.</li></ul>`,
});
const UNRELATED = job(2, {
  company: 'Gadget Co',
  title: 'Product Manager, Devices',
  descriptionHtml: '<p>Own firmware for our connected fitness hardware. You will work on workouts, exercise content and video streaming for our members.</p>',
});

const lines = RESUME.split('\n').map((l) => l.replace(/^•\s*/, ''));
const isVerbatim = (quote) => lines.some((l) => l.includes(quote.replace(/^…|…$/g, '')));

test('card shows up to 2 reasons, each quoting a real resume line', async () => {
  const { ctx, page, errors } = await openApp(env, { jobs: [BILLING, UNRELATED], profile: PROFILE });
  const box = page.locator('#deck .job-card.is-top .fit-box');
  assert.equal(await box.locator('.fit-title').textContent(), "Why you're a great fit");
  const items = box.locator('.fit-list li');
  const n = await items.count();
  assert.ok(n >= 1 && n <= 2, `reasons on card: ${n}`);
  for (let i = 0; i < n; i++) {
    assert.ok(isVerbatim(await items.nth(i).locator('q').textContent()), 'quote must come from the resume');
  }
  assert.match(await items.first().locator('strong').textContent(), /Billing & invoicing/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('details show at most 4 short bullets, each tied to a resume line, plus gaps', async () => {
  const { ctx, page } = await openApp(env, { jobs: [BILLING], profile: PROFILE });
  await page.click('#deck .job-card.is-top .jc-more');
  const sheet = page.locator('#job-sheet');
  await sheet.waitFor({ state: 'visible' });
  const reasons = sheet.locator('.js-reasons .reason');
  const n = await reasons.count();
  assert.ok(n >= 2 && n <= 4, `reasons in details: ${n}`);
  for (let i = 0; i < n; i++) {
    const r = reasons.nth(i);
    assert.ok((await r.locator('.reason-label').textContent()).length > 0);
    assert.ok(isVerbatim((await r.locator('.reason-line').textContent()).replace(/^“|”$/g, '')));
  }
  assert.match(await reasons.first().locator('.reason-label').textContent(), /Billing & invoicing/);
  // Uncluttered: no per-reason job quotes or sub-labels
  assert.equal(await sheet.locator('.reason-job, .reason-src').count(), 0);
  // Things the job asks for that the resume doesn't show
  assert.equal(await sheet.locator('.js-gaps').isVisible(), true);
  assert.match(await sheet.locator('.js-gap-list').textContent(), /Crypto|Custody/);
  // Full description and original posting are still there
  assert.match(await sheet.locator('.js-description').textContent(), /What you'll do/);
  assert.equal(await sheet.locator('.js-original').getAttribute('href'), BILLING.url);
  await ctx.close();
});

test('no overlap: says so plainly instead of inventing reasons', async () => {
  const { ctx, page } = await openApp(env, { jobs: [UNRELATED], profile: PROFILE });
  const card = page.locator('#deck .job-card.is-top');
  assert.equal(await card.locator('.fit-list').count(), 0);
  assert.match(await card.locator('.fit-none').textContent(), /didn’t find a clear match/);
  await page.click('#deck .job-card.is-top .jc-more');
  await page.locator('#job-sheet').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#job-sheet .js-reasons .reason').count(), 0);
  assert.match(await page.textContent('#job-sheet .js-fit-none'), /didn’t find lines in your resume/);
  await ctx.close();
});

test('saved jobs show the same reasons from the Tracker', async () => {
  const { ctx, page } = await openApp(env, { jobs: [BILLING], profile: PROFILE });
  await page.click('#btn-save');
  await page.waitForTimeout(900);
  await page.click('a[data-nav="tracker"]');
  await page.click('.queue-item .qi-details');
  await page.locator('#job-sheet').waitFor({ state: 'visible' });
  assert.ok((await page.locator('#job-sheet .js-reasons .reason').count()) >= 2);
  assert.match(await page.textContent('#job-sheet .match-badge'), /\d+% match/);
  await ctx.close();
});

test('Profile → Start over clears swipes and the queue so every job shows again', async () => {
  const { ctx, page } = await openApp(env, { jobs: [BILLING, UNRELATED], profile: PROFILE });
  await page.click('#btn-save');
  await page.waitForTimeout(900);
  await page.click('#btn-pass');
  await page.waitForTimeout(900);
  assert.equal(await page.textContent('#deck .deck-panel h2'), 'You’re all caught up!');
  await page.click('a[data-nav="profile"]');
  await page.click('#btn-start-over');
  assert.match(await page.textContent('#start-over-summary'), /clears 2 swiped jobs and 1 saved job/);
  await page.click('#btn-start-over-no'); // Cancel changes nothing
  assert.equal(await page.locator('#start-over-confirm').isVisible(), false);
  await page.click('#btn-start-over');
  await page.click('#btn-start-over-yes');
  // Lands on Today with every job back and says so
  await page.waitForSelector('#screen-today:not([hidden]) #deck .job-card.is-top');
  assert.match(await page.textContent('#deck-status'), /2 of 2 left today · 0 of 5 in your queue/);
  await page.waitForFunction(() => /Fresh start: 2 jobs ready/.test(document.querySelector('#deck-live').textContent));
  assert.ok(JSON.parse(await page.evaluate(() => localStorage.getItem('jf.profile'))).resume.text.length > 0);
  // With nothing to clear, it says so instead of asking
  await page.click('a[data-nav="profile"]');
  await page.click('#btn-start-over');
  assert.match(await page.textContent('#start-over-status'), /Nothing to clear yet/);
  await ctx.close();
});
