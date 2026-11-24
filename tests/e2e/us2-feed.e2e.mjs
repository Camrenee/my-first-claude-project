// US2 swipe feed, end to end at phone size, against a fixed set of sample jobs.
//   node tests/e2e/us2-feed.e2e.mjs      (needs Playwright + Chromium)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

let server;
let base;
let browser;
before(async () => {
  server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const file = p.endsWith('/') ? path.join(p, 'index.html') : p;
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}/`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.closeAllConnections();
  server?.close();
});

// ---------- Fixtures ----------
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();
const RESUME = `Alex Rivera
Senior Product Manager, Acme Payments — 2021–Present
• Led payments roadmap for B2B invoicing and billing, growing ARR 40%
• Ran pricing experiments and A/B testing with SQL
Product Manager, Northwind Health — 2018–2021
• Launched patient scheduling used by 200 clinics`;

function job(i, o = {}) {
  return {
    id: `greenhouse:co${i}:${i}`,
    ats: 'greenhouse',
    company: `Company ${String.fromCharCode(65 + (i % 26))}${i}`,
    title: `Product Manager, Area ${i}`,
    locations: ['New York, NY'],
    scope: 'nyc',
    workplaceType: null,
    postedAt: daysAgo(1),
    url: `https://example.com/jobs/${i}`,
    descriptionHtml: `<p>Own the roadmap for area ${i}. Partner with engineering and design. Customer interviews, analytics, stakeholder management.</p>`,
    salary: { min: 180000, max: 230000, source: 'structured' },
    ...o,
  };
}
const PAYMENTS = job(99, {
  company: 'Stripe',
  title: 'Senior Product Manager, Payments',
  workplaceType: 'Hybrid',
  descriptionHtml: '<p>Lead the payments roadmap: B2B invoicing, billing, pricing experiments, A/B testing and SQL analysis.</p>',
  salary: { min: 200000, max: 260000 },
});
const PROFILE = {
  name: 'Alex',
  resume: { text: RESUME, lines: RESUME.split('\n'), fileName: 'Pasted text', fileType: 'paste', updatedAt: '2026-11-01T00:00:00Z' },
  roles: ['pm', 'senior_pm'],
  locations: ['nyc', 'remote_us'],
  salaryFloor: 170000,
  showNoSalary: true,
};

async function open({ jobs, profile = PROFILE, seed = {}, viewport } = {}) {
  const ctx = await browser.newContext(viewport ? { viewport, hasTouch: true, isMobile: true } : { ...devices['iPhone 13'] });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const served = { count: 0, jobs };
  await ctx.route(/data\/jobs\.json/, (r) => {
    served.count++;
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ generatedAt: new Date().toISOString(), jobs: served.jobs }) });
  });
  // Seed storage once per tab (init scripts also run on reload).
  await ctx.addInitScript(({ profile, seed }) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('jf.profile', JSON.stringify(profile));
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, JSON.stringify(v));
  }, { profile, seed });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}#today`);
  await page.waitForSelector('#deck .job-card.is-top:not(.is-skeleton), #deck .deck-panel');
  return { ctx, page, errors, served };
}

const topCard = (page) => page.locator('#deck .job-card.is-top');
const topId = (page) => topCard(page).getAttribute('data-id');
const store = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);

async function swipe(page, dir) {
  const box = await topCard(page).boundingBox();
  const y = box.y + box.height / 2;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dir * 40, y, { steps: 4 });
  await page.mouse.move(x + dir * box.width * 0.6, y + 10, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(900);
}

// ---------- Tests ----------

test('card shows logo letter, title, company, location, salary, date and match; best match first', async () => {
  const { ctx, page, errors } = await open({ jobs: [job(1), PAYMENTS, job(2)] });
  const card = topCard(page);
  assert.equal(await card.getAttribute('data-id'), PAYMENTS.id);
  assert.equal(await card.locator('.logo').textContent(), 'S');
  assert.equal(await card.locator('.jc-title').textContent(), 'Senior Product Manager, Payments');
  assert.equal(await card.locator('.jc-company').textContent(), 'Stripe');
  assert.equal(await card.locator('.jc-loc').textContent(), 'New York, NY · Hybrid');
  assert.equal(await card.locator('.jc-salary').textContent(), '$200K–$260K');
  assert.equal(await card.locator('.jc-posted').textContent(), 'Posted yesterday');
  const pct = Number((await card.locator('.match-badge strong').textContent()).replace('%', ''));
  assert.ok(pct >= 60, `match ${pct}`);
  assert.match(await page.textContent('#deck-status'), /3 of 3 left today · 0 of 5 in your queue/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('salary floor hides ≤$170K tops; no-salary jobs get a tag or are hidden by the toggle', async () => {
  const atFloor = job(3, { salary: { min: 150000, max: 170000 } });
  const none = job(4, { salary: null });
  let { ctx, page } = await open({ jobs: [atFloor, none] });
  assert.equal(await topId(page), none.id);
  assert.equal(await topCard(page).locator('.tag-muted').textContent(), 'Salary not listed');
  assert.match(await page.textContent('#deck-status'), /1 of 1 left/);
  await ctx.close();

  ({ ctx, page } = await open({ jobs: [atFloor, none], profile: { ...PROFILE, showNoSalary: false } }));
  assert.match(await page.textContent('#deck .deck-panel h2'), /No new matches/);
  await ctx.close();
});

test('swipe right saves to the queue, swipe left passes and hides it for good', async () => {
  const { ctx, page } = await open({ jobs: [PAYMENTS, job(1), job(2)] });
  await swipe(page, +1);
  assert.equal((await store(page, 'jf.decisions')).byId[PAYMENTS.id].action, 'queued');
  assert.ok((await store(page, 'jf.tracker'))[PAYMENTS.id].queuedAt);
  const second = await topId(page);
  await swipe(page, -1);
  assert.equal((await store(page, 'jf.decisions')).byId[second].action, 'passed');
  assert.match(await page.textContent('#deck-status'), /1 of 3 left today · 1 of 5 in your queue/);

  await page.reload();
  await page.waitForSelector('#deck .job-card.is-top');
  const left = await page.$$eval('#deck .job-card', (els) => els.map((e) => e.dataset.id));
  assert.ok(!left.includes(second) && !left.includes(PAYMENTS.id));

  await page.click('a[data-nav="tracker"]');
  assert.equal(await page.locator('.queue-item .qi-title').first().textContent(), PAYMENTS.title);
  await ctx.close();
});

test('✓ and ✕ buttons and keyboard arrows do the same; Undo restores the card and the queue', async () => {
  const { ctx, page } = await open({ jobs: [PAYMENTS, job(1), job(2)] });
  assert.equal(await page.isDisabled('#btn-undo'), true);
  await page.click('#btn-save');
  await page.waitForTimeout(900);
  assert.equal((await store(page, 'jf.tracker'))[PAYMENTS.id] !== undefined, true);
  await page.click('#btn-undo');
  assert.equal(await topId(page), PAYMENTS.id);
  assert.equal((await store(page, 'jf.tracker'))[PAYMENTS.id], undefined);
  assert.equal((await store(page, 'jf.decisions')).byId[PAYMENTS.id], undefined);

  await page.click('#btn-pass');
  await page.waitForTimeout(900);
  assert.equal((await store(page, 'jf.decisions')).byId[PAYMENTS.id].action, 'passed');
  await page.locator('#deck .job-card.is-top').focus();
  const id = await topId(page);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(900);
  assert.equal((await store(page, 'jf.decisions')).byId[id].action, 'queued');
  await ctx.close();
});

test('queue holds 5: swiping pauses with a prompt; removing one resumes', async () => {
  const jobs = Array.from({ length: 8 }, (_, i) => job(i + 10));
  const { ctx, page } = await open({ jobs });
  for (let i = 0; i < 5; i++) {
    await page.click('#btn-save');
    await page.waitForTimeout(900);
  }
  assert.equal(await page.textContent('#deck .deck-panel h2'), 'Your queue is full');
  assert.equal(await page.isDisabled('#btn-save'), true);
  assert.equal(await page.isDisabled('#btn-pass'), true);
  assert.equal(await page.isEnabled('#btn-undo'), true);
  await page.keyboard.press('ArrowRight');
  assert.equal(Object.keys(await store(page, 'jf.tracker')).length, 5);

  await page.click('#deck .deck-panel a');
  await page.waitForSelector('#screen-tracker:not([hidden])');
  assert.match(await page.textContent('#queue-count'), /5 of 5 saved/);
  const remove = page.locator('.queue-item .qi-remove').first();
  await remove.click();
  assert.equal(await remove.textContent(), 'Tap again to remove');
  await remove.click();
  assert.equal(await page.locator('.queue-item').count(), 4);

  await page.click('a[data-nav="today"]');
  await page.waitForSelector('#deck .job-card.is-top');
  assert.equal(await page.isEnabled('#btn-save'), true);
  await ctx.close();
});

test('"All caught up" after the last card; deck is capped at 15 a day', async () => {
  let { ctx, page } = await open({ jobs: [job(1), job(2)] });
  await page.click('#btn-pass');
  await page.waitForTimeout(900);
  await page.click('#btn-save');
  await page.waitForTimeout(900);
  assert.equal(await page.textContent('#deck .deck-panel h2'), 'You’re all caught up!');
  assert.match(await page.textContent('#deck .deck-panel p'), /1 saved, 1 passed/);
  await ctx.close();

  ({ ctx, page } = await open({ jobs: Array.from({ length: 20 }, (_, i) => job(i + 30)) }));
  assert.match(await page.textContent('#deck-status'), /15 of 15 left today/);
  await ctx.close();
});

test('a passed job that is re-posted comes back tagged "Updated"', async () => {
  const old = job(50, { postedAt: daysAgo(6) });
  const repost = { ...old, id: 'greenhouse:co50:5000', postedAt: daysAgo(0) };
  const key = `${old.company}|${old.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
  const passed = { action: 'passed', at: daysAgo(5), postedAt: old.postedAt };
  const { ctx, page } = await open({ jobs: [old, repost], seed: { 'jf.decisions': { byId: { [old.id]: passed }, byKey: { [key]: passed } } } });
  assert.equal(await topId(page), repost.id);
  assert.equal(await topCard(page).locator('.tag-accent').textContent(), 'Updated');
  assert.match(await page.textContent('#deck-status'), /1 of 1 left/);
  await ctx.close();
});

test('pull to refresh fetches new jobs', async () => {
  const { ctx, page, served } = await open({ jobs: [job(1)] });
  const firstCount = served.count;
  served.jobs = [job(1), PAYMENTS];
  // Simulate a finger dragging down from the top of the screen.
  await page.evaluate(async () => {
    const el = document.querySelector('#screen-today');
    const t = (y) => new Touch({ identifier: 1, target: el, clientX: 180, clientY: y });
    el.dispatchEvent(new TouchEvent('touchstart', { touches: [t(120)], bubbles: true, cancelable: true }));
    for (let y = 130; y <= 330; y += 20) el.dispatchEvent(new TouchEvent('touchmove', { touches: [t(y)], bubbles: true, cancelable: true }));
    el.dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true, cancelable: true }));
  });
  const said = await page.waitForFunction(() => {
    const t = document.querySelector('#deck-live').textContent;
    return /new role/.test(t) && t;
  });
  assert.equal(served.count, firstCount + 1);
  assert.match(await said.jsonValue(), /1 new role found/);
  assert.match(await page.textContent('#deck-status'), /of 2 left today/);
  await ctx.close();
});

test('no horizontal scroll and 44px targets at 320px with a card showing', async () => {
  const { ctx, page } = await open({ jobs: [PAYMENTS, job(1)], viewport: { width: 320, height: 640 } });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  const small = await page.$$eval('#screen-today button, #screen-today a, .nav a', (els) =>
    els.filter((e) => e.offsetParent !== null && !e.closest('[aria-hidden="true"]')).map((e) => [e.id || e.textContent.trim().slice(0, 20), Math.round(e.getBoundingClientRect().height)]).filter(([, h]) => h < 44)
  );
  assert.deepEqual(small, []);
  await ctx.close();
});

// ---------- Description preview + details sheet ----------
const RICH = job(77, {
  company: 'Ramp',
  title: 'Product Manager, Bill Pay',
  descriptionHtml: `<div class="content-intro"><p>Ramp is the finance automation platform built to save businesses time and money. We are a fast-growing team.</p></div>
    <h2 style="color:red">About the role</h2>
    <p onclick="alert(1)">You will own Bill Pay end to end, from invoice capture to payment, working with design and engineering to ship weekly.</p>
    <ul><li>Lead the roadmap for <strong>accounts payable</strong> automation</li><li>Run experiments with SQL</li></ul>
    <script>window.__pwned = true</script><img src="https://example.com/x.png" onerror="window.__pwned=true">
    <p>Learn more on <a href="https://ramp.com/careers">our site</a> or <a href="javascript:window.__pwned=true">here</a>.</p>`,
});

test('card previews the role section of the description', async () => {
  const { ctx, page } = await open({ jobs: [RICH] });
  const preview = await topCard(page).locator('.jc-preview').textContent();
  assert.match(preview, /^You will own Bill Pay end to end/);
  assert.doesNotMatch(preview, /finance automation platform/);
  await ctx.close();
});

test('tapping the card opens the full, sanitized description; Back and Escape close it', async () => {
  const { ctx, page, errors } = await open({ jobs: [RICH, job(1)] });
  const box = await topCard(page).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + 60);
  const sheet = page.locator('#job-sheet');
  await sheet.waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => location.hash), '#job');
  assert.equal(await sheet.locator('.js-title').textContent(), RICH.title);
  const desc = sheet.locator('.js-description');
  assert.match(await desc.textContent(), /accounts payable/);
  assert.equal(await desc.locator('h3').first().textContent(), 'About the role');
  assert.equal(await desc.locator('li').count(), 2);
  // Nothing unsafe survives
  assert.equal(await desc.locator('script, img, [onclick], [onerror], [style]').count(), 0);
  assert.equal(await desc.locator('a').count(), 1);
  assert.equal(await desc.locator('a').getAttribute('href'), 'https://ramp.com/careers');
  assert.equal(await desc.locator('a').getAttribute('target'), '_blank');
  assert.equal(await page.evaluate(() => window.__pwned ?? false), false);
  assert.equal(await sheet.locator('.js-original').getAttribute('href'), RICH.url);

  await page.goBack(); // phone Back button
  await sheet.waitFor({ state: 'hidden' });
  assert.equal(await topId(page), RICH.id); // still on the same card

  await page.click('#deck .job-card.is-top .jc-more');
  await sheet.waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'hidden' });
  assert.notEqual(await page.evaluate(() => location.hash), '#job');

  await page.locator('#deck .job-card.is-top').focus();
  await page.keyboard.press('Enter');
  await sheet.waitFor({ state: 'visible' });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Save to apply and Pass work from the details sheet', async () => {
  const { ctx, page } = await open({ jobs: [RICH, job(1)] });
  await page.click('#deck .job-card.is-top .jc-more');
  await page.click('#job-sheet .js-save');
  await page.locator('#job-sheet').waitFor({ state: 'hidden' });
  await page.waitForTimeout(900);
  assert.equal((await store(page, 'jf.decisions')).byId[RICH.id].action, 'queued');
  assert.equal(await topId(page), job(1).id);

  await page.click('#deck .job-card.is-top .jc-more');
  await page.click('#job-sheet .js-pass');
  await page.waitForTimeout(900);
  assert.equal((await store(page, 'jf.decisions')).byId[job(1).id].action, 'passed');
  assert.equal(await page.textContent('#deck .deck-panel h2'), 'You’re all caught up!');

  // Saved jobs open from the Tracker too (read-only: no Pass/Save there)
  await page.click('a[data-nav="tracker"]');
  await page.click('.queue-item .qi-details');
  await page.locator('#job-sheet').waitFor({ state: 'visible' });
  assert.match(await page.textContent('#job-sheet .js-description'), /accounts payable/);
  assert.equal(await page.locator('#job-sheet .js-actions').isVisible(), false);
  await page.click('#job-sheet [data-close]');
  await page.locator('#job-sheet').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#screen-tracker').isVisible(), true);
  await ctx.close();
});

test('saving and passing show a confirmation the user can see', async () => {
  const { ctx, page } = await open({ jobs: [PAYMENTS, job(1), job(2)] });
  await page.click('#btn-save');
  const fb = page.locator('#deck-feedback');
  await fb.waitFor({ state: 'attached' });
  await page.waitForTimeout(300); // mid-animation: card still leaving, badge showing
  assert.equal(await page.locator('#deck .job-card.is-top').getAttribute('data-id'), PAYMENTS.id);
  assert.match(await fb.textContent(), /Saved to apply\s*1 of 5 in your queue/);
  assert.ok(Number(await fb.evaluate((e) => getComputedStyle(e).opacity)) > 0.5);
  await page.waitForTimeout(900);
  assert.notEqual(await page.locator('#deck .job-card.is-top').getAttribute('data-id'), PAYMENTS.id);
  await page.click('#btn-pass');
  await page.waitForTimeout(300);
  assert.match(await fb.textContent(), /Passed/);
  await ctx.close();
});
