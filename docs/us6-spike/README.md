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

## Part 2: Claude as the judge (ready to run)
`claude-judge.mjs` sends each posting's requirements and the resume lines (numbered) to Claude
and gets back up to 3 index pairs, so the app can show both texts word for word. It scores the
pairs against the same labels (`labels.json`, all 104 judged pairs) and lists any new pairs to judge
by the same rule.

```
cd docs/us6-spike
npm install @anthropic-ai/sdk zod
ANTHROPIC_API_KEY=... node claude-judge.mjs            # Haiku 5.5 and Sonnet 5.5
```

Go bar: at least 85% of shown pairs correct (after judging any new ones) and 2+ pairs on most jobs.
Expected cost of one run: well under $1.

## Part 2 results (2026-11-24)
One run of `claude-judge.mjs`, 12 jobs, both default models. The 24 new pairs the models picked
(some by both) were judged by the same rule as before and merged into `labels.json` (now 128
pairs), so precision below counts every shown pair.

| Model | Pairs shown | Jobs with 2+ pairs | Correct (all shown pairs) | Cost, 12 jobs | ~Per month (15 jobs/day) | Go? |
|---|---|---|---|---|---|---|
| claude-haiku-5-5 | 33 | 11 of 12 | **79%** (26/33) | $0.007 | ~$0.26 | No: precision < 85% |
| claude-sonnet-5-5 | 27 | 9 of 12 | **96%** (26/27) | $0.079 | ~$2.95 | **Yes** |

Go bar: at least 85% correct and 2+ pairs on at least 7 of 12 jobs. Costs come from the
script's price table and the token counts it reports (18.6k input tokens for each model;
Haiku used 10.2k output tokens, Sonnet 4.1k).

**Haiku's misses** are the failure modes the prompt warns about: generic matches ("leading
complex launches across many teams" ↔ one team shipping onboarding), different senses (employee
technology adoption ↔ customer onboarding), loose domain links (health and fitness ↔ clinic
scheduling) and vague requirements ("deliver measurable business impact"). It fills 3 slots
almost every time.

**Sonnet** shows fewer pairs but nearly all hold up. Its one labeled miss was already in the
labels. Borderline new pairs judged good: "products with a technical platform" ↔ payments-API
requirements, "launching and growing new products for businesses" ↔ growing B2B invoicing ARR,
and "work closely with Engineering… document tickets" ↔ shipping with 6 engineers. If all three
were bad it would still pass at 85% (23/27).

**Recommendation:** go with Sonnet 5.5 as the matcher, at roughly 13× Haiku's cost but still about
$3 a month. Run it on GitHub when jobs are fetched, like the requirement embeddings would have been.

Caveats: one resume, one run (no repeat runs to check variance), and one person labeling.
`labels.json` marked one years-of-experience pair as good (OpenAI "Have 6+ years of product
management experience…" ↔ the self-serve onboarding line). That label came from part 1 and broke
the rule; it is now corrected to bad. Effect: part 1's best on-device result drops from 50% to 47%
(17/36); part 2 numbers are unchanged unless a model picked that pair.
