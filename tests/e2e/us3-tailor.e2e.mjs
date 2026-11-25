// US3 tailoring, end to end at phone size.
//   node tests/e2e/us3-tailor.e2e.mjs      (needs Playwright + Chromium)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer, openApp, job, profileWith, daysAgo } from './harness.mjs';

let env;
before(async () => (env = await startServer()));
after(async () => env?.stop());

const RESUME = [
  'Alex Rivera',
  'alex@example.com · New York, NY',
  'Experience',
  'Senior Product Manager, Acme Payments — 2021–Present',
  '• Led roadmap for B2B invoicing and billing, growing ARR 40% in 18 months',
  '• Ran pricing experiments and A/B tests with SQL and Amplitude',
  'Product Manager, Shopco — 2017–2021',
  '• Launched checkout redesign that lifted conversion 12% for 2M monthly shoppers',
  'Education',
  'BA Economics, NYU — 2010–2014',
].join('\n');
const STRIPE = job(1, {
  company: 'Stripe',
  title: 'Senior Product Manager, Billing',
  descriptionHtml: '<h2>What you will do</h2><ul><li>Own the billing platform roadmap end to end</li><li>Run pricing experiments</li></ul><p>We are an equal opportunity employer.</p>',
});
const seedQueued = (jobs, extra = {}) => ({
  'jf.tracker': Object.fromEntries(jobs.map((j) => [j.id, { job: j, queuedAt: daysAgo(1) }])),
  'jf.decisions': { byId: Object.fromEntries(jobs.map((j) => [j.id, { action: 'queued', at: daysAgo(1), postedAt: j.postedAt }])), byKey: {} },
  ...extra,
});
const ANSWER = {
  summary: 'Payments product manager who grows B2B billing revenue through pricing experiments.',
  changes: [
    { line: 4, text: 'Owned the B2B billing and invoicing roadmap end to end, growing ARR 40% in 18 months' },
    { line: 5, text: 'Ran 45 pricing experiments with SQL and Amplitude' }, // adds a number: held back
    { line: 3, text: 'Staff Product Manager, Acme Payments — 2021–Present' }, // title: ignored
  ],
};
const reply = (a = ANSWER) => `Here's your tailored resume:\n\n\`\`\`json\n${JSON.stringify(a, null, 2)}\n\`\`\`\n\nGood luck!`;
const sheet = (page) => page.locator('#tailor-sheet');

async function openTailorFromTracker(page, j = STRIPE) {
  await page.click('a[data-nav="tracker"]');
  const btn = page.locator(`.queue-item[data-id="${j.id}"] .qi-tailor`);
  assert.equal(await btn.textContent(), 'Tailor resume');
  assert.match(await btn.getAttribute('class'), /btn-primary/);
  await btn.click();
  await sheet(page).locator('.js-t-copy').waitFor();
}

test('copy the prompt, paste the reply, review highlighted changes, save a one-page PDF', async () => {
  const { ctx, page, errors } = await openApp(env, { jobs: [STRIPE], profile: profileWith(RESUME), seed: seedQueued([STRIPE]) });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openTailorFromTracker(page);
  assert.equal(await page.evaluate(() => location.hash), '#tailor');
  assert.equal(await sheet(page).locator('.js-t-step').textContent(), 'Step 1 of 2');
  assert.equal(await sheet(page).locator('.js-t-auto').isHidden(), true, 'no key, no one-tap option');

  // 1. Copy: the prompt has the rules, the job (without boilerplate) and the numbered resume.
  await sheet(page).locator('.js-t-copy').click();
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(prompt, /Never add skills, tools, titles, companies, numbers, dates or experience/);
  assert.match(prompt, /JOB: Senior Product Manager, Billing at Stripe\nWhat you will do\nOwn the billing platform roadmap end to end/);
  assert.doesNotMatch(prompt, /equal opportunity/);
  assert.match(prompt, /\n4 \[edit\] Led roadmap for B2B invoicing/);
  assert.match(await sheet(page).locator('.js-t-status').textContent(), /Prompt copied/);

  // 3. A reply that isn't Claude's JSON gets a clear message.
  await sheet(page).locator('.js-t-answer').fill('I rewrote it for you!');
  await sheet(page).locator('.js-t-review-btn').click();
  assert.match(await sheet(page).locator('.js-t-error').textContent(), /Copy Claude’s whole reply/);

  await sheet(page).locator('.js-t-answer').fill(reply());
  await sheet(page).locator('.js-t-review-btn').click();
  await sheet(page).locator('.js-t-paper .t-line').first().waitFor();
  await page.waitForFunction(() => !document.querySelector('#tailor-sheet .js-t-save').disabled);
  assert.equal(await sheet(page).locator('.js-t-step').textContent(), 'Step 2 of 2');
  assert.match(await sheet(page).locator('.js-t-counts').textContent(), /1 line reworded · summary added/);
  const notes = await sheet(page).locator('.js-t-notes').textContent();
  assert.match(notes, /1 change added a number that isn’t in your resume, so we kept your original line/);
  assert.match(notes, /1 of Claude’s edits weren’t used/);

  // Changed line in accent blue; held line shows the original with a warning.
  const changed = sheet(page).locator('.t-line.is-changed').filter({ hasText: 'Owned the B2B billing' });
  assert.equal(await changed.count(), 1);
  assert.equal(await changed.locator('.t-text').evaluate((el) => getComputedStyle(el).color), 'rgb(27, 44, 193)');
  const held = sheet(page).locator('.t-line.is-kept').filter({ hasText: 'Ran pricing experiments and A/B tests' });
  assert.match(await held.locator('.t-warn').textContent(), /Adds “45”/);
  assert.equal(await sheet(page).locator('.t-text', { hasText: 'Staff Product Manager' }).count(), 0, 'titles never change');
  assert.equal(await sheet(page).locator('.t-summary.is-changed').count(), 1);

  // Show original
  assert.equal(await sheet(page).locator('.t-orig').count(), 0);
  await sheet(page).locator('label[for="t-orig"]').click();
  assert.match(await changed.locator('.t-orig del').textContent(), /^Led roadmap for B2B invoicing/);

  // Keep the original for one line
  await changed.locator('.t-toggle').click();
  await page.waitForFunction(() => !document.querySelector('#tailor-sheet .js-t-save').disabled);
  assert.match(await sheet(page).locator('.js-t-counts').textContent(), /0 lines reworded · summary added/);
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Use Claude’s version', 'focus stays on the line');
  await page.locator('.t-toggle[data-key="4"]').click();
  await page.waitForFunction(() => !document.querySelector('#tailor-sheet .js-t-save').disabled);

  // Save PDF
  const [download] = await Promise.all([page.waitForEvent('download'), sheet(page).locator('.js-t-save').click()]);
  assert.equal(download.suggestedFilename(), 'Alex Rivera - Resume - Stripe.pdf');
  const bytes = fs.readFileSync(await download.path());
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.match(bytes.toString('latin1'), /\/BaseFont \/[A-Z]*\+?Arimo/);
  assert.equal((bytes.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length, 1, 'one page');

  await page.waitForFunction(() => !document.querySelector('#tailor-sheet').open);
  assert.equal(await page.evaluate(() => location.hash), '#tracker');
  const entry = await page.evaluate((id) => JSON.parse(localStorage.getItem('jf.tracker'))[id], STRIPE.id);
  assert.equal(entry.tailored.changed, 1);
  assert.ok(entry.tailored.items.some((x) => x.text === ANSWER.changes[0].text));
  assert.ok(entry.tailored.items.some((x) => x.text === ANSWER.summary));
  assert.ok(!entry.tailored.items.some((x) => /45 pricing/.test(x.text)), 'held change not printed');
  const item = page.locator(`.queue-item[data-id="${STRIPE.id}"]`);
  assert.equal(await item.locator('.qi-tailor').textContent(), 'Tailored ✓ · Open');
  assert.match(await item.locator('.qi-dates').textContent(), /Tailored [A-Z][a-z]{2} \d+/);

  // Reopen: download the saved PDF again without Claude.
  await item.locator('.qi-tailor').click();
  assert.match(await sheet(page).locator('.js-t-done-text').textContent(), /You saved a tailored resume/);
  const [again] = await Promise.all([page.waitForEvent('download'), sheet(page).locator('.js-t-redownload').click()]);
  assert.equal(again.suggestedFilename(), 'Alex Rivera - Resume - Stripe.pdf');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a resume that runs long is trimmed to one page: oldest role first, shown under Show original', async () => {
  const bullets = (role, n) => Array.from({ length: n }, (_, k) => `• ${role} accomplishment ${k + 1}: shipped a meaningful improvement to the product for enterprise customers and partners`);
  const long = [
    'Alex Rivera', 'alex@example.com', 'Experience',
    'Senior PM, Acme — 2021–Present', ...bullets('Acme', 8),
    'PM, Shopco — 2017–2021', ...bullets('Shopco', 8),
    'Associate PM, Oldco — 2014–2017', ...bullets('Oldco', 8),
    'Education', 'BA Economics, NYU — 2010–2014',
  ].join('\n');
  const { ctx, page, errors } = await openApp(env, { jobs: [STRIPE], profile: profileWith(long), seed: seedQueued([STRIPE]) });
  await openTailorFromTracker(page);
  await sheet(page).locator('.js-t-answer').fill(reply({ summary: 'Product manager for enterprise platforms.', changes: [] }));
  await sheet(page).locator('.js-t-review-btn').click();
  await page.waitForFunction(() => /oldest role/.test(document.querySelector('#tailor-sheet .js-t-notes').textContent));
  const notes = await sheet(page).locator('.js-t-notes').textContent();
  assert.match(notes, /left out \d+ bullets? from your oldest role \(Associate PM, Oldco — 2014–2017\)/);
  assert.equal(await sheet(page).locator('.t-line.is-trimmed').count(), 0, 'hidden until Show original');
  await sheet(page).locator('label[for="t-orig"]').click();
  const trimmed = await sheet(page).locator('.t-line.is-trimmed').allTextContents();
  assert.ok(trimmed.length >= 1 && trimmed.every((t) => /Oldco/.test(t)), 'only the oldest role is trimmed');
  const [download] = await Promise.all([page.waitForEvent('download'), sheet(page).locator('.js-t-save').click()]);
  const bytes = fs.readFileSync(await download.path()).toString('latin1');
  assert.equal((bytes.match(/\/Type \/Page\b/g) ?? []).length, 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('with a saved Claude key: one tap sends the same prompt and opens the review; a bad key says so', async () => {
  const calls = [];
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
  let status = 401;
  const { ctx, page, errors } = await openApp(env, {
    jobs: [STRIPE],
    profile: profileWith(RESUME),
    seed: seedQueued([STRIPE], { 'jf.apiKey': 'sk-ant-test' }),
    beforeLoad: (c) =>
      c.route('https://api.anthropic.com/**', (route) => {
        const req = route.request();
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        calls.push(JSON.parse(req.postData() || '{}'));
        if (status !== 200) return route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'nope' } }) });
        return route.fulfill({
          status: 200,
          headers: cors,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: JSON.stringify(ANSWER) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 3000, output_tokens: 600 } }),
        });
      }),
  });
  await openTailorFromTracker(page);
  assert.equal(await sheet(page).locator('.js-t-auto').isVisible(), true);
  await sheet(page).locator('.js-t-auto-btn').click();
  await page.waitForFunction(() => /didn’t work/.test(document.querySelector('#tailor-sheet .js-t-auto-notice').textContent));
  status = 200;
  await sheet(page).locator('.js-t-auto-btn').click();
  await sheet(page).locator('.js-t-review:not([hidden])').waitFor();
  await page.waitForFunction(() => !document.querySelector('#tailor-sheet .js-t-save').disabled);
  assert.match(await sheet(page).locator('.js-t-counts').textContent(), /1 line reworded · summary added/);
  const body = calls.at(-1);
  assert.equal(body.model, 'claude-sonnet-5-5');
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.match(body.messages[0].content, /\n4 \[edit\] Led roadmap for B2B invoicing/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Tailor from job details; Back (and the phone’s back) closes the sheet', async () => {
  const { ctx, page, errors } = await openApp(env, { jobs: [STRIPE], profile: profileWith(RESUME), seed: seedQueued([STRIPE]) });
  await page.click('a[data-nav="tracker"]');
  await page.locator(`.queue-item[data-id="${STRIPE.id}"] .qi-details`).click();
  await page.locator('#job-sheet .js-tailor').click();
  await sheet(page).locator('.js-t-copy').waitFor();
  assert.equal(await page.locator('#job-sheet').evaluate((d) => d.open), false);
  assert.equal(await page.evaluate(() => location.hash), '#tailor');
  await page.goBack();
  await page.waitForFunction(() => !document.querySelector('#tailor-sheet').open);
  assert.equal(await page.locator('#screen-tracker').isVisible(), true);
  // The sheet's Back button, and the details sheet from the feed has no Tailor button.
  await page.locator(`.queue-item[data-id="${STRIPE.id}"] .qi-tailor`).click();
  await sheet(page).locator('[data-close]').click();
  await page.waitForFunction(() => !document.querySelector('#tailor-sheet').open);
  await page.waitForFunction(() => document.activeElement?.classList.contains('qi-tailor'), null, { timeout: 3000 }); // focus returns to the button
  assert.deepEqual(errors, []);
  await ctx.close();
});
