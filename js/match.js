// Resume ↔ job match score, computed in the browser. No AI, no network.
//
// Main score: the share of skills a posting asks for (see skills.js) that your resume
// also shows, weighted by how much the posting stresses each one and how distinctive it is.
// Word overlap (terms below) is the fallback for postings that name few lexicon skills.
// Pure functions only, so the same code runs in Node tests.
import { skillCounts, SKILL_BY_ID, resumeEvidenceText } from './skills.js';

const STOP = new Set(
  `a about above across after again all also am an and any are as at be because been before being below between both but by can
  could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is
  it its itself just me more most my no nor not now of off on once only or other our ours out over own same she should so some
  such than that the their theirs them then there these they this those through to too under until up very was we were what when
  where which while who whom why will with would you your yours etc eg ie per via within without across including include includes
  well new work working role roles job jobs company team teams us we're you'll you're it's they're our join looking help helping
  ability able strong great experience experienced year years plus preferred required requirements responsibilities qualifications
  bonus ideal candidate candidates opportunity opportunities benefits salary range base equity compensation pay apply applicants
  employer equal employment status race color religion sex gender identity sexual orientation national origin age disability
  veteran protected law laws applicable location locations office hybrid remote york new nyc ny san francisco based day days week
  weeks month months time full part`
    .split(/\s+/)
    .filter(Boolean)
);

// Light stemming so "roadmaps"/"roadmap" and "launched"/"launch" meet.
function stem(w) {
  if (w.length <= 4) return w;
  if (w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.endsWith('ing') && w.length > 6) return w.slice(0, -3);
  if (w.endsWith('ed') && w.length > 5) return w.slice(0, -2);
  if (w.endsWith('es') && /(ss|x|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** Words and two-word phrases, lowercased, stopwords removed. */
export function terms(text) {
  const words = String(text)
    .toLowerCase()
    .replace(/&[a-z]+;/g, ' ')
    .match(/[a-z][a-z0-9+#.]*[a-z0-9+#]|[a-z]/g);
  if (!words) return [];
  const out = [];
  let prev = null;
  for (const raw of words) {
    if (STOP.has(raw) || raw.length < 2) {
      prev = null;
      continue;
    }
    const w = stem(raw);
    out.push(w);
    if (prev) out.push(`${prev} ${w}`);
    prev = w;
  }
  return out;
}

function counts(list) {
  const m = new Map();
  for (const t of list) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

/**
 * Build a scorer for one resume against a set of job descriptions.
 *
 * Score = share of the skills a posting asks for (from the PM skills lexicon) that the
 * resume also shows. Each skill is weighted by how often the posting mentions it and by how
 * distinctive it is across all postings, so "cross-functional" counts less than "billing".
 * Postings that name fewer than 3 lexicon skills fall back to plain word overlap.
 *
 * @param {string} resumeText
 * @param {{id: string, text: string}[]} docs  all postings (used for rarity weights)
 * @returns {(id: string) => {score: number, matched: {id: string, label: string}[], missing: {id: string, label: string}[]}}
 */
export function buildMatcher(resumeText, docs) {
  const resumeSkills = skillCounts(resumeEvidenceText(resumeText));
  const docSkills = new Map(docs.map((d) => [d.id, skillCounts(d.text)]));
  const df = new Map();
  for (const m of docSkills.values()) for (const id of m.keys()) df.set(id, (df.get(id) ?? 0) + 1);
  const N = Math.max(docs.length, 1);
  const fallback = buildTermMatcher(resumeText, docs);

  const cache = new Map();
  return (id) => {
    if (cache.has(id)) return cache.get(id);
    const asks = docSkills.get(id);
    let result;
    if (!asks || resumeSkills.size === 0) {
      result = { score: 0, matched: [], missing: [] };
    } else if (asks.size < 3) {
      result = { ...fallback(id), matched: [], missing: [] };
    } else {
      const weighted = [...asks.entries()].map(([sid, n]) => {
        const s = SKILL_BY_ID.get(sid);
        // Rarer across postings → more telling. Floor keeps universal skills from vanishing.
        const rarity = Math.max(0.35, Math.log(1 + N / df.get(sid)) / Math.log(1 + N));
        return { id: sid, label: s.label, w: s.w * (1 + Math.log(n)) * rarity };
      });
      weighted.sort((a, b) => b.w - a.w);
      const total = weighted.reduce((t, x) => t + x.w, 0);
      const matched = weighted.filter((x) => resumeSkills.has(x.id));
      const covered = matched.reduce((t, x) => t + x.w, 0);
      // Even a perfect-fit resume rarely shows every skill a posting lists; ~75% coverage reads as a 99.
      const raw = total ? covered / total : 0;
      const score = Math.max(1, Math.min(99, Math.round(100 * Math.min(raw / 0.75, 1) ** 0.8)));
      result = {
        score,
        matched: matched.map(({ id: i, label }) => ({ id: i, label })),
        missing: weighted.filter((x) => !resumeSkills.has(x.id)).map(({ id: i, label }) => ({ id: i, label })),
      };
    }
    cache.set(id, result);
    return result;
  };
}

/** Plain word-overlap score; used when a posting names too few lexicon skills. */
export function buildTermMatcher(resumeText, docs) {
  const resume = new Set(terms(resumeText));
  const docTerms = new Map(docs.map((d) => [d.id, counts(terms(d.text))]));

  const df = new Map();
  for (const c of docTerms.values()) for (const t of c.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const N = Math.max(docs.length, 1);
  // Smoothed IDF; with very few postings, fall back toward plain counts.
  const idf = (t) => Math.log(1 + (N + 1) / ((df.get(t) ?? 0) + 1));

  const cache = new Map();
  return (id) => {
    if (cache.has(id)) return cache.get(id);
    const c = docTerms.get(id);
    if (!c || resume.size === 0) return { score: 0, matched: [] };
    // The posting's top 40 terms by tf·idf are what it's asking for.
    const weighted = [...c.entries()]
      .map(([t, tf]) => [t, (1 + Math.log(tf)) * idf(t) * (t.includes(' ') ? 1.5 : 1)])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40);
    const total = weighted.reduce((s, [, w]) => s + w, 0);
    const hits = weighted.filter(([t]) => resume.has(t));
    const covered = hits.reduce((s, [, w]) => s + w, 0);
    // A resume rarely covers more than ~60% of a posting's asks; stretch so a strong fit reads ~90.
    const raw = total ? covered / total : 0;
    const score = Math.max(1, Math.min(99, Math.round(100 * Math.sqrt(Math.min(raw / 0.6, 1)))));
    const result = { score, matched: hits.map(([t]) => t) };
    cache.set(id, result);
    return result;
  };
}
