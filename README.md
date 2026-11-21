# Job Finder

A simple, no-backend job search helper. Plain HTML/CSS/JS, so it runs on GitHub Pages.

- **Profile** – name, email, target job titles, remote/on-site preference, location, and your resume. **Upload a PDF, Word (.docx) or text file** and the text is pulled out right in your browser (or paste it). Also an editable cover letter template. Saved in your browser's localStorage.
- **Swipe** – jobs come up as a card stack, dating-app style:
  - **Right ♥ = apply.** Opens the apply screen with a **resume tailored to that job**, a cover letter, and a big **Open application page** button. The job stays in your Tracker as *To finish* until you tap **I applied ✓**.
  - **Left ✕ = skip.** **Up ★ = save for later.** **↺** undoes the last swipe. On a computer use ← → ↑ and Z.
  - Switch to **List** view any time.
- **Tailored resume** – built from *your* resume only, nothing made up. It moves the bullet points most relevant to the job to the top of each role, puts matching skills first, adds a "Core skills for this role" line, and lists keywords from the posting that aren't on your resume (add them only if they're true). Edit it, then **Copy**, **Download .txt** or **Save as PDF**.
- **Jobs** – live listings from the free [Remotive](https://remotive.com) and [Arbeitnow](https://www.arbeitnow.com) APIs, filtered by your titles and location. Results are cached for an hour; tap **↻** to re-fetch.
- **Tracker** – To finish, Saved, Applied, Interviewing, Skipped. Your tailored resume and letter are kept with each job.

All data stays in your browser. Use **Profile → Data → Export** to back it up.

## Deploy (GitHub Pages)
`.github/workflows/pages.yml` publishes the site automatically every time `main` changes.

One-time setup:
1. The repo must be **public** (or you need a paid GitHub plan for Pages on private repos): Settings → General → Danger Zone → Change visibility.
2. Settings → Pages → Build and deployment → **Source: GitHub Actions**.
3. Merge to `main`. Watch the **Actions** tab; when "Deploy to GitHub Pages" goes green the site is live at
   **https://camrenee.github.io/my-first-claude-project/**

To redeploy without changing code: Actions → Deploy to GitHub Pages → Run workflow.

## Run locally
Open `index.html` in a browser, or run `python3 -m http.server` in this folder and visit http://localhost:8000.

## Notes
- PDF and Word reading use [pdf.js](https://mozilla.github.io/pdf.js/) and [mammoth.js](https://github.com/mwilliamson/mammoth.js), bundled in `vendor/` (licenses included). Your file never leaves your device.
- Scanned (image-only) PDFs have no text to read. Paste the text instead.
- Remotive only lists remote jobs. Arbeitnow is mostly Europe/Germany-based.
- Remotive asks that its API not be called more than a few times a day, which is why results are cached.
