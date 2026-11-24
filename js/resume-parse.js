// Turn a resume file (PDF or Word .docx) into plain text, entirely in the browser.
// Libraries are loaded only when needed so the first screen stays fast.

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

/** One trimmed line per entry; bullets normalized to "• "; blank lines dropped. */
export function toLines(text) {
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
