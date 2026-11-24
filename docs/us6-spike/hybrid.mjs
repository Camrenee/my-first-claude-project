import fs from 'node:fs';
import { AutoTokenizer, AutoModelForSequenceClassification, env } from '@huggingface/transformers';
import { skillCounts, SKILL_BY_ID } from '/home/user/my-first-claude-project/js/skills.js';
const S = process.argv[2];
env.localModelPath = S + '/models/'; env.allowRemoteModels = false;
const { resume, jobs, out } = JSON.parse(fs.readFileSync(S + '/compare.json'));
const good = new Set(fs.readFileSync(S + '/labels.txt', 'utf8').trim().split(/\s+/).slice(1).map(Number));
const keys = fs.readFileSync(S + '/pool.txt', 'utf8').split('\n').filter((l) => /^\d+\t/.test(l)).map((l) => l.split('\t'));
const label = new Map(keys.map(([n, k]) => [k, good.has(Number(n))]));
const YEARS = /\b\d+\s*\+?\s*(-\s*\d+\s*)?years?\b/i;
const specific = (t) => new Set([...skillCounts(t).keys()].filter((id) => (SKILL_BY_ID.get(id)?.w ?? 1) >= 1));
const shared = (a, b) => { const A = specific(a); return [...specific(b)].filter((x) => A.has(x)).length; };
// cross-encoder
const tok = await AutoTokenizer.from_pretrained('Xenova/ms-marco-MiniLM-L-6-v2');
const ce = await AutoModelForSequenceClassification.from_pretrained('Xenova/ms-marco-MiniLM-L-6-v2', { dtype: 'q8' });
async function ceScore(q, p) { const x = tok(q, { text_pair: p, padding: true, truncation: true }); return (await ce(x)).logits.data[0]; }
function evaluate(name, scoreFn) {
  const scored = []; let tp = 0, n = 0, unl = 0;
  for (const j of jobs) {
    const r = out.gte[j.id];
    const reqs = r.reqs;
    const cands = [];
    reqs.forEach((q, i) => resume.forEach((p, k) => { const s = scoreFn(j.id, i, k, q, p); if (s !== null) cands.push([s, i, k]); }));
    cands.sort((a, b) => b[0] - a[0]);
    const uR = new Set(), uQ = new Set(), top = [];
    for (const c of cands) { if (uR.has(c[2]) || uQ.has(c[1])) continue; top.push(c); uR.add(c[2]); uQ.add(c[1]); if (top.length === 3) break; }
    for (const [, i, k] of top) { const l = label.get(`${j.id}|${i}|${k}`); if (l === undefined) unl++; else { n++; if (l) tp++; } }
    for (const [s, i, k] of cands) { const l = label.get(`${j.id}|${i}|${k}`); if (l !== undefined) scored.push([s, l]); }
  }
  const G = scored.filter((s) => s[1]).map((s) => s[0]), B = scored.filter((s) => !s[1]).map((s) => s[0]);
  let w = 0; for (const g of G) for (const b of B) w += g > b ? 1 : g === b ? 0.5 : 0;
  console.log(`${name.padEnd(34)} top3 precision ${tp}/${n} = ${(tp / n * 100).toFixed(0)}% (${unl} unlabeled)   AUC ${(w / (G.length * B.length)).toFixed(2)}`);
}
const pairScores = new Map();
for (const j of jobs) { const r = out.gte[j.id]; for (let i = 0; i < r.reqs.length; i++) for (let k = 0; k < resume.length; k++) pairScores.set(`${j.id}|${i}|${k}`, await ceScore(r.reqs[i], resume[k])); }
const noYears = (q) => !YEARS.test(q);
for (const m of ['minilm', 'gte']) {
  evaluate(`${m} only`, (id, i, k) => out[m][id].sims[i][k]);
  evaluate(`${m} + drop "N years"`, (id, i, k, q) => (noYears(q) ? out[m][id].sims[i][k] : null));
  evaluate(`${m} + drop years + shared skill`, (id, i, k, q, p) => (noYears(q) ? out[m][id].sims[i][k] + 0.12 * Math.min(shared(q, p), 2) : null));
}
evaluate('re-ranker only, drop years', (id, i, k, q) => (noYears(q) ? pairScores.get(`${id}|${i}|${k}`) : null));
evaluate('gte → re-ranker (top 10 per job)', (() => { const keep = new Set(); for (const j of jobs) { const r = out.gte[j.id]; r.sims.flatMap((row, i) => row.map((s, k) => [s, i, k])).filter(([, i]) => noYears(r.reqs[i])).sort((a, b) => b[0] - a[0]).slice(0, 10).forEach(([, i, k]) => keep.add(`${j.id}|${i}|${k}`)); } return (id, i, k) => (keep.has(`${id}|${i}|${k}`) ? pairScores.get(`${id}|${i}|${k}`) : null); })());
