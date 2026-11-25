// Job description helpers: safe HTML for the details sheet, and a short preview for the card.
//
// Descriptions come from other companies' job boards, so we never insert their HTML as-is.
// sanitizeHtml rebuilds it from an allowlist of plain formatting tags with no attributes
// (except https links), dropping scripts, styles, images, iframes and event handlers.

const KEEP = new Set(['P', 'BR', 'UL', 'OL', 'LI', 'STRONG', 'B', 'EM', 'I', 'U', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'A', 'BLOCKQUOTE']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'IMG', 'SVG', 'VIDEO', 'AUDIO', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META', 'HEAD', 'TITLE']);
const HEADINGS = { H1: 'h3', H2: 'h3', H3: 'h3', H4: 'h4', H5: 'h4', H6: 'h4' };

/** Returns a DocumentFragment that is safe to append. */
export function sanitizeHtml(html = '') {
  const src = new DOMParser().parseFromString(String(html), 'text/html').body;
  const out = document.createDocumentFragment();
  copyChildren(src, out);
  return out;
}

function copyChildren(from, to) {
  for (const node of from.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      to.append(document.createTextNode(node.textContent));
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || DROP.has(node.tagName)) continue;
    if (!KEEP.has(node.tagName)) {
      // div, span, section, font…: keep the content, lose the wrapper.
      // Block-level wrappers become paragraphs so text doesn't run together.
      if (/^(DIV|SECTION|ARTICLE|HEADER|FOOTER|TABLE|TR)$/.test(node.tagName)) {
        const p = document.createElement('p');
        copyChildren(node, p);
        if (p.textContent.trim()) to.append(p);
      } else {
        copyChildren(node, to);
      }
      continue;
    }
    let el;
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') ?? '';
      if (!/^https:\/\//i.test(href)) {
        copyChildren(node, to); // keep the words, drop the unsafe link
        continue;
      }
      el = document.createElement('a');
      el.href = href;
      el.target = '_blank';
      el.rel = 'noopener noreferrer';
    } else {
      el = document.createElement(HEADINGS[node.tagName] ?? node.tagName.toLowerCase());
    }
    copyChildren(node, el);
    if (el.tagName === 'BR' || el.textContent.trim()) to.append(el);
  }
}

/** Block-level text pieces in reading order (paragraphs, list items, headings). */
export function htmlToParagraphs(html = '') {
  // Make sure adjacent blocks don't glue together ("forums</li><li>Experience").
  const spaced = String(html).replace(/<\/(p|li|div|h[1-6]|td|blockquote)>/gi, '$& ').replace(/<br\s*\/?>/gi, ' ');
  const body = new DOMParser().parseFromString(spaced, 'text/html').body;
  const blocks = body.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, div:not(:has(p, li, div, h1, h2, h3, h4, h5, h6))');
  const seen = new Set();
  const out = [];
  for (const b of blocks) {
    const t = b.textContent.replace(/\s+/g, ' ').trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  if (!out.length) {
    const t = body.textContent.replace(/\s+/g, ' ').trim();
    if (t) out.push(t);
  }
  return out;
}

const ROLE_HEADING = /^(about (the|this) (role|position|opportunity|team)|the role|the opportunity|role overview|position overview|overview|your role|in this role|what you['’]ll (do|be doing|work on)|what you will do|responsibilities|key responsibilities|the job|job description|about the job)\b/i;

/**
 * Pick the most useful ~300 characters for the card: the start of the role section when the
 * posting has one, otherwise its first real paragraph. Pure; unit-tested.
 */
export function previewFromParagraphs(paragraphs, max = 300) {
  const isHeading = (t) => t.length < 60 && !/[.!?]$/.test(t);
  let start = paragraphs.findIndex((t) => ROLE_HEADING.test(t) && t.length < 80);
  start = start === -1 ? 0 : start + (isHeading(paragraphs[start]) ? 1 : 0);
  const body = paragraphs.slice(start).filter((t) => !isHeading(t) && t.length > 40);
  // Bullet points usually lack end punctuation; add it so they don't run together.
  const text = (body.length ? body : paragraphs).slice(0, 3).map((t) => (/[.!?:…]$/.test(t) ? t : `${t}.`)).join(' ');
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 30)).replace(/[,;:\s]+$/, '')}…`;
}

// ---------- Boilerplate ----------
// Legal, pay, benefits and application text that every posting carries. It says nothing about
// the role, so it must not count toward the match score or be quoted as "what the job says".
const BOILERPLATE = new RegExp(
  [
    'equal (employment )?opportunit', 'affirmative action', 'sexual orientation', 'gender identity', 'national origin',
    'protected (veteran|class|characteristic)', 'disabilit', 'reasonable accommodation', 'e-verify', 'background check',
    'arrest (and|or) conviction', 'fair chance', 'pay transparency', 'salary range', 'base (salary|pay)', 'on target earnings',
    '\\bote\\b', 'compensation (package|range)', 'total compensation', 'equity (and|or) benefits', 'benefits (include|package)',
    '401\\(?k\\)?', 'paid time off', '\\bpto\\b', 'parental leave', 'health(care)? (insurance|coverage|benefits)', 'wellness stipend',
    'we never ask', 'recruiting scam', 'fraudulent', 'only careers site', 'privacy (notice|policy)', 'applicant',
    'new hires', 'in-person onboarding', 'e-?mail .* (accommodation|recruit)', 'visa sponsorship', 'relocation assistance',
  ].join('|'),
  'i'
);

export function isBoilerplate(sentence) {
  return BOILERPLATE.test(sentence);
}

/** The posting's paragraphs with boilerplate sentences removed. */
export function roleParagraphs(paragraphs) {
  return paragraphs
    .map((p) =>
      p
        .split(/(?<=[.!?])\s+(?=[A-Z])/)
        .filter((sent) => !isBoilerplate(sent))
        .join(' ')
        .trim()
    )
    .filter(Boolean);
}
