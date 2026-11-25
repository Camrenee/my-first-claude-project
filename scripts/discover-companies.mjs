// Company discovery test: can Claude (with web search) find more NYC / US-remote companies
// that hire PMs, so the feed gets more jobs? Claude only *suggests* companies; every suggestion
// is then checked against the real Greenhouse / Lever / Ashby APIs, so nothing made up gets in.
//
// Setup:  npm install --no-save @anthropic-ai/sdk@1.7.0
// Run:    ANTHROPIC_API_KEY=... node scripts/discover-companies.mjs out-dir
// Writes: out-dir/suggestions.json (Claude's raw suggestions), out-dir/verified.json (boards that exist
//         and have NYC / US-remote postings, not already in data/companies.json)
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { fetchBoard, normalize, pool } from './lib/sources.mjs';
import { jobLocationScope } from './lib/filters.mjs';

const outDir = process.argv[2] ?? '.';
const MODEL = 'claude-opus-5-5';
const PRICE = { in: 4, out: 20 }; // $ per 1M tokens for Claude Opus 5.5
const SEARCH_PRICE = 0.01; // $ per web search (estimate; actual billing is on the Anthropic account)
const BUDGET = 3; // stop asking Claude once estimated spend passes this many dollars

const SEGMENTS = [
  'fintech, payments, banking infrastructure, insurance and crypto',
  'AI / machine learning companies and AI-native startups',
  'B2B SaaS, developer tools, data and infrastructure software',
  'consumer apps, marketplaces, e-commerce and media',
  'health tech, HR / payroll tech, edtech and climate tech',
  'later-stage startups (Series B to pre-IPO) not covered by the segments above',
];

const existing = JSON.parse(fs.readFileSync('data/companies.json', 'utf8'));
const existingNames = existing.map((c) => c.name);

const client = new Anthropic();
let spend = 0;
let searches = 0;

function prompt(segment) {
  return `I'm building a job feed for product managers in New York City (Manhattan, including hybrid) or remote in the US.

Find up to 40 companies in this segment: ${segment}.
Each must (a) have a New York City office or hire US-remote, (b) employ product managers, and
(c) most likely post jobs on Greenhouse, Lever or Ashby (boards like boards.greenhouse.io/<slug>,
jobs.lever.co/<slug> or jobs.ashbyhq.com/<slug>). Use web search to check NYC presence and the job
board when you aren't sure.

Skip these companies, which are already covered: ${existingNames.join(', ')}.

Finish with only a JSON code block in this shape:
\`\`\`json
{"companies":[{"name":"Example","website":"example.com","ats":"greenhouse|lever|ashby|unknown","slug":"best guess or empty"}]}
\`\`\``;
}

async function ask(segment) {
  const messages = [{ role: 'user', content: prompt(segment) }];
  let response;
  for (let turn = 0; turn < 5; turn++) {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6 }],
      messages,
    });
    const u = response.usage;
    searches += u.server_tool_use?.web_search_requests ?? 0;
    spend +=
      ((u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)) * PRICE.in + u.output_tokens * PRICE.out) / 1e6 +
      (u.server_tool_use?.web_search_requests ?? 0) * SEARCH_PRICE;
    if (response.stop_reason !== 'pause_turn') break;
    // Server-side search loop paused: send the turn back and it resumes where it left off.
    messages.splice(1, messages.length - 1, { role: 'assistant', content: response.content });
  }
  if (response.stop_reason === 'refusal') return [];
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  try {
    return JSON.parse(blocks.at(-1)?.[1] ?? '{}').companies ?? [];
  } catch {
    return [];
  }
}

// ---------- 1. Ask Claude, segment by segment, within budget ----------
const suggestions = [];
for (const segment of SEGMENTS) {
  if (spend > BUDGET) {
    console.log(`budget reached ($${spend.toFixed(2)}); skipping: ${segment}`);
    continue;
  }
  const found = await ask(segment);
  console.log(`${segment}: ${found.length} suggestions (running total ~$${spend.toFixed(2)}, ${searches} searches)`);
  suggestions.push(...found.map((c) => ({ ...c, segment })));
}
fs.writeFileSync(path.join(outDir, 'suggestions.json'), JSON.stringify(suggestions, null, 2));

// ---------- 2. Verify every suggestion against the real job boards ----------
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const known = new Set([...existing.map((c) => `${c.ats}:${c.slug}`)]);
const knownNames = new Set(existing.map((c) => norm(c.name)));

function slugCandidates(c) {
  const domain = String(c.website ?? '').replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[./]/)[0];
  const name = String(c.name ?? '');
  return [...new Set([c.slug, norm(name), name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-'), norm(domain), `${norm(name)}hq`, `${norm(name)}inc`].filter(Boolean).map((s) => s.toLowerCase()))];
}

const ATS = ['greenhouse', 'lever', 'ashby'];
const unique = [...new Map(suggestions.filter((c) => !knownNames.has(norm(c.name))).map((c) => [norm(c.name), c])).values()];
const checks = unique.flatMap((c) => {
  const order = ATS.includes(c.ats) ? [c.ats, ...ATS.filter((a) => a !== c.ats)] : ATS;
  return slugCandidates(c).flatMap((slug) => order.map((ats) => ({ c, ats, slug })));
});
console.log(`checking ${unique.length} new suggestions (${checks.length} board lookups)…`);

const hits = await pool(checks, 10, async ({ c, ats, slug }) => {
  if (known.has(`${ats}:${slug}`)) return null;
  let raw;
  try {
    raw = await fetchBoard(ats, slug, { retries: 1 });
  } catch {
    return null;
  }
  if (!raw?.length) return null;
  const jobs = raw.map((r) => normalize(ats, slug, c.name, r)).filter((j) => j.listed !== false);
  const inScope = jobs.filter((j) => jobLocationScope(j.locations) !== 'other').length;
  if (!inScope) return null;
  // Board names on Greenhouse let us catch a slug that belongs to a different company.
  return { name: c.name, ats, slug, segment: c.segment, total: jobs.length, nycOrRemote: inScope, boardName: jobs[0]?.company ?? '' };
});

// One board per company: prefer the one with the most NYC / remote postings.
const best = new Map();
for (const h of hits.filter(Boolean)) {
  const k = norm(h.name);
  if (!best.has(k) || h.nycOrRemote > best.get(k).nycOrRemote) best.set(k, h);
}
const verified = [...best.values()].sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(path.join(outDir, 'verified.json'), JSON.stringify(verified, null, 2));
console.log(`verified: ${verified.length} new companies with live boards and NYC / US-remote postings`);
console.log(`Claude cost estimate: ~$${spend.toFixed(2)} (${searches} web searches)`);
