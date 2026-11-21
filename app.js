/* Job Finder — plain JS, no backend. All data lives in localStorage. */
(() => {
  'use strict';

  // ---------- Storage ----------
  const KEYS = { profile: 'jf.profile', tracker: 'jf.tracker', cache: 'jf.jobsCache', tab: 'jf.tab', view: 'jf.view' };
  const CACHE_MS = 60 * 60 * 1000; // reuse fetched jobs for an hour to be kind to the free APIs

  const load = (key, fallback) => {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  };
  const save = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { return false; }
  };

  const DEFAULT_TEMPLATE = `{{date}}

Dear {{company}} Hiring Team,

I'm excited to apply for the {{jobTitle}} role at {{company}}. {{matchedSkills}}

{{highlights}}

I'd welcome the chance to talk about how I can contribute to {{company}}. Thank you for your time and consideration.

Best regards,
{{name}}
{{email}}
{{phone}}`;

  let profile = Object.assign(
    { name: '', email: '', phone: '', titles: '', workPref: 'remote', location: '', resume: '', template: DEFAULT_TEMPLATE },
    load(KEYS.profile, {})
  );
  let tracker = load(KEYS.tracker, {}); // { [jobId]: { job, status, letter, updated } }
  let jobs = [];
  let currentJob = null;
  let trackerFilter = 'all';
  let view = load(KEYS.view, 'swipe') === 'list' ? 'list' : 'swipe';
  const undoStack = []; // [{ job, prev }] so a swipe can be taken back
  let busy = false;     // true while a card is flying off screen

  // ---------- Helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s || '').toLowerCase().replace(/[-_/]/g, '').replace(/\s+/g, ' ').trim();

  const htmlToText = (html) => {
    if (!html) return '';
    // DOMParser does not run scripts or load images, so this is a safe way to strip HTML.
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, noscript').forEach((n) => n.remove());
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
  };

  const fmtDate = (ms) => {
    if (!ms) return '';
    const days = Math.floor((Date.now() - ms) / 86400000);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 30) return `${days} days ago`;
    return new Date(ms).toLocaleDateString();
  };

  let toastTimer;
  const toast = (msg) => {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  };

  const targetTitles = () => profile.titles.split(',').map((t) => t.trim()).filter(Boolean);

  // ---------- Fetching ----------
  async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function fetchRemotive() {
    const titles = targetTitles();
    const searches = titles.length ? titles : [''];
    const results = await Promise.all(searches.map((q) =>
      fetchJSON(`https://remotive.com/api/remote-jobs?limit=100${q ? `&search=${encodeURIComponent(q)}` : ''}`)
    ));
    return results.flatMap((r) => r.jobs || []).map((j) => ({
      id: `remotive-${j.id}`,
      source: 'Remotive',
      title: j.title,
      company: j.company_name,
      location: j.candidate_required_location || 'Anywhere',
      remote: true,
      salary: j.salary || '',
      date: Date.parse(j.publication_date) || 0,
      url: j.url,
      tags: j.tags || [],
      type: (j.job_type || '').replace(/_/g, ' '),
      text: htmlToText(j.description).slice(0, 1500),
    }));
  }

  async function fetchArbeitnow() {
    const pages = await Promise.allSettled([1, 2, 3].map((p) => fetchJSON(`https://www.arbeitnow.com/api/job-board-api?page=${p}`)));
    const ok = pages.filter((p) => p.status === 'fulfilled');
    if (!ok.length) throw pages[0].reason;
    return ok.flatMap((p) => p.value.data || []).map((j) => ({
      id: `arbeitnow-${j.slug}`,
      source: 'Arbeitnow',
      title: j.title,
      company: j.company_name,
      location: j.location || '',
      remote: !!j.remote,
      salary: '',
      date: (j.created_at || 0) * 1000,
      url: j.url,
      tags: j.tags || [],
      type: (j.job_types || []).join(', '),
      text: htmlToText(j.description).slice(0, 1500),
    }));
  }

  async function loadJobs(force = false) {
    const status = $('#feedStatus');
    const cacheKey = targetTitles().join('|').toLowerCase();
    const cache = load(KEYS.cache, null);
    if (!force && cache && cache.key === cacheKey && Date.now() - cache.at < CACHE_MS) {
      jobs = cache.jobs;
      renderJobs();
      return;
    }

    status.className = 'status';
    status.textContent = 'Loading jobs from Remotive and Arbeitnow…';
    $('#refreshBtn').disabled = true;

    const [rem, arb] = await Promise.allSettled([fetchRemotive(), fetchArbeitnow()]);
    $('#refreshBtn').disabled = false;

    const errors = [];
    const all = [];
    if (rem.status === 'fulfilled') all.push(...rem.value); else errors.push('Remotive');
    if (arb.status === 'fulfilled') all.push(...arb.value); else errors.push('Arbeitnow');

    // de-duplicate (same Remotive job can come back from several searches)
    const seen = new Set();
    jobs = all.filter((j) => (seen.has(j.id) ? false : seen.add(j.id))).sort((a, b) => b.date - a.date);

    if (all.length) save(KEYS.cache, { key: cacheKey, at: Date.now(), jobs });
    renderJobs(errors);
  }

  // ---------- Filtering ----------
  const LOCATION_ALIASES = [
    ['usa', 'us', 'u.s.', 'united states', 'america', 'americas', 'north america'],
    ['uk', 'united kingdom', 'england', 'britain', 'great britain'],
    ['germany', 'deutschland', 'de'],
    ['europe', 'eu', 'emea'],
  ];
  const ANYWHERE = ['anywhere', 'worldwide', 'global', 'world'];

  function locationTerms(loc) {
    const l = loc.toLowerCase().trim();
    if (!l) return [];
    const group = LOCATION_ALIASES.find((g) => g.includes(l));
    return group ? group : [l];
  }

  function locationMatches(jobLoc, terms) {
    if (!terms.length) return true;
    const jl = ` ${jobLoc.toLowerCase().replace(/[(),;/|]/g, ' ')} `;
    return terms.some((t) => (t.length <= 3 ? jl.includes(` ${t} `) : jl.includes(t)));
  }

  function matchesTitle(job) {
    const titles = targetTitles();
    if (!titles.length || $('#showAll').checked) return true;
    const jt = norm(job.title);
    return titles.some((t) => {
      const nt = norm(t);
      if (jt.includes(nt)) return true;
      const words = nt.split(' ').filter((w) => w.length > 2);
      return words.length > 0 && words.every((w) => jt.includes(w));
    });
  }

  function matchesLocation(job) {
    const terms = locationTerms(profile.location);
    const pref = profile.workPref;
    if (job.remote) {
      if (pref === 'onsite') return false;
      // For remote jobs, location = where candidates may live.
      const jl = job.location.toLowerCase();
      if (!jl || ANYWHERE.some((a) => jl.includes(a))) return true;
      return job.source === 'Arbeitnow' || locationMatches(job.location, terms);
    }
    if (pref === 'remote') return false;
    return locationMatches(job.location, terms);
  }

  function filteredJobs() {
    const q = $('#jobSearch').value.trim().toLowerCase();
    const hideTracked = view === 'swipe' || $('#hideTracked').checked;
    return jobs.filter((j) =>
      matchesTitle(j) &&
      matchesLocation(j) &&
      (!hideTracked || !tracker[j.id]) &&
      (!q || `${j.title} ${j.company} ${j.location} ${j.tags.join(' ')}`.toLowerCase().includes(q))
    );
  }

  // ---------- Rendering ----------
  function jobCard(job, entry) {
    const badge = entry ? `<span class="badge ${esc(entry.status)}">${esc(entry.status)}</span>` : '';
    const updated = entry ? `<span>Updated ${esc(fmtDate(entry.updated))}</span>` : '';
    return `
      <li class="card">
        <h3>${esc(job.title)}</h3>
        <div class="company">${esc(job.company)}</div>
        <div class="meta">
          <span>📍 ${esc(job.remote ? `Remote · ${job.location || 'Anywhere'}` : job.location || 'Location n/a')}</span>
          <span>💰 ${esc(job.salary || 'Salary not listed')}</span>
          <span>🗓 ${esc(fmtDate(job.date))}</span>
          ${job.type ? `<span>${esc(job.type)}</span>` : ''}
          ${updated}
        </div>
        ${entry ? '' : `<p class="snippet">${esc(job.text.slice(0, 220))}</p>`}
        <div class="card-actions">
          <button class="btn primary" data-apply="${esc(job.id)}">Apply</button>
          ${entry ? '' : `<button class="btn ghost" data-skip="${esc(job.id)}">Skip</button>`}
          ${badge}
          <span class="source">${esc(job.source)}</span>
        </div>
      </li>`;
  }

  function renderJobs(errors = []) {
    const list = filteredJobs();
    const status = $('#feedStatus');
    const parts = [];
    if (!profile.name || !targetTitles().length) parts.push('Tip: fill in your Profile (name + target titles) for better matches and cover letters.');
    parts.push(view === 'swipe'
      ? `${list.length} job${list.length === 1 ? '' : 's'} left to swipe.`
      : `${list.length} matching job${list.length === 1 ? '' : 's'} (of ${jobs.length} fetched).`);
    if (errors.length) parts.push(`Couldn't reach ${errors.join(' and ')} — try Refresh later.`);
    status.textContent = parts.join(' ');
    status.className = errors.length && !jobs.length ? 'status error' : 'status';

    if (view === 'swipe') { renderDeck(list); return; }
    $('#jobList').innerHTML = list.length
      ? list.slice(0, 200).map((j) => jobCard(j, tracker[j.id])).join('')
      : `<li class="empty">No matching jobs. Try broader titles in your Profile, change your work preference, or tick “Ignore my title filter”.</li>`;
  }

  function renderTracker() {
    const entries = Object.values(tracker)
      .filter((e) => trackerFilter === 'all' || e.status === trackerFilter)
      .sort((a, b) => b.updated - a.updated);
    $('#trackerList').innerHTML = entries.length
      ? entries.map((e) => jobCard(e.job, e)).join('')
      : `<li class="empty">Nothing here yet. Swipe right on jobs you like, or open one and mark it Applied, Interviewing or Skipped.</li>`;
    const n = Object.values(tracker).filter((e) => e.status !== 'Skipped').length;
    $('#trackerCount').textContent = n || '';
  }

  // ---------- Tracker ----------
  function setStatus(job, status, letter) {
    if (!status) {
      delete tracker[job.id];
    } else {
      tracker[job.id] = {
        job,
        status,
        letter: letter ?? tracker[job.id]?.letter ?? '',
        updated: Date.now(),
      };
    }
    save(KEYS.tracker, tracker);
    renderTracker();
    renderJobs();
  }

  const findJob = (id) => jobs.find((j) => j.id === id) || tracker[id]?.job;

  // ---------- Cover letter ----------
  const SKILLS = ['javascript', 'typescript', 'react', 'vue', 'angular', 'svelte', 'node.js', 'node', 'python', 'django', 'flask',
    'java', 'kotlin', 'swift', 'c#', '.net', 'c++', 'golang', 'rust', 'ruby', 'rails', 'php', 'laravel', 'sql', 'postgresql',
    'mysql', 'mongodb', 'graphql', 'rest', 'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform', 'linux', 'git', 'ci/cd',
    'html', 'css', 'figma', 'ux', 'ui design', 'user research', 'product management', 'agile', 'scrum', 'jira', 'excel',
    'tableau', 'power bi', 'machine learning', 'data analysis', 'seo', 'content marketing', 'copywriting', 'salesforce',
    'hubspot', 'customer support', 'customer success', 'zendesk', 'sales', 'accounting', 'project management', 'recruiting',
    'communication', 'leadership'];

  const escRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const termRegex = (term) => new RegExp(`(^|[^a-z0-9])${escRe(term)}([^a-z0-9]|$)`, 'i');
  const hasTerm = (text, term) => termRegex(term).test(text);

  function matchedSkills(job) {
    const resume = profile.resume.toLowerCase();
    if (!resume) return [];
    const jobText = `${job.title} ${job.tags.join(' ')} ${job.text}`.toLowerCase();
    const candidates = [...new Set([...job.tags.map((t) => t.toLowerCase()), ...SKILLS])];
    return candidates
      .filter((s) => s.length > 1 && hasTerm(jobText, s) && hasTerm(resume, s))
      .slice(0, 5)
      .map((s) => { // use the casing from the resume, e.g. "React" not "react"
        const i = resume.search(termRegex(s));
        const m = i >= 0 ? profile.resume.slice(i).match(new RegExp(escRe(s), 'i')) : null;
        return m ? m[0] : s;
      });
  }

  function resumeHighlights() {
    const bullets = profile.resume.split('\n')
      .map((l) => l.trim())
      .filter((l) => /^[-•*▪◦·]\s+/.test(l))
      .map((l) => l.replace(/^[-•*▪◦·]\s+/, ''))
      .filter((l) => l.length > 20)
      .slice(0, 3);
    if (!bullets.length) return '';
    return `A few highlights from my experience:\n${bullets.map((b) => `• ${b}`).join('\n')}`;
  }

  const listJoin = (arr) => (arr.length <= 1 ? arr.join('') : `${arr.slice(0, -1).join(', ')} and ${arr[arr.length - 1]}`);

  function buildLetter(job) {
    const skills = matchedSkills(job);
    const skillLine = skills.length
      ? `My experience with ${listJoin(skills)} lines up closely with what you're looking for, and I'm confident I can make an impact quickly.`
      : `My background lines up well with what you're looking for, and I'm confident I can make an impact quickly.`;
    const values = {
      name: profile.name || '[Your Name]',
      email: profile.email,
      phone: profile.phone,
      jobTitle: job.title,
      company: job.company,
      location: job.remote ? 'Remote' : job.location,
      matchedSkills: skillLine,
      highlights: resumeHighlights(),
      date: new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
    };
    return (profile.template || DEFAULT_TEMPLATE)
      .replace(/\{\{(\w+)\}\}/g, (m, k) => (k in values ? values[k] : m))
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // ---------- Apply panel ----------
  function openApply(job) {
    currentJob = job;
    const entry = tracker[job.id];
    $('#applyTitle').textContent = job.title;
    $('#applyMeta').textContent = `${job.company} · ${job.remote ? 'Remote' : job.location} · via ${job.source}`;
    $('#coverLetter').value = entry?.letter || buildLetter(job);
    $('#applyLink').href = job.url;
    $$('.status-btn').forEach((b) => b.classList.toggle('selected', !!entry && b.dataset.mark === entry.status));
    $('#applyPanel').hidden = false;
    document.body.classList.add('no-scroll');
  }

  function closeApply() {
    $('#applyPanel').hidden = true;
    document.body.classList.remove('no-scroll');
    currentJob = null;
  }

  async function copyLetter() {
    const text = $('#coverLetter').value;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = $('#coverLetter'); ta.focus(); ta.select();
      document.execCommand('copy');
    }
    toast('Cover letter copied');
  }

  // ---------- Swipe deck ----------
  const initials = (name) => (String(name || '?').match(/[A-Za-z0-9]+/g) || ['?']).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const hueFor = (str) => [...String(str)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const clamp01 = (n) => Math.max(0, Math.min(1, n));

  function swipeCard(job, depth) {
    const skills = matchedSkills(job);
    const facts = [
      `📍 ${job.remote ? `Remote · ${job.location || 'Anywhere'}` : job.location || 'Location n/a'}`,
      `💰 ${job.salary || 'Salary not listed'}`,
      `🗓 ${fmtDate(job.date) || 'Date n/a'}`,
      job.type && `⏱ ${job.type}`,
    ].filter(Boolean);
    return `
      <article class="swipe-card ${depth ? `behind-${depth}` : 'top'}" data-id="${esc(job.id)}" style="--h:${hueFor(job.company)}"
        ${depth ? 'aria-hidden="true"' : ''}>
        <div class="hero">
          <div class="avatar">${esc(initials(job.company))}</div>
          <h3>${esc(job.title)}</h3>
          <div class="company">${esc(job.company)}</div>
        </div>
        <div class="body">
          <div class="facts">${facts.map((f) => `<span class="fact">${esc(f)}</span>`).join('')}</div>
          ${skills.length ? `<div class="skill-row">${skills.map((k) => `<span class="skill">✓ ${esc(k)}</span>`).join('')}</div>` : ''}
          <p class="desc">${esc(job.text.slice(0, 600))}</p>
          <span class="source">via ${esc(job.source)}</span>
        </div>
        <span class="stamp like">LIKE</span>
        <span class="stamp nope">NOPE</span>
        <span class="stamp super">APPLY</span>
      </article>`;
  }

  function renderDeck(list) {
    const deck = $('#deck');
    const top3 = list.slice(0, 3);
    $$('[data-swipe]').forEach((b) => { b.disabled = !top3.length; });
    $('#undoBtn').disabled = !undoStack.length;
    if (!top3.length) {
      deck.innerHTML = `
        <div class="deck-empty">
          <div class="big">🎉</div>
          <strong>You've seen every match</strong>
          <span>${jobs.length ? 'Check your Tracker, try broader titles in your Profile, or refresh later for new jobs.' : 'No jobs loaded yet. Tap ↻ to fetch jobs.'}</span>
          <button class="btn" data-goto="tracker">Open Tracker</button>
        </div>`;
      return;
    }
    // Render back-to-front so the top card is last in the DOM (and on top).
    deck.innerHTML = top3.map((j, i) => swipeCard(j, i)).reverse().join('');
    attachDrag($('.swipe-card.top', deck));
  }

  function setCardPose(card, dx, dy) {
    card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 18}deg)`;
    const vertical = -dy > Math.abs(dx);
    $('.stamp.like', card).style.opacity = vertical ? 0 : clamp01(dx / 90);
    $('.stamp.nope', card).style.opacity = vertical ? 0 : clamp01(-dx / 90);
    $('.stamp.super', card).style.opacity = vertical ? clamp01(-dy / 90) : 0;
    card._dx = dx; card._dy = dy;
  }

  function attachDrag(card) {
    if (!card) return;
    let startX = 0, startY = 0, dragging = false;
    card.addEventListener('pointerdown', (e) => {
      if (busy || e.button > 0) return;
      dragging = true; startX = e.clientX; startY = e.clientY;
      card.setPointerCapture(e.pointerId);
      card.style.transition = 'none';
    });
    card.addEventListener('pointermove', (e) => {
      if (dragging) setCardPose(card, e.clientX - startX, e.clientY - startY);
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      const dx = card._dx || 0, dy = card._dy || 0, limit = Math.min(120, card.offsetWidth * 0.28);
      if (-dy > 110 && -dy > Math.abs(dx)) swipe('up');
      else if (dx > limit) swipe('right');
      else if (dx < -limit) swipe('left');
      else { card.style.transition = 'transform .25s ease'; setCardPose(card, 0, 0); }
    };
    card.addEventListener('pointerup', end);
    card.addEventListener('pointercancel', end);
  }

  function swipe(dir) {
    const card = $('#deck .swipe-card.top');
    if (!card || busy) return;
    const job = findJob(card.dataset.id);
    if (!job) return;
    busy = true;
    const w = window.innerWidth, h = window.innerHeight;
    const dy = card._dy || 0;
    card.style.transition = 'transform .32s ease-out';
    if (dir === 'right') setCardPose(card, w * 1.1, dy + 40);
    else if (dir === 'left') setCardPose(card, -w * 1.1, dy + 40);
    else setCardPose(card, card._dx || 0, -h);
    setTimeout(() => { busy = false; commitSwipe(job, dir); }, 300);
  }

  function commitSwipe(job, dir) {
    undoStack.push({ job, prev: tracker[job.id] ? { ...tracker[job.id] } : null });
    if (undoStack.length > 30) undoStack.shift();
    if (dir === 'left') {
      setStatus(job, 'Skipped');
    } else {
      setStatus(job, 'Liked');
      if (dir === 'up') openApply(job);
      else showMatchOrToast(job);
    }
  }

  function undoSwipe() {
    const last = undoStack.pop();
    if (!last) return;
    if (last.prev) tracker[last.job.id] = last.prev; else delete tracker[last.job.id];
    save(KEYS.tracker, tracker);
    renderTracker();
    renderJobs();
    toast('Undone');
  }

  let matchJob = null;
  function showMatchOrToast(job) {
    const skills = matchedSkills(job);
    if (skills.length < 2) { toast('Saved to Liked ♥'); return; }
    matchJob = job;
    $('#matchText').textContent = `Your resume and ${job.company} both mention:`;
    $('#matchSkills').innerHTML = skills.map((k) => `<span class="skill">${esc(k)}</span>`).join('');
    $('#matchOverlay').hidden = false;
    $('#matchApply').focus();
  }
  function closeMatch() { $('#matchOverlay').hidden = true; matchJob = null; }

  function setView(v) {
    view = v;
    save(KEYS.view, v);
    document.body.classList.toggle('view-swipe', v === 'swipe');
    $$('.seg button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    $('#swipeView').hidden = v !== 'swipe';
    $('#jobList').hidden = v === 'swipe';
    renderJobs();
  }

  // ---------- Profile ----------
  function fillProfileForm() {
    const f = $('#profileForm');
    for (const [k, v] of Object.entries(profile)) if (f.elements[k]) f.elements[k].value = v;
  }

  function saveProfile(e) {
    e.preventDefault();
    const f = e.target;
    const before = targetTitles().join('|');
    for (const k of Object.keys(profile)) if (f.elements[k]) profile[k] = f.elements[k].value.trim();
    if (!profile.template) profile.template = DEFAULT_TEMPLATE;
    const ok = save(KEYS.profile, profile);
    $('#saveMsg').textContent = ok ? 'Saved ✓' : 'Could not save (storage full or blocked).';
    setTimeout(() => { $('#saveMsg').textContent = ''; }, 2500);
    if (targetTitles().join('|') !== before) loadJobs(true); else renderJobs();
  }

  // ---------- Tabs ----------
  function showTab(name) {
    $$('.tab').forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on);
    });
    $$('.panel').forEach((p) => { p.hidden = p.id !== `tab-${name}`; });
    save(KEYS.tab, name);
    window.scrollTo(0, 0);
  }

  // ---------- Events ----------
  function handleCardClick(e) {
    const applyId = e.target.closest('[data-apply]')?.dataset.apply;
    const skipId = e.target.closest('[data-skip]')?.dataset.skip;
    if (applyId) { const job = findJob(applyId); if (job) openApply(job); }
    if (skipId) { const job = findJob(skipId); if (job) { setStatus(job, 'Skipped'); toast('Skipped — see Tracker'); } }
    if (e.target.closest('[data-goto]')) showTab(e.target.closest('[data-goto]').dataset.goto);
  }

  function init() {
    $$('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
    $('#jobList').addEventListener('click', handleCardClick);
    $('#trackerList').addEventListener('click', handleCardClick);
    $('#refreshBtn').addEventListener('click', () => loadJobs(true));
    $('#jobSearch').addEventListener('input', () => renderJobs());
    $('#hideTracked').addEventListener('change', () => renderJobs());
    $('#showAll').addEventListener('change', () => renderJobs());
    $('#filtersBtn').addEventListener('click', () => {
      const f = $('#filters'); f.hidden = !f.hidden;
      $('#filtersBtn').setAttribute('aria-expanded', String(!f.hidden));
    });

    // Swipe deck
    $$('.seg button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
    $$('[data-swipe]').forEach((b) => b.addEventListener('click', () => swipe(b.dataset.swipe)));
    $('#undoBtn').addEventListener('click', undoSwipe);
    $('#deck').addEventListener('click', handleCardClick);
    $('#matchKeep').addEventListener('click', closeMatch);
    $('#matchApply').addEventListener('click', () => { const j = matchJob; closeMatch(); if (j) openApply(j); });
    document.addEventListener('keydown', (e) => {
      if (view !== 'swipe' || $('#tab-jobs').hidden || !$('#applyPanel').hidden) return;
      if (!$('#matchOverlay').hidden) { if (e.key === 'Escape') closeMatch(); return; }
      if (e.target.closest('input, textarea, select')) return;
      const dir = { ArrowRight: 'right', ArrowLeft: 'left', ArrowUp: 'up' }[e.key];
      if (dir) { e.preventDefault(); swipe(dir); }
      else if (e.key === 'z' || e.key === 'Backspace') { e.preventDefault(); undoSwipe(); }
    });

    $('#trackerFilters').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip'); if (!chip) return;
      trackerFilter = chip.dataset.status;
      $$('.chip').forEach((c) => c.classList.toggle('active', c === chip));
      renderTracker();
    });

    $$('[data-close]').forEach((el) => el.addEventListener('click', closeApply));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#applyPanel').hidden) closeApply(); });
    $('#copyBtn').addEventListener('click', copyLetter);
    $('#applyLink').addEventListener('click', () => {
      // Remember the (possibly edited) letter for this job when they head to the application page.
      if (currentJob && tracker[currentJob.id]) { tracker[currentJob.id].letter = $('#coverLetter').value; save(KEYS.tracker, tracker); }
    });
    $$('.status-btn').forEach((b) => b.addEventListener('click', () => {
      if (!currentJob) return;
      const s = b.dataset.mark;
      setStatus(currentJob, s, $('#coverLetter').value);
      toast(s ? `Marked ${s}` : 'Removed from tracker');
      closeApply();
    }));

    $('#profileForm').addEventListener('submit', saveProfile);
    $('#resetTemplate').addEventListener('click', () => { $('#profileForm').elements.template.value = DEFAULT_TEMPLATE; });
    $('#exportBtn').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify({ profile, tracker }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'job-finder-data.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    $('#clearBtn').addEventListener('click', () => {
      if (!confirm('Delete your profile, tracker and cached jobs from this browser?')) return;
      Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
      location.reload();
    });

    fillProfileForm();
    renderTracker();
    setView(view);
    const startTab = load(KEYS.tab, null) || (profile.name ? 'jobs' : 'profile');
    showTab(['jobs', 'tracker', 'profile'].includes(startTab) ? startTab : 'jobs');
    loadJobs();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
