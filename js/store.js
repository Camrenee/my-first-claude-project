// The only module that touches localStorage. Everything is per-device, no sync.

const KEYS = {
  profile: 'jf.profile',
  meta: 'jf.meta',
  jobs: 'jf.jobs.cache', // last jobs.json, so the feed works offline
  decisions: 'jf.decisions', // { byId: {jobId: {action, at, postedAt}}, byKey: {roleKey: same} }
  tracker: 'jf.tracker', // { jobId: {job, queuedAt, removedAt?, appliedAt?} }
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

/** Snapshot kept in the tracker so a saved job survives after it drops out of jobs.json. */
function snapshot(job) {
  const { descriptionHtml, ...rest } = job;
  return rest;
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
  if (action === 'queued') tracker[job.id] = { job: snapshot(job), queuedAt: at };

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
