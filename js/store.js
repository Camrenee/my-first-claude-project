// The only module that touches localStorage. Everything is per-device, no sync.

const KEYS = {
  profile: 'jf.profile',
  meta: 'jf.meta',
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
