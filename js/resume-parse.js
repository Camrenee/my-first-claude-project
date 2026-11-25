// Turn a resume file (PDF or Word .docx) into plain text, entirely in the browser.
// Libraries are loaded only when needed so the first screen stays fast.

import { isResumeHeading } from './skills.js';

const PDFJS = new URL('../vendor/pdfjs-4.10.38/pdf.min.mjs', import.meta.url).href;
const PDFJS_WORKER = new URL('../vendor/pdfjs-4.10.38/pdf.worker.min.mjs', import.meta.url).href;
const MAMMOTH = new URL('../vendor/mammoth-1.12.3/mammoth.browser.min.js', import.meta.url).href;

const MAX_BYTES = 10 * 1024 * 1024;

export class ResumeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** @returns {Promise<{text: string, fileType: 'pdf'|'docx'}>} */
export async function parseResumeFile(file) {
  const name = (file.name || '').toLowerCase();
  if (file.size > MAX_BYTES) {
    throw new ResumeError('too_big', 'That file is over 10 MB. Try exporting a smaller PDF, or paste the text instead.');
  }
  if (name.endsWith('.doc')) {
    throw new ResumeError('old_word', 'Older .doc files aren\'t supported. In Word, choose Save As → .docx or PDF, or paste the text instead.');
  }

  let text;
  let fileType;
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    fileType = 'pdf';
    text = await readPdf(file);
  } else if (name.endsWith('.docx') || file.type.includes('wordprocessingml')) {
    fileType = 'docx';
    text = await readDocx(file);
  } else {
    throw new ResumeError('unsupported', 'Please choose a PDF or Word (.docx) file, or paste the text instead.');
  }

  text = cleanText(text);
  if (text.replace(/\s/g, '').length < 50) {
    throw new ResumeError(
      'no_text',
      fileType === 'pdf'
        ? 'We couldn\'t find text in that PDF. It may be a scanned image. Paste the text instead.'
        : 'That file looks empty. Paste the text instead.'
    );
  }
  return { text, fileType };
}

async function readPdf(file) {
  let pdfjs;
  try {
    pdfjs = await import(PDFJS);
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  } catch {
    throw new ResumeError('load_failed', 'We couldn\'t load the PDF reader. Check your connection, or paste the text instead.');
  }
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  } catch (err) {
    if (err?.name === 'PasswordException') {
      throw new ResumeError('locked', 'That PDF is password-protected. Remove the password, or paste the text instead.');
    }
    throw new ResumeError('bad_file', 'We couldn\'t open that PDF. Try exporting it again, or paste the text instead.');
  }

  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    pages.push(pdfItemsToLines(content.items).join('\n'));
  }
  return pages.join('\n');
}

// pdf.js returns text in drawing order. Rebuild lines using hasEOL and vertical jumps,
// adding spaces where items sit apart on the same line.
export function pdfItemsToLines(items) {
  const lines = [];
  let line = '';
  let lastY = null;
  let lastEndX = null;
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    const x = it.transform?.[4] ?? 0;
    const y = it.transform?.[5] ?? 0;
    const h = Math.abs(it.height || it.transform?.[3] || 10);
    if (lastY !== null && Math.abs(y - lastY) > h * 0.6 && line.trim()) {
      lines.push(line);
      line = '';
      lastEndX = null;
    }
    if (lastEndX !== null && x - lastEndX > h * 0.15 && !/\s$/.test(line) && !/^\s/.test(it.str)) line += ' ';
    line += it.str;
    if (it.str) {
      lastY = y;
      lastEndX = x + (it.width || 0);
    }
    if (it.hasEOL) {
      lines.push(line);
      line = '';
      lastEndX = null;
    }
  }
  if (line.trim()) lines.push(line);
  return lines;
}

let mammothPromise;
function loadMammoth() {
  if (window.mammoth) return Promise.resolve(window.mammoth);
  mammothPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = MAMMOTH;
    s.onload = () => resolve(window.mammoth);
    s.onerror = () => {
      mammothPromise = null;
      reject(new ResumeError('load_failed', 'We couldn\'t load the Word reader. Check your connection, or paste the text instead.'));
    };
    document.head.append(s);
  });
  return mammothPromise;
}

async function readDocx(file) {
  const mammoth = await loadMammoth();
  try {
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return value;
  } catch {
    throw new ResumeError('bad_file', 'We couldn\'t open that Word file. Try saving it again as .docx or PDF, or paste the text instead.');
  }
}

// ---------- Text helpers (also used for pasted text) ----------

const BULLET_RE = /^[•▪●◦‣⁃∙·*–-]\s*/;

/** One trimmed line per entry; bullets normalized to "• "; blank lines dropped; wrapped bullets rejoined. */
export function toLines(text) {
  return joinWrappedLines(splitLines(text));
}

function splitLines(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .map((l) => (BULLET_RE.test(l) && l.length > 2 ? `• ${l.replace(BULLET_RE, '')}` : l));
}

export function cleanText(text) {
  return toLines(text).join('\n');
}

// ---------- Dates and wrapped lines ----------

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const ONE_DATE = `(?:${MONTH}\\s+)?(?:19|20)\\d{2}`;
/**
 * Dates at the end of a title line: "Apr. 2025 – Present", "Jul. 2017– Dec. 2018", "2010–2014",
 * "Graduated: May 2017". Group 1 is the dates as written.
 */
export const TRAILING_DATES = new RegExp(
  `[\\s,|–—-]*((?:[A-Za-z]+:\\s*)?${ONE_DATE}(?:\\s*[–—-]\\s*(?:${ONE_DATE}|present|current|now|today))?)\\s*$`,
  'i'
);
const CONTACT_RE = /@|linkedin\.com|https?:\/\/|\(\d{3}\)|\b\d{3}[-.\s)]+\d{3}[-.\s]\d{4}\b/i;

/**
 * PDFs break long bullets across lines ("• Redesigned … A/B testing, and" / "custom survey …").
 * Join a line onto the bullet above it when it reads as a continuation: it isn't a bullet,
 * heading, contact or dated title line, and either starts lowercase or the bullet above hasn't
 * ended its sentence. A short line right before a dated title is a company name, not a continuation.
 */
export function joinWrappedLines(lines) {
  const out = [];
  lines.forEach((raw, k) => {
    const line = String(raw).trim();
    if (!line) return;
    const prev = out.at(-1);
    const next = String(lines[k + 1] ?? '').trim();
    const isOrg = line.length < 60 && /^[A-Z]/.test(line) && next && !BULLET_RE.test(next) && TRAILING_DATES.test(next);
    const cont =
      prev !== undefined &&
      BULLET_RE.test(prev) &&
      !BULLET_RE.test(line) &&
      !/^[A-Z][\w &/]{1,30}:\s/.test(line) && // "Skills: …"-style label lines start something new
      !isResumeHeading(line) &&
      !TRAILING_DATES.test(line) &&
      !CONTACT_RE.test(line) &&
      !isOrg &&
      (/^[a-z]/.test(line) || !/[.!?]["”’')]*$/.test(prev));
    if (!cont) return out.push(line);
    // "call -" + "handling" was a hyphenated word split by the line break.
    out[out.length - 1] = /\s-$/.test(prev) && /^[a-z]/.test(line) ? `${prev.replace(/\s-$/, '-')}${line}` : `${prev} ${line}`;
  });
  return out;
}
