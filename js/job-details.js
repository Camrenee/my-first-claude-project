// Job details: a full-screen sheet over the current screen with the whole job description.
// Opening it adds "#job" to the address so the phone's Back button closes it.
import { sanitizeHtml } from './job-text.js';
import { formatSalary, formatPosted, formatLocation, companyInitial } from './feed-logic.js';

let dialog;
let onCloseCb = null;

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
  return dialog;
}

/**
 * @param job normalized job
 * @param opts {score?, fit?: {reasons, gaps}, actions?: {onPass, onSave, saveBlocked?}, tracking?: {applied(), referred(), toggleApplied(), toggleReferred()}, onClose?}
 */
export function openJobDetails(job, { score, fit, actions, tracking, onClose } = {}) {
  const d = ensureDialog();
  onCloseCb = onClose ?? null;

  d.querySelector('.js-logo').textContent = companyInitial(job.company);
  d.querySelector('.js-company').textContent = job.company;
  d.querySelector('.js-posted').textContent = formatPosted(job.postedAt);
  const badge = d.querySelector('.js-match');
  badge.hidden = score == null;
  if (score != null) badge.innerHTML = `<strong>${Number(score)}%</strong> match`;
  d.querySelector('.js-title').textContent = job.title;
  d.querySelector('.js-loc').textContent = formatLocation(job);
  d.querySelector('.js-salary').textContent = formatSalary(job.salary) ?? 'Salary not listed';

  renderFit(d, fit);
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

function renderFit(d, fit) {
  const section = d.querySelector('.js-fit');
  const list = d.querySelector('.js-reasons');
  const none = d.querySelector('.js-fit-none');
  section.hidden = !fit;
  list.replaceChildren();
  none.textContent = '';
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
