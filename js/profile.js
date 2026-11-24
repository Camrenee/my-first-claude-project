// US1 Profile: resume (upload or paste), roles, locations, salary floor, no-salary toggle.
// Every valid change saves to this device right away.
import { DEFAULT_PROFILE, loadProfile, saveProfile, isProfileComplete } from './store.js';
import { parseResumeFile, ResumeError, cleanText, toLines } from './resume-parse.js';

const $ = (sel, root = document) => root.querySelector(sel);

let profile;
let els;
let typingTimer;

export function initProfile({ onDone }) {
  const form = $('#profile-form');
  els = {
    form,
    name: $('#f-name'),
    file: $('#f-file'),
    fileReplace: $('#f-file-replace'),
    dropzone: $('#dropzone'),
    pasteBtn: $('#btn-paste'),
    removeBtn: $('#btn-remove-resume'),
    resumeEmpty: $('#resume-empty'),
    resumeFilled: $('#resume-filled'),
    resumeText: $('#f-resume'),
    fileIcon: $('[data-file-icon]'),
    fileName: $('[data-file-name]'),
    fileSub: $('[data-file-sub]'),
    notice: $('#resume-notice'),
    roles: [...form.querySelectorAll('input[name="roles"]')],
    locations: [...form.querySelectorAll('input[name="locations"]')],
    salary: $('#f-salary'),
    noSalary: $('#f-nosalary'),
    errRoles: $('#err-roles'),
    errLocations: $('#err-locations'),
    errSalary: $('#err-salary'),
    status: $('#save-status'),
    eyebrow: $('[data-profile-eyebrow]'),
    title: $('[data-profile-title]'),
  };

  const saved = loadProfile();
  profile = structuredClone(saved ?? DEFAULT_PROFILE);
  render(Boolean(saved));

  // Name
  els.name.addEventListener('input', () => {
    profile.name = els.name.value.trim();
    debounce(persist);
  });

  // Resume: upload, replace, drag-and-drop, paste, edit, remove
  els.file.addEventListener('change', () => handleFile(els.file));
  els.fileReplace.addEventListener('change', () => handleFile(els.fileReplace));
  ['dragenter', 'dragover'].forEach((t) =>
    els.dropzone.addEventListener(t, (e) => {
      e.preventDefault();
      els.dropzone.classList.add('is-over');
    })
  );
  ['dragleave', 'drop'].forEach((t) => els.dropzone.addEventListener(t, () => els.dropzone.classList.remove('is-over')));
  els.dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) loadFile(f);
  });

  els.pasteBtn.addEventListener('click', () => {
    showResumeEditor({ fileName: 'Pasted text', fileType: 'paste' });
    els.resumeText.value = '';
    setNotice('');
    els.resumeText.focus();
  });

  els.resumeText.addEventListener('input', () => {
    const text = els.resumeText.value;
    if (!text.trim()) {
      profile.resume = profile.resume ? { ...profile.resume, text: '', lines: [] } : null;
    } else {
      const base = profile.resume ?? { fileName: 'Pasted text', fileType: 'paste' };
      profile.resume = { ...base, text, lines: toLines(text), updatedAt: new Date().toISOString() };
    }
    renderFileChip();
    debounce(persist);
  });
  // Tidy pasted text when the person leaves the box (keeps their words, drops stray blank lines).
  els.resumeText.addEventListener('blur', () => {
    if (!profile.resume?.text) return;
    const tidy = cleanText(els.resumeText.value);
    if (tidy !== els.resumeText.value) {
      els.resumeText.value = tidy;
      profile.resume.text = tidy;
      persist();
    }
  });

  // Two-tap remove (no browser dialog): first tap asks, second tap within 4s removes.
  let removeTimer;
  els.removeBtn.addEventListener('click', () => {
    if (!els.removeBtn.dataset.armed) {
      els.removeBtn.dataset.armed = '1';
      els.removeBtn.textContent = 'Tap again to remove';
      removeTimer = setTimeout(disarmRemove, 4000);
      return;
    }
    disarmRemove();
    profile.resume = null;
    els.file.value = '';
    els.fileReplace.value = '';
    renderResume();
    setNotice('Resume removed.', 'info');
    persist();
    els.file.focus();
  });
  function disarmRemove() {
    clearTimeout(removeTimer);
    delete els.removeBtn.dataset.armed;
    els.removeBtn.textContent = 'Remove resume';
  }
  els.removeBtn.addEventListener('blur', () => {
    if (els.removeBtn.dataset.armed) setTimeout(disarmRemove, 150);
  });

  // Roles & locations
  [...els.roles, ...els.locations].forEach((cb) =>
    cb.addEventListener('change', () => {
      profile.roles = checkedValues(els.roles);
      profile.locations = checkedValues(els.locations);
      if (validateChoices()) persist();
    })
  );

  // Salary floor
  els.salary.addEventListener('input', () => {
    const v = parseMoney(els.salary.value);
    if (validateSalary(v, { quiet: true })) {
      profile.salaryFloor = v;
      debounce(persist);
    }
  });
  els.salary.addEventListener('blur', () => {
    const v = parseMoney(els.salary.value);
    if (validateSalary(v)) {
      profile.salaryFloor = v;
      els.salary.value = formatMoney(v);
      persist();
    }
  });
  els.noSalary.addEventListener('change', () => {
    profile.showNoSalary = els.noSalary.checked;
    persist();
  });

  // "Show my shortlist"
  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const choicesOk = validateChoices();
    const salaryOk = validateSalary(parseMoney(els.salary.value));
    if (!profile.resume?.text?.trim()) {
      setNotice('Add your resume so we can match jobs to you.', 'error');
      (els.resumeFilled.hidden ? els.file : els.resumeText).focus();
      els.notice.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    if (!choicesOk || !salaryOk) {
      els.form.querySelector('.field-error:not(:empty)')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    clearTimeout(typingTimer);
    if (persist()) onDone?.();
  });
}

export function profileGreetingName() {
  return loadProfile()?.name || '';
}

// ---------- Resume handling ----------

function handleFile(input) {
  const f = input.files?.[0];
  if (f) loadFile(f);
  input.value = ''; // let the same file be chosen again
}

async function loadFile(file) {
  setNotice(`Reading ${file.name}…`, 'info');
  els.form.setAttribute('aria-busy', 'true');
  try {
    const { text, fileType } = await parseResumeFile(file);
    profile.resume = {
      text,
      lines: toLines(text),
      fileName: file.name,
      fileType,
      updatedAt: new Date().toISOString(),
    };
    renderResume();
    const n = profile.resume.lines.length;
    setNotice(`Got it! We read ${n} line${n === 1 ? '' : 's'} from ${file.name}.`, 'info');
    persist();
  } catch (err) {
    const msg = err instanceof ResumeError ? err.message : 'Something went wrong reading that file. Paste the text instead.';
    setNotice(msg, 'error');
    if (!(err instanceof ResumeError)) console.error(err);
  } finally {
    els.form.removeAttribute('aria-busy');
  }
}

function showResumeEditor(meta) {
  els.resumeEmpty.hidden = true;
  els.resumeFilled.hidden = false;
  renderFileChip(meta);
}

// ---------- Rendering ----------

function render(isReturning) {
  els.eyebrow.textContent = isReturning ? 'Your profile' : 'Welcome!';
  els.title.textContent = isReturning ? 'Your search, your way' : "Let's find your next PM role";
  els.name.value = profile.name;
  els.roles.forEach((cb) => (cb.checked = profile.roles.includes(cb.value)));
  els.locations.forEach((cb) => (cb.checked = profile.locations.includes(cb.value)));
  els.salary.value = formatMoney(profile.salaryFloor);
  els.noSalary.checked = profile.showNoSalary;
  renderResume();
  if (isReturning) setStatus(`Saved on this device${profile.updatedAt ? ` · ${timeAgo(profile.updatedAt)}` : ''}`);
}

function renderResume() {
  const has = Boolean(profile.resume);
  els.resumeEmpty.hidden = has;
  els.resumeFilled.hidden = !has;
  if (has) {
    if (els.resumeText.value !== profile.resume.text) els.resumeText.value = profile.resume.text;
    renderFileChip();
  } else {
    els.resumeText.value = '';
  }
}

function renderFileChip(meta = profile.resume) {
  if (!meta) return;
  const icon = { pdf: 'PDF', docx: 'DOC', paste: 'TXT' }[meta.fileType] ?? 'TXT';
  els.fileIcon.textContent = icon;
  els.fileName.textContent = meta.fileName;
  const n = meta.lines?.length ?? 0;
  els.fileSub.textContent = n ? `${n} line${n === 1 ? '' : 's'} · stored on this device` : 'Paste your resume below';
}

function setNotice(text, kind = 'info') {
  els.notice.textContent = text;
  els.notice.className = `notice ${text ? `is-${kind}` : ''}`;
}

function setStatus(text) {
  els.status.textContent = text;
}

// ---------- Validation ----------

function validateChoices() {
  const rolesOk = profile.roles.length > 0;
  const locOk = profile.locations.length > 0;
  els.errRoles.textContent = rolesOk ? '' : 'Pick at least one role.';
  els.errLocations.textContent = locOk ? '' : 'Pick at least one place.';
  return rolesOk && locOk;
}

function validateSalary(v, { quiet = false } = {}) {
  let msg = '';
  if (v === null) msg = 'Enter a yearly amount, like 170,000.';
  else if (v > 2000000) msg = 'That looks too high. Enter a yearly amount, like 170,000.';
  if (!quiet || !msg) els.errSalary.textContent = msg;
  els.salary.setAttribute('aria-invalid', msg ? 'true' : 'false');
  return !msg;
}

// Accepts "170000", "170,000", "$170k", "170K". Empty means no floor (0).
export function parseMoney(raw) {
  const s = String(raw).trim().toLowerCase().replace(/[$,\s]/g, '');
  if (s === '') return 0;
  const m = s.match(/^(\d+(?:\.\d+)?)(k)?$/);
  if (!m) return null;
  return Math.round(parseFloat(m[1]) * (m[2] ? 1000 : 1));
}

function formatMoney(v) {
  return v ? v.toLocaleString('en-US') : '';
}

// ---------- Saving ----------

function persist() {
  clearTimeout(typingTimer);
  const result = saveProfile(profile);
  if (result.ok) {
    profile.updatedAt = new Date().toISOString();
    setStatus(isProfileComplete(profile) ? 'Saved on this device ✓' : 'Saved. Add your resume to see matches.');
    return true;
  }
  setStatus(
    result.reason === 'quota'
      ? "Couldn't save: this browser is out of space. Try trimming your resume text."
      : "Couldn't save: this browser is blocking storage (private mode?)."
  );
  return false;
}

function debounce(fn) {
  clearTimeout(typingTimer);
  typingTimer = setTimeout(fn, 400);
}

function checkedValues(list) {
  return list.filter((cb) => cb.checked).map((cb) => cb.value);
}

function timeAgo(iso) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
