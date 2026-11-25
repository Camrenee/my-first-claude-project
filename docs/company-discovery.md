# Company discovery test (2026-11-25)

**Question.** Can Claude, with web search, find more companies to watch, so the feed gets more
matching PM jobs? Today's 173 companies give about 16 matching jobs a week.

**How.** `scripts/discover-companies.mjs` asked Claude Opus 5.5 (web search on) for up to 40
NYC / US-remote companies that hire PMs, in each of 6 segments, skipping companies already on
the list. Claude only suggested; every suggestion was then checked against the real Greenhouse,
Lever and Ashby APIs (up to 6 slug guesses × 3 job boards), and kept only if the board exists and
has at least one NYC or US-remote posting. `scripts/compare-coverage.mjs` then counted matching jobs
with the same filters as the data test (PM / Senior PM, NYC incl. hybrid or US-remote, salary max
above $170K or not listed, one copy per company + title).

## Results
- 238 suggestions → 190 new names → **117 new companies with live boards** (≈60% hit rate).
- Claude cost ≈ **$2.75** (31 web searches), one-time.

| Company list | Matching jobs, last 7 days | Avg / week over 28 days |
|---|---|---|
| Today's list (173) | 13 | 16.0 |
| New companies only (117) | 8 | 7.5 |
| **Combined (290)** | **21** | **23.5** |

**Gain: +47% (28-day average), +62% (last 7 days). Go bar was +50% on the 28-day average: just short.**

Top new sources of matching jobs (28 days): Baseten 5, Tailscale 4, BitGo 2, Figure 2, Hebbia 2,
Valon 2, then 1 each from Alloy, AlphaSense, Arize AI, Chainguard, FanDuel, Human Interest, Kraken,
Maven Clinic, Modern Treasury.

## Notes
- Many new companies have plenty of NYC / remote openings but few PM roles in a given month;
  returns per company are lower than the original list (0.06 vs 0.09 matching jobs / week each).
- Adding boards costs nothing at runtime beyond a few seconds of fetching; Claude is only needed
  when the list is refreshed (e.g. quarterly, ~$3 each time).
- Ashby boards don't name the company, so short slugs (19 flagged in
  `data/companies-proposed.json`) should be eyeballed once before adding.
- Bigger gains would need other sources (Workday companies, or a job-search API such as Adzuna, V2).

## Proposed list
`data/companies-proposed.json`: 117 companies (name, job board, slug, link, segment, review note).
Not merged into `data/companies.json` until reviewed.
