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
  let tracker = load(KEYS.tracker, {}); // { [jobId]: { job, status, letter, resume, updated } }
  // Older versions called "save for later" Liked.
  Object.values(tracker).forEach((e) => { if (e.status === 'Liked') e.status = 'Saved'; });
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
          <button class="btn primary" data-apply="${esc(job.id)}">${entry?.status === 'Applying' ? 'Finish applying' : entry ? 'Open' : 'Apply'}</button>
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
      : `<li class="empty">Nothing here yet. Swipe right to apply, up to save for later, or left to skip.</li>`;
    const n = Object.values(tracker).filter((e) => e.status !== 'Skipped').length;
    $('#trackerCount').textContent = n || '';
  }

  // ---------- Tracker ----------
  // docs = { letter, resume } — the (possibly edited) documents for this job
  function setStatus(job, status, docs = {}) {
    if (!status) {
      delete tracker[job.id];
    } else {
      const prev = tracker[job.id] || {};
      tracker[job.id] = {
        job,
        status,
        letter: docs.letter ?? prev.letter ?? '',
        resume: docs.resume ?? prev.resume ?? '',
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
    'communication', 'leadership', 'jest', 'cypress', 'testing', 'accessibility', 'design systems', 'design system', 'next.js',
    'tailwind', 'redux', 'webpack', 'responsive design', 'performance', 'analytics', 'a/b testing', 'stakeholder management',
    'data visualization', 'pandas', 'spark', 'airflow', 'snowflake', 'dbt', 'etl', 'ios', 'android', 'react native', 'flutter',
    'security', 'devops', 'microservices', 'api design', 'onboarding', 'crm', 'negotiation', 'budgeting', 'forecasting',
    'quickbooks', 'photoshop', 'illustrator', 'wireframing', 'prototyping', 'social media', 'email marketing', 'google ads']; 

  const escRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const termRegex = (term) => new RegExp(`(^|[^a-z0-9])${escRe(term)}([^a-z0-9]|$)`, 'i');
  const hasTerm = (text, term) => termRegex(term).test(text);

  function matchedSkills(job, limit = 5) {
    const resume = profile.resume.toLowerCase();
    if (!resume) return [];
    const jobText = `${job.title} ${job.tags.join(' ')} ${job.text}`.toLowerCase();
    const candidates = [...new Set([...job.tags.map((t) => t.toLowerCase()), ...SKILLS])];
    return candidates
      .filter((s) => s.length > 1 && hasTerm(jobText, s) && hasTerm(resume, s))
      .slice(0, limit)
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

  // ---------- Resume tailoring ----------
  // Only re-orders and emphasises what's already in the resume. It never invents experience or skills.
  const HEADING_RE = /^(professional\s+|career\s+|work\s+|relevant\s+|technical\s+|core\s+|key\s+|selected\s+)?(summary|profile|objective|about( me)?|experience|history|employment( history)?|skills( summary)?|competencies|expertise|education|projects|certifications?|licen[sc]es( (and|&) certifications)?|awards|honou?rs|publications|volunteer(ing| experience)?|languages|interests|training|tools|qualifications|achievements|accomplishments)\s*:?$/i;
  const BULLET_RE = /^\s*([-•*▪◦·‣–]|\d+[.)])\s+/;
  const STOP = new Set(('the and for with you your our are will have this that from they their about into who what when where which while within ' +
    'across able also more most such than then them these those been being both each other over only very just must should could would can ' +
    'may using use used work working team teams role job company including include strong experience years year plus well like make help ' +
    'new based etc all any per its one two three you\'ll we\'re looking join ideal candidate position opportunity benefits salary').split(' '));

  function isHeading(line) {
    const t = line.trim();
    if (!t || t.length > 45 || BULLET_RE.test(t)) return false;
    if (HEADING_RE.test(t)) return true;
    return /[A-Z]/.test(t) && t === t.toUpperCase() && /^[A-Z &/,'-]+:?$/.test(t) && t.split(/\s+/).length <= 6;
  }

  function sectionKind(heading) {
    const h = heading.toLowerCase();
    if (/summary|profile|objective|about/.test(h) && !/skill/.test(h)) return 'summary';
    if (/skill|competenc|expertise|tools|qualifications/.test(h)) return 'skills';
    if (/experience|history|employment|projects|volunteer/.test(h)) return 'experience';
    return 'other';
  }

  function parseResume(text) {
    const sections = [{ heading: '', kind: 'header', lines: [] }];
    let seenContent = false;
    for (const raw of text.replace(/\r/g, '').split('\n')) {
      const line = raw.replace(/\s+$/, '');
      if (seenContent && isHeading(line)) {
        const heading = line.trim().replace(/:$/, '');
        sections.push({ heading, kind: sectionKind(heading), lines: [] });
        continue;
      }
      if (line.trim()) seenContent = true;
      sections[sections.length - 1].lines.push(line);
    }
    return sections;
  }

  function jobKeywords(job) {
    const text = `${job.title} ${job.tags.join(' ')} ${job.text}`.toLowerCase();
    const skills = [...new Set([...job.tags.map((t) => t.toLowerCase()), ...SKILLS])].filter((k) => k.length > 1 && hasTerm(text, k));
    const counts = {};
    (text.match(/[a-z][a-z+#]{3,}/g) || []).forEach((w) => { if (!STOP.has(w)) counts[w] = (counts[w] || 0) + 1; });
    const titleWords = (job.title.toLowerCase().match(/[a-z][a-z+#]{3,}/g) || []).filter((w) => !STOP.has(w));
    const terms = [...new Set([...titleWords, ...Object.entries(counts).filter(([, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1]).slice(0, 40).map(([w]) => w)])];
    return { skills, terms };
  }

  const scoreLine = (line, kw) =>
    kw.skills.reduce((n, k) => n + (hasTerm(line, k) ? 3 : 0), 0) + kw.terms.reduce((n, t) => n + (hasTerm(line, t) ? 1 : 0), 0);

  // A line like "Senior Engineer — Nimbus Co (2020–Present)" starts a new job entry.
  const isEntryHead = (line) => /\b(19|20)\d{2}\b|\bpresent\b|\bcurrent\b/i.test(line) || (line.length < 70 && /\s[—–|@]\s|\sat\s/.test(line) && !/[.;]$/.test(line));

  // Split an experience section into entries (heading lines + bullets) and sort each entry's bullets by relevance.
  // PDFs often draw bullet symbols as graphics, so sentences under a job heading count as bullets too.
  function tailorExperience(lines, kw, stats) {
    const entries = [];
    let cur = null;
    let lastWasBullet = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { lastWasBullet = false; continue; }
      if (BULLET_RE.test(line)) {
        if (!cur) { cur = { head: [], bullets: [] }; entries.push(cur); }
        cur.bullets.push(line.replace(BULLET_RE, ''));
        lastWasBullet = true;
      } else if (lastWasBullet && /^[a-z0-9(]/.test(line)) {
        cur.bullets[cur.bullets.length - 1] += ` ${line}`; // wrapped bullet from a PDF
      } else if (cur && cur.head.length && !isEntryHead(line)) {
        cur.bullets.push(line); // bullet whose symbol was lost
        lastWasBullet = true;
      } else {
        if (!cur || cur.bullets.length) { cur = { head: [], bullets: [] }; entries.push(cur); }
        cur.head.push(line);
        lastWasBullet = false;
      }
    }
    const out = [];
    entries.forEach((e, i) => {
      if (i) out.push('');
      out.push(...e.head);
      const sorted = e.bullets.map((b, idx) => ({ b, idx, sc: scoreLine(b, kw) }))
        .sort((a, b) => b.sc - a.sc || a.idx - b.idx);
      if (sorted.some((x, pos) => x.idx !== pos)) stats.reordered += 1;
      out.push(...sorted.map((x) => `• ${x.b}`));
    });
    return out;
  }

  // Put job-relevant skills first on each skills line.
  function tailorSkills(lines, kw, stats) {
    return lines.filter((l) => l.trim()).map((raw) => {
      const line = raw.trim().replace(BULLET_RE, '');
      const bullet = BULLET_RE.test(raw.trim()) ? '• ' : '';
      const m = line.match(/^([^:,]{1,30}):\s*(.+)$/);
      const label = m ? `${m[1]}: ` : '';
      const items = (m ? m[2] : line).split(/\s*[,|;•·]\s*/).filter(Boolean);
      if (items.length < 2) return `${bullet}${line}`;
      const hit = (it) => kw.skills.some((k) => hasTerm(it, k)) || kw.terms.some((t) => hasTerm(it, t));
      const sorted = [...items.filter(hit), ...items.filter((it) => !hit(it))];
      if (sorted.some((it, i) => it !== items[i])) stats.skillsReordered = true;
      return `${bullet}${label}${sorted.join(', ')}`;
    });
  }

  function tailorResume(job) {
    const resume = profile.resume.trim();
    if (!resume) return null;
    const kw = jobKeywords(job);
    const matched = matchedSkills(job, 10);
    const lowerResume = resume.toLowerCase();
    const missing = kw.skills.filter((k) => !hasTerm(lowerResume, k)).slice(0, 8);
    const stats = { reordered: 0, skillsReordered: false, addedSummary: false, addedCore: false };
    const sections = parseResume(resume);

    const out = [];
    const push = (...lines) => out.push(...lines);
    const coreLine = () => {
      if (matched.length < 2) return;
      push('', 'CORE SKILLS FOR THIS ROLE', matched.join(' · '));
      stats.addedCore = true;
    };

    const hasSummary = sections.some((sec) => sec.kind === 'summary');
    sections.forEach((sec, i) => {
      if (sec.kind === 'header') {
        push(...sec.lines.map((l) => l.trim()).filter((l, idx, arr) => l || (idx > 0 && arr[idx - 1])));
        while (out.length && !out[out.length - 1]) out.pop();
        if (!hasSummary && matched.length >= 2) {
          const title = targetTitles()[0] || job.title;
          push('', 'SUMMARY', `${title} with hands-on experience in ${listJoin(matched.slice(0, 4))}.`);
          stats.addedSummary = true;
        }
        if (!hasSummary) coreLine();
        return;
      }
      push('', sec.heading.toUpperCase());
      if (sec.kind === 'experience') push(...tailorExperience(sec.lines, kw, stats));
      else if (sec.kind === 'skills') push(...tailorSkills(sec.lines, kw, stats));
      else push(...sec.lines.map((l) => l.trim().replace(BULLET_RE, '• ')).filter((l, idx, arr) => l || (idx > 0 && arr[idx - 1])));
      while (out.length && !out[out.length - 1]) out.pop();
      if (sec.kind === 'summary' && !sections.slice(0, i).some((x) => x.kind === 'summary')) coreLine();
    });

    return { text: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(), matched, missing, stats };
  }

  function renderResumeNotes(t) {
    const notes = [];
    if (t.matched.length) notes.push(`<div><span class="label">✓ You match:</span> <span class="skill-row inline">${t.matched.map((k) => `<span class="skill">${esc(k)}</span>`).join(' ')}</span></div>`);
    const did = [];
    if (t.stats.reordered) did.push(`moved your most relevant bullet points to the top of ${t.stats.reordered} role${t.stats.reordered > 1 ? 's' : ''}`);
    if (t.stats.skillsReordered) did.push('listed matching skills first');
    if (t.stats.addedCore) did.push('added a “Core skills for this role” line');
    if (t.stats.addedSummary) did.push('added a short summary (edit it to sound like you)');
    if (did.length) notes.push(`<div><span class="label">✎ Tailored:</span> ${esc(listJoin(did))}.</div>`);
    if (t.missing.length) notes.push(`<div><span class="label">The posting also mentions</span> <span class="skill-row inline">${t.missing.map((k) => `<span class="skill missing">${esc(k)}</span>`).join(' ')}</span> <span class="label">— add these only if you really have them.</span></div>`);
    $('#resumeNotes').innerHTML = notes.join('');
  }

  // ---------- Apply panel ----------
  let saveDocsTimer;
  function openApply(job) {
    currentJob = job;
    const entry = tracker[job.id];
    $('#applyTitle').textContent = job.title;
    $('#applyMeta').textContent = `${job.company} · ${job.remote ? 'Remote' : job.location} · via ${job.source}`;

    const skills = matchedSkills(job, 6);
    $('#matchBanner').hidden = skills.length < 2;
    $('#matchText').textContent = `Your resume and ${job.company} both mention ${listJoin(skills)}.`;

    const t = tailorResume(job);
    $('#noResume').hidden = !!t;
    $('#resumeNotes').innerHTML = '';
    if (t) renderResumeNotes(t);
    $('#tailoredResume').value = entry?.resume || (t ? t.text : '');
    $('#coverLetter').value = entry?.letter || buildLetter(job);
    showDoc('resume');

    $('#applyLink').href = job.url;
    $$('.status-btn').forEach((b) => b.classList.toggle('selected', !!entry && b.dataset.mark === entry.status));
    $('#applyPanel').hidden = false;
    $('.sheet-body').scrollTop = 0;
    document.body.classList.add('no-scroll');
  }

  function closeApply() {
    saveDocs();
    $('#applyPanel').hidden = true;
    document.body.classList.remove('no-scroll');
    currentJob = null;
  }

  const currentDocs = () => ({ letter: $('#coverLetter').value, resume: $('#tailoredResume').value });

  // Keep edits to the resume / letter for jobs that are in the tracker.
  function saveDocs() {
    clearTimeout(saveDocsTimer);
    if (!currentJob || !tracker[currentJob.id]) return;
    Object.assign(tracker[currentJob.id], currentDocs());
    save(KEYS.tracker, tracker);
  }

  function showDoc(which) {
    $$('[data-doc]').forEach((b) => { const on = b.dataset.doc === which; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
    $('#docResume').hidden = which !== 'resume';
    $('#docLetter').hidden = which !== 'letter';
  }

  async function copyText(id, label) {
    const ta = $(`#${id}`);
    try {
      await navigator.clipboard.writeText(ta.value);
    } catch {
      ta.focus(); ta.select();
      document.execCommand('copy');
    }
    toast(`${label} copied`);
  }

  const fileSafe = (str) => String(str).replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const docName = (kind) => fileSafe(`${profile.name || 'My'} ${kind} - ${currentJob?.company || ''}`);

  function downloadText(text, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function resumeToHtml(text) {
    const lines = text.split('\n');
    let html = '';
    let inList = false;
    let first = true;
    let inBody = false; // past the name/contact block
    const close = () => { if (inList) { html += '</ul>'; inList = false; } };
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { close(); continue; }
      if (first) { html += `<h1>${esc(line)}</h1>`; first = false; continue; }
      if (BULLET_RE.test(line)) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += `<li>${esc(line.replace(BULLET_RE, ''))}</li>`;
      } else if (isHeading(line)) { close(); inBody = true; html += `<h2>${esc(line)}</h2>`; }
      else if (inBody && isEntryHead(line)) { close(); html += `<p class="role"><strong>${esc(line)}</strong></p>`; }
      else { close(); html += `<p>${esc(line)}</p>`; }
    }
    close();
    return html;
  }

  function printDoc(html, title) {
    $('#printArea').innerHTML = html;
    const oldTitle = document.title;
    document.title = title; // most browsers use this as the PDF file name
    const restore = () => { document.title = oldTitle; $('#printArea').innerHTML = ''; window.removeEventListener('afterprint', restore); };
    window.addEventListener('afterprint', restore);
    window.print();
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
        <span class="stamp like">APPLY</span>
        <span class="stamp nope">NOPE</span>
        <span class="stamp super">SAVE</span>
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
    } else if (dir === 'up') {
      setStatus(job, 'Saved');
      toast('Saved for later ★');
    } else {
      setStatus(job, 'Applying'); // stays in Tracker as "To finish" until marked Applied
      openApply(job);
    }
  }

  function undoSwipe() {
    const last = undoStack.pop();
    if (!last) return;
    if (currentJob && currentJob.id === last.job.id) { currentJob = null; closeApply(); }
    if (last.prev) tracker[last.job.id] = last.prev; else delete tracker[last.job.id];
    save(KEYS.tracker, tracker);
    renderTracker();
    renderJobs();
    toast('Undone');
  }

  function setView(v) {
    view = v;
    save(KEYS.view, v);
    document.body.classList.toggle('view-swipe', v === 'swipe');
    $$('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    $('#swipeView').hidden = v !== 'swipe';
    $('#jobList').hidden = v === 'swipe';
    renderJobs();
  }

  // ---------- Resume upload ----------
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const el = document.createElement('script');
      el.src = src;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.appendChild(el);
    });
  }

  // Rebuild lines from PDF text pieces using their positions on the page.
  function pdfItemsToText(items) {
    const rows = [];
    for (const it of items) {
      if (!it.str) continue;
      const x = it.transform[4], y = it.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) < 3);
      if (!row) { row = { y, parts: [] }; rows.push(row); }
      row.parts.push({ x, w: it.width || 0, str: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    const lines = [];
    let lastY = null;
    for (const r of rows) {
      if (lastY !== null && lastY - r.y > 22) lines.push(''); // big vertical gap = new block
      r.parts.sort((a, b) => a.x - b.x);
      let line = '', end = null;
      for (const pt of r.parts) {
        if (end !== null && pt.x - end > 1.5 && !line.endsWith(' ') && !pt.str.startsWith(' ')) line += ' ';
        line += pt.str;
        end = pt.x + pt.w;
      }
      lines.push(line);
      lastY = r.y;
    }
    return lines.join('\n');
  }

  function htmlToLines(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const out = [];
    const walk = (el) => {
      for (const node of el.children) {
        const tag = node.tagName.toLowerCase();
        if (tag === 'ul' || tag === 'ol') { [...node.children].forEach((li) => out.push(`• ${li.textContent.trim()}`)); out.push(''); }
        else if (/^h[1-6]$/.test(tag)) { out.push('', node.textContent.trim()); }
        else if (tag === 'table' || tag === 'div') walk(node);
        else out.push(node.textContent.trim());
      }
    };
    walk(doc.body);
    return out.join('\n');
  }

  async function extractResumeText(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.pdf') || file.type === 'application/pdf') {
      await loadScript('vendor/pdf.min.js');
      const lib = window.pdfjsLib;
      lib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
      const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      const pages = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        pages.push(pdfItemsToText((await page.getTextContent()).items));
      }
      return pages.join('\n\n');
    }
    if (name.endsWith('.docx')) {
      await loadScript('vendor/mammoth.browser.min.js');
      const result = await window.mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
      return htmlToLines(result.value);
    }
    if (name.endsWith('.doc')) throw new Error('Old .doc files aren’t supported. Save it as .docx or PDF and try again.');
    return file.text();
  }

  const cleanResumeText = (t) => t
    .replace(/\r/g, '')
    .replace(/[●▪■•]\s*/g, '• ') // odd bullet glyphs from Word/PDF fonts
    .replace(/[ \t]+/g, ' ')
    .split('\n').map((l) => l.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  async function handleResumeUpload(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const msg = $('#uploadMsg');
    msg.textContent = `Reading ${file.name}…`;
    try {
      const text = cleanResumeText(await extractResumeText(file));
      if (!text) throw new Error('No text found. If it’s a scanned image, paste the text instead.');
      $('#profileForm').elements.resume.value = text;
      profile.resume = text;
      save(KEYS.profile, profile);
      msg.textContent = `Loaded ${file.name} and saved ✓. Give it a quick check below.`;
    } catch (err) {
      msg.textContent = `Couldn't read that file: ${err.message}`;
    }
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
    $$('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
    $$('[data-swipe]').forEach((b) => b.addEventListener('click', () => swipe(b.dataset.swipe)));
    $('#undoBtn').addEventListener('click', undoSwipe);
    $('#deck').addEventListener('click', handleCardClick);
    document.addEventListener('keydown', (e) => {
      if (view !== 'swipe' || $('#tab-jobs').hidden || !$('#applyPanel').hidden) return;
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
    $('#applyPanel').addEventListener('click', (e) => {
      const go = e.target.closest('[data-goto]');
      if (go) { closeApply(); showTab(go.dataset.goto); }
    });
    $$('[data-doc]').forEach((b) => b.addEventListener('click', () => showDoc(b.dataset.doc)));
    $$('[data-copy]').forEach((b) => b.addEventListener('click', () =>
      copyText(b.dataset.copy, b.dataset.copy === 'coverLetter' ? 'Cover letter' : 'Resume')));
    ['#tailoredResume', '#coverLetter'].forEach((id) => $(id).addEventListener('input', () => {
      clearTimeout(saveDocsTimer); saveDocsTimer = setTimeout(saveDocs, 400);
    }));
    $('#downloadResume').addEventListener('click', () => downloadText($('#tailoredResume').value, `${docName('Resume')}.txt`));
    $('#printResume').addEventListener('click', () => printDoc(resumeToHtml($('#tailoredResume').value), docName('Resume')));
    $('#printLetter').addEventListener('click', () => printDoc(
      `<div class="letter">${$('#coverLetter').value.split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join('')}</div>`, docName('Cover Letter')));
    $('#regenResume').addEventListener('click', () => {
      if (!currentJob) return;
      const t = tailorResume(currentJob);
      if (t) { $('#tailoredResume').value = t.text; renderResumeNotes(t); saveDocs(); toast('Re-tailored from your profile resume'); }
    });
    $('#applyLink').addEventListener('click', () => {
      // Heading to the real application: make sure it's tracked and the documents are kept.
      if (currentJob && !tracker[currentJob.id]) setStatus(currentJob, 'Applying', currentDocs());
      saveDocs();
    });
    $$('.status-btn').forEach((b) => b.addEventListener('click', () => {
      if (!currentJob) return;
      const st = b.dataset.mark;
      setStatus(currentJob, st, currentDocs());
      toast({ Applied: 'Applied ✓ Good luck!', Saved: 'Saved for later ★', '': 'Removed from tracker' }[st] || `Marked ${st}`);
      closeApply();
    }));

    $('#resumeFile').addEventListener('change', handleResumeUpload);

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
