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

test('details show every reason with the resume line and the job sentence, plus gaps', async () => {
  const { ctx, page } = await openApp(env, { jobs: [BILLING], profile: PROFILE });
  await page.click('#deck .job-card.is-top .jc-more');
  const sheet = page.locator('#job-sheet');
  await sheet.waitFor({ state: 'visible' });
  const reasons = sheet.locator('.js-reasons .reason');
  const n = await reasons.count();
  assert.ok(n >= 2, `reasons in details: ${n}`);
  const jobQuotes = new Set();
  for (let i = 0; i < n; i++) {
    const r = reasons.nth(i);
    assert.ok(isVerbatim(await r.locator('.reason-resume').textContent()));
    const jq = r.locator('.reason-job');
    if (await jq.count()) {
      const t = await jq.textContent();
      assert.ok(!jobQuotes.has(t), 'each job sentence is quoted once');
      jobQuotes.add(t);
    }
  }
  assert.match(await reasons.first().locator('.reason-job').textContent(), /billing platform/);
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
  await page.waitForTimeout(350);
  await page.click('a[data-nav="tracker"]');
  await page.click('.queue-item .qi-details');
  await page.locator('#job-sheet').waitFor({ state: 'visible' });
  assert.ok((await page.locator('#job-sheet .js-reasons .reason').count()) >= 2);
  assert.match(await page.textContent('#job-sheet .match-badge'), /\d+% match/);
  await ctx.close();
});
