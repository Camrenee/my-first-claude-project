// US2 Today screen: one job card at a time, swipe right to save, left to pass.
import {
  loadProfile, isProfileComplete, loadJobsCache, saveJobsCache, loadDecisions, loadDeck, saveDeck,
  recordDecision, undoLastDecision, canUndo, queuedJobs,
} from './store.js';
import {
  dealDeck, remainingCards, roleKey, QUEUE_MAX, formatSalary, formatPosted, formatLocation, companyInitial,
} from './feed-logic.js';
import { buildMatcher } from './match.js';
import { openJobDetails, isDetailsOpen } from './job-details.js';
import { htmlToParagraphs, previewFromParagraphs, roleParagraphs } from './job-text.js';
import { buildReasons, gapsFrom } from './fit.js';
import { toLines } from './resume-parse.js';

const JOBS_URL = 'data/jobs.json';
const STALE_MS = 60 * 60 * 1000; // re-check the server copy at most hourly unless pulled
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = (s) => document.querySelector(s);
let els;
let state = { jobs: [], jobsById: new Map(), generatedAt: null, matcher: null, matcherKey: '', cards: [], loading: false, error: null };
let busy = false; // true while a card is flying out

export function initFeed() {
  els = {
    screen: $('#screen-today'),
    deck: $('#deck'),
    status: $('#deck-status'),
    actions: $('#deck-actions'),
    pass: $('#btn-pass'),
    save: $('#btn-save'),
    undo: $('#btn-undo'),
    live: $('#deck-live'),
    ptr: $('#ptr'),
  };
  els.pass.addEventListener('click', () => decide('passed'));
  els.save.addEventListener('click', () => decide('queued'));
  els.undo.addEventListener('click', undo);
  document.addEventListener('keydown', onKey);
  setupPullToRefresh();

  const cached = loadJobsCache();
  if (cached?.jobs) setJobs(cached);
}

/** Called by the router each time Today is shown. */
export function showToday() {
  render();
  const cached = loadJobsCache();
  if (!cached || Date.now() - Date.parse(cached.fetchedAt ?? 0) > STALE_MS) refresh({ quiet: Boolean(cached) });
}

// ---------- Data ----------

async function refresh({ quiet = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  state.error = null;
  if (!state.jobs.length) render();
  const before = new Set(state.jobs.map((j) => j.id));
  try {
    const res = await fetch(JOBS_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const payload = { generatedAt: data.generatedAt, fetchedAt: new Date().toISOString(), jobs: data.jobs ?? [] };
    saveJobsCache(payload); // best effort; the feed still works if storage is full
    setJobs(payload);
    const added = payload.jobs.filter((j) => !before.has(j.id)).length;
    // The very first load isn't news; only say "new" when we had jobs before.
    if (!quiet && before.size) announce(added ? `${added} new role${added === 1 ? '' : 's'} found.` : 'You’re up to date.', true);
  } catch {
    state.error = state.jobs.length ? null : 'load';
    if (!quiet) announce('Couldn’t refresh. Check your connection and try again.', true);
  } finally {
    state.loading = false;
    render();
  }
}

function setJobs({ jobs, generatedAt }) {
  state.jobs = jobs;
  state.jobsById = new Map(jobs.map((j) => [j.id, j]));
  state.generatedAt = generatedAt;
  state.matcherKey = ''; // rebuild scores for the new set
}

function getMatcher(profile) {
  const key = `${profile.resume.updatedAt}|${state.jobs.length}|${state.generatedAt}`;
  if (state.matcherKey !== key) {
    const docs = state.jobs.map((j) => ({ id: j.id, text: roleText(j) }));
    state.matcher = buildMatcher(profile.resume.text, docs);
    state.matcherKey = key;
  }
  return state.matcher;
}

const textCache = new Map();
/** Title + description without legal/pay/benefits boilerplate: what the match score reads. */
function roleText(job) {
  if (!textCache.has(job.id)) {
    // DOMParser (inside htmlToParagraphs) never runs scripts; we only read the text.
    textCache.set(job.id, `${job.title}\n${roleParagraphs(htmlToParagraphs(job.descriptionHtml)).join('\n')}`);
  }
  return textCache.get(job.id);
}

// ---------- Render ----------

function render() {
  if (!els) return;
  const profile = loadProfile();
  const queue = queuedJobs();
  const queueFull = queue.length >= QUEUE_MAX;

  if (!isProfileComplete(profile)) {
    setStatus('');
    return showPanel({
      icon: 'resume',
      title: 'Add your resume first',
      body: 'We rank every job by how well it matches your resume. It only takes a minute.',
      cta: { href: '#profile', label: 'Set up my profile' },
    });
  }

  if (!state.jobs.length) {
    setStatus('');
    if (state.error) {
      return showPanel({ icon: 'cloud', title: 'We couldn’t load jobs', body: 'Check your connection, then pull down to try again.', cta: { action: () => refresh(), label: 'Try again' } });
    }
    return showLoading();
  }

  const decisions = loadDecisions();
  const matcher = getMatcher(profile);
  const deck = dealDeck({ jobs: state.jobs, profile, decisions, deck: loadDeck(), score: matcher });
  saveDeck(deck);
  state.cards = remainingCards({ deck, jobsById: state.jobsById, profile, decisions });

  const left = state.cards.length;
  setStatus(`${left ? `${left} of ${deck.dealt.length} left today` : 'Done for today'} · ${queue.length} of ${QUEUE_MAX} in your queue`);
  els.status.title = freshness();
  els.undo.disabled = !canUndo();

  if (queueFull && left) {
    return showPanel({
      icon: 'queue',
      title: 'Your queue is full',
      body: `You've saved ${QUEUE_MAX} jobs. Tailor your resume for them and apply, then come back for more. Your ${left} remaining card${left === 1 ? '' : 's'} will wait here.`,
      cta: { href: '#tracker', label: 'Go to my queue' },
      paused: true,
    });
  }

  if (!left) {
    const today = deck.dealt.map((d) => decisions.byId[d.id]?.action);
    const saved = today.filter((a) => a === 'queued').length;
    const passed = today.filter((a) => a === 'passed').length;
    if (!deck.dealt.length) {
      return showPanel({
        icon: 'search',
        title: 'No new matches right now',
        body: `We checked ${state.jobs.length} PM role${state.jobs.length === 1 ? '' : 's'} posted this week. None are new for you under your filters. Pull down later, or widen your filters.`,
        cta: { href: '#profile', label: 'Edit my filters' },
      });
    }
    return showPanel({
      icon: 'done',
      title: 'You’re all caught up!',
      body: `That’s today’s shortlist: ${saved} saved, ${passed} passed. Fresh roles land every day.`,
      cta: queue.length ? { href: '#tracker', label: `See my queue (${queue.length})` } : null,
    });
  }

  showCards(matcher, deck);
}

function showCards(matcher, deck) {
  const [top, next] = state.cards;
  els.deck.replaceChildren(...[next, top].filter(Boolean).map((c, i, arr) => cardEl(c, matcher, i === arr.length - 1)));
  els.actions.hidden = false;
  els.pass.disabled = false;
  els.save.disabled = false;
  const topEl = els.deck.querySelector('.job-card.is-top');
  const nextEl = els.deck.querySelector('.job-card.is-next');
  if (nextEl && topEl) nextEl.style.height = `${topEl.offsetHeight}px`;
  attachSwipe(topEl);
}

function cardEl(card, matcher, isTop) {
  const job = state.jobsById.get(card.id);
  const { score } = matcher(job.id);
  const salary = formatSalary(job.salary);
  const el = document.createElement('article');
  el.className = `job-card ${isTop ? 'is-top' : 'is-next'}`;
  el.dataset.id = job.id;
  if (isTop) {
    el.tabIndex = 0;
    el.setAttribute('aria-label', `${job.title} at ${job.company}. ${score}% match.`);
  } else {
    el.setAttribute('aria-hidden', 'true');
  }
  el.innerHTML = `
    <div class="stamp stamp-save" aria-hidden="true">Save</div>
    <div class="stamp stamp-pass" aria-hidden="true">Pass</div>
    <div class="jc-head">
      <div class="logo" aria-hidden="true"></div>
      <div class="jc-co">
        <p class="jc-company"></p>
        <p class="jc-posted"></p>
      </div>
      <span class="match-badge"><strong>${score}%</strong> match</span>
    </div>
    <h2 class="jc-title"></h2>
    <ul class="jc-facts">
      <li class="fact"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg><span class="jc-loc"></span></li>
      <li class="fact"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="3"/><circle cx="12" cy="12" r="2.5"/></svg><span class="jc-salary"></span></li>
    </ul>
    <div class="jc-tags"></div>
    <section class="fit-box"><h3 class="fit-title">Why you're a great fit</h3><ul class="fit-list"></ul></section>
    <p class="jc-preview"></p>
    <button type="button" class="jc-more">More details<span class="visually-hidden">: ${''}</span></button>`;
  // Text from job boards goes in as text, never as HTML.
  el.querySelector('.logo').textContent = companyInitial(job.company);
  el.querySelector('.jc-company').textContent = job.company;
  el.querySelector('.jc-posted').textContent = formatPosted(job.postedAt);
  el.querySelector('.jc-title').textContent = job.title;
  el.querySelector('.jc-loc').textContent = formatLocation(job);
  const salEl = el.querySelector('.jc-salary');
  if (salary) salEl.textContent = salary;
  else salEl.closest('li').replaceWith(tag('Salary not listed', 'tag-muted'));
  if (card.updated) el.querySelector('.jc-tags').append(tag('Updated', 'tag-accent'));
  if (!el.querySelector('.jc-tags').children.length) el.querySelector('.jc-tags').remove();
  const preview = previewOf(job);
  renderFitBox(el.querySelector('.fit-box'), fitFor(job).reasons.slice(0, 2));
  if (preview) el.querySelector('.jc-preview').textContent = preview;
  else el.querySelector('.jc-preview').remove();
  const more = el.querySelector('.jc-more');
  more.querySelector('.visually-hidden').textContent = `: ${job.title} at ${job.company}`;
  if (isTop) more.addEventListener('click', () => openDetails(job));
  else more.tabIndex = -1;
  if (job.logo && /^https:\/\//.test(job.logo)) {
    const img = new Image();
    img.alt = '';
    img.src = job.logo;
    img.onload = () => el.querySelector('.logo').replaceChildren(img);
  }
  return el;
}

// ---------- Why you fit (US5) ----------

const fitCache = new Map();
/** Match score, reasons tied to resume lines, and gaps for one job. Exported for the Tracker. */
export function fitFor(job) {
  const profile = loadProfile();
  if (!isProfileComplete(profile)) return { score: null, reasons: [], gaps: [] };
  if (!state.jobsById.has(job.id) && !state.jobs.length) {
    const cached = loadJobsCache();
    if (cached?.jobs) setJobs(cached);
  }
  const matcher = getMatcher(profile);
  const key = `${state.matcherKey}|${job.id}`;
  if (!fitCache.has(key)) {
    // Jobs no longer in this week's list (e.g. saved earlier) are scored against the current set.
    const m = state.jobsById.has(job.id)
      ? matcher(job.id)
      : buildMatcher(profile.resume.text, [...state.jobs, job].map((j) => ({ id: j.id, text: roleText(j) })))(job.id);
    const resumeLines = profile.resume.lines?.length ? profile.resume.lines : toLines(profile.resume.text);
    const jobParagraphs = roleParagraphs(htmlToParagraphs(job.descriptionHtml));
    fitCache.set(key, {
      score: m.score,
      reasons: buildReasons({ matched: m.matched, resumeLines, jobParagraphs, max: 5 }),
      gaps: gapsFrom(m.missing, 3),
    });
  }
  return fitCache.get(key);
}

function renderFitBox(box, reasons) {
  const list = box.querySelector('.fit-list');
  if (!reasons.length) {
    box.classList.add('is-empty');
    box.querySelector('.fit-title').textContent = 'Fit check';
    list.replaceWith(Object.assign(document.createElement('p'), {
      className: 'fit-none',
      textContent: 'We didn’t find a clear match with your resume. Open the details to see what this job asks for.',
    }));
    return;
  }
  for (const r of reasons) {
    const li = document.createElement('li');
    const label = document.createElement('strong');
    label.textContent = r.label;
    const quote = document.createElement('q');
    quote.textContent = r.resumeLine;
    li.append(label, ' ', quote);
    list.append(li);
  }
}

const previewCache = new Map();
function previewOf(job) {
  if (!previewCache.has(job.id)) previewCache.set(job.id, previewFromParagraphs(htmlToParagraphs(job.descriptionHtml)));
  return previewCache.get(job.id);
}

function openDetails(job) {
  const fit = fitFor(job);
  const full = queuedJobs().length >= QUEUE_MAX;
  openJobDetails(job, {
    score: fit.score,
    fit,
    actions: {
      onPass: () => decide('passed'),
      onSave: () => decide('queued'),
      saveBlocked: full ? `Your queue is full (${QUEUE_MAX} of ${QUEUE_MAX}). Apply to or remove a saved job first.` : null,
    },
    onClose: () => els.deck.querySelector('.job-card.is-top')?.focus({ preventScroll: true }),
  });
}

function tag(text, cls) {
  const t = document.createElement(cls === 'tag-muted' ? 'li' : 'span');
  t.className = `tag ${cls}`;
  t.textContent = text;
  return t;
}

function showPanel({ icon, title, body, cta, paused = false }) {
  const panel = document.createElement('div');
  panel.className = `card deck-panel panel-${icon}`;
  panel.innerHTML = `<div class="panel-art" aria-hidden="true">${ART[icon] ?? ''}</div><h2></h2><p></p>`;
  panel.querySelector('h2').textContent = title;
  panel.querySelector('p').textContent = body;
  if (cta) {
    const b = document.createElement(cta.href ? 'a' : 'button');
    b.className = 'btn btn-primary';
    b.textContent = cta.label;
    if (cta.href) b.href = cta.href;
    else {
      b.type = 'button';
      b.addEventListener('click', cta.action);
    }
    panel.append(b);
  }
  els.deck.replaceChildren(panel);
  // While paused (queue full) only Undo stays available.
  els.actions.hidden = !paused && !canUndo();
  els.pass.disabled = true;
  els.save.disabled = true;
  els.undo.disabled = !canUndo();
}

function showLoading() {
  els.deck.innerHTML = '<div class="job-card is-top is-skeleton" aria-busy="true"><span class="visually-hidden">Loading jobs…</span><div class="sk sk-head"></div><div class="sk sk-title"></div><div class="sk sk-line"></div><div class="sk sk-line short"></div></div>';
  els.actions.hidden = true;
}

function setStatus(text) {
  els.status.textContent = text;
}

function freshness() {
  if (!state.generatedAt) return '';
  const hrs = Math.round((Date.now() - Date.parse(state.generatedAt)) / 36e5);
  return hrs >= 1 ? `Jobs updated ${hrs < 24 ? `${hrs} hr` : `${Math.round(hrs / 24)} d`} ago` : 'Jobs updated just now';
}

function announce(text, toast = false) {
  els.live.textContent = '';
  requestAnimationFrame(() => (els.live.textContent = text));
  if (toast) showToast(text);
}

let toastTimer;
function showToast(text) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('aria-hidden', 'true'); // the live region already announces it
    document.body.append(t);
  }
  t.textContent = text;
  t.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-on'), 2600);
}

// ---------- Decisions ----------

function decide(action, { fromSwipe = false, dx = 0 } = {}) {
  if (busy) return;
  const top = els.deck.querySelector('.job-card.is-top:not(.is-skeleton)');
  if (!top) return;
  const job = state.jobsById.get(top.dataset.id);
  if (!job) return;
  if (action === 'queued' && queuedJobs().length >= QUEUE_MAX) return render();

  recordDecision(job, action, roleKey(job));
  announce(action === 'queued' ? `Saved ${job.title} at ${job.company} to your queue.` : `Passed on ${job.title} at ${job.company}.`);
  flyOut(top, action === 'queued' ? 1 : -1, fromSwipe ? dx : 0);
}

function flyOut(el, dir, fromDx) {
  if (reduceMotion()) return render();
  busy = true;
  const w = el.offsetWidth;
  el.classList.add(dir > 0 ? 'show-save' : 'show-pass');
  el.style.transition = 'transform 260ms cubic-bezier(.2,.7,.3,1), opacity 260ms';
  el.style.transform = `translateX(${dir * (w * 1.4)}px) rotate(${dir * 18}deg)`;
  el.style.opacity = '0';
  const next = els.deck.querySelector('.job-card.is-next');
  next?.classList.add('is-promoting');
  setTimeout(() => {
    busy = false;
    render();
    els.deck.querySelector('.job-card.is-top')?.focus({ preventScroll: true });
  }, fromDx ? 200 : 260);
}

function undo() {
  if (busy) return;
  const id = undoLastDecision();
  if (!id) return;
  // If the undone card came from an earlier day, put it back on today's deck.
  const deck = loadDeck();
  if (deck && !deck.dealt.some((d) => d.id === id) && state.jobsById.has(id)) {
    deck.dealt.unshift({ id, at: new Date(0).toISOString() });
    saveDeck(deck);
  }
  const job = state.jobsById.get(id);
  announce(job ? `Undid: ${job.title} at ${job.company} is back.` : 'Undone.');
  render();
  els.deck.querySelector('.job-card.is-top')?.classList.add('is-returning');
}

function onKey(e) {
  if (els.screen.hidden || e.altKey || e.metaKey || e.ctrlKey) return;
  if (e.target.closest('input, textarea, select, [contenteditable]')) return;
  if (isDetailsOpen()) return;
  if (e.key === 'Enter' && e.target.classList?.contains('job-card') && e.target.classList.contains('is-top')) {
    e.preventDefault();
    const job = state.jobsById.get(e.target.dataset.id);
    if (job) openDetails(job);
  } else if (e.key === 'ArrowRight' && !els.save.disabled) {
    e.preventDefault();
    decide('queued');
  } else if (e.key === 'ArrowLeft' && !els.pass.disabled) {
    e.preventDefault();
    decide('passed');
  }
}

// ---------- Swipe ----------

function attachSwipe(card) {
  if (!card) return;
  let startX = 0;
  let startY = 0;
  let startT = 0;
  let dx = 0;
  let axis = null;
  let id = null;

  card.addEventListener('pointerdown', (e) => {
    if (busy || e.button !== 0 || e.target.closest('a, button')) return;
    id = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    startT = performance.now();
    dx = 0;
    axis = null;
  });

  card.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const mx = e.clientX - startX;
    const my = e.clientY - startY;
    if (!axis) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      if (axis === 'x') {
        card.setPointerCapture(id);
        card.classList.add('is-dragging');
      } else {
        id = null; // let the page scroll / pull-to-refresh handle it
        return;
      }
    }
    dx = mx;
    card.style.transform = `translateX(${dx}px) translateY(${my * 0.15}px) rotate(${dx / 18}deg)`;
    const p = Math.min(Math.abs(dx) / 110, 1);
    card.style.setProperty('--save', dx > 0 ? p : 0);
    card.style.setProperty('--pass', dx < 0 ? p : 0);
  });

  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    card.classList.remove('is-dragging');
    // A tap (no real movement) opens the full description.
    if (axis === null && e.type === 'pointerup' && !e.target.closest('a, button')) {
      const job = state.jobsById.get(card.dataset.id);
      if (job) openDetails(job);
      return;
    }
    if (axis !== 'x') return;
    const v = Math.abs(dx) / Math.max(performance.now() - startT, 1);
    if (Math.abs(dx) > card.offsetWidth * 0.3 || (v > 0.6 && Math.abs(dx) > 40)) {
      decide(dx > 0 ? 'queued' : 'passed', { fromSwipe: true, dx });
    } else {
      card.style.transition = 'transform 200ms ease';
      card.style.transform = '';
      card.style.setProperty('--save', 0);
      card.style.setProperty('--pass', 0);
      setTimeout(() => (card.style.transition = ''), 200);
    }
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
}

// ---------- Pull to refresh ----------

function setupPullToRefresh() {
  const THRESHOLD = 70;
  let startY = null;
  let pull = 0;

  els.screen.addEventListener('touchstart', (e) => {
    if (window.scrollY > 0 || state.loading || e.touches.length !== 1) return (startY = null);
    startY = e.touches[0].clientY;
    pull = 0;
  }, { passive: true });

  els.screen.addEventListener('touchmove', (e) => {
    if (startY === null) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0 || els.deck.querySelector('.is-dragging')) {
      pull = 0;
      return setPull(0);
    }
    if (e.cancelable) e.preventDefault(); // stop the browser's own pull-to-reload
    pull = Math.min(dy * 0.5, 110);
    setPull(pull, pull > THRESHOLD ? 'Release to refresh' : 'Pull to refresh');
  }, { passive: false });

  els.screen.addEventListener('touchend', () => {
    if (startY === null) return;
    startY = null;
    if (pull > THRESHOLD) {
      setPull(56, 'Refreshing…', true);
      refresh().finally(() => setPull(0));
    } else {
      setPull(0);
    }
  });
}

function setPull(px, text, spinning = false) {
  els.ptr.style.setProperty('--pull', `${px}px`);
  els.ptr.classList.toggle('is-visible', px > 0);
  els.ptr.classList.toggle('is-spinning', spinning);
  if (text) els.ptr.querySelector('.ptr-text').textContent = text;
}

// ---------- Panel art (simple inline icons) ----------

const ART = {
  done: '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="26"/><path d="M20 33l8 8 16-17"/></svg>',
  queue: '<svg viewBox="0 0 64 64"><rect x="14" y="10" width="36" height="44" rx="8"/><path d="M22 24h20M22 32h20M22 40h12"/></svg>',
  search: '<svg viewBox="0 0 64 64"><circle cx="28" cy="28" r="15"/><path d="M39 39l13 13"/></svg>',
  resume: '<svg viewBox="0 0 64 64"><rect x="14" y="8" width="36" height="48" rx="8"/><circle cx="32" cy="24" r="6"/><path d="M22 40h20M22 47h14"/></svg>',
  cloud: '<svg viewBox="0 0 64 64"><path d="M20 46a10 10 0 0 1 0-20 14 14 0 0 1 27 3 9 9 0 0 1-2 17z"/><path d="M28 34l8 8M36 34l-8 8"/></svg>',
};
