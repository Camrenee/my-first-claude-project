# Job Finder

One swipe feed of PM and Senior PM jobs in New York and US-remote, matched to your resume.
Plain HTML, CSS and JS: no build step, no backend. Everything you enter stays in your browser (localStorage).

## Try it
**On GitHub Pages:** Settings → Pages → *Deploy from a branch* → pick the branch → `/ (root)` → Save.
The site appears at `https://<owner>.github.io/my-first-claude-project/` a minute later.

**Locally:**
```
python3 -m http.server 8000     # then open http://localhost:8000
```
(Opening `index.html` straight from disk won't work: browsers block ES modules on `file://`.)

## Status
| Story | Status |
|---|---|
| Data test (job sources, company list) | PR #1 |
| US1 Profile: resume upload/paste, roles, locations, salary floor | PR #2 |
| US2 Swipe feed: daily deck, match score, queue of 5, undo, pull to refresh | PR #3 |
| US5 Why I fit: reasons tied to resume lines on the card and in details | ✅ this branch |
| US4 Tracking, US3 Tailoring | next |

## Layout
```
index.html          all screens (Today, Tracker, Profile)
css/tokens.css      design tokens: colors, radii, font
css/app.css         mobile-first styles
js/app.js           router + bottom nav + greeting
js/store.js         the only code that reads/writes localStorage
js/profile.js       US1 profile screen
js/feed.js          US2 Today screen: cards, swipe, undo, pull to refresh
js/feed-logic.js    US2 rules: eligibility, daily deck, labels (pure, unit-tested)
js/match.js         match score: share of a posting's skills your resume shows
js/skills.js        PM skills lexicon used by the match score
js/tracker.js       "To apply" queue (US4 adds the rest of the tracker)
js/job-details.js   job details sheet: full description, Pass / Save to apply
js/job-text.js      safe description HTML, card preview text, boilerplate filter
js/fit.js           US5 "Why you're a great fit": reasons quoting your resume lines
data/jobs.json      this week's matching jobs, refreshed by .github/workflows/refresh-jobs.yml
js/resume-parse.js  PDF (pdf.js) / Word (mammoth) → text, in the browser
vendor/             pinned copies of pdf.js 4.10.38 and mammoth 1.12.3 (with licenses)
tests/e2e/          Playwright checks at phone size
```

## Releasing a change
After editing anything in `css/` or `js/`, run `node scripts/stamp-version.mjs`. It stamps a new
version onto every file URL in `index.html`, so phones never mix old cached files with new ones.

## Tests
```
npm test            # unit tests: filters, feed rules, match score
npm run test:e2e    # browser tests at phone size (needs Playwright + Chromium)
```

## Job data
`.github/workflows/refresh-jobs.yml` runs `scripts/fetch-jobs.mjs` every 6 hours and commits
`data/jobs.json` when the list changes. It runs on the default branch, so it starts once this is merged to `main`.
