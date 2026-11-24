// Shared setup for browser tests: a static server for the repo, Chromium, and helpers to
// open the app at phone size with a seeded profile and a fixed jobs.json.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const { chromium, devices } = require('playwright');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

export async function startServer() {
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const file = p.endsWith('/') ? path.join(p, 'index.html') : p;
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, r));
  const browser = await chromium.launch();
  return {
    base: `http://localhost:${server.address().port}/`,
    browser,
    async stop() {
      await browser.close();
      server.closeAllConnections();
      server.close();
    },
  };
}

export const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();

export function job(i, o = {}) {
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

export function profileWith(resumeText, o = {}) {
  return {
    name: 'Alex',
    resume: { text: resumeText, lines: resumeText.split('\n'), fileName: 'Pasted text', fileType: 'paste', updatedAt: '2026-11-01T00:00:00Z' },
    roles: ['pm', 'senior_pm'],
    locations: ['nyc', 'remote_us'],
    salaryFloor: 170000,
    showNoSalary: true,
    ...o,
  };
}

/** Open the app on Today with a seeded profile/storage and a fixed jobs list. */
export async function openApp(env, { jobs, profile, seed = {} }) {
  const ctx = await env.browser.newContext({ ...devices['iPhone 13'] });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.route(/data\/jobs\.json/, (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ generatedAt: new Date().toISOString(), jobs }) })
  );
  await ctx.addInitScript(({ profile, seed }) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('jf.profile', JSON.stringify(profile));
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, JSON.stringify(v));
  }, { profile, seed });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${env.base}#today`);
  await page.waitForSelector('#deck .job-card.is-top:not(.is-skeleton), #deck .deck-panel');
  return { ctx, page, errors };
}
