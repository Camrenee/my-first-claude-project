# Job Finder

A simple, no-backend job search helper. Plain HTML/CSS/JS, so it runs on GitHub Pages.

- **Profile** – name, email, target job titles, remote/on-site preference, location, pasted resume, and an editable cover letter template. Saved in your browser's localStorage.
- **Swipe** – jobs come up as a card stack, dating-app style. Swipe **right** to save (♥ Liked), **left** to skip, **up** to apply right away. ↺ undoes the last swipe. If your resume shares 2+ skills with the posting you get an *It's a match!* screen. On a computer use ← → ↑ and Z. Switch to **List** view any time.
- **Jobs** – live listings from the free [Remotive](https://remotive.com) and [Arbeitnow](https://www.arbeitnow.com) APIs, filtered by your titles and location. Results are cached for an hour; tap **Refresh** to re-fetch.
- **Apply** – opens a panel with a cover letter filled in from your profile and the job (including skills that appear in both your resume and the posting), a **Copy** button, and a link to the real application page.
- **Tracker** – jobs you've Liked, Applied to, are Interviewing for, or Skipped.

All data stays in your browser. Use **Profile → Data → Export** to back it up.

## Run locally
Open `index.html` in a browser, or run `python3 -m http.server` in this folder and visit http://localhost:8000.

## Notes
- Remotive only lists remote jobs. Arbeitnow is mostly Europe/Germany-based.
- Remotive asks that its API not be called more than a few times a day, which is why results are cached.
