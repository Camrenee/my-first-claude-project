// Split a job posting into its requirements ("They want …") and a resume into the lines that
// can serve as evidence ("You did …"). Pure string work (no DOM), so it runs in Node tests too.
// Ported from the US6 spike (docs/us6-spike/requirements.mjs), where it was checked on real postings.
import { isBoilerplate } from './job-text.js';
import { isResumeHeading } from './skills.js';
import { joinWrappedLines, TRAILING_DATES } from './resume-parse.js';

const decode = (s) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&rsquo;|&apos;|&#8217;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;|&#822[01];/g, '"');
const strip = (s) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

const SECTION = [
  ['resp', /(what you('|’)?ll do|what you will do|responsibilit|in this role|the role|your impact|day[- ]to[- ]day|you will|what you('|’)?ll be doing|your role|the job)/i],
  ['nice', /(nice to have|bonus|preferred|plus if|extra credit)/i],
  ['req', /(what you('|’)?ll bring|requirements|qualifications|about you|you have|you might|looking for|who you are|what we look for|what you bring|experience|skills)/i],
];
// Pay and "apply anyway" lines that slip past the general boilerplate filter.
const EXTRA_NOISE = /salary expectations|total rewards|incentive compensation|eligible for|equity grant|bonus program|encourage you to apply|check every box|meet all (the )?listed requirements|hold back from applying/i;

export const MAX_REQUIREMENTS = 20;

/** Requirements in posting order: responsibilities, then requirements, then nice-to-haves. */
export function extractRequirements(html = '') {
  const blocks = [];
  const re = /<(h[1-6]|li|p|div)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(String(html)))) {
    const tag = m[1].toLowerCase();
    const text = strip(m[2]);
    if (!text) continue;
    const headingLike =
      /^h/.test(tag) || (text.length < 70 && (/^<(strong|b)>/i.test(m[2].trim()) || /:$/.test(text)) && !/[.!?]$/.test(text));
    blocks.push({ kind: headingLike ? 'h' : tag === 'li' ? 'li' : 'p', text });
  }
  let section = 'other';
  const items = [];
  for (const b of blocks) {
    if (b.kind === 'h') {
      section = (SECTION.find(([, r]) => r.test(b.text)) ?? ['other'])[0];
      continue;
    }
    items.push({ ...b, section });
  }
  const good = (t) => t.length >= 25 && t.length <= 320 && !isBoilerplate(t) && !EXTRA_NOISE.test(t);
  let picked = items.filter((i) => i.kind === 'li' && i.section !== 'other' && good(i.text));
  if (picked.length < 4) picked = items.filter((i) => i.kind === 'li' && good(i.text));
  if (picked.length < 4) {
    picked = items
      .filter((i) => i.section !== 'other')
      .flatMap((i) => i.text.split(/(?<=[.!?])\s+(?=[A-Z])/).map((t) => ({ ...i, text: t })))
      .filter((i) => good(i.text));
  }
  const order = { resp: 0, req: 1, other: 2, nice: 3 };
  return [...new Map(picked.map((p) => [p.text, p])).values()]
    .sort((a, b) => order[a.section] - order[b.section])
    .slice(0, MAX_REQUIREMENTS)
    .map((p) => p.text);
}

const CONTACT = /@|linkedin\.com|github\.com|https?:\/\/|\(\d{3}\)|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/i;
const DATE_RANGE = /\b(19|20)\d{2}\s*[–—-]\s*((19|20)\d{2}|present|current|now)\b/i;
export const MAX_RESUME_LINES = 40;

/**
 * Resume lines that can prove something: accomplishments, not headings, contact details,
 * or "Title, Company — 2019–2021" lines. Returns the lines exactly as written (bullet dot
 * removed), so they can be quoted word for word.
 */
export function resumeEvidenceLines(lines = []) {
  const out = [];
  for (const raw of joinWrappedLines(lines)) {
    const line = String(raw).replace(/^\s*[•▪●◦*–-]\s*/, '').trim();
    if (line.length < 25 || isResumeHeading(line) || CONTACT.test(line)) continue;
    if ((DATE_RANGE.test(line) || TRAILING_DATES.test(line)) && line.length < 140 && !/^\s*[•▪●◦*–-]/.test(raw)) continue; // job title / dates line
    if (/^(skills?|tools|technologies|languages|certifications?)\s*:/i.test(line)) continue;
    if (!out.includes(line)) out.push(line);
    if (out.length >= MAX_RESUME_LINES) break;
  }
  return out;
}
