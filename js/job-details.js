// Job details: a full-screen sheet over the current screen with the whole job description.
// Opening it adds "#job" to the address so the phone's Back button closes it.
import { sanitizeHtml } from './job-text.js';
import { formatSalary, formatPosted, formatLocation, companyInitial } from './feed-logic.js';
import { badgeHtml } from './fit.js';
import { vote, voteFor } from './feedback.js';

let dialog;
let onCloseCb = null;
let current = null; // { job, getFit } for live updates while the sheet is open

function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.getElementById('job-sheet');
  dialog.querySelector('[data-close]').addEventListener('click', () => close());
  // Escape fires 'cancel'; route it through close() so the #job entry is popped too.
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  // Tap on the dimmed backdrop closes.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });
  window.addEventListener('hashchange', () => {
    if (dialog.open && location.hash !== '#job') finish();
  });
  // Smart matching answered while the sheet is open: show the pairs.
  window.addEventListener('jf:smart-ready', (e) => {
    if (!dialog.open || !current?.getFit || e.detail?.jobId !== current.job.id) return;
    const fit = current.getFit();
    renderBadge(dialog, fit);
    renderFit(dialog, fit, current.job);
  });
  return dialog;
}

/**
 * @param job normalized job
 * @param opts {score?, fit?: {reasons, gaps, smart?}, getFit?: () => fit (for live smart updates), actions?: {onPass, onSave, saveBlocked?}, tracking?: {applied(), referred(), toggleApplied(), toggleReferred()}, onClose?}
 */
export function openJobDetails(job, { score, fit, getFit, actions, tracking, onClose } = {}) {
  const d = ensureDialog();
  onCloseCb = onClose ?? null;
  current = { job, getFit };

  d.querySelector('.js-logo').textContent = companyInitial(job.company);
  d.querySelector('.js-company').textContent = job.company;
  d.querySelector('.js-posted').textContent = formatPosted(job.postedAt);
  renderBadge(d, fit ?? { score });
  d.querySelector('.js-title').textContent = job.title;
  d.querySelector('.js-loc').textContent = formatLocation(job);
  d.querySelector('.js-salary').textContent = formatSalary(job.salary) ?? 'Salary not listed';

  renderFit(d, fit, job);
  renderTracking(d, tracking);

  const body = d.querySelector('.js-description');
  const safe = job.descriptionHtml ? sanitizeHtml(job.descriptionHtml) : null;
  if (safe && safe.textContent.trim()) body.replaceChildren(safe);
  else body.innerHTML = '<p class="muted">This posting didn’t include a description. Open the original posting to read it.</p>';

  const link = d.querySelector('.js-original');
  link.hidden = !/^https:\/\//.test(job.url ?? '');
  if (!link.hidden) link.href = job.url;

  const bar = d.querySelector('.js-actions');
  const note = d.querySelector('.js-blocked');
  bar.hidden = !actions;
  if (actions) {
    const pass = d.querySelector('.js-pass');
    const save = d.querySelector('.js-save');
    pass.onclick = () => close(actions.onPass);
    save.onclick = () => close(actions.onSave);
    save.disabled = Boolean(actions.saveBlocked);
    note.textContent = actions.saveBlocked ?? '';
  } else {
    note.textContent = '';
  }

  d.querySelector('.sheet-scroll').scrollTop = 0;
  if (!d.open) d.showModal();
  if (location.hash !== '#job') location.hash = 'job';
  d.querySelector('[data-close]').focus({ preventScroll: true });
}

function renderTracking(d, tracking) {
  const row = d.querySelector('.js-track');
  row.hidden = !tracking;
  if (!tracking) return;
  const applied = d.querySelector('.js-track-applied');
  const referred = d.querySelector('.js-track-referred');
  applied.setAttribute('aria-pressed', String(tracking.applied()));
  referred.setAttribute('aria-pressed', String(tracking.referred()));
  applied.onclick = () => applied.setAttribute('aria-pressed', String(tracking.toggleApplied()));
  referred.onclick = () => referred.setAttribute('aria-pressed', String(tracking.toggleReferred()));
}

/** Close the sheet from outside (e.g. after marking a feed job applied), then run `after`. */
export function closeJobDetails(after) {
  if (dialog?.open) close(after);
  else after?.();
}

function renderBadge(d, fit) {
  const badge = d.querySelector('.js-match');
  badge.innerHTML = badgeHtml(fit);
  badge.hidden = !badge.innerHTML;
}

const THUMB_UP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11v9H4v-9zM7 11l4-8a2 2 0 0 1 3 2l-1 5h6a2 2 0 0 1 2 2.3l-1.2 6.5A2 2 0 0 1 17.8 20H7"/></svg>';
const THUMB_DOWN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 13V4h3v9zM17 13l-4 8a2 2 0 0 1-3-2l1-5H5a2 2 0 0 1-2-2.3l1.2-6.5A2 2 0 0 1 6.2 4H17"/></svg>';

/** US6: "They want → You did" pairs from Claude, each with 👍 / 👎. */
function renderSmart(d, smart, job) {
  const list = d.querySelector('.js-reasons');
  const none = d.querySelector('.js-fit-none');
  const source = d.querySelector('.js-fit-source');
  source.textContent = 'Matched by Claude · quotes are exact';
  if (smart.state === 'loading') {
    none.textContent = 'Finding your best matches…';
    return;
  }
  if (!smart.pairs.length) {
    none.textContent = 'Claude found no lines in your resume that clearly prove what this job asks for. Read the description below to judge for yourself.';
    return;
  }
  for (const p of smart.pairs) {
    const li = document.createElement('li');
    li.className = 'reason pair-reason';
    li.innerHTML = `
      <p class="pair"><span class="pair-label">They want</span> <q class="pair-want"></q></p>
      <p class="pair"><span class="pair-label">You did</span> <q class="pair-did"></q></p>
      <div class="thumbs" role="group" aria-label="Was this reason useful?">
        <button type="button" class="thumb" data-vote="up" aria-label="Useful" aria-pressed="false">${THUMB_UP}</button>
        <button type="button" class="thumb" data-vote="down" aria-label="Not useful" aria-pressed="false">${THUMB_DOWN}</button>
      </div>`;
    li.querySelector('.pair-want').textContent = p.want;
    li.querySelector('.pair-did').textContent = p.did;
    const buttons = [...li.querySelectorAll('.thumb')];
    const paint = (v) => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.vote === v)));
    paint(voteFor(job.id, p));
    buttons.forEach((b) => b.addEventListener('click', () => paint(vote(job, p, b.dataset.vote))));
    list.append(li);
  }
}

function renderFit(d, fit, job) {
  const section = d.querySelector('.js-fit');
  const list = d.querySelector('.js-reasons');
  const none = d.querySelector('.js-fit-none');
  const source = d.querySelector('.js-fit-source');
  section.hidden = !fit;
  list.replaceChildren();
  none.textContent = '';
  source.textContent = '';
  const smart = fit?.smart;
  if (smart && (smart.state === 'ready' || smart.state === 'loading')) {
    renderSmart(d, smart, job);
    d.querySelector('.js-gaps').hidden = true; // keyword gaps don't belong next to Claude's pairs
    return;
  }
  if (smart?.state === 'error') source.textContent = 'Keyword matches · smart matching unavailable right now';
  if (fit?.reasons.length) {
    // At most 4 short bullets: the skill, and the resume line that shows it.
    for (const r of fit.reasons.slice(0, 4)) {
      const li = document.createElement('li');
      li.className = 'reason';
      const label = document.createElement('strong');
      label.className = 'reason-label';
      label.textContent = r.label;
      const line = document.createElement('span');
      line.className = 'reason-line';
      line.textContent = `“${r.resumeLine}”`;
      li.append(label, line);
      list.append(li);
    }
  } else if (fit) {
    none.textContent = 'We didn’t find lines in your resume that match what this job asks for. Read the description below to judge for yourself.';
  }

  const gaps = d.querySelector('.js-gaps');
  const gapList = d.querySelector('.js-gap-list');
  gapList.replaceChildren(
    ...(fit?.gaps ?? []).map((g) => Object.assign(document.createElement('li'), { className: 'tag tag-muted', textContent: g.label }))
  );
  gaps.hidden = !gapList.children.length;
}

export function isDetailsOpen() {
  return Boolean(dialog?.open);
}

/** Close, then run `after` (e.g. pass/save the card) once the sheet is gone. */
function close(after) {
  pendingAfter = after ?? null;
  if (location.hash === '#job') history.back(); // hashchange → finish()
  else finish();
}

let pendingAfter = null;
function finish() {
  if (!dialog?.open) return;
  dialog.close();
  const after = pendingAfter;
  pendingAfter = null;
  const cb = onCloseCb;
  onCloseCb = null;
  cb?.();
  after?.();
}
