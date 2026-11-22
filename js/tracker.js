// Tracker, US2 slice: the "To apply" queue with manual remove.
// US4 adds Applied / Referred / All tabs, statuses and the weekly goal.
import { queuedJobs, removeFromQueue, loadJobsCache } from './store.js';
import { openJobDetails } from './job-details.js';
import { fitFor } from './feed.js';
import { QUEUE_MAX, formatSalary, formatLocation, companyInitial } from './feed-logic.js';

const $ = (s) => document.querySelector(s);

export function showTracker() {
  const list = $('#queue-list');
  const count = $('#queue-count');
  const queue = queuedJobs();
  count.textContent = queue.length
    ? `${queue.length} of ${QUEUE_MAX} saved. Tailor your resume for each one, then apply.`
    : '';

  if (!queue.length) {
    list.innerHTML = `<div class="card empty"><h2>Nothing saved yet</h2><p>Swipe right on a job you like and it lands here, ready to tailor and apply.</p><a class="btn btn-primary" href="#today">Go to today's shortlist</a></div>`;
    return;
  }

  list.replaceChildren(...queue.map(itemEl));
}

function itemEl({ id, job, queuedAt }) {
  const el = document.createElement('article');
  el.className = 'card queue-item';
  el.dataset.id = id;
  el.innerHTML = `
    <div class="qi-head">
      <div class="logo" aria-hidden="true"></div>
      <div class="qi-main">
        <h2 class="qi-title"></h2>
        <p class="qi-sub"></p>
        <p class="qi-meta"></p>
      </div>
    </div>
    <div class="btn-row">
      <button type="button" class="btn btn-ghost qi-details">Details</button>
      <a class="btn btn-ghost qi-link" target="_blank" rel="noopener noreferrer">View posting<span class="visually-hidden"> (opens in a new tab)</span> ↗</a>
      <button type="button" class="link-btn qi-remove">Remove</button>
    </div>`;
  el.querySelector('.logo').textContent = companyInitial(job.company);
  el.querySelector('.qi-title').textContent = job.title;
  el.querySelector('.qi-sub').textContent = `${job.company} · ${formatLocation(job)}`;
  const saved = new Date(queuedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  el.querySelector('.qi-meta').textContent = `${formatSalary(job.salary) ?? 'Salary not listed'} · Saved ${saved}`;
  const link = el.querySelector('.qi-link');
  if (/^https:\/\//.test(job.url)) link.href = job.url;
  else link.remove();

  // Prefer the latest copy of the posting; fall back to the one saved with the job.
  el.querySelector('.qi-details').addEventListener('click', () => {
    const full = loadJobsCache()?.jobs?.find((j) => j.id === id);
    const theJob = full ?? job;
    const fit = fitFor(theJob);
    openJobDetails(theJob, {
      score: fit.score,
      fit,
      onClose: () => document.querySelector(`.queue-item[data-id="${CSS.escape(id)}"] .qi-details`)?.focus({ preventScroll: true }),
    });
  });

  const btn = el.querySelector('.qi-remove');
  let timer;
  btn.addEventListener('click', () => {
    if (!btn.dataset.armed) {
      btn.dataset.armed = '1';
      btn.textContent = 'Tap again to remove';
      timer = setTimeout(() => {
        delete btn.dataset.armed;
        btn.textContent = 'Remove';
      }, 4000);
      return;
    }
    clearTimeout(timer);
    removeFromQueue(id);
    showTracker();
    $('#queue-list').focus?.();
  });
  return el;
}
