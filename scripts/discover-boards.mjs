// Dev tool: probe candidate company slugs on every supported job board and report
// which boards exist and how many NYC / US-remote postings they carry.
// Usage: node scripts/discover-boards.mjs scripts/candidate-slugs.txt out.json [cacheDir]
import fs from 'node:fs';
import path from 'node:path';
import { SOURCES, fetchBoard, normalize, pool } from './lib/sources.mjs';
import { classifyTitle, jobLocationScope } from './lib/filters.mjs';

const [slugFile, outFile, cacheDir] = process.argv.slice(2);
const slugs = [...new Set(fs.readFileSync(slugFile, 'utf8').split(/\s+/).filter(Boolean))];
const tasks = slugs.flatMap((slug) => Object.keys(SOURCES).map((ats) => ({ ats, slug })));

const results = (
  await pool(tasks, 10, async ({ ats, slug }) => {
    let raw;
    try {
      raw = await fetchBoard(ats, slug, { retries: 1 });
    } catch (e) {
      return { ats, slug, error: e.message };
    }
    if (!raw || raw.length === 0) return null;
    if (cacheDir) fs.writeFileSync(path.join(cacheDir, `${ats}__${slug}.json`), JSON.stringify(raw));
    const jobs = raw.map((r) => normalize(ats, slug, slug, r)).filter((j) => j.listed !== false);
    const inScope = jobs.filter((j) => jobLocationScope(j.locations) !== 'other');
    return {
      ats,
      slug,
      company: jobs[0]?.company ?? slug,
      total: jobs.length,
      nycOrRemote: inScope.length,
      pmInScope: inScope.filter((j) => classifyTitle(j.title) === 'match').length,
    };
  })
).filter(Boolean);

fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
const ok = results.filter((r) => !r.error);
for (const ats of Object.keys(SOURCES)) {
  const r = ok.filter((x) => x.ats === ats);
  console.log(`${ats}: ${r.length} boards, ${r.filter((x) => x.nycOrRemote).length} with NYC/US-remote jobs`);
}
console.log(`errors: ${results.length - ok.length}`);
