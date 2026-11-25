// How many matching jobs per week would the feed get with today's companies vs. an expanded list?
// Same filters as the data test: PM / Senior PM, NYC (incl. hybrid) or US-remote, salary max above
// $170K or not listed, one copy per company + title.
// Usage: node scripts/compare-coverage.mjs path/to/verified.json
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collect } from './lib/collect.mjs';

const extraFile = process.argv[2];
const FLOOR = 170000;
const base = JSON.parse(fs.readFileSync('data/companies.json', 'utf8'));
const extra = JSON.parse(fs.readFileSync(extraFile, 'utf8')).map(({ name, ats, slug }) => ({ name, ats, slug }));
const tmp = path.join(os.tmpdir(), `companies-extra-${process.pid}.json`);
fs.writeFileSync(tmp, JSON.stringify(extra));

const now = Date.now();
const keep = (j) => !j.salary || j.salary.max > FLOOR;
const in7 = (j) => now - Date.parse(j.postedAt) <= 7 * 864e5;

const a = await collect({ days: 28, now, log: () => {} });
const b = await collect({ companiesFile: tmp, days: 28, now, log: () => {} });
fs.unlinkSync(tmp);

const row = (label, jobs) => {
  const w7 = jobs.filter(in7).filter(keep).length;
  const w28 = jobs.filter(keep).length / 4;
  return { label, w7, w28 };
};
const before = row(`Today's list (${base.length} companies)`, a.jobs);
const added = row(`New companies only (${extra.length})`, b.jobs);
const after = { label: `Combined (${base.length + extra.length})`, w7: before.w7 + added.w7, w28: before.w28 + added.w28 };

console.log('| List | Last 7 days | Avg / week over 28 days |\n|---|---|---|');
for (const r of [before, added, after]) console.log(`| ${r.label} | ${r.w7} | ${r.w28.toFixed(1)} |`);
console.log(`\nGain: +${Math.round(((after.w28 - before.w28) / Math.max(before.w28, 0.1)) * 100)}% (28-day average). Go bar: +50%.`);
const top = Object.entries(b.jobs.filter(keep).reduce((m, j) => ((m[j.company] = (m[j.company] ?? 0) + 1), m), {})).sort((x, y) => y[1] - x[1]).slice(0, 15);
console.log(`Top new companies (matching jobs, 28 days): ${top.map(([k, v]) => `${k} ${v}`).join(', ')}`);
