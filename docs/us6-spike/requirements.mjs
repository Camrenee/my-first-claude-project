// Spike: split a posting's HTML into requirement lines (Node-friendly, regex-based).
import { isBoilerplate } from '/home/user/my-first-claude-project/js/job-text.js';
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&rsquo;|&apos;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"');
const strip = (s) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const SECTION = [
  ['resp', /(what you('|’)?ll do|what you will do|responsibilit|in this role|the role|your impact|day[- ]to[- ]day|you will|what you('|’)?ll be doing|your role|the job)/i],
  ['nice', /(nice to have|bonus|preferred|plus if|extra credit)/i],
  ['req', /(what you('|’)?ll bring|requirements|qualifications|about you|you have|you might|looking for|who you are|what we look for|what you bring|experience|skills)/i],
];
export function requirements(html) {
  const blocks = [];
  const re = /<(h[1-6]|li|p|div)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[1].toLowerCase(); const text = strip(m[2]);
    if (!text) continue;
    const headingLike = /^h/.test(tag) || (text.length < 70 && (/^<(strong|b)>/i.test(m[2].trim()) || /:$/.test(text)) && !/[.!?]$/.test(text));
    blocks.push({ kind: headingLike ? 'h' : tag === 'li' ? 'li' : 'p', text });
  }
  let section = 'other';
  const items = [];
  for (const b of blocks) {
    if (b.kind === 'h') { section = (SECTION.find(([, r]) => r.test(b.text)) ?? ['other'])[0]; continue; }
    items.push({ ...b, section });
  }
  const PAY = /salary expectations|total rewards|incentive compensation|eligible for|equity grant|bonus program/i;
  const good = (t) => t.length >= 25 && t.length <= 320 && !isBoilerplate(t) && !PAY.test(t);
  let picked = items.filter((i) => i.kind === 'li' && i.section !== 'other' && good(i.text));
  if (picked.length < 4) picked = items.filter((i) => i.kind === 'li' && good(i.text));
  if (picked.length < 4) picked = items.filter((i) => i.section !== 'other').flatMap((i) => i.text.split(/(?<=[.!?])\s+(?=[A-Z])/).map((t) => ({ ...i, text: t }))).filter((i) => good(i.text));
  const order = { resp: 0, req: 1, other: 2, nice: 3 };
  return [...new Map(picked.map((p) => [p.text, p])).values()].sort((a, b) => order[a.section] - order[b.section]).slice(0, 20);
}
