import fs from 'node:fs';
const S = process.argv[2];
const { jobs, out } = JSON.parse(fs.readFileSync(S + '/compare.json'));
const good = new Set(fs.readFileSync(S + '/labels.txt', 'utf8').trim().split(/\s+/).slice(1).map(Number));
const keys = fs.readFileSync(S + '/pool.txt', 'utf8').split('\n').filter((l) => /^\d+\t/.test(l)).map((l) => l.split('\t'));
const label = new Map(keys.map(([n, k]) => [k, good.has(Number(n))]));
console.log(`labeled pairs: ${label.size}, good: ${[...label.values()].filter(Boolean).length}\n`);
console.log('model   top3 precision   AUC    best cutoff → shown pairs, precision');
for (const name of Object.keys(out)) {
  let tp = 0, n = 0;
  const scored = [];
  for (const j of jobs) {
    const r = out[name][j.id];
    for (const [, i, k] of r.top) { n++; if (label.get(`${j.id}|${i}|${k}`)) tp++; }
    for (const [key, g] of label) { const [id, i, k] = key.split('|'); if (id === j.id) scored.push([r.sims[+i][+k], g]); }
  }
  // AUC: chance a good pair outscores a bad pair
  const G = scored.filter((s) => s[1]).map((s) => s[0]), B = scored.filter((s) => !s[1]).map((s) => s[0]);
  let w = 0; for (const g of G) for (const b of B) w += g > b ? 1 : g === b ? 0.5 : 0;
  const auc = w / (G.length * B.length);
  // cutoff giving the most good pairs at >= 85% precision
  const cuts = [...new Set(scored.map((s) => s[0]))].sort((a, b) => a - b);
  let best = null;
  for (const c of cuts) { const shown = scored.filter((s) => s[0] >= c); const p = shown.filter((s) => s[1]).length / shown.length; if (p >= 0.85 && (!best || shown.length > best.shown)) best = { c, shown: shown.length, p, good: shown.filter((s) => s[1]).length }; }
  console.log(`${name.padEnd(7)} ${tp}/${n} = ${(tp / n * 100).toFixed(0)}%`.padEnd(25), auc.toFixed(2), '  ', best ? `≥${best.c.toFixed(3)} → ${best.shown} pairs (${best.good} good), ${(best.p * 100).toFixed(0)}%` : 'none reaches 85%');
}
