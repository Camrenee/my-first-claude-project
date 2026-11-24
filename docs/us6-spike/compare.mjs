import fs from 'node:fs';
import { pipeline, env } from '@huggingface/transformers';
import { requirements } from './requirements.mjs';
env.localModelPath = process.argv[2] + '/models/'; env.allowRemoteModels = false;
const jobs = JSON.parse(fs.readFileSync('/home/user/my-first-claude-project/data/jobs.json')).jobs;
const RESUME = fs.readFileSync(process.argv[2] + '/resume.txt', 'utf8').trim().split('\n').map((l) => l.replace(/^•\s*/, ''));
const MODELS = {
  minilm: { id: 'Xenova/all-MiniLM-L6-v2', q: '', p: '' },
  bge: { id: 'Xenova/bge-small-en-v1.5', q: 'Represent this sentence for searching relevant passages: ', p: '' },
  e5: { id: 'Xenova/e5-small-v2', q: 'query: ', p: 'passage: ' },
  gte: { id: 'Xenova/gte-small', q: '', p: '' },
};
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const out = {};
for (const [name, m] of Object.entries(MODELS)) {
  const embed = await pipeline('feature-extraction', m.id, { dtype: 'q8' });
  const vec = async (t) => (await embed(t, { pooling: m.id.includes('bge') ? 'cls' : 'mean', normalize: true })).tolist();
  const R = await vec(RESUME.map((r) => m.p + r));
  out[name] = {};
  for (const j of jobs) {
    const reqs = requirements(j.descriptionHtml).map((r) => r.text);
    const Q = await vec(reqs.map((r) => m.q + r));
    const sims = Q.map((q) => R.map((r) => dot(q, r)));
    // all pairs (for scoring) + greedy top 3
    const flat = sims.flatMap((row, i) => row.map((s, k) => [s, i, k])).sort((a, b) => b[0] - a[0]);
    const top = []; const uR = new Set(); const uQ = new Set();
    for (const [s, i, k] of flat) { if (uR.has(k) || uQ.has(i)) continue; top.push([s, i, k]); uR.add(k); uQ.add(i); if (top.length === 3) break; }
    out[name][j.id] = { reqs, sims, top };
  }
}
fs.writeFileSync(process.argv[2] + '/compare.json', JSON.stringify({ resume: RESUME, jobs: jobs.map((j) => ({ id: j.id, co: j.company })), out }));
// Candidate pool to label: union of every model's top-3, shown without model names.
const pool = new Map();
for (const name of Object.keys(MODELS)) for (const j of jobs) for (const [, i, k] of out[name][j.id].top) {
  const key = `${j.id}|${i}|${k}`;
  if (!pool.has(key)) pool.set(key, { job: j.company, want: out[name][j.id].reqs[i], did: RESUME[k] });
}
let n = 0;
for (const [key, p] of pool) console.log(`${++n}\t${key}\n   WANT (${p.job}): ${p.want.slice(0, 150)}\n   DID: ${p.did}`);
