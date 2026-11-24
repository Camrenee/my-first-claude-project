import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTitle, classifyLocation, jobLocationScope, parseSalaryText, postedWithin, htmlToText } from './filters.mjs';

test('titles: PM and Senior PM are in', () => {
  for (const t of [
    'Product Manager',
    'Senior Product Manager',
    'Sr. Product Manager, Payments',
    'Product Manager II - Growth',
    'Technical Product Manager',
    'Senior Product Manager (AI Platform)',
  ])
    assert.equal(classifyTitle(t), 'match', t);
});

test('titles: staff+, leadership, junior and non-PM are out', () => {
  assert.equal(classifyTitle('Staff Product Manager'), 'senior_plus');
  assert.equal(classifyTitle('Principal Product Manager'), 'senior_plus');
  assert.equal(classifyTitle('Lead Product Manager'), 'senior_plus');
  assert.equal(classifyTitle('Group Product Manager'), 'senior_plus');
  assert.equal(classifyTitle('Director, Product Management'), 'not_pm');
  assert.equal(classifyTitle('Director of Product Manager Org'), 'excluded');
  assert.equal(classifyTitle('Associate Product Manager'), 'excluded');
  assert.equal(classifyTitle('Product Manager Intern'), 'excluded');
  assert.equal(classifyTitle('Product Marketing Manager'), 'not_pm');
  assert.equal(classifyTitle('Senior Software Engineer'), 'not_pm');
});

test('locations: NYC incl. hybrid; not Brooklyn-only or upstate', () => {
  for (const l of ['New York, NY', 'New York City', 'NYC', 'New York, New York, USA', 'Hybrid - New York, NY', 'New York, NY (HQ)', 'Manhattan'])
    assert.equal(classifyLocation(l), 'nyc', l);
  for (const l of ['Brooklyn, NY', 'Albany, NY', 'Jersey City, NJ', 'San Francisco, CA', 'London'])
    assert.equal(classifyLocation(l), 'other', l);
});

test('locations: US-remote and NY-limited remote are in; other remote is out', () => {
  for (const l of ['Remote', 'Remote - US', 'Remote (US)', 'US Remote', 'Remote, USA', 'Remote - United States', 'United States', 'Remote - New York', 'Remote (NY)', 'Remote - US East Coast'])
    assert.equal(classifyLocation(l), 'us_remote', l);
  for (const l of ['Remote - San Francisco', 'Remote (Canada)', 'Remote - EMEA', 'Remote, UK', 'Remote - Brooklyn'])
    assert.equal(classifyLocation(l), 'other', l);
});

test('job location scope: any qualifying location wins', () => {
  assert.equal(jobLocationScope(['San Francisco, CA; New York, NY']), 'nyc');
  assert.equal(jobLocationScope(['Seattle, WA', 'Remote (US)']), 'us_remote');
  assert.equal(jobLocationScope(['Seattle, WA or Austin, TX']), 'other');
});

test('salary text parsing', () => {
  assert.deepEqual(parseSalaryText('The base range is $150,000 - $210,000 per year.'), { min: 150000, max: 210000 });
  assert.deepEqual(parseSalaryText('Pay: $180K–$240K + equity'), { min: 180000, max: 240000 });
  assert.deepEqual(parseSalaryText('$165 to $195k'), { min: 165000, max: 195000 });
  assert.deepEqual(parseSalaryText('NYC: $190,000—$230,000; SF: $200,000 - $245,000'), { min: 190000, max: 245000 });
  assert.equal(parseSalaryText('$45 - $60 per hour'), null);
  assert.equal(parseSalaryText('Competitive salary and equity'), null);
});

test('posted within N days', () => {
  const now = Date.parse('2026-11-22T12:00:00Z');
  assert.equal(postedWithin('2026-11-16T12:00:00Z', 7, now), true);
  assert.equal(postedWithin('2026-11-14T12:00:00Z', 7, now), false);
  assert.equal(postedWithin(undefined, 7, now), false);
});

test('html to text', () => {
  assert.equal(htmlToText('<p>Hi &amp; welcome</p><ul><li>One</li><li>Two</li></ul>'), 'Hi & welcome\n One\n Two');
});
