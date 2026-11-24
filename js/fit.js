// US5 "Why you're a great fit": reasons tied to specific lines of the person's resume.
//
// Rule: never invent experience. Every reason quotes a line from the resume word for word
// (trimmed to a window around the match when the line is very long), next to the sentence in
// the posting that asks for the same skill. If nothing overlaps, we say so.
// Pure functions; no DOM.
import { findSkill, SKILL_BY_ID, isResumeHeading } from './skills.js';

const BULLET = /^•\s*/;

/**
 * @param matched     skills the resume and posting share, strongest first ({id,label}[], from the matcher)
 * @param resumeLines the resume, one line per entry
 * @param jobParagraphs the posting's text blocks (to quote what the job asks for)
 * @param max         how many reasons to return
 * @returns {{skill: string, skills: string[], label: string, resumeLine: string, jobLine: string|null}[]}
 */
export function buildReasons({ matched = [], resumeLines = [], jobParagraphs = [], max = 3 }) {
  // Generic skills (weight < 1: roadmaps, stakeholders, shipping, design) only fill in
  // when there aren't enough specific ones.
  const ordered = [
    ...matched.filter((m) => (SKILL_BY_ID.get(m.id)?.w ?? 1) >= 1),
    ...matched.filter((m) => (SKILL_BY_ID.get(m.id)?.w ?? 1) < 1),
  ];
  const usedLines = new Set();
  const reasons = [];
  const jobSentences = jobParagraphs.flatMap(splitSentences);

  const byLine = new Map(); // resume line index → reason
  const usedJobLines = new Set();
  for (const m of ordered) {
    const pick = bestLine(m.id, resumeLines, usedLines, matched);
    if (!pick) continue;
    const existing = byLine.get(pick.index);
    if (existing) {
      // Same line already proves another skill: name both on one reason instead of repeating it.
      // Generic skills aren't worth the extra label.
      if ((SKILL_BY_ID.get(m.id)?.w ?? 1) >= 1) {
        existing.skills.push(m.id);
        existing.label += ` · ${m.label}`;
      }
      continue;
    }
    if (reasons.length >= max) continue;
    usedLines.add(pick.index);
    const reason = {
      skill: m.id,
      skills: [m.id],
      label: m.label,
      resumeLine: excerpt(pick.line.replace(BULLET, ''), m.id),
      jobLine: jobLineFor(m.id, jobSentences, usedJobLines),
    };
    byLine.set(pick.index, reason);
    reasons.push(reason);
  }
  return reasons;
}

function bestLine(skillId, lines, used, matched) {
  let best = null;
  lines.forEach((raw, index) => {
    const line = String(raw).trim();
    if (!line || isResumeHeading(line) || !findSkill(skillId, line)) return;
    let score = 0;
    if (BULLET.test(line) || /^[-*–]\s/.test(line)) score += 3; // accomplishments live in bullets
    if (line.length >= 40) score += 2;
    if (line.length < 25) score -= 3; // headings, titles, skill lists
    if (/^(skills?|tools|technologies|languages)\b/i.test(line)) score -= 2;
    // Lines that show several of the shared skills are stronger evidence.
    score += matched.filter((m) => m.id !== skillId && findSkill(m.id, line)).length * 0.5;
    if (used.has(index)) score -= 2; // a different strong line beats reusing one; a weak one doesn't
    if (!best || score > best.score) best = { index, line, score };
  });
  return best;
}

function splitSentences(paragraph) {
  return String(paragraph)
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
}

function jobLineFor(skillId, sentences, used) {
  // Prefer a sentence that reads like a requirement or responsibility over company intro copy,
  // and don't quote the same sentence under two reasons.
  const hits = sentences.filter((s) => findSkill(skillId, s) && !used.has(s));
  if (!hits.length) return null;
  const ask = hits.find((s) => /\b(you|you'll|you will|experience|own|lead|build|drive|partner|work)\b/i.test(s)) ?? hits[0];
  used.add(ask);
  return excerpt(ask, skillId, 170);
}

/** A verbatim window of the text around the skill mention, at most `max` characters. */
export function excerpt(text, skillId, max = 200) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const hit = findSkill(skillId, t);
  const center = hit ? hit.index + hit.length / 2 : 0;
  let start = Math.max(0, Math.round(center - max / 2));
  let end = Math.min(t.length, start + max);
  start = Math.max(0, end - max);
  // Snap to word boundaries so we never cut a word in half.
  if (start > 0) start = t.indexOf(' ', start) + 1 || start;
  if (end < t.length) end = t.lastIndexOf(' ', end) > start ? t.lastIndexOf(' ', end) : end;
  return `${start > 0 ? '…' : ''}${t.slice(start, end).trim()}${end < t.length ? '…' : ''}`;
}

/** Shared skills the resume doesn't show, most important first, generic ones left out. */
export function gapsFrom(missing = [], max = 3) {
  return missing.filter((m) => (SKILL_BY_ID.get(m.id)?.w ?? 1) >= 1).slice(0, max);
}
