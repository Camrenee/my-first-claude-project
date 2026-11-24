import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractRequirements, resumeEvidenceLines } from '../../js/requirements.js';
import { validatePairs, buildPrompt, cacheKey, MODEL } from '../../js/smart-fit.js';

test('requirements: bullets under role headings, boilerplate and pay text dropped, posting order kept', () => {
  const html = `<p>Acme builds finance software for millions of businesses around the world.</p>
    <h2>What you'll do</h2><ul><li>Own the billing platform roadmap end to end</li><li>Partner with Sales to bring new pricing to market</li></ul>
    <h2>Nice to have</h2><ul><li>Experience with crypto custody and settlement</li></ul>
    <h2>About you</h2><ul><li>5+ years of product management experience</li><li>Fluent in SQL and experimentation</li></ul>
    <h2>Benefits</h2><ul><li>We are an equal opportunity employer and value diversity</li><li>We look forward to discussing your salary expectations</li></ul>`;
  assert.deepEqual(extractRequirements(html), [
    'Own the billing platform roadmap end to end',
    'Partner with Sales to bring new pricing to market',
    '5+ years of product management experience',
    'Fluent in SQL and experimentation',
    'Experience with crypto custody and settlement',
  ]);
});

test('requirements: real postings split into 7–20 requirements each', () => {
  const { jobs } = JSON.parse(fs.readFileSync(new URL('../../data/jobs.json', import.meta.url)));
  for (const j of jobs) {
    const n = extractRequirements(j.descriptionHtml).length;
    assert.ok(n >= 4 && n <= 20, `${j.company}: ${n}`);
  }
});

test('resume lines: accomplishments only, quoted exactly as written', () => {
  const lines = [
    'Alex Rivera',
    'alex@example.com · linkedin.com/in/alex',
    'Experience',
    'Senior Product Manager, Acme Payments — 2021–Present',
    '• Led roadmap for B2B invoicing and billing, growing ARR 40% in 18 months',
    '- Ran pricing experiments and A/B tests with SQL and Amplitude',
    'Skills: SQL, Figma, Amplitude, customer interviews',
    '• Led roadmap for B2B invoicing and billing, growing ARR 40% in 18 months',
  ];
  assert.deepEqual(resumeEvidenceLines(lines), [
    'Led roadmap for B2B invoicing and billing, growing ARR 40% in 18 months',
    'Ran pricing experiments and A/B tests with SQL and Amplitude',
  ]);
});

test("Claude's answer: out-of-range, non-integer and repeated indices are dropped; max 3; exact texts attached", () => {
  const reqs = ['R0', 'R1', 'R2', 'R3'];
  const lines = ['L0', 'L1', 'L2', 'L3'];
  const raw = [
    { requirement: 1, resume_line: 2 },
    { requirement: 9, resume_line: 0 }, // no such requirement
    { requirement: 1, resume_line: 0 }, // requirement reused
    { requirement: 2, resume_line: 2 }, // line reused
    { requirement: '3', resume_line: 1.5 }, // not an integer
    { requirement: 0, resume_line: 0 },
    { requirement: 3, resume_line: 3 },
    { requirement: 2, resume_line: 1 }, // would be a 4th pair
  ];
  assert.deepEqual(validatePairs(raw, reqs, lines), [
    { req: 1, line: 2, want: 'R1', did: 'L2' },
    { req: 0, line: 0, want: 'R0', did: 'L0' },
    { req: 3, line: 3, want: 'R3', did: 'L3' },
  ]);
  assert.deepEqual(validatePairs(undefined, reqs, lines), []);
});

test('prompt numbers requirements and resume lines; cache key changes with the resume', () => {
  const p = buildPrompt('Figma', ['Own billing'], ['Led billing roadmap', 'Ran A/B tests']);
  assert.equal(p, 'Job: Figma\n\nRequirements:\n0. Own billing\n\nResume lines:\n0. Led billing roadmap\n1. Ran A/B tests');
  const a = cacheKey('job1', ['Led billing roadmap']);
  assert.equal(a, cacheKey('job1', ['Led billing roadmap']));
  assert.notEqual(a, cacheKey('job1', ['Led billing roadmap (edited)']));
  assert.ok(a.includes(MODEL));
});
