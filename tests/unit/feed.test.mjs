import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  levelOf, ineligibleReason, priorDecision, dealDeck, remainingCards, formatSalary, formatPosted, formatLocation, companyInitial, roleKey, DECK_SIZE,
} from '../../js/feed-logic.js';
import { buildMatcher, terms } from '../../js/match.js';

const NOW = Date.parse('2026-11-22T15:00:00');
const daysAgo = (n) => new Date(NOW - n * 864e5).toISOString();
const PROFILE = { roles: ['pm', 'senior_pm'], locations: ['nyc', 'remote_us'], salaryFloor: 170000, showNoSalary: true };
const job = (o = {}) => ({
  id: 'gh:x:1', company: 'Acme', title: 'Senior Product Manager', scope: 'nyc', postedAt: daysAgo(1),
  salary: { min: 180000, max: 220000 }, ...o,
});

test('level from title', () => {
  assert.equal(levelOf('Senior Product Manager, Payments'), 'senior_pm');
  assert.equal(levelOf('Sr. Product Manager'), 'senior_pm');
  assert.equal(levelOf('Product Manager III'), 'senior_pm');
  assert.equal(levelOf('Product Manager II'), 'pm');
  assert.equal(levelOf('Technical Product Manager'), 'pm');
});

test('eligibility: role, location, age, salary floor, no-salary toggle', () => {
  assert.equal(ineligibleReason(job(), PROFILE, NOW), null);
  assert.equal(ineligibleReason(job(), { ...PROFILE, roles: ['pm'] }, NOW), 'role');
  assert.equal(ineligibleReason(job({ scope: 'us_remote' }), { ...PROFILE, locations: ['nyc'] }, NOW), 'location');
  assert.equal(ineligibleReason(job({ postedAt: daysAgo(8) }), PROFILE, NOW), 'old');
  // "Hide jobs whose salary range tops out at $170K or less"
  assert.equal(ineligibleReason(job({ salary: { min: 140000, max: 170000 } }), PROFILE, NOW), 'salary');
  assert.equal(ineligibleReason(job({ salary: { min: 140000, max: 170001 } }), PROFILE, NOW), null);
  assert.equal(ineligibleReason(job({ salary: null }), PROFILE, NOW), null);
  assert.equal(ineligibleReason(job({ salary: null }), { ...PROFILE, showNoSalary: false }, NOW), 'no_salary');
});

test('passed jobs stay hidden unless re-posted; re-posts are tagged Updated', () => {
  const passed = { action: 'passed', at: daysAgo(3), postedAt: daysAgo(5) };
  const j = job({ postedAt: daysAgo(5) });
  assert.deepEqual(priorDecision(j, { byId: { [j.id]: passed } }), { decided: true });
  // Same role, new posting ID, posted later
  const repost = job({ id: 'gh:x:2', postedAt: daysAgo(1) });
  assert.deepEqual(priorDecision(repost, { byKey: { [roleKey(j)]: passed } }), { decided: false, updated: true });
  // Saved jobs never come back as cards
  assert.deepEqual(priorDecision(repost, { byKey: { [roleKey(j)]: { ...passed, action: 'queued' } } }), { decided: true });
});

test('deck: up to 15 per day, ranked by match, stable within the day', () => {
  const jobs = Array.from({ length: 20 }, (_, i) => job({ id: `j${i}`, title: `Product Manager ${i}` }));
  const score = (id) => ({ score: Number(id.slice(1)) });
  const deck = dealDeck({ jobs, profile: PROFILE, decisions: {}, deck: null, score, now: NOW });
  assert.equal(deck.dealt.length, DECK_SIZE);
  assert.equal(deck.dealt[0].id, 'j19'); // best match first
  // Re-dealing later the same day keeps the same cards
  const again = dealDeck({ jobs, profile: PROFILE, decisions: {}, deck, score, now: NOW + 3600e3 });
  assert.deepEqual(again.dealt.map((d) => d.id), deck.dealt.map((d) => d.id));
  // Next day: a fresh deck of unseen jobs (already-decided ones excluded)
  const decisions = { byId: Object.fromEntries(deck.dealt.map((d) => [d.id, { action: 'passed', at: daysAgo(0), postedAt: daysAgo(1) }])) };
  const tomorrow = dealDeck({ jobs, profile: PROFILE, decisions, deck, score, now: NOW + 864e5 });
  assert.deepEqual(tomorrow.dealt.map((d) => d.id).sort(), ['j0', 'j1', 'j2', 'j3', 'j4']);
});

test('remaining cards skip decided and no-longer-eligible jobs', () => {
  const jobs = [job({ id: 'a' }), job({ id: 'b', salary: { min: 150000, max: 175000 } }), job({ id: 'c' })];
  const deck = dealDeck({ jobs, profile: PROFILE, decisions: {}, deck: null, score: () => ({ score: 50 }), now: NOW });
  const jobsById = new Map(jobs.map((j) => [j.id, j]));
  const decisions = { byId: { a: { action: 'queued', at: new Date(NOW + 1000).toISOString() } } };
  const left = remainingCards({ deck, jobsById, profile: { ...PROFILE, salaryFloor: 180000 }, decisions, now: NOW });
  assert.deepEqual(left.map((d) => d.id), ['c']);
});

test('card labels', () => {
  assert.equal(formatSalary({ min: 180000, max: 240000 }), '$180K–$240K');
  assert.equal(formatSalary({ min: 200000, max: 200000 }), '$200K');
  assert.equal(formatSalary(null), null);
  assert.equal(formatPosted(daysAgo(0), NOW), 'Posted today');
  assert.equal(formatPosted(daysAgo(1), NOW), 'Posted yesterday');
  assert.equal(formatPosted(daysAgo(4), NOW), 'Posted 4 days ago');
  assert.equal(formatLocation({ scope: 'nyc', workplaceType: 'Hybrid' }), 'New York, NY · Hybrid');
  assert.equal(formatLocation({ scope: 'nyc', locations: ['New York, NY'] }), 'New York, NY');
  assert.equal(formatLocation({ scope: 'us_remote' }), 'Remote (US)');
  assert.equal(companyInitial('1Password'), '1');
  assert.equal(companyInitial('  stripe'), 'S');
});

test('match: score is the share of the posting\'s skills the resume shows', () => {
  const docs = [
    { id: 'payments', text: 'Own the payments roadmap: B2B invoicing and billing, pricing experiments, SQL and A/B testing. Partner with sales.' },
    { id: 'health', text: 'Lead clinical workflows for patients and clinics. EHR integrations, HIPAA compliance, telehealth, care delivery.' },
    { id: 'ads', text: 'Ads ranking with machine learning, advertiser campaigns and auctions, measurement and analytics, mobile.' },
  ];
  const resume = 'Senior PM. Led payments roadmap for B2B invoicing and billing. Ran pricing experiments and A/B tests with SQL.';
  const m = buildMatcher(resume, docs);
  assert.ok(m('payments').score >= 85, `payments ${m('payments').score}`);
  assert.ok(m('payments').score > m('health').score + 50);
  const labels = m('payments').matched.map((s) => s.label);
  assert.ok(labels.includes('Billing & invoicing') && labels.includes('SQL'), labels.join());
  assert.deepEqual(m('health').matched, []);
  assert.ok(m('health').missing.some((s) => s.label === 'Healthcare'));
  assert.equal(buildMatcher('', docs)('payments').score, 0);
});

test('skills: synonyms meet, benefits boilerplate does not count', async () => {
  const { skillCounts } = await import('../../js/skills.js');
  assert.ok(skillCounts('Ran A/B tests').has('experimentation'));
  assert.ok(skillCounts('experimentation culture').has('experimentation'));
  assert.ok(!skillCounts('We use ChatGPT daily').has('comms'));
  assert.ok(!skillCounts('Wellness stipend and healthcare coverage').has('fitness'));
  assert.ok(!skillCounts('Wellness stipend and healthcare coverage').has('healthcare'));
  assert.ok(!skillCounts('a new business model').has('ai'));
});

test('match terms: stopwords out, stems and phrases in', () => {
  const t = terms('We are looking for roadmaps and launched products');
  assert.ok(t.includes('roadmap'));
  assert.ok(t.includes('launch'));
  assert.ok(!t.includes('we'));
});
