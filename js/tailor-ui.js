// US3 Tailor sheet. Step 1: copy the prompt into Claude and paste the reply back (or, with a
// saved Claude key, one tap). Step 2: review the changes, highlighted, with Show original, then
// save a one-page PDF. Opening it adds "#tailor" to the address so the phone's Back closes it.
import { loadProfile, isProfileComplete, trackerEntry, saveTailored, loadApiKey } from './store.js';
import { htmlToParagraphs, roleParagraphs } from './job-text.js';
import { toLines } from './resume-parse.js';
import { resumeModel, buildTailorPrompt, parseTailorAnswer, reviewAnswer, composeResume, trimSteps, rolesIn, choice, pdfFileName, TailorAnswerError } from './tailor.js';
import { shortDate } from './tracking.js';
import { toast } from './toast.js';

let dialog;
let state = null; // { job, model, prompt, review, use, omit, size, over, showOriginal, step }
let onCloseCb = null;
const drafts = new Map(); // jobId → pasted reply, kept for this visit if the sheet is closed
const $ = (s) => dialog.querySelector(s);

function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.getElementById('tailor-sheet');
  $('[data-close]').addEventListener('click', () => close());
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  window.addEventListener('hashchange', () => {
    if (dialog.open && location.hash !== '#tailor') finish();
  });
  $('.js-t-copy').addEventListener('click', copyPrompt);
  $('.js-t-review-btn').addEventListener('click', () => startReview($('.js-t-answer').value));
  $('.js-t-answer').addEventListener('input', () => {
    $('.js-t-error').textContent = '';
    if (state) drafts.set(state.job.id, $('.js-t-answer').value);
  });
  $('.js-t-auto-btn').addEventListener('click', tailorWithClaude);
  $('.js-t-again').addEventListener('click', () => showStep('paste'));
  $('.js-t-save').addEventListener('click', savePdf);
  $('.js-t-redownload').addEventListener('click', redownload);
  $('.js-t-orig').addEventListener('change', (e) => {
    state.showOriginal = e.target.checked;
    renderPaper();
  });
  return dialog;
}

export function isTailorOpen() {
  return Boolean(dialog?.open);
}

/** Open the tailor sheet for a saved job. */
export function openTailor(job, { onClose } = {}) {
  ensureDialog();
  onCloseCb = onClose ?? null;
  const profile = loadProfile();
  const ready = isProfileComplete(profile);
  const lines = ready ? (profile.resume.lines?.length ? profile.resume.lines : toLines(profile.resume.text)) : [];
  const model = resumeModel(lines);
  const description = roleParagraphs(htmlToParagraphs(job.descriptionHtml ?? '')).filter(Boolean);
  if (!description.length && job.descriptionText) description.push(job.descriptionText);
  state = {
    job,
    model,
    prompt: ready ? buildTailorPrompt(job, description, model) : '',
    review: null,
    use: {},
    omit: new Set(),
    size: null,
    over: false,
    showOriginal: false,
    step: 'paste',
  };

  $('.js-t-job').textContent = `${job.title} · ${job.company}`;
  $('.js-t-prompt').value = state.prompt;
  $('.js-t-answer').value = drafts.get(job.id) ?? '';
  $('.js-t-error').textContent = '';
  $('.js-t-auto-notice').textContent = '';
  $('.js-t-auto-notice').className = 'notice js-t-auto-notice';
  $('.js-t-noresume').textContent = ready ? '' : 'Add your resume in Profile first, then come back to tailor it.';
  $('.js-t-auto').hidden = !ready || !loadApiKey();
  for (const el of dialog.querySelectorAll('.tailor-steps button, .tailor-steps textarea, .js-t-review-btn')) el.disabled = !ready;

  const done = trackerEntry(job.id)?.tailored;
  $('.js-t-done').hidden = !done;
  if (done) $('.js-t-done-text').textContent = `You saved a tailored resume for this job on ${shortDate(done.at)}. Download it again, or tailor it again below.`;

  showStep('paste');
  if (!dialog.open) dialog.showModal();
  if (location.hash !== '#tailor') location.hash = 'tailor';
  $('[data-close]').focus({ preventScroll: true });
}

function showStep(step) {
  state.step = step;
  const paste = step === 'paste';
  $('.js-t-paste').hidden = !paste;
  $('.js-t-review').hidden = paste;
  $('.js-t-paste-actions').hidden = !paste;
  $('.js-t-review-actions').hidden = paste;
  $('.js-t-step').textContent = paste ? 'Step 1 of 2' : 'Step 2 of 2';
  $('.js-t-title').textContent = paste ? 'Tailor your resume' : 'Review your changes';
  $('.js-t-status').textContent = '';
  $('.sheet-scroll').scrollTop = 0;
}

// ---------- Step 1 ----------

async function copyPrompt() {
  const btn = $('.js-t-copy');
  let ok = false;
  try {
    await navigator.clipboard.writeText(state.prompt);
    ok = true;
  } catch {
    // Older browsers / no permission: select the text so the person can copy it by hand.
    const box = $('.js-t-prompt');
    box.closest('details').open = true;
    box.focus();
    box.select();
    ok = document.execCommand?.('copy') ?? false;
  }
  btn.textContent = ok ? 'Copied ✓' : 'Copy prompt';
  $('.js-t-status').textContent = ok ? 'Prompt copied. Paste it into a new Claude chat.' : 'Couldn’t copy automatically. The prompt is selected below: copy it from there.';
  setTimeout(() => (btn.textContent = 'Copy prompt'), 2500);
}

async function tailorWithClaude() {
  const btn = $('.js-t-auto-btn');
  const notice = $('.js-t-auto-notice');
  btn.disabled = true;
  btn.textContent = 'Tailoring… about 30 seconds';
  notice.className = 'notice is-info js-t-auto-notice';
  notice.textContent = '';
  try {
    const { tailorWithClaude: ask } = await import('./smart-fit.js');
    const answer = await ask(state.prompt);
    startReview(answer);
  } catch (err) {
    notice.className = 'notice is-error js-t-auto-notice';
    notice.textContent = err?.userMessage ?? 'Claude couldn’t tailor this right now. Try again, or use copy and paste below.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Tailor with Claude';
  }
}

async function startReview(pasted) {
  let answer;
  try {
    answer = parseTailorAnswer(pasted);
  } catch (err) {
    $('.js-t-error').textContent = err instanceof TailorAnswerError ? err.message : 'Something went wrong reading that reply.';
    $('.js-t-answer').focus();
    return;
  }
  state.review = reviewAnswer(state.model, answer);
  state.use = {};
  state.showOriginal = false;
  $('.js-t-orig').checked = false;
  showStep('review');
  renderPaper();
  await refit();
}

// ---------- Step 2 ----------

/** Find the least trimming that fits one page, following the PRD order. */
async function refit() {
  const { fitSize } = await import('./resume-pdf.js');
  const save = $('.js-t-save');
  save.disabled = true;
  $('.js-t-status').textContent = 'Checking it fits on one page…';
  const steps = [new Set(), ...trimSteps(state.model, state.review)];
  let found = false;
  for (const omit of steps) {
    if (omit.has('summary') && !(state.review.summary && choice(state.use, 'summary', state.review.summary))) continue;
    const size = await fitSize(composeResume(state.model, state.review, state.use, omit));
    if (size) {
      Object.assign(state, { omit, size, over: false });
      found = true;
      break;
    }
  }
  if (!found) Object.assign(state, { omit: steps.at(-1), size: null, over: true });
  save.disabled = false;
  $('.js-t-status').textContent = '';
  renderPaper();
}

function renderPaper() {
  const { model, review, use, omit, showOriginal } = state;
  const byLine = new Map(review.changes.map((c) => [c.i, c]));
  const used = review.changes.filter((c) => choice(use, c.i, c)).length;
  const summaryOn = review.summary && choice(use, 'summary', review.summary) && !omit.has('summary');
  $('.js-t-counts').textContent =
    review.changes.length || review.summary
      ? [`${used} line${used === 1 ? '' : 's'} reworded`, summaryOn ? 'summary added' : null].filter(Boolean).join(' · ') + '. Changes are in blue.'
      : 'Claude didn’t suggest any changes, so this is your resume as it is.';
  renderNotes();

  const paper = $('.js-t-paper');
  paper.replaceChildren();
  let insertAt = model.findIndex((l) => l.kind !== 'name' && l.kind !== 'contact');
  if (insertAt === -1) insertAt = model.length;
  const addSummary = () => review.summary && paper.append(...summaryEls());
  for (const l of model) {
    if (l.i === insertAt) addSummary();
    const trimmed = omit.has(l.i);
    if (trimmed && !showOriginal) continue;
    const c = byLine.get(l.i);
    const el = document.createElement('div');
    el.className = `t-line t-${l.kind}`;
    const text = document.createElement('p');
    text.className = 't-text';
    if (trimmed) {
      el.classList.add('is-trimmed');
      text.append(Object.assign(document.createElement('del'), { textContent: l.text }));
      el.append(text, note('Left out to fit one page'));
      paper.append(el);
      continue;
    }
    if (l.kind === 'role') {
      text.append(Object.assign(document.createElement('span'), { textContent: l.main }), ' ', Object.assign(document.createElement('span'), { className: 't-dates', textContent: l.dates }));
      el.append(text);
      paper.append(el);
      continue;
    }
    if (!c) {
      text.textContent = l.text;
      el.append(text);
      paper.append(el);
      continue;
    }
    const on = choice(use, l.i, c);
    el.classList.add(on ? 'is-changed' : 'is-kept');
    text.textContent = on ? c.tailored : l.text;
    el.append(text);
    if (on && showOriginal) {
      const orig = document.createElement('p');
      orig.className = 't-orig';
      orig.append(Object.assign(document.createElement('span'), { className: 'visually-hidden', textContent: 'Original: ' }), Object.assign(document.createElement('del'), { textContent: l.text }));
      el.append(orig);
    }
    for (const w of c.warnings) el.append(note(w, true));
    el.append(toggle(on ? 'Use original' : 'Use Claude’s version', l.i, !on));
    paper.append(el);
  }
  if (insertAt === model.length) addSummary();
}

function summaryEls() {
  const { review, use, omit, showOriginal } = state;
  const s = review.summary;
  const on = choice(use, 'summary', s);
  const trimmed = on && omit.has('summary');
  if (!on && !showOriginal && !s.warnings.length) {
    // Left out by choice: still offer it back.
    const el = document.createElement('div');
    el.className = 't-line t-summary is-kept';
    el.append(note('Claude’s summary is left out.'), toggle('Add summary', 'summary', true));
    return [el];
  }
  const head = document.createElement('div');
  head.className = 't-line t-heading';
  head.innerHTML = '<p class="t-text">Summary</p>';
  const el = document.createElement('div');
  el.className = `t-line t-text-line t-summary ${on && !trimmed ? 'is-changed' : 'is-kept'}`;
  const p = document.createElement('p');
  p.className = 't-text';
  if (on && !trimmed) p.textContent = s.text;
  else p.append(Object.assign(document.createElement('del'), { textContent: s.text }));
  el.append(p);
  if (trimmed) el.append(note('Left out to fit one page'));
  for (const w of s.warnings) el.append(note(w, true));
  el.append(toggle(on ? 'Leave out summary' : 'Add summary', 'summary', !on));
  return [head, el];
}

function renderNotes() {
  const { review, omit, over, model } = state;
  const notes = [];
  const trimmedBullets = [...omit].filter((x) => x !== 'summary').length;
  if (trimmedBullets) {
    const role = rolesIn(model).at(-1);
    notes.push(`To fit one page, we left out ${trimmedBullets} bullet${trimmedBullets === 1 ? '' : 's'} from your oldest role${role ? ` (${role.text})` : ''}.`);
  }
  if (omit.has('summary') && review.summary && choice(state.use, 'summary', review.summary)) notes.push('To fit one page, we also left out the summary.');
  if (over) notes.push('It’s still longer than one page. Tap “Use original” on long lines, or shorten your resume in Profile.');
  if (state.size === 10.5) notes.push('Set in 10.5 pt to fit one page.');
  const held = review.changes.filter((c) => c.held).length;
  if (held) notes.push(`${held} change${held === 1 ? '' : 's'} added a number that isn’t in your resume, so we kept your original line.`);
  if (review.ignored) notes.push(`${review.ignored} of Claude’s edits weren’t used: they pointed at lines that can’t change (names, titles, dates, skills).`);
  $('.js-t-notes').replaceChildren(...notes.map((t) => Object.assign(document.createElement('li'), { textContent: t })));
}

function note(text, warn = false) {
  const p = document.createElement('p');
  p.className = warn ? 't-warn' : 't-note';
  p.textContent = warn ? `⚠ ${text}` : text;
  return p;
}

function toggle(label, key, value) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'link-btn t-toggle';
  b.dataset.key = String(key);
  b.textContent = label;
  b.addEventListener('click', async () => {
    state.use[key] = value;
    renderPaper();
    refocus(key);
    await refit();
    refocus(key);
  });
  return b;
}

// The list is redrawn after each choice; keep focus on the same line's button.
function refocus(key) {
  dialog.querySelector(`.t-toggle[data-key="${CSS.escape(String(key))}"]`)?.focus({ preventScroll: true });
}

async function savePdf() {
  const btn = $('.js-t-save');
  btn.disabled = true;
  $('.js-t-status').textContent = 'Making your PDF…';
  try {
    const items = composeResume(state.model, state.review, state.use, state.omit);
    const fileName = pdfFileName(state.model, state.job.company);
    const { buildPdf } = await import('./resume-pdf.js');
    const { blob, size } = await buildPdf(items, { title: fileName.replace(/\.pdf$/, ''), size: state.size ?? undefined });
    download(blob, fileName);
    const changed = state.review.changes.filter((c) => choice(state.use, c.i, c)).length;
    saveTailored(state.job, { at: new Date().toISOString(), items, size, fileName, changed });
    toast('PDF saved. Apply with it, then tap Applied.');
    close();
  } catch {
    $('.js-t-status').textContent = 'Couldn’t make the PDF. Try again.';
    btn.disabled = false;
  }
}

async function redownload() {
  const t = trackerEntry(state.job.id)?.tailored;
  if (!t) return;
  const { buildPdf } = await import('./resume-pdf.js');
  const { blob } = await buildPdf(t.items, { title: t.fileName.replace(/\.pdf$/, ''), size: t.size });
  download(blob, t.fileName);
  $('.js-t-status').textContent = 'PDF downloaded.';
}

function download(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---------- Closing (same pattern as the job details sheet) ----------

function close() {
  if (location.hash === '#tailor') history.back();
  else finish();
}

function finish() {
  if (!dialog?.open) return;
  dialog.close();
  const cb = onCloseCb;
  onCloseCb = null;
  cb?.();
}
