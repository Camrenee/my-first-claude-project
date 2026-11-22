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
| US1 Profile: resume upload/paste, roles, locations, salary floor | ✅ this branch |
| US2 Swipe feed | next |
| US4 Tracking, US3 Tailoring, US5 Why I fit | later |

## Layout
```
index.html          all screens (Today, Tracker, Profile)
css/tokens.css      design tokens: colors, radii, font
css/app.css         mobile-first styles
js/app.js           router + bottom nav + greeting
js/store.js         the only code that reads/writes localStorage
js/profile.js       US1 profile screen
js/resume-parse.js  PDF (pdf.js) / Word (mammoth) → text, in the browser
vendor/             pinned copies of pdf.js 4.10.38 and mammoth 1.12.3 (with licenses)
tests/e2e/          Playwright checks at phone size
```

## Tests
```
node tests/e2e/us1-profile.e2e.mjs   # needs Playwright + Chromium installed
```
