// Pure filter/parse helpers shared by the job pipeline and (later) the browser.
// No I/O here, so everything is unit-testable.

// ---------- Title ----------
// In scope: "Product Manager" and "Senior Product Manager" (incl. Sr., Technical, numbered levels).
// Out of scope: people-manager / exec / staff+ / junior / non-PM roles.
const PM_RE = /\bproduct\s+manager\b/i;
const EXCLUDE_TITLE_RE =
  /\b(director|vp|vice\s+president|head|chief|principal|staff|lead|group|associate|apm|intern|internship|marketing|program|project|owner)\b/i;
const SENIOR_PLUS_RE = /\b(principal|staff|lead|group)\b/i;

export function classifyTitle(title = '') {
  const t = title.replace(/\s+/g, ' ').trim();
  if (!PM_RE.test(t)) return 'not_pm';
  if (!EXCLUDE_TITLE_RE.test(t)) return 'match';
  if (SENIOR_PLUS_RE.test(t) && !/\b(director|vp|vice\s+president|head|chief)\b/i.test(t)) return 'senior_plus';
  return 'excluded';
}

// ---------- Location ----------
// Returns 'nyc' | 'us_remote' | 'other' for a single location string.
const REMOTE_RE = /\b(remote|anywhere|distributed|work from home|wfh)\b/i;
const NYC_RE = /\b(new york|nyc|manhattan)\b|\bny,\s*ny\b/i;
// Places that mention "New York" but are not Manhattan/NYC proper, or are other boroughs.
const NOT_NYC_RE =
  /\b(brooklyn|queens|bronx|staten island|long island|albany|buffalo|rochester|syracuse|westchester|white plains|tarrytown|yonkers|purchase|armonk|melville)\b/i;
const NY_MENTION_RE = /\b(new york|nyc|ny)\b/i;
const US_ONLY_RE = /^(us|usa|u\.?s\.?a?\.?|united states( of america)?|america|north america|nationwide)$/i;
// Words that can sit next to "Remote" without tying it to a place.
const NOISE_RE =
  /\b(remote|anywhere|distributed|work from home|wfh|hybrid|based|only|first|friendly|eligible|optional|in|the|within|or|and|any|location|locations|time ?zones?|eastern|central|east|coast|est|et|pst|pt|hours?|us|usa|u\.s\.a?\.?|united states( of america)?|america|north america|nationwide|country|wide)\b/gi;

export function classifyLocation(raw = '') {
  const s = String(raw).replace(/\s+/g, ' ').trim();
  if (!s) return 'other';
  const isRemote = REMOTE_RE.test(s);

  if (!isRemote) {
    if (NYC_RE.test(s) && !(NOT_NYC_RE.test(s) && !/\b(new york city|nyc|manhattan|new york, ny)\b/i.test(s)))
      return 'nyc';
    // "United States" / "US" with no city is how many boards label remote-US roles.
    if (US_ONLY_RE.test(s.replace(/[()]/g, '').trim())) return 'us_remote';
    return 'other';
  }

  // Remote limited to New York is in scope.
  if (NY_MENTION_RE.test(s) && !NOT_NYC_RE.test(s)) return 'us_remote';
  const leftover = s
    .replace(NOISE_RE, ' ')
    .replace(/[^a-z]+/gi, ' ')
    .trim();
  // Nothing left (e.g. "Remote", "Remote - US", "US Remote (Eastern time)") => US remote.
  return leftover === '' ? 'us_remote' : 'other';
}

// Splits multi-location strings like "New York, NY; Remote - US" or "NYC | SF".
export function splitLocations(raw = '') {
  return String(raw)
    .split(/\s*(?:;|\||\/|\bor\b|\n)\s*/i)
    .map((x) => x.trim())
    .filter(Boolean);
}

// Job-level: in scope if any of its locations is NYC or US-remote.
export function jobLocationScope(locations) {
  const parts = locations.flatMap(splitLocations);
  const classes = parts.map(classifyLocation);
  if (classes.includes('nyc')) return 'nyc';
  if (classes.includes('us_remote')) return 'us_remote';
  return 'other';
}

// ---------- Salary ----------
const AMOUNT = String.raw`\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?([kK])?`;
const RANGE_RE = new RegExp(`${AMOUNT}\\s*(?:USD)?\\s*(?:-|–|—|to)\\s*(?:USD\\s*)?${AMOUNT}`, 'g');

function toDollars(num, k, otherK) {
  let v = parseFloat(num.replace(/,/g, ''));
  if (k || (otherK && v < 1000)) v *= 1000;
  return v;
}

// Pulls annual USD ranges out of free text. Returns {min,max} or null.
export function parseSalaryText(text = '') {
  let min = Infinity;
  let max = -Infinity;
  for (const m of String(text).matchAll(RANGE_RE)) {
    const lo = toDollars(m[1], m[2], m[4]);
    const hi = toDollars(m[3], m[4], m[2]);
    if (!(hi >= lo) || lo < 30000 || hi > 2000000) continue; // drop hourly / equity / junk
    min = Math.min(min, lo);
    max = Math.max(max, hi);
  }
  return max > 0 ? { min, max } : null;
}

// ---------- Date ----------
export function postedWithin(iso, days, now = Date.now()) {
  const t = Date.parse(iso);
  return Number.isFinite(t) && now - t <= days * 864e5 && t <= now + 864e5;
}

// ---------- Text ----------
export function decodeEntities(s = '') {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

export function htmlToText(html = '') {
  return decodeEntities(
    String(html)
      .replace(/<(br|\/p|\/li|\/h\d|\/div)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}
