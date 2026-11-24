# US6 semantic fit: spike results (2026-11-24)

**Question.** Can a small sentence-embedding model running on the phone pair each job
requirement ("They want") with the right resume line ("You did") well enough to replace the
keyword-based "Why you fit"?

**Answer: not on its own.** Speed is fine; quality is not.

## Quality
Setup: this week's 12 real postings (`data/jobs.json`) split into 7–20 requirements each, one
8-bullet sample resume (`resume.txt`). Every model's top-3 pairs per job were pooled and each
pair hand-judged, blind to model: *would a recruiter accept this resume line as evidence for
this requirement?* "N+ years of experience" requirements count as bad, since no single bullet
proves them. 90 pairs labeled (`pool.txt`, good ones listed in `labels.txt`), plus 14 more for
the best configuration.

| Model (q8) | Download | Top-3 pairs correct | Ranking quality (AUC) |
|---|---|---|---|
| all-MiniLM-L6-v2 | 21.9 MB | 31% | 0.61 |
| bge-small-en-v1.5 | 32.4 MB | 33% | 0.64 |
| e5-small-v2 | 32.4 MB | 39% | 0.55 |
| gte-small | 32.4 MB | 42% | 0.72 |
| gte-small + drop "N years" | 32.4 MB | 45% | 0.77 |
| **gte-small + drop "N years" + shared-skill bonus** | 32.4 MB | **50%** (18/36) | **0.80** |
| ms-marco cross-encoder re-ranker | +22 MB | 31–46% | 0.63–0.68 |

At a cutoff of 0.95 the best configuration shows ~1.4 pairs per job with ~71% correct, so most
jobs would show one pair and about 1 in 3 shown pairs would still be wrong.

Typical failures: shared verbs ("Partner with IT Engineering…" ↔ "Partnered with sales"), shared
nouns in different senses ("define requirements" for engineering tickets ↔ customer
requirements), and company culture or "apply anyway" text in postings without bullet lists.

## Speed (Chromium, CPU throttled; files served locally)
| Device | Model | First start | Later start | Embed 8 resume lines | Embed 20 requirements |
|---|---|---|---|---|---|
| Desktop | MiniLM / gte | 1.1 / 1.3 s | 0.35 / 0.44 s | 0.16 / 0.23 s | 0.24 / 0.40 s |
| Mid-range phone (4×) | MiniLM / gte | 3.7 / 4.3 s | 1.1 / 1.7 s | 0.5 / 0.9 s | 0.9 / 1.6 s |
| Low-end phone (6×) | MiniLM / gte | 5.6 / 6.3 s | 1.8 / 2.8 s | 0.8 / 1.5 s | 1.3 / 2.7 s |

Add download: ~26 MB (MiniLM) or ~37 MB (gte) including the runtime ≈ 4–6 s on Wi-Fi,
9–12 s on good 4G, 21–30 s on slow 4G. Job requirements would be embedded on GitHub, not the
phone. Go/no-go bars (first load < 30 s, later < 3 s) pass, except gte on slow 4G (~34 s).

## Files
- `requirements.mjs`: splits a posting into requirements (headings + bullets, boilerplate removed)
- `compare.mjs`, `score.mjs`, `hybrid.mjs`: run models, score against labels
- `timing.cjs` + `timing-page.html`: browser timing harness
- Models were downloaded from Hugging Face (Xenova/*) and are not committed.
