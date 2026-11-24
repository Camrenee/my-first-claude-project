// US1 Profile end-to-end checks at phone size.
// Needs Playwright with Chromium available:  node --test tests/e2e/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const FIX = path.join(ROOT, 'tests/fixtures');
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

const phone = devices['iPhone 13'];

async function freshPage() {
  const ctx = await browser.newContext({ ...phone });
  // Google Fonts may be unreachable in CI; don't let it slow tests down.
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  return { ctx, page, errors };
}

const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('jf.profile')));

test('first visit opens Profile with the PRD defaults', async () => {
  const { ctx, page, errors } = await freshPage();
  assert.equal(await page.locator('#screen-profile').isVisible(), true);
  assert.equal(await page.locator('[data-profile-title]').textContent(), "Let's find your next PM role");
  assert.deepEqual(await page.locator('input[name=roles]:checked').evaluateAll((e) => e.map((x) => x.value)), ['pm', 'senior_pm']);
  assert.deepEqual(await page.locator('input[name=locations]:checked').evaluateAll((e) => e.map((x) => x.value)), ['nyc', 'remote_us']);
  assert.equal(await page.inputValue('#f-salary'), '170,000');
  assert.equal(await page.isChecked('#f-nosalary'), true);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('cannot continue without a resume', async () => {
  const { ctx, page } = await freshPage();
  await page.click('#btn-done');
  assert.match(await page.textContent('#resume-notice'), /Add your resume/);
  assert.equal(await page.locator('#screen-profile').isVisible(), true);
  await ctx.close();
});

test('PDF upload extracts readable lines', async () => {
  const { ctx, page, errors } = await freshPage();
  await page.setInputFiles('#f-file', path.join(FIX, 'resume.pdf'));
  await page.waitForSelector('#resume-filled:not([hidden])');
  const text = await page.inputValue('#f-resume');
  assert.match(text, /Alex Rivera/);
  assert.match(text, /Senior Product Manager, Acme Payments/);
  // Each bullet comes through as its own clean line (this PDF draws bullet dots as shapes, not text).
  assert.match(text, /^(• )?Led roadmap for B2B invoicing, growing ARR 40% in 18 months$/m);
  assert.match(await page.textContent('#resume-notice'), /We read \d+ lines/);
  const p = await stored(page);
  assert.equal(p.resume.fileType, 'pdf');
  assert.equal(p.resume.fileName, 'resume.pdf');
  assert.ok(p.resume.lines.length >= 8);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Word (.docx) upload extracts text', async () => {
  const { ctx, page } = await freshPage();
  await page.setInputFiles('#f-file', path.join(FIX, 'resume.docx'));
  await page.waitForSelector('#resume-filled:not([hidden])');
  const text = await page.inputValue('#f-resume');
  assert.match(text, /Jordan Lee/);
  assert.match(text, /Owned mobile checkout; cut drop-off 18%/);
  assert.equal((await stored(page)).resume.fileType, 'docx');
  await ctx.close();
});

test('unsupported and image-only files show a friendly error', async () => {
  const { ctx, page } = await freshPage();
  await page.setInputFiles('#f-file', path.join(FIX, 'old.doc'));
  await page.waitForFunction(() => document.querySelector('#resume-notice').classList.contains('is-error'));
  assert.match(await page.textContent('#resume-notice'), /\.doc files aren't supported/);
  await page.setInputFiles('#f-file', path.join(FIX, 'scanned.pdf'));
  await page.waitForFunction(() => /scanned image/.test(document.querySelector('#resume-notice').textContent));
  assert.equal(await page.locator('#resume-empty').isVisible(), true);
  assert.equal(await stored(page), null);
  await ctx.close();
});

test('paste text, validation, then everything persists after the browser closes', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jf-'));
  const open = async () => {
    const ctx = await chromium.launchPersistentContext(userDataDir, { ...phone });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto(base);
    return { ctx, page };
  };

  let { ctx, page } = await open();
  await page.fill('#f-name', 'Alex');
  await page.click('#btn-paste');
  await page.fill('#f-resume', 'Alex Rivera\n\n- Led roadmap for B2B invoicing\n* Shipped onboarding\n');
  await page.locator('#f-resume').blur();
  assert.equal(await page.inputValue('#f-resume'), 'Alex Rivera\n• Led roadmap for B2B invoicing\n• Shipped onboarding');

  // Roles: unchecking both shows an error and doesn't save the empty choice.
  await page.locator('label.chip', { hasText: 'Product Manager' }).click();
  await page.locator('label.chip', { hasText: 'Senior PM' }).click();
  assert.equal(await page.textContent('#err-roles'), 'Pick at least one role.');
  // The empty choice is never saved; the last valid choice (Senior PM only) stays.
  assert.deepEqual((await stored(page)).roles, ['senior_pm']);
  await page.locator('label.chip', { hasText: 'Senior PM' }).click();
  assert.equal(await page.textContent('#err-roles'), '');

  // Locations: remote only.
  await page.locator('label.chip', { hasText: 'Manhattan' }).click();

  // Salary accepts "180k" and formats on blur; garbage shows an error.
  await page.fill('#f-salary', 'lots');
  await page.locator('#f-salary').blur();
  assert.match(await page.textContent('#err-salary'), /yearly amount/);
  await page.fill('#f-salary', '$180k');
  await page.locator('#f-salary').blur();
  assert.equal(await page.inputValue('#f-salary'), '180,000');

  await page.locator('label.switch-row').click();
  await page.click('#btn-done');
  await page.waitForSelector('#screen-today:not([hidden])');
  assert.match(await page.textContent('[data-greeting]'), /^Good (morning|afternoon|evening), Alex$/);
  await ctx.close();

  // Reopen the browser: profile is intact and the app opens on Today.
  ({ ctx, page } = await open());
  await page.waitForSelector('#screen-today:not([hidden])');
  await page.goto(base + '#profile');
  assert.equal(await page.textContent('[data-profile-title]'), 'Your search, your way');
  assert.equal(await page.inputValue('#f-name'), 'Alex');
  assert.equal(await page.inputValue('#f-salary'), '180,000');
  assert.equal(await page.isChecked('#f-nosalary'), false);
  assert.deepEqual(await page.locator('input[name=locations]:checked').evaluateAll((e) => e.map((x) => x.value)), ['remote_us']);
  assert.deepEqual(await page.locator('input[name=roles]:checked').evaluateAll((e) => e.map((x) => x.value)), ['senior_pm']);
  assert.match(await page.inputValue('#f-resume'), /Led roadmap for B2B invoicing/);
  const p = await stored(page);
  assert.equal(p.salaryFloor, 180000);
  assert.equal(p.showNoSalary, false);
  assert.equal(p.resume.lines.length, 3);
  await ctx.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

test('no horizontal scroll and 44px touch targets at small phone width', async () => {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  await page.goto(base);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  const small = await page.$$eval('button, .btn, .chip span, .nav a, input.text-input', (els) =>
    els
      .filter((e) => e.offsetParent !== null)
      .map((e) => [e.id || e.textContent.trim().slice(0, 20), Math.round(e.getBoundingClientRect().height)])
      .filter(([, h]) => h < 44)
  );
  assert.deepEqual(small, []);
  await ctx.close();
});

test('remove resume takes two taps', async () => {
  const { ctx, page } = await freshPage();
  await page.click('#btn-paste');
  await page.fill('#f-resume', 'Alex Rivera\nSenior Product Manager');
  await page.click('#btn-remove-resume');
  assert.equal(await page.textContent('#btn-remove-resume'), 'Tap again to remove');
  assert.equal(await page.locator('#resume-filled').isVisible(), true);
  await page.click('#btn-remove-resume');
  assert.equal(await page.locator('#resume-empty').isVisible(), true);
  assert.equal((await stored(page)).resume, null);
  await ctx.close();
});
