// US4 Tracker: tabs (To apply / All / Applied / Referred), one-tap Applied and Referred on
// any job (a job can be both), referral status + "Referred by", and the weekly goal card.
import { trackerEntries, removeFromQueue, loadJobsCache, setApplied, setReferral, queuedJobs } from './store.js';
import { openJobDetails } from './job-details.js';
import { fitFor } from './feed.js';
import { QUEUE_MAX, formatSalary, formatLocation, companyInitial } from './feed-logic.js';
import { TABS, REFERRAL_STATUSES, entriesForTab, weeklyGoal, shortDate, weekLabel } from './tracking.js';
import { toast } from './toast.js';
import { trackingFor, appliedMessage } from './track-actions.js';
import { openTailor } from './tailor-ui.js';

const $ = (s) => document.querySelector(s);
const TAB_KEY = 'jf.trackerTab';
let tab = readTab();

function readTab() {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return TABS.some((x) => x.id === t) ? t : 'to_apply';
  } catch {
    return 'to_apply';
  }
}

function saveTab(t) {
  try {
    localStorage.setItem(TAB_KEY, t);
  } catch {
    /* remembered for this visit only */
  }
}

export function showTracker() {
  const entries = trackerEntries();
  renderGoal(entries);
  renderTabs(entries);
  renderList(entries);
}

// ---------- Weekly goal ----------

function renderGoal(entries) {
  const g = weeklyGoal(entries);
  $('#goal-week').textContent = weekLabel(g.weekStart, g.weekEnd);
  $('#goal-count').textContent = `${g.count} of ${g.goal}`;
  const bar = $('#goal-bar');
  bar.setAttribute('aria-valuenow', String(Math.min(g.count, g.goal)));
  bar.setAttribute('aria-valuetext', `${g.count} of ${g.goal} applications this week`);
  bar.replaceChildren(
    ...Array.from({ length: g.goal }, (_, i) => Object.assign(document.createElement('span'), { className: `goal-seg ${i < g.count ? 'is-done' : ''}` }))
  );
  const left = g.goal - g.count;
  let note = g.met ? 'Goal hit. Nice work!' : left === g.goal ? 'Two applications this week keeps your search moving.' : `${left} more to hit this week's goal.`;
  if (g.streak >= 2) note += ` ${g.streak} weeks in a row.`;
  $('#goal-note').textContent = note;
  $('#goal-card').classList.toggle('is-met', g.met);
}

// ---------- Tabs ----------

function renderTabs(entries) {
  const wrap = $('#tracker-tabs');
  wrap.replaceChildren(
    ...TABS.map((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.role = 'tab';
      b.id = `tab-${t.id}`;
      b.className = 'tab';
      b.setAttribute('aria-selected', String(t.id === tab));
      b.setAttribute('aria-controls', 'tracker-list');
      b.tabIndex = t.id === tab ? 0 : -1;
      const n = entriesForTab(entries, t.id).length;
      b.innerHTML = `<span class="tab-label"></span><span class="tab-count"></span>`;
      b.firstChild.textContent = t.label;
      b.querySelector('.tab-count').textContent = String(n);
      b.addEventListener('click', () => selectTab(t.id));
      return b;
    })
  );
  // Arrow keys move between tabs (standard tablist behaviour).
  wrap.onkeydown = (e) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    selectTab(TABS[(i + step + TABS.length) % TABS.length].id);
    document.getElementById(`tab-${tab}`)?.focus();
  };
  $('#tracker-list').setAttribute('aria-labelledby', `tab-${tab}`);
}

function selectTab(id) {
  tab = id;
  saveTab(id);
  showTracker();
}

// ---------- List ----------

const EMPTY = {
  to_apply: ['Nothing saved yet', 'Swipe right on a job you like and it lands here, ready to tailor and apply.', { href: '#today', label: "Go to today's shortlist" }],
  all: ['No jobs tracked yet', 'Jobs you save, apply to or get referred for all show up here.', { href: '#today', label: "Go to today's shortlist" }],
  applied: ['No applications yet', 'Tap “Applied” on a job once you’ve sent your application. It counts toward your weekly goal.', null],
  referred: ['No referrals yet', 'Tap “Referred” on a job when someone refers you, and track how it’s going here.', null],
};

function renderList(entries) {
  const list = $('#tracker-list');
  const items = entriesForTab(entries, tab);
  const hint = $('#tab-hint');
  const queued = queuedJobs().length;
  hint.textContent = tab === 'to_apply' && queued ? `${queued} of ${QUEUE_MAX} saved. Tailor your resume for each one, then apply.` : '';

  if (!items.length) {
    const [title, body, cta] = EMPTY[tab];
    const card = document.createElement('div');
    card.className = 'card empty';
    card.innerHTML = '<h2></h2><p></p>';
    card.querySelector('h2').textContent = title;
    card.querySelector('p').textContent = body;
    if (cta) card.append(Object.assign(document.createElement('a'), { className: 'btn btn-primary', href: cta.href, textContent: cta.label }));
    list.replaceChildren(card);
    return;
  }
  list.replaceChildren(...items.map(itemEl));
}

function itemEl(entry) {
  const { id, job } = entry;
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
        <p class="qi-dates"></p>
      </div>
    </div>
    <div class="track-row" role="group" aria-label="Status">
      <button type="button" class="track-btn qi-applied" aria-pressed="false"><span class="tb-icon" aria-hidden="true">✓</span> Applied</button>
      <button type="button" class="track-btn qi-referred" aria-pressed="false"><span class="tb-icon" aria-hidden="true">✓</span> Referred</button>
    </div>
    <button type="button" class="btn btn-block qi-tailor"></button>
    <div class="btn-row qi-actions">
      <button type="button" class="btn btn-ghost qi-details">Details</button>
      <a class="btn btn-ghost qi-link" target="_blank" rel="noopener noreferrer">View posting<span class="visually-hidden"> (opens in a new tab)</span> ↗</a>
      <button type="button" class="link-btn qi-remove">Remove</button>
    </div>`;
  el.querySelector('.logo').textContent = companyInitial(job.company);
  el.querySelector('.qi-title').textContent = job.title;
  el.querySelector('.qi-sub').textContent = `${job.company} · ${formatLocation(job)}`;
  el.querySelector('.qi-meta').textContent = formatSalary(job.salary) ?? 'Salary not listed';
  el.querySelector('.qi-dates').textContent = datesLine(entry);

  // Applied / Referred: one tap each; a job can be both.
  const appliedBtn = el.querySelector('.qi-applied');
  const referredBtn = el.querySelector('.qi-referred');
  appliedBtn.setAttribute('aria-pressed', String(Boolean(entry.appliedAt)));
  referredBtn.setAttribute('aria-pressed', String(Boolean(entry.referral)));
  appliedBtn.addEventListener('click', () => toggleApplied(job, !entry.appliedAt));
  referredBtn.addEventListener('click', () => {
    if (entry.referral) return toggleReferralOff(job, referredBtn);
    setReferral(job, {});
    toast('Marked as referred. Add who referred you below.');
    showTracker();
    focusLater(id, '.ref-by');
  });

  if (entry.referral) el.querySelector('.track-row').after(referralEditor(job, entry.referral));

  const link = el.querySelector('.qi-link');
  if (/^https:\/\//.test(job.url)) link.href = job.url;
  else link.remove();

  el.querySelector('.qi-details').addEventListener('click', () => openDetails(entry));

  // US3: tailor the resume for this job. Primary while it's waiting in the queue and not tailored yet.
  const tailorBtn = el.querySelector('.qi-tailor');
  const waiting = entry.queuedAt && !entry.appliedAt && !entry.removedAt;
  tailorBtn.textContent = entry.tailored ? 'Tailored ✓ · Open' : 'Tailor resume';
  tailorBtn.classList.add(waiting && !entry.tailored ? 'btn-primary' : 'btn-ghost');
  tailorBtn.addEventListener('click', () => tailor(entry, '.qi-tailor'));

  const removeBtn = el.querySelector('.qi-remove');
  if (tab !== 'to_apply') removeBtn.remove();
  else armTwoTap(removeBtn, 'Remove', 'Tap again to remove', () => {
    removeFromQueue(id);
    toast('Removed from your queue.');
    showTracker();
  });
  return el;
}

function datesLine(e) {
  const parts = [];
  if (e.queuedAt) parts.push(`Saved ${shortDate(e.queuedAt)}`);
  if (e.tailored) parts.push(`Tailored ${shortDate(e.tailored.at)}`);
  if (e.appliedAt) parts.push(`Applied ${shortDate(e.appliedAt)}`);
  if (e.referral) {
    const status = REFERRAL_STATUSES.find((s) => s.id === e.referral.status)?.label ?? 'In progress';
    parts.push(`Referred ${shortDate(e.referral.at)} · ${status}${e.referral.by ? ` · by ${e.referral.by}` : ''}`);
  }
  return parts.join(' · ');
}

function referralEditor(job, referral) {
  const box = document.createElement('div');
  box.className = 'ref-editor';
  const gid = `ref-${cssId(job.id)}`;
  box.innerHTML = `
    <fieldset class="ref-status">
      <legend>Referral status</legend>
      <div class="chips"></div>
    </fieldset>
    <label class="field-label" for="${gid}-by">Referred by</label>
    <input id="${gid}-by" class="text-input ref-by" type="text" maxlength="60" autocomplete="off" placeholder="Their name" />`;
  const chips = box.querySelector('.chips');
  for (const s of REFERRAL_STATUSES) {
    const label = document.createElement('label');
    label.className = 'chip';
    label.innerHTML = `<input type="radio" name="${gid}-status" value="${s.id}" /><span></span>`;
    label.querySelector('span').textContent = s.label;
    const input = label.querySelector('input');
    input.checked = referral.status === s.id;
    input.addEventListener('change', () => {
      setReferral(job, { status: s.id });
      toast(`Referral: ${s.label}.`);
      showTracker();
      focusLater(job.id, `input[value="${s.id}"]`);
    });
    chips.append(label);
  }
  const by = box.querySelector('.ref-by');
  by.value = referral.by ?? '';
  let t;
  by.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => setReferral(job, { by: by.value.trim() }), 400);
  });
  by.addEventListener('change', () => {
    clearTimeout(t);
    setReferral(job, { by: by.value.trim() });
    const dates = by.closest('.queue-item')?.querySelector('.qi-dates');
    const fresh = trackerEntries().find((e) => e.id === job.id);
    if (dates && fresh) dates.textContent = datesLine(fresh);
  });
  return box;
}

// ---------- Actions ----------

function toggleApplied(job, on) {
  setApplied(job, on);
  toast(on ? appliedMessage() : 'No longer marked as applied.');
  showTracker();
}

function toggleReferralOff(job, btn) {
  // Removing a referral loses its status and name, so ask once.
  if (!btn.dataset.armed) {
    btn.dataset.armed = '1';
    btn.lastChild.textContent = ' Tap again to remove referral';
    setTimeout(() => {
      if (!btn.isConnected) return;
      delete btn.dataset.armed;
      btn.lastChild.textContent = ' Referred';
    }, 4000);
    return;
  }
  setReferral(job, null);
  toast('Referral removed.');
  showTracker();
}

function openDetails(entry) {
  // Prefer the latest copy of the posting; fall back to the one saved with the job.
  const job = loadJobsCache()?.jobs?.find((j) => j.id === entry.id) ?? entry.job;
  const fit = fitFor(job);
  openJobDetails(job, {
    score: fit.score,
    fit,
    getFit: () => fitFor(job),
    tracking: trackingFor(job),
    onTailor: () => tailor(entry, '.qi-tailor'),
    onClose: () => {
      showTracker();
      focusLater(entry.id, '.qi-details');
    },
  });
}

function tailor(entry, focusSel) {
  const job = loadJobsCache()?.jobs?.find((j) => j.id === entry.id) ?? entry.job;
  openTailor(job, {
    onClose: () => {
      showTracker();
      focusLater(entry.id, focusSel);
    },
  });
}

// ---------- Helpers ----------

function armTwoTap(btn, idle, armed, onConfirm) {
  let timer;
  btn.addEventListener('click', () => {
    if (!btn.dataset.armed) {
      btn.dataset.armed = '1';
      btn.textContent = armed;
      timer = setTimeout(() => {
        delete btn.dataset.armed;
        btn.textContent = idle;
      }, 4000);
      return;
    }
    clearTimeout(timer);
    onConfirm();
  });
}

function focusLater(jobId, selector) {
  requestAnimationFrame(() => document.querySelector(`.queue-item[data-id="${CSS.escape(jobId)}"] ${selector}`)?.focus({ preventScroll: true }));
}

function cssId(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
}
