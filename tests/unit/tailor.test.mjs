import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  resumeModel, buildTailorPrompt, parseTailorAnswer, reviewAnswer, composeResume, trimSteps, rolesIn, choice, pdfFileName, numbersIn, TailorAnswerError,
} from '../../js/tailor.js';

const LINES = [
  'Alex Rivera',
  'alex@example.com · linkedin.com/in/alex · New York, NY',
  'Experience',
  'Senior Product Manager, Acme Payments — 2021–Present',
  '• Led roadmap for B2B invoicing and billing, growing ARR 40% in 18 months',
  '• Ran pricing experiments and A/B tests with SQL and Amplitude',
  'Product Manager, Shopco — 2017–2021',
  '• Launched checkout redesign that lifted conversion 12% for 2M monthly shoppers',
  '• Partnered with sales on enterprise onboarding for new accounts',
  'Associate PM, Oldco — 2014–2017',
  '• Built internal analytics dashboards used by 300 staff',
  '• Managed release notes and beta programs for the mobile app',
  'Education',
  'BA Economics, NYU — 2010–2014',
  'Skills: SQL, Figma, Amplitude, customer interviews and roadmapping',
];
const model = resumeModel(LINES);

test('resume model: only accomplishment lines can be edited', () => {
  assert.deepEqual(
    model.map((l) => l.kind),
    ['name', 'contact', 'heading', 'role', 'bullet', 'bullet', 'role', 'bullet', 'bullet', 'role', 'bullet', 'bullet', 'heading', 'role', 'text']
  );
  assert.deepEqual(model.filter((l) => l.editable).map((l) => l.i), [4, 5, 7, 8, 10, 11]);
  assert.equal(model[4].text, 'Led roadmap for B2B invoicing and billing, growing ARR 40% in 18 months', 'bullet dot removed, words kept');
});

test('prompt: rules, job, numbered resume with [edit]/[fixed], and the answer format', () => {
  const p = buildTailorPrompt({ title: 'Senior PM, Billing', company: 'Stripe' }, ['Own the billing roadmap.'], model);
  assert.match(p, /Never add skills, tools, titles, companies, numbers, dates or experience/);
  assert.match(p, /one page/);
  assert.match(p, /Write a short summary/);
  assert.match(p, /JOB: Senior PM, Billing at Stripe\nOwn the billing roadmap\./);
  assert.match(p, /\n0 \[fixed\] Alex Rivera\n/);
  assert.match(p, /\n4 \[edit\] Led roadmap for B2B invoicing/);
  assert.match(p, /\n3 \[fixed\] Senior Product Manager, Acme Payments/);
  assert.match(p, /```json\n\{"summary": .*"changes": \[\{"line": 7/);
});

test('prompt: a resume that already has a summary asks for no new one', () => {
  const m = resumeModel(['Alex Rivera', 'Summary', 'Payments product manager who ships billing products end to end.', 'Experience']);
  assert.match(buildTailorPrompt({ title: 'PM', company: 'X' }, [], m), /already has a summary/);
});

test('parse: a code block, bare JSON, or text around JSON; a clear error otherwise', () => {
  const json = '{"summary":"S","changes":[{"line":4,"text":"T"}]}';
  assert.deepEqual(parseTailorAnswer(`Here you go:\n\`\`\`json\n${json}\n\`\`\`\nGood luck!`), { summary: 'S', changes: [{ line: 4, text: 'T' }] });
  assert.deepEqual(parseTailorAnswer(json).changes.length, 1);
  assert.deepEqual(parseTailorAnswer(`Sure! ${json} Hope that helps`).summary, 'S');
  assert.throws(() => parseTailorAnswer(''), TailorAnswerError);
  assert.throws(() => parseTailorAnswer('I rewrote your resume: Led roadmap…'), /Copy Claude’s whole reply/);
});

test('review: fixed lines, bad numbers, repeats and no-ops are ignored; new numbers are held back', () => {
  const r = reviewAnswer(model, {
    summary: 'Payments PM who grows revenue with pricing experiments.',
    changes: [
      { line: 5, text: 'Ran 45 pricing experiments in SQL' }, // new number
      { line: 4, text: 'Owned the B2B billing and invoicing roadmap, growing ARR 40% in 18 months' },
      { line: 3, text: 'Staff Product Manager, Acme Payments — 2021–Present' }, // title line: fixed
      { line: 4, text: 'again' }, // repeat
      { line: 99, text: 'nope' },
      { line: 8, text: 'Partnered with sales on enterprise onboarding for new accounts' }, // unchanged
      { line: 10, text: '• Built analytics dashboards used by 300 staff across Finance' },
    ],
  });
  assert.equal(r.ignored, 4);
  assert.deepEqual(r.changes.map((c) => [c.i, c.held]), [[4, false], [5, true], [10, false]]);
  assert.match(r.changes[1].warnings[0], /Adds “45”/);
  assert.equal(r.changes[2].tailored, 'Built analytics dashboards used by 300 staff across Finance', 'bullet dot stripped');
  assert.equal(r.summary.held, false);
});

test('review: a skill the resume never mentions is flagged, not blocked', () => {
  const r = reviewAnswer(model, { summary: '', changes: [{ line: 11, text: 'Managed release notes and beta programs for the Kubernetes mobile app' }] });
  assert.equal(r.changes[0].held, false);
  assert.match(r.changes[0].warnings.join(' '), /Infrastructure & cloud/);
});

test('review: a summary with a number the resume lacks is held back', () => {
  const r = reviewAnswer(model, { summary: 'PM with 8 years in payments.', changes: [] });
  assert.equal(r.summary.held, true);
  assert.equal(choice({}, 'summary', r.summary), false);
  assert.equal(choice({ summary: true }, 'summary', r.summary), true, 'the person can still choose it');
});

test('numbers: commas, percents and money are compared by value', () => {
  assert.deepEqual([...numbersIn('$1,200 and 40% over 2.0x, 3')], ['1200', '40', '2', '3']);
});

test('compose: summary after the contact lines, choices respected, omitted lines dropped', () => {
  const r = reviewAnswer(model, { summary: 'Payments PM.', changes: [{ line: 4, text: 'Owned the B2B billing roadmap, growing ARR 40% in 18 months' }] });
  const all = composeResume(model, r);
  assert.deepEqual(all.slice(0, 5).map((x) => [x.kind, x.text]), [
    ['name', 'Alex Rivera'],
    ['contact', LINES[1]],
    ['heading', 'Summary'],
    ['text', 'Payments PM.'],
    ['heading', 'Experience'],
  ]);
  assert.equal(all.find((x) => x.src === 4).text, 'Owned the B2B billing roadmap, growing ARR 40% in 18 months');
  const kept = composeResume(model, r, { 4: false, summary: false }, new Set([11]));
  assert.equal(kept.find((x) => x.src === 4).text, LINES[4].slice(2));
  assert.ok(!kept.some((x) => x.src === 'summary' || x.src === 11));
});

test('trim order: oldest role’s bullets (last first), then the summary; newest role never', () => {
  assert.deepEqual(rolesIn(model).map((r) => [r.i, r.bullets]), [[3, [4, 5]], [6, [7, 8]], [9, [10, 11]]]);
  const r = reviewAnswer(model, { summary: 'Payments PM.', changes: [] });
  assert.deepEqual(trimSteps(model, r).map((s) => [...s]), [[11], [11, 10], [11, 10, 'summary']]);
});

test('file name', () => {
  assert.equal(pdfFileName(model, 'Stripe, Inc.'), 'Alex Rivera - Resume - Stripe, Inc..pdf');
});

test('PDF: Arimo embedded, selectable text, one page at 11 pt', async () => {
  const { jsPDF } = await import('../../vendor/jspdf-4.2.1/jspdf.min.mjs');
  const pdf = await import('../../js/resume-pdf.js');
  const b64 = (f) => fs.readFileSync(new URL(`../../vendor/arimo/${f}`, import.meta.url)).toString('base64');
  pdf.provide({ jsPDF, fonts: { normal: b64('Arimo-Regular.ttf'), bold: b64('Arimo-Bold.ttf') } });
  const r = reviewAnswer(model, { summary: 'Payments PM.', changes: [] });
  const items = composeResume(model, r);
  assert.deepEqual(await pdf.measure(items), { 11: 1, 10.5: 1 });
  const out = await pdf.buildPdf(items);
  assert.equal(out.size, 11);
  const raw = Buffer.from(out.bytes).toString('latin1');
  assert.match(raw, /\/BaseFont \/Arimo/);
  assert.match(raw, /\/ToUnicode/, 'text can be copied and read by applicant tracking systems');

  // A long resume runs over one page; 10.5 pt is tried before giving up.
  const long = Array.from({ length: 70 }, (_, k) => ({ kind: 'bullet', text: `Shipped improvement number ${k} to the billing platform for enterprise customers` }));
  const pages = await pdf.measure(long);
  assert.ok(pages[11] > 1);
  assert.equal(await pdf.fitSize(long), pages[10.5] === 1 ? 10.5 : null);
});

// The shape of a real Word resume read from PDF (made-up content): wrapped bullets, a company
// line above each title, "Mon. YYYY – Mon. YYYY" dates, and an education line with "Graduated:".
const PDF_LINES = [
  'Jordan Lee',
  'e: jordan@example.com | m: (555)-555-0100',
  'WORK EXPERIENCE',
  'Example Bank',
  'Digital Payments, Sr. Product Manager Apr. 2025 – Present',
  '• Redesigned the card management experience using user research, A/B testing, and',
  'custom surveys with engineering and design. Reducing calls 8%, saving $270K.',
  '• Led training and call -',
  'handling procedures with Servicing.',
  'Consumer Products, Product Manager Jun. 2021 – Mar. 2025',
  '• Led 3 card launches across channels.',
  'Network Services: Marketing, Analyst Jul. 2017– Dec. 2018',
  '• Generated +$2M in dining spend across 20+ merchants; drove 2X sales for Amex',
  'Auto across 90+ merchants.',
  'EDUCATION',
  'Example University School of Business – Boston, MA Graduated: May 2017',
  'BSBA; Concentrations in Marketing & Information Systems; Magna Cum Laude',
];

test('PDF resumes: wrapped bullets are rejoined, hyphenated words mended, company lines kept', async () => {
  const { toLines } = await import('../../js/resume-parse.js');
  const lines = toLines(PDF_LINES.join('\n'));
  assert.equal(lines[3], 'Example Bank');
  assert.equal(lines[5], '• Redesigned the card management experience using user research, A/B testing, and custom surveys with engineering and design. Reducing calls 8%, saving $270K.');
  assert.equal(lines[6], '• Led training and call-handling procedures with Servicing.');
  assert.equal(lines[10], '• Generated +$2M in dining spend across 20+ merchants; drove 2X sales for Amex Auto across 90+ merchants.');
  assert.equal(lines.length, PDF_LINES.length - 3);
});

test('PDF resumes: every date style is a title line; company line bold; education fixed', () => {
  const m = resumeModel(PDF_LINES);
  const roles = m.filter((l) => l.kind === 'role').map((l) => [l.main, l.dates]);
  assert.deepEqual(roles, [
    ['Digital Payments, Sr. Product Manager', 'Apr. 2025 – Present'],
    ['Consumer Products, Product Manager', 'Jun. 2021 – Mar. 2025'],
    ['Network Services: Marketing, Analyst', 'Jul. 2017– Dec. 2018'],
    ['Example University School of Business – Boston, MA', 'Graduated: May 2017'],
  ]);
  assert.equal(m[3].kind, 'org');
  assert.equal(m.find((l) => l.text.startsWith('BSBA')).editable, false, 'degree line never reworded');
  assert.equal(m.filter((l) => l.editable).length, 4);
  assert.deepEqual(rolesIn(m).map((r) => r.bullets.length), [2, 1, 1], 'education isn’t a role to trim');
});

test('PDF: title dates are printed, company and title lines carry through', async () => {
  const m = resumeModel(PDF_LINES);
  const items = composeResume(m, reviewAnswer(m, { summary: '', changes: [] }));
  const role = items.find((x) => x.kind === 'role');
  assert.deepEqual([role.text, role.dates], ['Digital Payments, Sr. Product Manager', 'Apr. 2025 – Present']);
  const pdf = await import('../../js/resume-pdf.js');
  const out = await pdf.buildPdf(items);
  assert.equal(out.pages, 1);
});
