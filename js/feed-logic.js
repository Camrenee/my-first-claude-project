// US2 feed rules: which jobs are eligible today, how the daily deck is dealt,
// and how cards are labeled. Pure functions so they can be unit-tested in Node.

export const DECK_SIZE = 15;
export const QUEUE_MAX = 5;
export const WINDOW_DAYS = 7;

const DAY = 864e5;

/** 'pm' or 'senior_pm' from a job title. */
export function levelOf(title = '') {
  return /\b(senior|sr\.?|iii)\b/i.test(title) ? 'senior_pm' : 'pm';
}

/** Profile location value for a job's scope from the pipeline. */
export function locationOf(job) {
  return job.scope === 'nyc' ? 'nyc' : 'remote_us';
}

/** Same role re-posted (often under a new ID) shares company + title. */
export function roleKey(job) {
  return `${job.company}|${String(job.title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
}

export function localDate(now = Date.now()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Has the person already decided on this job (or its earlier posting)?
 * Returns {decided:false} | {decided:true} | {decided:false, updated:true} for a repost.
 */
export function priorDecision(job, decisions) {
  const byId = decisions.byId?.[job.id];
  const byKey = decisions.byKey?.[roleKey(job)];
  const prior = byId ?? byKey;
  if (!prior) return { decided: false };
  // Re-posted more than a day after the version they decided on → show again, tagged "Updated".
  const reposted = Date.parse(job.postedAt) - Date.parse(prior.postedAt) > DAY;
  if (reposted && prior.action === 'passed') return { decided: false, updated: true };
  return { decided: true };
}

/** Why a job is (not) shown. Returns null when eligible, else a short reason. */
export function ineligibleReason(job, profile, now = Date.now()) {
  if (!profile.roles.includes(levelOf(job.title))) return 'role';
  if (!profile.locations.includes(locationOf(job))) return 'location';
  const t = Date.parse(job.postedAt);
  if (!Number.isFinite(t) || now - t > WINDOW_DAYS * DAY) return 'old';
  if (job.salary) {
    if (job.salary.max <= profile.salaryFloor) return 'salary';
  } else if (!profile.showNoSalary) {
    return 'no_salary';
  }
  return null;
}

/**
 * Deal today's deck. Keeps the cards already dealt today (in order) and tops up
 * with the best-matching eligible jobs until DECK_SIZE have been dealt.
 * @param deck {date, dealt: [{id, at, updated?}]} | null
 * @returns new deck object (does not mutate)
 */
export function dealDeck({ jobs, profile, decisions, deck, score, now = Date.now() }) {
  const today = localDate(now);
  const dealt = deck && deck.date === today ? [...deck.dealt] : [];
  const dealtIds = new Set(dealt.map((d) => d.id));
  if (dealt.length >= DECK_SIZE) return { date: today, dealt };

  const candidates = [];
  for (const job of jobs) {
    if (dealtIds.has(job.id)) continue;
    if (ineligibleReason(job, profile, now)) continue;
    const prior = priorDecision(job, decisions);
    if (prior.decided) continue;
    candidates.push({ job, updated: Boolean(prior.updated), score: score(job.id).score });
  }
  candidates.sort((a, b) => b.score - a.score || Date.parse(b.job.postedAt) - Date.parse(a.job.postedAt));
  for (const c of candidates.slice(0, DECK_SIZE - dealt.length)) {
    dealt.push({ id: c.job.id, at: new Date(now).toISOString(), ...(c.updated ? { updated: true } : {}) });
  }
  return { date: today, dealt };
}

/**
 * Cards still to swipe, in order: dealt today, still eligible, no decision since dealt.
 */
export function remainingCards({ deck, jobsById, profile, decisions, now = Date.now() }) {
  if (!deck) return [];
  return deck.dealt.filter((d) => {
    const job = jobsById.get(d.id);
    if (!job || ineligibleReason(job, profile, now)) return false;
    const dec = decisions.byId?.[d.id];
    return !dec || Date.parse(dec.at) < Date.parse(d.at);
  });
}

// ---------- Display ----------

export function formatSalary(salary) {
  if (!salary) return null;
  const k = (v) => `$${Math.round(v / 1000)}K`;
  return salary.min && salary.min !== salary.max ? `${k(salary.min)}–${k(salary.max)}` : k(salary.max);
}

export function formatPosted(iso, now = Date.now()) {
  const days = Math.floor((startOfDay(now) - startOfDay(Date.parse(iso))) / DAY);
  if (days <= 0) return 'Posted today';
  if (days === 1) return 'Posted yesterday';
  return `Posted ${days} days ago`;
}

function startOfDay(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function formatLocation(job) {
  if (job.scope !== 'nyc') return 'Remote (US)';
  const hybrid = job.workplaceType ? /hybrid/i.test(job.workplaceType) : job.locations?.some((l) => /hybrid/i.test(l));
  return hybrid ? 'New York, NY · Hybrid' : 'New York, NY';
}

export function companyInitial(name = '') {
  const m = String(name).match(/[A-Za-z0-9]/);
  return m ? m[0].toUpperCase() : '?';
}
