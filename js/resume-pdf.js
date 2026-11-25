// US3: lay the tailored resume out on US Letter and save it as a PDF.
// Clean and ATS-friendly: Arimo (metrically the same as Arial), black text, one column,
// 11 pt (10.5 pt if that's what it takes to fit one page). Text stays selectable.
const JSPDF_URL = new URL('../vendor/jspdf-4.2.1/jspdf.min.mjs', import.meta.url).href;
const FONT_URLS = {
  normal: new URL('../vendor/arimo/Arimo-Regular.ttf', import.meta.url).href,
  bold: new URL('../vendor/arimo/Arimo-Bold.ttf', import.meta.url).href,
};

export const SIZES = [11, 10.5];
const PAGE = { w: 612, h: 792 }; // US Letter in points
const MARGIN = { x: 40, top: 36, bottom: 36 };
const BULLET_INDENT = 16;
const LINE = 1.17; // line height as a multiple of the font size

let libPromise = null;
let fontsPromise = null;

/** For Node tests: provide jsPDF and the fonts (base64) without fetch. */
export function provide({ jsPDF, fonts }) {
  libPromise = Promise.resolve(jsPDF);
  fontsPromise = Promise.resolve(fonts);
}

function lib() {
  libPromise ??= import(JSPDF_URL).then((m) => m.jsPDF);
  return libPromise;
}

function fonts() {
  fontsPromise ??= Promise.all(
    Object.entries(FONT_URLS).map(async ([style, url]) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`font ${res.status}`);
      return [style, toBase64(new Uint8Array(await res.arrayBuffer()))];
    })
  ).then(Object.fromEntries);
  return fontsPromise;
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function newDoc() {
  const [jsPDF, f] = await Promise.all([lib(), fonts()]);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
  doc.addFileToVFS('Arimo-Regular.ttf', f.normal);
  doc.addFont('Arimo-Regular.ttf', 'Arimo', 'normal');
  doc.addFileToVFS('Arimo-Bold.ttf', f.bold);
  doc.addFont('Arimo-Bold.ttf', 'Arimo', 'bold');
  doc.setTextColor(0, 0, 0);
  return doc;
}

// Spacing in points; `size` is extra over the body size (only the name is bigger).
const STYLE = {
  name: { bold: true, size: 5, center: true, before: 0, after: 1 },
  contact: { bold: false, center: true, before: 0, after: 0 },
  heading: { bold: true, upper: true, rule: true, before: 9, after: 3 },
  org: { bold: true, before: 3, after: 0 },
  role: { bold: true, before: 7, after: 1 },
  bullet: { bold: false, before: 0, after: 1 },
  text: { bold: false, before: 0, after: 1 },
};

/**
 * Place every line; draw only if `draw` is true. Returns {pages, lastY}.
 * Title lines put their dates flush right. Lines that would cross the bottom margin start a new page.
 */
function layout(doc, items, size, draw) {
  const width = PAGE.w - MARGIN.x * 2;
  let page = 1;
  let y = MARGIN.top;
  items.forEach((item, n) => {
    const st = STYLE[item.kind] ?? STYLE.text;
    const fs = size + (st.size ?? 0);
    const lh = fs * LINE;
    doc.setFont('Arimo', st.bold ? 'bold' : 'normal');
    doc.setFontSize(fs);
    const text = st.upper ? item.text.toUpperCase() : item.text;
    const indent = item.kind === 'bullet' ? BULLET_INDENT : 0;
    const datesW = item.dates ? doc.getTextWidth(item.dates) + 12 : 0;
    const wrapped = doc.splitTextToSize(text, width - indent - datesW);
    // A title right under its company line or a section heading sits close to it.
    const before = (item.kind === 'role' || item.kind === 'org') && ['org', 'heading'].includes(items[n - 1]?.kind) ? 1 : st.before;
    if (n > 0) y += before;
    const block = wrapped.length * lh + (st.rule ? 3 : 0);
    if (y + block > PAGE.h - MARGIN.bottom && y > MARGIN.top) {
      page++;
      y = MARGIN.top;
      if (draw) doc.addPage();
    }
    wrapped.forEach((ln, k) => {
      const base = y + fs * 0.9; // text baseline
      if (draw) {
        if (item.kind === 'bullet' && k === 0) doc.text('•', MARGIN.x + 5, base);
        if (st.center) doc.text(ln, PAGE.w / 2, base, { align: 'center' });
        else doc.text(ln, MARGIN.x + indent, base);
        if (item.dates && k === 0) doc.text(item.dates, PAGE.w - MARGIN.x, base, { align: 'right' });
      }
      y += lh;
    });
    if (st.rule) {
      if (draw) {
        doc.setLineWidth(0.75);
        doc.setDrawColor(0, 0, 0);
        doc.line(MARGIN.x, y + 1, PAGE.w - MARGIN.x, y + 1);
      }
      y += 3;
    }
    y += st.after;
  });
  return { pages: page, lastY: y };
}

/** How many pages the resume takes at each size: {11: n, 10.5: n}. */
export async function measure(items) {
  const doc = await newDoc();
  return Object.fromEntries(SIZES.map((s) => [s, layout(doc, items, s, false).pages]));
}

/** The first size that fits one page, or null. */
export async function fitSize(items) {
  const pages = await measure(items);
  return SIZES.find((s) => pages[s] === 1) ?? null;
}

/** Build the PDF. Returns {blob, bytes, pages, size}. */
export async function buildPdf(items, { title = 'Resume', size } = {}) {
  const chosen = size ?? (await fitSize(items)) ?? SIZES.at(-1);
  const doc = await newDoc();
  doc.setProperties({ title, creator: 'Job Finder' });
  const { pages } = layout(doc, items, chosen, true);
  const bytes = doc.output('arraybuffer');
  return { blob: new Blob([bytes], { type: 'application/pdf' }), bytes, pages, size: chosen };
}
