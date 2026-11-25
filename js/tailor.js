// US3 Tailoring: the prompt, reading Claude's answer, the safety checks, and the final resume.
// Pure string work (no DOM, no storage), so it is unit-tested in Node.
//
// How it stays honest:
// - Claude can only reword lines we mark [edit] (accomplishment lines). Names, contact details,
//   headings, job titles, companies, dates and skills lists can't change.
// - Claude adds no lines of its own except one short summary.
// - Any change that brings in a number not already in that line (or, for the summary, anywhere in
//   the resume) is held back: the original line is kept unless the person chooses otherwise.
// - A change that names a skill or domain the resume never mentions is flagged for review.
import { isResumeHeading, SKILLS } from './skills.js';
import { joinWrappedLines, TRAILING_DATES } from './resume-parse.js';

export const PROMPT_VERSION = 1;
export const SUMMARY_MAX = 320;
const DESCRIPTION_MAX = 7000;

const BULLET = /^\s*•\s*/;
const CONTACT = /@|linkedin\.com|github\.com|https?:\/\/|\(\d{3}\)|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/i;
const SKILLS_LINE = /^(skills?|tools|technologies|technical skills|languages|certifications?|interests)\s*:/i;
const SUMMARY_HEADING = /^\s*(summary|profile|professional summary|about( me)?|objective)\s*:?\s*$/i;
const EXPERIENCE_HEADING = /experience|employment|work history/i;
const FIXED_SECTION = /education|certification|award|honor|language|interest|reference/i;

export class TailorAnswerError extends Error {}

// ---------- The resume, line by line ----------

/** A title line's dates, split off: {main, dates} or null. "PM, Acme — 2019–2021" → {main: "PM, Acme", dates: "2019–2021"}. */
export function splitDates(text) {
  const m = TRAILING_DATES.exec(text);
  if (!m || m.index < 3) return null;
  const main = text.slice(0, m.index).replace(/[\s,|–—-]+$/, '');
  return main.length >= 3 ? { main, dates: m[1] } : null;
}

/**
 * Each resume line with its role in the document:
 * name (first line), contact, heading, org (company line above a title), role ("Title, Company
 * Apr. 2021 – Present", with `main` and `dates` split), bullet, text.
 * Lines a PDF wrapped are joined first. `editable` lines are the only ones Claude may reword:
 * accomplishments outside education and similar fixed sections.
 */
export function resumeModel(lines = []) {
  const joined = joinWrappedLines(lines);
  let seenHeading = false;
  let fixedSection = false;
  const model = joined.map((raw, i) => {
    const bullet = BULLET.test(raw);
    const text = String(raw).replace(BULLET, '').trim();
    let kind = 'text';
    let split = null;
    if (i === 0 && !bullet && text.length < 60 && !CONTACT.test(text)) kind = 'name';
    else if (!bullet && isResumeHeading(text)) kind = 'heading';
    else if (!bullet && CONTACT.test(text) && !seenHeading) kind = 'contact';
    else if (!bullet && text.length < 140 && (split = splitDates(text))) kind = 'role';
    else if (bullet) kind = 'bullet';
    if (kind === 'heading') {
      seenHeading = true;
      fixedSection = FIXED_SECTION.test(text);
    }
    const editable = (kind === 'bullet' || kind === 'text') && !fixedSection && text.length >= 25 && !SKILLS_LINE.test(text) && !CONTACT.test(text);
    return { i, kind, text, bullet, editable, ...(split ?? {}) };
  });
  // A short line just above a dated title is the company: "American Express".
  model.forEach((l, k) => {
    if (l.kind === 'text' && !l.bullet && l.text.length < 60 && !/[.!?]$/.test(l.text) && model[k + 1]?.kind === 'role') {
      l.kind = 'org';
      l.editable = false;
    }
  });
  return model;
}

export function hasSummary(model) {
  return model.some((l) => l.kind === 'heading' && SUMMARY_HEADING.test(l.text));
}

// ---------- The prompt ----------

export const RULES = [
  'Reword the lines marked [edit] so they speak to this job: use its keywords and lead with what it cares about most. Keep every fact and the meaning of each line.',
  'Reframe true experience only. Never add skills, tools, titles, companies, numbers, dates or experience that aren’t already in my resume. Never change or add a number.',
  'Only lines marked [edit] may change. Leave out lines that don’t need to change. Don’t delete, merge, split or reorder lines.',
  'Keep each reworded line about as long as the original or shorter: the resume must fit on one page.',
];

/**
 * The text the person copies into Claude.
 * @param job {title, company}
 * @param description job description as paragraphs (boilerplate already removed)
 * @param model resumeModel(lines)
 */
export function buildTailorPrompt(job, description, model) {
  const summaryRule = hasSummary(model)
    ? 'My resume already has a summary: reword those lines like the others and leave "summary" empty.'
    : `Write a short summary for the top of my resume: 2 sentences, under ${SUMMARY_MAX - 40} characters, built only from what my resume shows. Don’t count years of experience.`;
  const rules = [...RULES, summaryRule].map((r, n) => `${n + 1}. ${r}`).join('\n');
  let desc = description.join('\n');
  if (desc.length > DESCRIPTION_MAX) desc = `${desc.slice(0, DESCRIPTION_MAX)}…`;
  const resume = model.map((l) => `${l.i} ${l.editable ? '[edit]' : '[fixed]'} ${l.text}`).join('\n');
  return `Help me tailor my resume for one job. Follow every rule.

RULES
${rules}

JOB: ${job.title} at ${job.company}
${desc}

MY RESUME (numbered lines)
${resume}

ANSWER FORMAT
Reply with only this JSON in one code block, and nothing else:
\`\`\`json
{"summary": "the short summary, or empty", "changes": [{"line": 7, "text": "the reworded line"}]}
\`\`\``;
}

// ---------- Reading the answer ----------

/** Pull {summary, changes} out of whatever the person pasted (a code block, or bare JSON). */
export function parseTailorAnswer(pasted) {
  const text = String(pasted ?? '').trim();
  if (!text) throw new TailorAnswerError('Paste Claude’s reply first.');
  const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1]);
  const candidates = [...blocks.reverse(), text];
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const data = JSON.parse(c.replace(/[“”]/g, '"'));
      if (data && typeof data === 'object' && (Array.isArray(data.changes) || typeof data.summary === 'string')) {
        return { summary: typeof data.summary === 'string' ? data.summary.trim() : '', changes: Array.isArray(data.changes) ? data.changes : [] };
      }
    } catch {
      /* try the next candidate */
    }
  }
  throw new TailorAnswerError('That doesn’t look like Claude’s answer. Copy Claude’s whole reply, including the part in the code box, and paste it here.');
}

// ---------- Checks ----------

/** Numbers as written, without commas: "$1,200" → "1200", "40%" → "40", "2.5x" → "2.5". */
export function numbersIn(text) {
  return new Set((String(text).match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, '').replace(/\.0+$/, '')));
}

function newNumbers(tailored, source) {
  const have = numbersIn(source);
  return [...numbersIn(tailored)].filter((n) => !have.has(n));
}

/** Skills or domains a new line names that the resume never mentions. */
export function newSkills(tailored, resumeText) {
  const out = [];
  for (const s of SKILLS) {
    const re = new RegExp(s.re.source, 'i');
    if (re.test(tailored) && !re.test(resumeText)) out.push(s.label);
  }
  return out;
}

/**
 * Check Claude's answer against the resume.
 * Returns { summary, changes, ignored } where:
 *   summary: {text, warnings[], held} | null
 *   changes: [{i, original, tailored, warnings[], held}] in resume order
 *   ignored: number of entries that weren't usable (bad line numbers, fixed lines, repeats, no-ops)
 * `held` changes start out showing the original line; the person can still choose the new one.
 */
export function reviewAnswer(model, answer) {
  const resumeText = model.map((l) => l.text).join('\n');
  const seen = new Set();
  const changes = [];
  let ignored = 0;
  for (const c of answer.changes ?? []) {
    const i = Number(c?.line);
    const tailored = String(c?.text ?? '').replace(BULLET, '').replace(/\s+/g, ' ').trim();
    const line = model[i];
    if (!Number.isInteger(i) || !line || !line.editable || seen.has(i) || !tailored || tailored === line.text) {
      ignored++;
      continue;
    }
    seen.add(i);
    const warnings = [];
    const nums = newNumbers(tailored, line.text);
    if (nums.length) warnings.push(`Adds ${list(nums)}, which this line doesn’t have, so we kept your original.`);
    const skills = newSkills(tailored, resumeText);
    if (skills.length) warnings.push(`Mentions ${list(skills)}, which your resume doesn’t show. Keep it only if it’s true.`);
    changes.push({ i, original: line.text, tailored, warnings, held: nums.length > 0 });
  }
  changes.sort((a, b) => a.i - b.i);

  let summary = null;
  const s = String(answer.summary ?? '').replace(/\s+/g, ' ').trim();
  if (s && !hasSummary(model)) {
    const warnings = [];
    const nums = newNumbers(s, resumeText);
    if (nums.length) warnings.push(`Adds ${list(nums)}, which isn’t in your resume, so we left the summary out.`);
    const skills = newSkills(s, resumeText);
    if (skills.length) warnings.push(`Mentions ${list(skills)}, which your resume doesn’t show. Keep it only if it’s true.`);
    if (s.length > SUMMARY_MAX) warnings.push('It’s long for one page; we may drop it to fit.');
    summary = { text: s, warnings, held: nums.length > 0 };
  }
  return { summary, changes, ignored };
}

function list(items) {
  const q = items.map((x) => `“${x}”`);
  return q.length < 2 ? q.join('') : `${q.slice(0, -1).join(', ')} and ${q.at(-1)}`;
}

// ---------- The final resume ----------

/**
 * The resume to print: an array of {kind, text, src} where src is the original line number or
 * 'summary'. `use` maps a change's line number (or 'summary') to true (use Claude's version) or
 * false (keep the original / leave the summary out). `omit` is a Set of line numbers (and maybe
 * 'summary') dropped to fit one page.
 */
export function composeResume(model, review, use = {}, omit = new Set()) {
  const byLine = new Map(review.changes.map((c) => [c.i, c]));
  const out = [];
  const summaryOn = review.summary && choice(use, 'summary', review.summary) && !omit.has('summary');
  // The summary goes after the name and contact lines, before the first section.
  let insertAt = model.findIndex((l) => l.kind !== 'name' && l.kind !== 'contact');
  if (insertAt === -1) insertAt = model.length;
  for (const l of model) {
    if (summaryOn && l.i === insertAt) out.push({ kind: 'heading', text: 'Summary', src: 'summary' }, { kind: 'text', text: review.summary.text, src: 'summary' });
    if (omit.has(l.i)) continue;
    const c = byLine.get(l.i);
    if (l.kind === 'role') out.push({ kind: 'role', text: l.main, dates: l.dates, src: l.i });
    else out.push({ kind: l.kind, text: c && choice(use, l.i, c) ? c.tailored : l.text, src: l.i });
  }
  if (summaryOn && insertAt === model.length) out.push({ kind: 'heading', text: 'Summary', src: 'summary' }, { kind: 'text', text: review.summary.text, src: 'summary' });
  return out;
}

/** Whether a change is in use: the person's pick, otherwise "yes" unless the checks held it back. */
export function choice(use, key, change) {
  return key in use ? Boolean(use[key]) : !change.held;
}

/**
 * What to drop, in order, when the resume runs over one page (the PRD's rule): the oldest role's
 * bullets, last first, then the summary. Returns an array of steps; each step is the full Set of
 * things to omit at that point. The most recent role is never trimmed.
 */
export function trimSteps(model, review) {
  const roles = rolesIn(model);
  const steps = [];
  const omit = new Set();
  const oldest = roles.length > 1 ? roles.at(-1) : null;
  if (oldest) {
    for (const i of [...oldest.bullets].reverse()) {
      omit.add(i);
      steps.push(new Set(omit));
    }
  }
  if (review.summary) {
    omit.add('summary');
    steps.push(new Set(omit));
  }
  return steps;
}

/** Roles in the experience section (or anywhere, if there are no headings), newest first. */
export function rolesIn(model) {
  const hasExperience = model.some((l) => l.kind === 'heading' && EXPERIENCE_HEADING.test(l.text));
  let inExperience = !hasExperience;
  const roles = [];
  let current = null;
  for (const l of model) {
    if (l.kind === 'heading') {
      inExperience = !hasExperience || EXPERIENCE_HEADING.test(l.text);
      current = null;
      continue;
    }
    if (!inExperience) continue;
    if (l.kind === 'role') {
      current = { i: l.i, text: l.text, bullets: [] };
      roles.push(current);
    } else if (current && l.kind === 'bullet') current.bullets.push(l.i);
  }
  return roles;
}

/** Name for the saved PDF, e.g. "Alex Rivera - Resume - Stripe.pdf". */
export function pdfFileName(model, company) {
  const name = model.find((l) => l.kind === 'name')?.text ?? '';
  const clean = (s) => String(s).replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();
  return `${[clean(name), 'Resume', clean(company)].filter(Boolean).join(' - ')}.pdf`;
}
