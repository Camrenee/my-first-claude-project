// US6 spike, part 2: can Claude pair job requirements with resume lines better than
// on-device embeddings (best: 50% of top-3 pairs correct)?
//
// Same inputs as the embedding test: pairs-input.json (12 real postings split into
// requirements + an 8-bullet sample resume) and labels.json (104 hand-judged pairs:
// "would a recruiter accept this resume line as evidence for this requirement?").
//
// Claude returns only indices (requirement i ↔ resume line k), never text, so the app can
// show both lines word for word: nothing gets paraphrased.
//
// Setup (once):  cd docs/us6-spike && npm install @anthropic-ai/sdk zod
// Run:           ANTHROPIC_API_KEY=... node claude-judge.mjs [model ...]
//                default models: claude-haiku-5-5 claude-sonnet-5-5
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

const here = path.dirname(fileURLToPath(import.meta.url));
const input = JSON.parse(fs.readFileSync(path.join(here, 'pairs-input.json'), 'utf8'));
const labels = JSON.parse(fs.readFileSync(path.join(here, 'labels.json'), 'utf8'));
const models = process.argv.slice(2).length ? process.argv.slice(2) : ['claude-haiku-5-5', 'claude-sonnet-5-5'];
// $ per 1M tokens (input, output), from the current price list
const PRICE = { 'claude-haiku-5-5': [0.1, 0.5], 'claude-sonnet-5-5': [2, 10], 'claude-opus-5-5': [4, 20] };

const client = new Anthropic();

const Pairs = z.object({
  pairs: z
    .array(
      z.object({
        requirement: z.number().int().describe('Number of the job requirement'),
        resume_line: z.number().int().describe('Number of the resume line that proves it'),
      })
    )
    .describe('At most 3 pairs, strongest first. Empty if nothing qualifies.'),
});

const SYSTEM = `You match a job seeker's resume to a job posting for a job-search app.

You get the posting's requirements and the resume's lines, each numbered. Return up to 3 pairs
(requirement number, resume line number) where the resume line is direct evidence a recruiter
would accept that the person meets that requirement.

Rules:
- Only pair when the resume line shows the same kind of work, skill or domain the requirement
  asks for. Shared words are not enough ("partnered with sales" does not prove "partner with IT
  engineering"; "define requirements with customers" does not prove "write engineering tickets").
- Never pair a years-of-experience requirement ("5+ years of PM experience"): one line can't prove it.
- Use each requirement and each resume line at most once.
- Fewer than 3 pairs, or none, is the right answer when the evidence isn't there. Never stretch.
- Strongest pair first.`;

function prompt(job) {
  const reqs = job.requirements.map((r, i) => `${i}. ${r}`).join('\n');
  const lines = input.resume.map((r, i) => `${i}. ${r}`).join('\n');
  return `Job: ${job.company}\n\nRequirements:\n${reqs}\n\nResume lines:\n${lines}`;
}

for (const model of models) {
  let tp = 0;
  let fp = 0;
  let shown = 0;
  let jobsWithTwoPlus = 0;
  let inTok = 0;
  let outTok = 0;
  const unlabeled = [];
  for (const job of input.jobs) {
    const response = await client.messages.parse({
      model,
      max_tokens: 4000,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt(job) }],
      output_config: { format: zodOutputFormat(Pairs) },
    });
    inTok += response.usage.input_tokens;
    outTok += response.usage.output_tokens;
    if (response.stop_reason === 'refusal' || !response.parsed_output) {
      console.log(`  ${job.company}: no usable answer (stop_reason ${response.stop_reason})`);
      continue;
    }
    const seenR = new Set();
    const seenL = new Set();
    const pairs = response.parsed_output.pairs
      .filter((p) => job.requirements[p.requirement] !== undefined && input.resume[p.resume_line] !== undefined)
      .filter((p) => !seenR.has(p.requirement) && !seenL.has(p.resume_line) && seenR.add(p.requirement) && seenL.add(p.resume_line))
      .slice(0, 3);
    shown += pairs.length;
    if (pairs.length >= 2) jobsWithTwoPlus++;
    for (const p of pairs) {
      const key = `${job.id}|${p.requirement}|${p.resume_line}`;
      if (labels[key] === true) tp++;
      else if (labels[key] === false) fp++;
      else unlabeled.push({ key, want: job.requirements[p.requirement], did: input.resume[p.resume_line] });
    }
  }
  const [pi, po] = PRICE[model] ?? [NaN, NaN];
  const cost = (inTok * pi + outTok * po) / 1e6;
  console.log(`\n=== ${model}`);
  console.log(`pairs shown: ${shown} across ${input.jobs.length} jobs; jobs with 2+ pairs: ${jobsWithTwoPlus}`);
  console.log(`correct among already-labeled: ${tp}/${tp + fp}${tp + fp ? ` = ${Math.round((tp / (tp + fp)) * 100)}%` : ''}; new pairs to judge: ${unlabeled.length}`);
  console.log(`tokens: ${inTok} in / ${outTok} out → $${cost.toFixed(4)} for 12 jobs (~$${((cost / 12) * 15 * 30).toFixed(2)}/month at 15 jobs/day)`);
  for (const u of unlabeled) console.log(`  ?? ${u.key}\n     WANT: ${u.want}\n     DID:  ${u.did}`);
}
