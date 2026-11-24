// US6 smart matching, end to end at phone size, against a stand-in for Claude's API
// (no real key, no cost). Checks what the app sends and how it shows the answer.
//   node tests/e2e/us6-smart.e2e.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, openApp, job, profileWith } from './harness.mjs';

let env;
before(async () => (env = await startServer()));
after(async () => env?.stop());

const RESUME = `Alex Rivera
alex@example.com
Senior Product Manager, Acme Payments — 2021–Present
• Led roadmap for B2B invoicing and billing, growing ARR 40% in 18 months
• Ran pricing experiments and A/B tests with SQL and Amplitude
• Partnered with sales on enterprise deals and growth`;
const PROFILE = profileWith(RESUME);
const GOOD_KEY = 'sk-ant-api03-test-good-key-0123456789abcdef';

const BILLING = job(1, {
  company: 'Figma',
  title: 'Product Manager, Billing',
  descriptionHtml: `<p>Figma helps teams design together.</p><h2>What you'll do</h2>
    <ul><li>Own the billing platform roadmap end to end</li><li>Run pricing experiments with Data Science</li><li>Partner with IT Engineering on internal tools</li></ul>
    <h2>About you</h2><ul><li>5+ years of product management experience</li></ul>`,
});
const OTHER = job(2, { company: 'Peloton', title: 'Product Manager, Content', descriptionHtml: '<h2>What you will do</h2><ul><li>Own content production tools for studio teams</li><li>Work with hardware teams on new devices</li></ul>' });

const smartSeed = (extra = {}) => ({ 'jf.smart': { enabled: true }, ...extra });

/**
 * Stand-in for api.anthropic.com. `answer(body)` returns the pairs for a request.
 * Records every request so tests can check what was sent.
 */
async function mockClaude(ctx, { answer = () => [], status = 200, keyOk = (k) => k === GOOD_KEY } = {}) {
  const calls = [];
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    // SDK 1.x sends the key as `Authorization: Bearer …` (older SDKs used x-api-key).
    const h = req.headers();
    const key = h['x-api-key'] ?? h.authorization?.replace(/^Bearer\s+/i, '');
    const url = new URL(req.url());
    if (url.pathname.startsWith('/v1/models/')) {
      if (!keyOk(key)) return route.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }) });
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ type: 'model', id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', created_at: '2026-10-01T00:00:00Z' }) });
    }
    const body = JSON.parse(req.postData() || '{}');
    calls.push({ body, key, headers: req.headers() });
    if (status !== 200 || !keyOk(key)) {
      const code = status !== 200 ? status : 401;
      return route.fulfill({ status: code, headers: cors, contentType: 'application/json', body: JSON.stringify({ type: 'error', error: { type: code === 429 ? 'rate_limit_error' : 'authentication_error', message: 'nope' } }) });
    }
    const pairs = answer(body);
    return route.fulfill({
      status: 200,
      headers: cors,
      contentType: 'application/json',
      body: JSON.stringify({ id: `msg_${calls.length}`, type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: JSON.stringify({ pairs }) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1500, output_tokens: 300 } }),
    });
  });
  return calls;
}

// Pairs by text so the test doesn't depend on numbering: find "N. text" in the prompt.
function indexOf(prompt, section, text) {
  const block = prompt.split(`${section}:\n`)[1].split('\n\n')[0];
  const line = block.split('\n').find((l) => l.includes(text));
  return Number(line.split('.')[0]);
}
const billingAnswer = (body) => {
  const p = body.messages[0].content;
  if (!p.includes('Figma')) return [];
  return [
    { requirement: indexOf(p, 'Requirements', 'billing platform roadmap'), resume_line: indexOf(p, 'Resume lines', 'invoicing and billing') },
    { requirement: indexOf(p, 'Requirements', 'pricing experiments'), resume_line: indexOf(p, 'Resume lines', 'A/B tests') },
  ];
};

test('Profile: key is checked before saving; a bad key is refused; a good one turns smart matching on', async () => {
  let calls;
  const { ctx, page, errors } = await openApp(env, { jobs: [BILLING], profile: PROFILE, beforeLoad: async (c) => (calls = await mockClaude(c)) });
  await page.click('a[data-nav="profile"]');
  assert.equal(await page.isChecked('#f-smart'), false);
  await page.locator('label[for="f-smart"]').click(); // no key yet
  assert.match(await page.textContent('#smart-notice'), /Add your API key first/);
  await page.fill('#f-apikey', 'hello');
  await page.click('#btn-key-save');
  assert.match(await page.textContent('#smart-notice'), /starts with “sk-ant-”/);
  await page.fill('#f-apikey', 'sk-ant-api03-wrong-key-0000000000000000');
  await page.click('#btn-key-save');
  await page.waitForFunction(() => /didn’t work/.test(document.querySelector('#smart-notice').textContent));
  assert.equal(await page.evaluate(() => localStorage.getItem('jf.apiKey')), null);
  await page.fill('#f-apikey', GOOD_KEY);
  await page.click('#btn-key-save');
  await page.waitForFunction(() => /Smart matching is on/.test(document.querySelector('#smart-notice').textContent));
  assert.equal(await page.isChecked('#f-smart'), true);
  assert.equal(await page.inputValue('#f-apikey'), ''); // never left on screen
  assert.match(await page.textContent('#smart-sub'), /ends cdef/);
  assert.equal(calls.length, 0); // checking a key costs nothing (no messages call)
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('card shows Claude’s top pair verbatim; app sends requirements + resume lines, structured output, Sonnet 5.5', async () => {
  let calls;
  const { ctx, page, errors } = await openApp(env, {
    jobs: [BILLING, OTHER],
    profile: PROFILE,
    seed: smartSeed({ 'jf.apiKey': GOOD_KEY }),
    beforeLoad: async (c) => (calls = await mockClaude(c, { answer: billingAnswer })),
  });
  const card = page.locator('#deck .job-card.is-top');
  await page.waitForFunction(() => document.querySelector('#deck .job-card.is-top .fit-box.is-smart'));
  assert.equal(await card.getAttribute('data-id'), BILLING.id);
  const pairs = card.locator('.fit-box .pair');
  assert.equal(await pairs.nth(0).locator('q').textContent(), 'Own the billing platform roadmap end to end');
  assert.equal(await pairs.nth(1).locator('q').textContent(), 'Led roadmap for B2B invoicing and billing, growing ARR 40% in 18 months');
  assert.equal(await card.locator('.fit-more').textContent(), '1 more reason →');
  assert.match(await card.locator('.match-badge').textContent(), /2 matches/);

  const sent = calls.find((c) => c.body.messages[0].content.includes('Figma')).body;
  assert.equal(sent.model, 'claude-sonnet-5-5');
  assert.equal(sent.output_config.format.type, 'json_schema');
  assert.equal(sent.fallbacks, 'default');
  const prompt = sent.messages[0].content;
  assert.match(prompt, /Requirements:\n0\. Own the billing platform roadmap/);
  assert.match(prompt, /Resume lines:\n0\. Led roadmap for B2B invoicing/);
  assert.doesNotMatch(prompt, /alex@example\.com|2021–Present/); // contact and title lines never sent
  assert.equal(calls[0].key, GOOD_KEY);
  assert.equal(calls[0].headers['anthropic-dangerous-direct-browser-access'], 'true');
  // The next card is matched in the background too
  await page.waitForFunction(() => document.querySelector('#deck .job-card.is-next .fit-box.is-smart'));
  assert.equal(calls.length, 2);
  // Cached: reloading doesn't ask again
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#deck .job-card.is-top .fit-box.is-smart'));
  assert.equal(calls.length, 2);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('details show every pair with 👍/👎; votes are saved and summarized in Profile', async () => {
  const { ctx, page } = await openApp(env, {
    jobs: [BILLING],
    profile: PROFILE,
    seed: smartSeed({ 'jf.apiKey': GOOD_KEY }),
    beforeLoad: (c) => mockClaude(c, { answer: billingAnswer }),
  });
  await page.waitForFunction(() => document.querySelector('#deck .job-card.is-top .fit-box.is-smart'));
  await page.click('#deck .job-card.is-top .fit-more');
  const sheet = page.locator('#job-sheet');
  await sheet.waitFor({ state: 'visible' });
  const reasons = sheet.locator('.pair-reason');
  assert.equal(await reasons.count(), 2);
  assert.equal(await reasons.nth(1).locator('.pair-want').textContent(), 'Run pricing experiments with Data Science');
  assert.equal(await reasons.nth(1).locator('.pair-did').textContent(), 'Ran pricing experiments and A/B tests with SQL and Amplitude');
  assert.match(await sheet.locator('.js-fit-source').textContent(), /Matched by Claude/);
  assert.equal(await sheet.locator('.js-gaps').isVisible(), false);
  const up = reasons.nth(0).locator('.thumb[data-vote="up"]');
  await up.click();
  assert.equal(await up.getAttribute('aria-pressed'), 'true');
  await reasons.nth(1).locator('.thumb[data-vote="down"]').click();
  await page.click('#job-sheet [data-close]');
  await sheet.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => location.hash !== '#job');
  await page.click('a[data-nav="profile"]');
  await page.waitForSelector('#screen-profile:not([hidden])');
  assert.equal(await page.textContent('#feedback-stats'), 'Reasons rated: 2 · 50% useful');
  assert.equal(await page.isVisible('#btn-copy-feedback'), true);
  const saved = Object.values(JSON.parse(await page.evaluate(() => localStorage.getItem('jf.feedback'))));
  assert.deepEqual(saved.map((f) => f.vote).sort(), ['down', 'up']);
  assert.equal(saved[0].model, 'claude-sonnet-5-5');
  await ctx.close();
});

test('no strong matches is said plainly; a rejected key falls back to keyword reasons and says why', async () => {
  let { ctx, page } = await openApp(env, { jobs: [OTHER], profile: PROFILE, seed: smartSeed({ 'jf.apiKey': GOOD_KEY }), beforeLoad: (c) => mockClaude(c) });
  await page.waitForFunction(() => document.querySelector('#deck .job-card.is-top .fit-box.is-smart'));
  assert.match(await page.textContent('#deck .job-card.is-top .fit-box'), /No strong matches with your resume/);
  assert.equal(await page.textContent('#deck .job-card.is-top .match-badge'), 'No strong match');
  await ctx.close();

  let revoked;
  ({ ctx, page } = await openApp(env, { jobs: [BILLING], profile: PROFILE, seed: smartSeed({ 'jf.apiKey': 'sk-ant-api03-revoked-key-000000000000' }), beforeLoad: async (c) => (revoked = await mockClaude(c)) }));
  await page.waitForFunction(() => document.querySelector('#deck .job-card.is-top .fit-note'));
  assert.match(await page.textContent('#deck .job-card.is-top .fit-note'), /smart matching unavailable/);
  assert.ok((await page.locator('#deck .job-card.is-top .fit-list li').count()) >= 1); // keyword reasons shown
  await page.click('a[data-nav="profile"]');
  await page.waitForSelector('#screen-profile:not([hidden])');
  assert.match(await page.textContent('#smart-notice'), /API key didn’t work/);
  await page.click('a[data-nav="today"]');
  await page.waitForTimeout(800);
  assert.equal(revoked.length, 1); // asked once, never retried in a loop
  await ctx.close();
});

test('smart matching off: keyword reasons, and nothing is sent to Claude', async () => {
  let calls;
  const { ctx, page } = await openApp(env, { jobs: [BILLING], profile: PROFILE, seed: { 'jf.apiKey': GOOD_KEY, 'jf.smart': { enabled: false } }, beforeLoad: async (c) => (calls = await mockClaude(c)) });
  assert.equal(await page.locator('#deck .job-card.is-top .fit-box.is-smart').count(), 0);
  assert.match(await page.textContent('#deck .job-card.is-top .match-badge'), /\d+% match/);
  await page.waitForTimeout(500);
  assert.equal(calls.length, 0);
  await ctx.close();
});
