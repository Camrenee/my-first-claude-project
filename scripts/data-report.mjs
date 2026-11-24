// Data test: how many matching jobs per week would the feed get? Go/no-go on the 28-day weekly average.
// Usage: NODE_USE_ENV_PROXY=1 node scripts/data-report.mjs [--floor 170000] > report.md
import { collect } from './lib/collect.mjs';

const floorArg = process.argv.indexOf('--floor');
const FLOOR = floorArg > -1 ? Number(process.argv[floorArg + 1]) : 170000;
const GO = 15; // PM decision 2026-11-22: lowered from 30 (option 1). Goal is 2 applications/week.
const now = Date.now();

// Pull 28 days once; slice the last 7 from it.
const { jobs: jobs28, stats } = await collect({ days: 28, now });
const in7 = (j) => now - Date.parse(j.postedAt) <= 7 * 864e5;

function summarize(list) {
  const noSalary = list.filter((j) => !j.salary).length;
  const aboveFloor = list.filter((j) => j.salary && j.salary.max > FLOOR).length;
  const belowFloor = list.length - noSalary - aboveFloor;
  return { total: list.length, aboveFloor, noSalary, belowFloor, feedShowNoSalary: aboveFloor + noSalary, feedHideNoSalary: aboveFloor };
}
const bySource = (list, set) => list.filter((j) => set.includes(j.ats));
const GL = ['greenhouse', 'lever'];
const ALL = ['greenhouse', 'lever', 'ashby'];

const rows = [];
for (const [label, set] of [
  ['Greenhouse + Lever (PRD scope)', GL],
  ['Ashby only', ['ashby']],
  ['All three', ALL],
]) {
  const w7 = summarize(bySource(jobs28, set).filter(in7));
  const w28 = summarize(bySource(jobs28, set));
  rows.push({ label, w7, w28 });
}

const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const verdict = (n) => (n >= GO ? '✅ GO' : '⛔ NO-GO');
let md = `# Data test — ${new Date(now).toISOString().slice(0, 10)}\n\n`;
md += `> **PM decision (2026-11-22):** bar lowered from 30 to ${GO} matching jobs/week (goal is 2 applications/week; queue holds 5). Keep Ashby. Proceed to US1. First run measured about 14.5/wk for all three sources — just under the bar. Proceeding anyway is a deliberate call; growing the company list toward 300 is the follow-up.\n\n`;
md += `Boards: ${stats.boards} (${stats.failures} failed). Postings scanned: ${stats.postings}.\n`;
md += `Filters: PM / Senior PM titles, NYC (incl. hybrid) or US-remote, salary max > $${FLOOR / 1000}K or not listed. Duplicate copies of the same role (company + title) counted once.\n\n`;
md += `| Source | Last 7 days | 28-day avg / week | of which no salary (7d) | Hidden by floor (7d) | Go/no-go (≥${GO}/wk, 28-day avg) |\n|---|---|---|---|---|---|\n`;
for (const r of rows)
  md += `| ${r.label} | **${r.w7.feedShowNoSalary}** | ${fmt(r.w28.feedShowNoSalary / 4)} | ${r.w7.noSalary} | ${r.w7.belowFloor} | ${verdict(r.w28.feedShowNoSalary / 4)} |\n`;
md += `\nIf "show jobs with no salary" is off: Greenhouse + Lever = ${rows[0].w7.feedHideNoSalary}/wk, all three = ${rows[2].w7.feedHideNoSalary}/wk.\n`;
md += `Staff/Principal/Lead/Group PM roles excluded by the title rule (28d, all sources): ${stats.seniorPlusInScope}.\n\n`;

const top = Object.entries(
  jobs28.filter(in7).reduce((m, j) => ((m[`${j.company} (${j.ats})`] = (m[`${j.company} (${j.ats})`] ?? 0) + 1), m), {})
)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15);
md += `Top companies, last 7 days (before salary filter): ${top.map(([k, v]) => `${k} ${v}`).join(', ')}\n\n`;
md += `## Matching jobs, last 7 days\n\n| Posted | Company | Source | Title | Where | Salary |\n|---|---|---|---|---|---|\n`;
for (const j of jobs28.filter(in7).sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt))) {
  const sal = j.salary ? `$${Math.round(j.salary.min / 1000)}K–$${Math.round(j.salary.max / 1000)}K${j.salary.max <= FLOOR ? ' (below floor)' : ''}` : 'not listed';
  md += `| ${j.postedAt.slice(0, 10)} | ${j.company} | ${j.ats} | [${j.title.replace(/\|/g, '/')}](${j.url}) | ${j.scope === 'nyc' ? 'NYC' : 'US remote'} | ${sal} |\n`;
}
process.stdout.write(md);
