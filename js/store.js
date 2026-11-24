// The only module that touches localStorage. Everything is per-device, no sync.

const KEYS = {
  profile: 'jf.profile',
  meta: 'jf.meta',
  jobs: 'jf.jobs.cache', // last jobs.json, so the feed works offline
  decisions: 'jf.decisions', // { byId: {jobId: {action, at, postedAt}}, byKey: {roleKey: same} }
  tracker: 'jf.tracker', // { jobId: {job, queuedAt?, removedAt?, appliedAt?, referral?: {status, by, at, updatedAt}} }
  deck: 'jf.deck', // { date, dealt: [{id, at, updated?}] }
  undo: 'jf.undo', // last decisions, newest last
};
const SCHEMA_VERSION = 1;

export const DEFAULT_PROFILE = Object.freeze({
  name: '',
  resume: null, // { text, lines[], fileName, fileType: 'pdf'|'docx'|'paste', updatedAt }
  roles: ['pm', 'senior_pm'],
  locations: ['nyc', 'remote_us'],
  salaryFloor: 170000,
  showNoSalary: true,
  updatedAt: null,
});

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return { ok: true };
  } catch (err) {
    const quota = err && (err.name === 'QuotaExceededError' || err.code === 22);
    return { ok: false, reason: quota ? 'quota' : 'unavailable' };
  }
}

/** Saved profile merged over defaults, or null if the person hasn't saved anything yet. */
export function loadProfile() {
  const saved = read(KEYS.profile);
  return saved ? { ...DEFAULT_PROFILE, ...saved } : null;
}

export function saveProfile(profile) {
  const result = write(KEYS.profile, { ...profile, updatedAt: new Date().toISOString() });
  if (result.ok) {
    write(KEYS.meta, { schemaVersion: SCHEMA_VERSION });
    requestPersistence();
  }
  return result;
}

/** Ready for the feed: has a resume and at least one role and location. */
export function isProfileComplete(p) {
  return Boolean(p && p.resume && p.resume.text.trim() && p.roles.length && p.locations.length);
}

// ---------- Jobs cache ----------

export function loadJobsCache() {
  return read(KEYS.jobs);
}

export function saveJobsCache(data) {
  return write(KEYS.jobs, data);
}

// ---------- Decisions, queue, deck ----------

export function loadDecisions() {
  return read(KEYS.decisions) ?? { byId: {}, byKey: {} };
}

export function loadTracker() {
  return read(KEYS.tracker) ?? {};
}

/** Jobs saved to apply that are still waiting (not applied, not removed), oldest first. */
export function queuedJobs(tracker = loadTracker()) {
  return Object.entries(tracker)
    .filter(([, e]) => e.queuedAt && !e.appliedAt && !e.removedAt)
    .map(([id, e]) => ({ id, ...e }))
    .sort((a, b) => Date.parse(a.queuedAt) - Date.parse(b.queuedAt));
}

export function loadDeck() {
  return read(KEYS.deck);
}

export function saveDeck(deck) {
  return write(KEYS.deck, deck);
}

/** Copy kept in the tracker so a saved job (and its description) survives after it drops out of jobs.json. */
function snapshot(job) {
  return { ...job };
}

/**
 * Record a swipe. action: 'queued' (save to apply) or 'passed'.
 * Remembers what it replaced so Undo can put everything back.
 */
export function recordDecision(job, action, key) {
  const decisions = loadDecisions();
  const tracker = loadTracker();
  const at = new Date().toISOString();
  const undo = read(KEYS.undo) ?? [];
  undo.push({ jobId: job.id, key, prevById: decisions.byId[job.id] ?? null, prevByKey: decisions.byKey[key] ?? null, prevTracker: tracker[job.id] ?? null });

  const entry = { action, at, postedAt: job.postedAt };
  decisions.byId[job.id] = entry;
  decisions.byKey[key] = entry;
  // Merge, so saving a job never wipes a referral or applied date already recorded on it.
  if (action === 'queued') tracker[job.id] = { ...(tracker[job.id] ?? {}), job: snapshot(job), queuedAt: at };

  const ok = write(KEYS.decisions, decisions).ok && write(KEYS.tracker, tracker).ok;
  write(KEYS.undo, undo.slice(-20));
  return ok;
}

export function canUndo() {
  return (read(KEYS.undo) ?? []).length > 0;
}

/** Reverse the latest swipe. Returns the job id that was restored, or null. */
export function undoLastDecision() {
  const undo = read(KEYS.undo) ?? [];
  const last = undo.pop();
  if (!last) return null;
  const decisions = loadDecisions();
  const tracker = loadTracker();
  if (last.prevById) decisions.byId[last.jobId] = last.prevById;
  else delete decisions.byId[last.jobId];
  if (last.prevByKey) decisions.byKey[last.key] = last.prevByKey;
  else delete decisions.byKey[last.key];
  if (last.prevTracker) tracker[last.jobId] = last.prevTracker;
  else delete tracker[last.jobId];
  write(KEYS.decisions, decisions);
  write(KEYS.tracker, tracker);
  write(KEYS.undo, undo);
  return last.jobId;
}

/** Take a job out of the apply queue by hand. It stays hidden from the feed. */
// ---------- US4: Applied / Referred ----------

/** All tracker entries as a list: [{id, job, queuedAt?, appliedAt?, referral?, removedAt?}]. */
export function trackerEntries() {
  return Object.entries(loadTracker()).map(([id, e]) => ({ id, ...e }));
}

export function trackerEntry(jobId) {
  return loadTracker()[jobId] ?? null;
}

/** Hide a job from the feed once it's tracked, without touching Undo history. */
function markDecided(job, action) {
  const decisions = loadDecisions();
  if (decisions.byId[job.id]) return;
  const entry = { action, at: new Date().toISOString(), postedAt: job.postedAt };
  decisions.byId[job.id] = entry;
  const key = `${job.company}|${String(job.title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
  decisions.byKey[key] ??= entry;
  write(KEYS.decisions, decisions);
}

/** One tap: mark a job applied (on=true) or take that back. Applied jobs leave the To apply queue. */
export function setApplied(job, on) {
  const tracker = loadTracker();
  const e = { ...(tracker[job.id] ?? {}), job: tracker[job.id]?.job ?? snapshot(job) };
  if (on) e.appliedAt = new Date().toISOString();
  else delete e.appliedAt;
  tracker[job.id] = e;
  if (on) markDecided(job, 'applied');
  return write(KEYS.tracker, tracker).ok;
}

/**
 * One tap: mark a job referred (patch = {} starts "In progress"), update it
 * (patch = {status} or {by}), or remove the referral (patch = null).
 */
export function setReferral(job, patch) {
  const tracker = loadTracker();
  const e = { ...(tracker[job.id] ?? {}), job: tracker[job.id]?.job ?? snapshot(job) };
  const now = new Date().toISOString();
  if (patch === null) delete e.referral;
  else e.referral = { ...(e.referral ?? { status: 'in_progress', by: '', at: now }), ...patch, updatedAt: now };
  tracker[job.id] = e;
  if (patch !== null) markDecided(job, 'referred');
  return write(KEYS.tracker, tracker).ok;
}

/** What Start over would clear: number of swiped jobs and saved jobs. */
export function activitySummary() {
  const kept = Object.values(loadTracker()).filter((e) => e.appliedAt || e.referral).length;
  return { swipes: Math.max(0, Object.keys(loadDecisions().byId).length - kept), saved: queuedJobs().length };
}

/**
 * Start over: forget swipes, today's deck, undo history and jobs that were only saved.
 * Keeps the profile, the job cache, and application history (applied / referred jobs stay
 * in the Tracker and stay out of the feed).
 */
export function resetActivity() {
  const tracker = loadTracker();
  const decisions = loadDecisions();
  const keptTracker = {};
  const keptDecisions = { byId: {}, byKey: {} };
  for (const [id, e] of Object.entries(tracker)) {
    if (!e.appliedAt && !e.referral) continue;
    const { queuedAt, removedAt, ...rest } = e;
    keptTracker[id] = rest;
    if (decisions.byId[id]) keptDecisions.byId[id] = decisions.byId[id];
  }
  for (const [k, v] of Object.entries(decisions.byKey)) {
    if (Object.values(keptDecisions.byId).includes(v)) keptDecisions.byKey[k] = v;
  }
  write(KEYS.tracker, keptTracker);
  write(KEYS.decisions, keptDecisions);
  for (const k of [KEYS.deck, KEYS.undo]) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* storage blocked; nothing to clear */
    }
  }
}

export function removeFromQueue(jobId) {
  const tracker = loadTracker();
  if (!tracker[jobId]) return false;
  tracker[jobId] = { ...tracker[jobId], removedAt: new Date().toISOString() };
  // Removing is a deliberate act; it shouldn't be undone by the feed's Undo.
  write(KEYS.undo, (read(KEYS.undo) ?? []).filter((u) => u.jobId !== jobId));
  return write(KEYS.tracker, tracker).ok;
}

// Ask the browser not to evict our data (helps on iOS Safari). Best effort, once per load.
let persistAsked = false;
function requestPersistence() {
  if (persistAsked) return;
  persistAsked = true;
  try {
    navigator.storage?.persist?.().catch(() => {});
  } catch {
    /* not supported */
  }
}
