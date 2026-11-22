// Fetch + normalize postings from public job board APIs into one shape.
import { decodeEntities, htmlToText, parseSalaryText } from './filters.mjs';

export const SOURCES = {
  greenhouse: (slug) => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true&pay_transparency=true`,
  lever: (slug) => `https://api.lever.co/v0/postings/${slug}?mode=json`,
  ashby: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`,
};

// Returns the raw postings array, [] for an empty board, or null if the board doesn't exist.
export async function fetchBoard(ats, slug, { timeoutMs = 30000, retries = 2 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(SOURCES[ats](slug), { signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      return Array.isArray(body) ? body : body.jobs ?? [];
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

/**
 * Normalized job:
 * { id, ats, slug, company, title, locations[], workplaceType, postedAt, updatedAt,
 *   url, descriptionHtml, descriptionText, salary: {min,max,source}|null }
 */
export function normalize(ats, slug, company, raw) {
  return NORMALIZERS[ats](slug, company, raw);
}

const NORMALIZERS = {
  greenhouse(slug, company, j) {
    const html = decodeEntities(j.content ?? '');
    const text = htmlToText(html);
    const usd = (j.pay_input_ranges ?? []).filter((r) => (r.currency_type ?? 'USD') === 'USD' && r.max_cents);
    let salary = null;
    if (usd.length) {
      salary = {
        min: Math.min(...usd.map((r) => r.min_cents / 100)),
        max: Math.max(...usd.map((r) => r.max_cents / 100)),
        source: 'structured',
      };
      if (salary.max < 30000) salary = null; // hourly ranges
    }
    salary ??= withSource(parseSalaryText(text), 'text');
    return {
      id: `greenhouse:${slug}:${j.id}`,
      ats: 'greenhouse',
      slug,
      company: j.company_name || company,
      title: j.title?.trim(),
      locations: [j.location?.name, ...(j.offices ?? []).map((o) => o.location || o.name)].filter(Boolean),
      workplaceType: null,
      postedAt: j.first_published || j.updated_at,
      updatedAt: j.updated_at,
      url: j.absolute_url,
      descriptionHtml: html,
      descriptionText: text,
      salary,
    };
  },

  lever(slug, company, j) {
    const html = [j.description, ...(j.lists ?? []).map((l) => `<h3>${l.text}</h3><ul>${l.content}</ul>`), j.additional]
      .filter(Boolean)
      .join('\n');
    const text = [j.descriptionPlain, ...(j.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content)}`), j.additionalPlain]
      .filter(Boolean)
      .join('\n');
    let salary = null;
    const sr = j.salaryRange;
    if (sr && (sr.currency ?? 'USD') === 'USD' && /year/i.test(sr.interval ?? 'year') && sr.max >= 30000)
      salary = { min: sr.min, max: sr.max, source: 'structured' };
    salary ??= withSource(parseSalaryText(text), 'text');
    const locs = [...new Set([...(j.categories?.allLocations ?? []), j.categories?.location].filter(Boolean))];
    // Lever often says workplaceType=remote with location "United States" or a city.
    const locations =
      j.workplaceType === 'remote' ? locs.map((l) => (/remote/i.test(l) ? l : `Remote - ${l}`)) : locs;
    return {
      id: `lever:${slug}:${j.id}`,
      ats: 'lever',
      slug,
      company,
      title: j.text?.trim(),
      locations,
      workplaceType: j.workplaceType ?? null,
      postedAt: new Date(j.createdAt).toISOString(),
      updatedAt: new Date(j.createdAt).toISOString(),
      url: j.hostedUrl,
      descriptionHtml: html,
      descriptionText: text,
      salary,
    };
  },

  ashby(slug, company, j) {
    let salary = null;
    const comps = (j.compensation?.compensationTiers ?? [])
      .flatMap((t) => t.components ?? [])
      .filter((c) => /salary/i.test(c.compensationType ?? '') && (c.currencyCode ?? 'USD') === 'USD' && /year/i.test(c.interval ?? ''));
    if (comps.length) {
      salary = {
        min: Math.min(...comps.map((c) => c.minValue ?? c.maxValue)),
        max: Math.max(...comps.map((c) => c.maxValue ?? c.minValue)),
        source: 'structured',
      };
    }
    salary ??= withSource(parseSalaryText(j.compensation?.scrapeableCompensationSalarySummary ?? ''), 'structured');
    salary ??= withSource(parseSalaryText(j.descriptionPlain ?? ''), 'text');
    const locs = [j.location, ...(j.secondaryLocations ?? []).map((l) => l.location)].filter(Boolean);
    const locations = j.workplaceType === 'Remote' ? locs.map((l) => (/remote/i.test(l) ? l : `Remote - ${l}`)) : locs;
    return {
      id: `ashby:${slug}:${j.id}`,
      ats: 'ashby',
      slug,
      company,
      title: j.title?.trim(),
      locations,
      workplaceType: j.workplaceType ?? null,
      postedAt: j.publishedAt,
      updatedAt: j.updatedAt ?? j.publishedAt,
      url: j.jobUrl,
      descriptionHtml: j.descriptionHtml ?? '',
      descriptionText: j.descriptionPlain ?? '',
      salary,
      listed: j.isListed !== false,
    };
  },
};

function withSource(s, source) {
  return s ? { ...s, source } : null;
}

// Simple bounded-concurrency map.
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    })
  );
  return out;
}
