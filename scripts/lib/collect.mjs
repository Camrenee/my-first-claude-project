// Fetch every board in companies.json and keep in-scope PM postings.
import fs from 'node:fs';
import { fetchBoard, normalize, pool } from './sources.mjs';
import { classifyTitle, jobLocationScope, postedWithin } from './filters.mjs';

export async function collect({ companiesFile = 'data/companies.json', days = 7, now = Date.now(), log = console.error } = {}) {
  const companies = JSON.parse(fs.readFileSync(companiesFile, 'utf8'));
  const failures = [];
  const perBoard = await pool(companies, 10, async (c) => {
    try {
      const raw = (await fetchBoard(c.ats, c.slug)) ?? [];
      return raw.map((r) => normalize(c.ats, c.slug, c.name, r)).map((j) => ({ ...j, company: c.name }));
    } catch (e) {
      failures.push(`${c.ats}:${c.slug} ${e.message}`);
      return [];
    }
  });
  if (failures.length) log(`board fetch failures (${failures.length}):\n  ${failures.join('\n  ')}`);

  const all = perBoard.flat().filter((j) => j.listed !== false);
  const stats = { boards: companies.length, failures: failures.length, postings: all.length, seniorPlusInScope: 0 };
  const kept = [];
  for (const j of all) {
    const titleClass = classifyTitle(j.title);
    const scope = jobLocationScope(j.locations);
    if (scope === 'other' || !postedWithin(j.postedAt, days, now)) continue;
    if (titleClass === 'senior_plus') stats.seniorPlusInScope++;
    if (titleClass !== 'match') continue;
    kept.push({ ...j, scope });
  }
  return { jobs: dedupe(kept), rawCount: kept.length, stats };
}

// The same role is often posted once per city. Keep the newest copy per company + title.
export function dedupe(jobs) {
  const best = new Map();
  for (const j of jobs) {
    const key = `${j.company}|${j.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
    const prev = best.get(key);
    if (!prev || Date.parse(j.postedAt) > Date.parse(prev.postedAt)) best.set(key, j);
  }
  return [...best.values()];
}
