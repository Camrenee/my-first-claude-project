// Build data/jobs.json: PM / Senior PM postings in NYC or US-remote from the last 7 days.
// Personal filters (salary floor, passed jobs) are applied in the browser.
// Usage: NODE_USE_ENV_PROXY=1 node scripts/fetch-jobs.mjs [--days 7] [--out data/jobs.json]
import fs from 'node:fs';
import { collect } from './lib/collect.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), [])
);
const days = Number(args.days ?? 7);
const out = args.out ?? 'data/jobs.json';

const { jobs, stats } = await collect({ days });
jobs.sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt));
const slim = jobs.map(({ listed, descriptionText, ...j }) => j);
fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), days, count: slim.length, jobs: slim }) + '\n');
console.log(`${slim.length} jobs written to ${out} (${stats.postings} postings scanned across ${stats.boards} boards)`);
