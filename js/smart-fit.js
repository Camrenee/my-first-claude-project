// US6 Smart matching: Claude pairs a job's requirements with the person's resume lines.
//
// - Opt-in, with the person's own Anthropic API key stored only on this device.
// - Claude returns index pairs only (requirement i ↔ resume line k). The app shows both texts
//   exactly as written, so nothing is paraphrased or invented.
// - Results are cached per job + resume, so each job is judged once.
// - Anything that goes wrong (no key, offline, bad key, rate limit, refusal) falls back to the
//   keyword reasons from US5.
// Prompt, model and rules match the US6 spike that scored 96% (docs/us6-spike/README.md).
import { loadSmartSettings, saveSmartSettings, loadApiKey, loadProfile, isProfileComplete, loadSmartCache, saveSmartCache } from './store.js';
import { extractRequirements, resumeEvidenceLines } from './requirements.js';

export const MODEL = 'claude-sonnet-5-5';
export const PROMPT_VERSION = 1;
export const MAX_PAIRS = 3;
const SDK_URL = new URL('../vendor/anthropic-sdk-1.7.0/anthropic-sdk.min.mjs', import.meta.url).href;

export const SYSTEM = `You match a job seeker's resume to a job posting for a job-search app.

You get the posting's requirements and the resume's lines, each numbered. Return up to 3 pairs
(requirement number, resume line number) where the resume line is direct evidence a recruiter
would accept that the person meets that requirement.

Rules:
- Only pair when the resume line shows the same kind of work, skill or domain the requirement
  asks for. Shared words are not enough ("partnered with sales" does not prove "partner with IT
  engineering"; "define requirements with customers" does not prove "write engineering tickets").
- Never pair a years-of-experience requirement ("5+ years of PM experience"): one line can't prove it.
- Use each requirement and each resume line at most once.
- Fewer than 3 pairs, or none, is the right answer when the evidence isn't there. Never stretch.
- Strongest pair first.`;

const SCHEMA = {
  type: 'object',
  properties: {
    pairs: {
      type: 'array',
      items: {
        type: 'object',
        properties: { requirement: { type: 'integer' }, resume_line: { type: 'integer' } },
        required: ['requirement', 'resume_line'],
        additionalProperties: false,
      },
    },
  },
  required: ['pairs'],
  additionalProperties: false,
};

// ---------- Pure helpers (unit-tested) ----------

export function buildPrompt(company, requirements, resumeLines) {
  const reqs = requirements.map((r, i) => `${i}. ${r}`).join('\n');
  const lines = resumeLines.map((r, i) => `${i}. ${r}`).join('\n');
  return `Job: ${company}\n\nRequirements:\n${reqs}\n\nResume lines:\n${lines}`;
}

/** Keep only in-range, non-repeating pairs, at most MAX_PAIRS, and attach the exact texts. */
export function validatePairs(raw, requirements, resumeLines) {
  const seenR = new Set();
  const seenL = new Set();
  const out = [];
  for (const p of Array.isArray(raw) ? raw : []) {
    const r = Number(p?.requirement);
    const l = Number(p?.resume_line);
    if (!Number.isInteger(r) || !Number.isInteger(l)) continue;
    if (requirements[r] === undefined || resumeLines[l] === undefined) continue;
    if (seenR.has(r) || seenL.has(l)) continue;
    seenR.add(r);
    seenL.add(l);
    out.push({ req: r, line: l, want: requirements[r], did: resumeLines[l] });
    if (out.length === MAX_PAIRS) break;
  }
  return out;
}

/** Small stable hash for cache keys (not for security). */
export function hashText(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function cacheKey(jobId, resumeLines) {
  return `${PROMPT_VERSION}|${MODEL}|${jobId}|${hashText(resumeLines.join('\n'))}`;
}

// ---------- State ----------

let status = { state: 'idle', message: '' }; // idle | ok | bad_key | offline | rate_limited | error
const inflight = new Map(); // cacheKey → Promise
const failed = new Map(); // cacheKey → message; not retried until the next manual refresh
let chain = Promise.resolve(); // one request at a time
let clientPromise = null;
let clientKey = '';

export function smartEnabled() {
  return loadSmartSettings().enabled && Boolean(loadApiKey());
}

export function smartStatus() {
  return { ...status };
}

function setStatus(state, message = '') {
  status = { state, message };
  window.dispatchEvent(new CustomEvent('jf:smart-status', { detail: status }));
}

async function client() {
  const key = loadApiKey();
  if (!clientPromise || key !== clientKey) {
    clientKey = key;
    clientPromise = import(SDK_URL).then(
      ({ default: Anthropic }) =>
        // The key belongs to the person using the app and never leaves their device except
        // to go to Anthropic, which is what this opt-in is for.
        new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 45_000 })
    );
  }
  return clientPromise;
}

function resumeLinesNow() {
  const p = loadProfile();
  if (!isProfileComplete(p)) return [];
  return resumeEvidenceLines(p.resume.lines?.length ? p.resume.lines : String(p.resume.text).split('\n'));
}

/**
 * What smart matching has for a job right now, without waiting:
 * { state: 'off' | 'ready' | 'loading' | 'error', pairs?, message? }
 * Kicks off a request in the background when nothing is cached yet.
 */
export function smartFor(job) {
  if (!smartEnabled()) return { state: 'off' };
  const lines = resumeLinesNow();
  if (!lines.length) return { state: 'error', message: 'Add your resume to use smart matching.' };
  const key = cacheKey(job.id, lines);
  const hit = loadSmartCache()[key];
  if (hit) return { state: 'ready', pairs: hit.pairs };
  // Never retry in a loop: a failed job, or any job while the key/network is failing, shows
  // keyword reasons until the person pulls to refresh or fixes the key.
  if (failed.has(key)) return { state: 'error', message: failed.get(key) };
  if (['bad_key', 'rate_limited', 'offline'].includes(status.state) && !inflight.has(key)) {
    return { state: 'error', message: status.message };
  }
  ensure(job, lines, key);
  return { state: 'loading' };
}

/** Start (or join) the request for a job; resolves with the pairs, or null on failure. */
export function ensure(job, lines = resumeLinesNow(), key = cacheKey(job.id, lines)) {
  if (inflight.has(key)) return inflight.get(key);
  const p = (chain = chain.then(() => judge(job, lines, key)).catch(() => null));
  inflight.set(key, p);
  p.finally(() => inflight.delete(key));
  return p;
}

async function judge(job, lines, key) {
  const requirements = extractRequirements(job.descriptionHtml);
  let pairs = [];
  if (requirements.length) {
    try {
      const c = await client();
      const response = await c.beta.messages.create({
        model: MODEL,
        max_tokens: 4000,
        // If a safety check declines (unlikely for resumes), the API retries on a fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM,
        messages: [{ role: 'user', content: buildPrompt(job.company, requirements, lines) }],
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      });
      if (response.stop_reason === 'refusal') throw Object.assign(new Error('refusal'), { kind: 'refusal' });
      const text = response.content.find((b) => b.type === 'text')?.text ?? '{}';
      pairs = validatePairs(JSON.parse(text).pairs, requirements, lines);
      setStatus('ok');
    } catch (err) {
      handleError(err);
      failed.set(key, status.message);
      window.dispatchEvent(new CustomEvent('jf:smart-ready', { detail: { jobId: job.id, failed: true } }));
      throw err;
    }
  }
  const cache = loadSmartCache();
  cache[key] = { pairs, at: new Date().toISOString() };
  saveSmartCache(cache);
  window.dispatchEvent(new CustomEvent('jf:smart-ready', { detail: { jobId: job.id } }));
  return pairs;
}

function handleError(err) {
  // Status codes, not class names: the bundled SDK is minified, so class names can't be trusted.
  const name = err?.constructor?.name ?? '';
  const httpStatus = err?.status;
  if (err instanceof SyntaxError) {
    setStatus('error', 'Claude’s answer couldn’t be read. Showing keyword matches for now.');
  } else if (httpStatus === 401 || httpStatus === 403 || name === 'AuthenticationError' || name === 'PermissionDeniedError') {
    setStatus('bad_key', 'Your API key didn’t work. Check it in Profile → Smart matching.');
  } else if (httpStatus === 429 || name === 'RateLimitError') {
    setStatus('rate_limited', 'Claude is busy or your key hit its limit. Showing keyword matches for now.');
  } else if (name === 'APIConnectionError' || name === 'APIConnectionTimeoutError' || httpStatus === undefined) {
    setStatus('offline', 'Couldn’t reach Claude. Showing keyword matches for now.');
  } else if (err?.kind === 'refusal') {
    setStatus('error', 'Claude couldn’t match this job. Showing keyword matches.');
  } else {
    setStatus('error', 'Smart matching hit a problem. Showing keyword matches for now.');
  }
}

/** Clear a temporary error so the next card tries again (e.g. after pull to refresh). */
export function resetSmartStatus() {
  failed.clear();
  if (status.state !== 'idle') setStatus('idle');
}

/** Check a key without spending tokens: fetch the model's details. */
export async function testKey(key) {
  const { default: Anthropic } = await import(SDK_URL);
  const c = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 0, timeout: 20_000 });
  try {
    await c.models.retrieve(MODEL);
    return { ok: true };
  } catch (err) {
    const s = err?.status;
    if (s === 401 || s === 403) return { ok: false, message: 'That key didn’t work. Check you copied all of it.' };
    if (s === undefined) return { ok: false, message: 'Couldn’t reach Claude. Check your connection and try again.' };
    return { ok: false, message: `Claude returned an error (${s}). Try again in a minute.` };
  }
}

export function setSmartEnabled(on) {
  saveSmartSettings({ ...loadSmartSettings(), enabled: on });
  resetSmartStatus();
  window.dispatchEvent(new CustomEvent('jf:smart-status', { detail: status }));
}

// ---------- US3: one-tap tailoring with the same key ----------

const TAILOR_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { line: { type: 'integer' }, text: { type: 'string' } },
        required: ['line', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'changes'],
  additionalProperties: false,
};

/**
 * Send the same prompt the person would paste into Claude; returns Claude's reply text (JSON).
 * The app checks the reply exactly as it checks a pasted one. Errors carry a `userMessage`.
 */
export async function tailorWithClaude(prompt) {
  if (!loadApiKey()) throw Object.assign(new Error('no key'), { userMessage: 'Save your Claude key in Profile → Smart matching first.' });
  try {
    const c = await client();
    const response = await c.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [{ role: 'user', content: prompt }],
      output_config: { format: { type: 'json_schema', schema: TAILOR_SCHEMA } },
    });
    if (response.stop_reason === 'refusal') throw Object.assign(new Error('refusal'), { kind: 'refusal' });
    return response.content.find((b) => b.type === 'text')?.text ?? '';
  } catch (err) {
    const s = err?.status;
    const userMessage =
      s === 401 || s === 403
        ? 'Your Claude key didn’t work. Check it in Profile → Smart matching, or use copy and paste below.'
        : s === 429
          ? 'Claude is busy or your key hit its spending limit. Try again later, or use copy and paste below.'
          : s === undefined && err?.kind !== 'refusal'
            ? 'Couldn’t reach Claude. Check your connection, or use copy and paste below.'
            : 'Claude couldn’t tailor this right now. Try again, or use copy and paste below.';
    throw Object.assign(err instanceof Error ? err : new Error(String(err)), { userMessage });
  }
}
