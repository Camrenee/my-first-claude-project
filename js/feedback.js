// US6: thumbs up / down on each "They want → You did" pair, so usefulness can be measured.
// Stored on this device; "Copy feedback" lets the person share it.
import { loadFeedback, saveFeedback } from './store.js';
import { MODEL } from './smart-fit.js';

export function pairKey(jobId, pair) {
  return `${jobId}|${pair.req}|${pair.line}`;
}

export function voteFor(jobId, pair) {
  return loadFeedback()[pairKey(jobId, pair)]?.vote ?? null;
}

/** Set 'up' / 'down', or tap the same thumb again to clear it. Returns the new vote. */
export function vote(job, pair, value) {
  const all = loadFeedback();
  const k = pairKey(job.id, pair);
  if (all[k]?.vote === value) {
    delete all[k];
    saveFeedback(all);
    return null;
  }
  all[k] = { vote: value, want: pair.want, did: pair.did, jobId: job.id, company: job.company, title: job.title, model: MODEL, at: new Date().toISOString() };
  saveFeedback(all);
  return value;
}

export function feedbackStats() {
  const votes = Object.values(loadFeedback());
  const up = votes.filter((v) => v.vote === 'up').length;
  return { rated: votes.length, up, down: votes.length - up, usefulPct: votes.length ? Math.round((up / votes.length) * 100) : null };
}

export function feedbackJson() {
  return JSON.stringify(Object.values(loadFeedback()), null, 2);
}
