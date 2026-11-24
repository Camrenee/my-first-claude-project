// A small lexicon of what PM job postings ask for: skills, domains, methods and tools.
// Each concept lists the phrasings that count as the same thing, so "A/B tests" in a resume
// meets "experimentation" in a posting. Matching is case-insensitive on word boundaries.
//
// Benefits boilerplate ("wellness stipend", "healthcare coverage") is deliberately not matched.
// Keep entries specific: generic words every posting uses ("roadmap", "stakeholders") are
// listed with weight 0.5 so they count, but less than a real domain or skill.

/** @type {{id: string, label: string, w?: number, re: RegExp}[]} */
export const SKILLS = [
  // ----- Domains -----
  c('payments', 'Payments', /payments?|checkout|card issuing|money movement|money transfers?/),
  c('billing', 'Billing & invoicing', /billing|invoic\w*|subscriptions? billing|accounts receivable|pricing and packaging/),
  c('pricing', 'Pricing & monetization', /pricing|monetiz\w*|packaging|paywall\w*/),
  c('fintech', 'Fintech', /fintech|financial services|financial products?|banking|neobank|lending|credit cards?|loans?/),
  c('crypto', 'Crypto & digital assets', /crypto\w*|digital assets?|blockchain|stablecoins?|tokeniz\w*|web3|wallets?/),
  c('custody', 'Custody', /custody|custodial/),
  c('wealth', 'Investing & wealth', /investing|investments?|wealth|brokerage|portfolio management|retirement|401\(?k\)?|advisors?/),
  c('insurance', 'Insurance', /insurance (products?|carriers?|platforms?|industry)|insurtech|underwriting|claims processing|policyholders?/),
  c('payroll', 'Payroll & HR', /payroll|hris|benefits administration|\bpeo\b|hr tech|human resources/),
  c('healthcare', 'Healthcare', /healthtech|health tech|clinical|clinics?|patients?|payers?|ehr|emr|telehealth|care delivery|digital health/),
  c('ecommerce', 'E-commerce & retail', /e-?commerce|retail|merchants?|shopping|storefronts?|online ordering/),
  c('restaurants', 'Restaurants & food', /restaurants?|food delivery|dining|hospitality|menus?/),
  c('marketplace', 'Marketplaces', /marketplaces?|two-sided|supply and demand|sellers? and buyers?/),
  c('ads', 'Ads & ad tech', /advertis\w*|ad ?tech|\bads\b|campaigns?|auctions?|ad products?|programmatic/),
  c('media', 'Media & content', /digital media|media companies|publishing|publishers?|creators?|creator economy|streaming|video platforms?|podcasts?|music|newsrooms?|editorial/),
  c('fitness', 'Fitness & wellness', /fitness|workouts?|connected fitness|exercise/),
  c('mobility', 'Mobility & transportation', /transportation|transit|mobility|ride-?sharing|fleet management|logistics|last-mile/),
  c('travel', 'Travel', /travel (industry|booking|products?|platforms?|tech)|online travel|hotels?|flights?|airlines?|vacation rentals?/),
  c('real_estate', 'Real estate', /real estate|proptech|mortgages?|rentals?|leasing/),
  c('edtech', 'Education & edtech', /edtech|ed tech|education technology|education platforms?|k-?12|higher education|students|teachers|classrooms?|online courses|learning platforms?|learning management|lms/),
  c('security', 'Security & identity', /security|identity|authentication|sso|access management|fraud|trust and safety/),
  c('compliance', 'Compliance & regulation', /complian\w*|regulat\w*|\bkyc\b|\baml\b|audits?|hipaa|soc ?2|gdpr/),
  c('devtools', 'Developer tools', /developer tools?|developer experience|devtools|sdks?|developer platforms?/),
  c('infra', 'Infrastructure & cloud', /infrastructure|cloud|observability|databases?|data platform|reliability|devops|kubernetes|\baws\b|\bgcp\b|azure/),
  c('api', 'APIs & platform', /\bapis?\b|platform products?|integrations?|webhooks?|partner platform/),
  c('data_products', 'Data products & analytics tools', /data products?|analytics products?|business intelligence|dashboards?|reporting/),
  c('ai', 'AI & ML', /ai|artificial intelligence|machine learning|ml|llms?|large language models?|generative|gen ?ai|ml models?|ai models?|foundation models?|ai agents?|agentic|personaliz\w*/),
  c('search', 'Search & discovery', /search|discovery|relevance|recommendations?/),
  c('collab', 'Collaboration & productivity', /collaboration (tools?|software|products?)|productivity (tools?|software|apps?)|workspaces?|design tools?|workflow automation/),
  c('comms', 'Messaging & communications', /messaging|notifications?|in-app messages?|sms/),
  c('finance_ops', 'Finance operations', /finance operations|accounting|reconciliation|ledgers?|treasury|close process|spend management|expense/),

  // ----- Customer & business model -----
  c('b2b', 'B2B / enterprise', /\bb2b\b|enterprise|business customers?|smb|small businesses?|mid-?market|saas/),
  c('b2c', 'Consumer (B2C)', /b2c|consumers?|end users?|consumer apps?/),
  c('self_serve', 'Self-serve / PLG', /self-?serve|product-?led|\bplg\b|freemium|free trials?/),
  c('mobile', 'Mobile apps', /mobile|ios|android|app store|native apps?/),
  c('web', 'Web', /web apps?|web products?|websites?|browser extensions?|desktop apps?/),
  c('hardware', 'Hardware & devices', /hardware|iot|firmware|connected devices|consumer devices|embedded/),
  c('international', 'International / global', /international (expansion|markets?|launch\w*)|localization|multi-?currency|cross-?border|global (markets?|expansion|payments|launch\w*)/),

  // ----- Lifecycle & growth -----
  c('growth', 'Growth', /growth|acquisition|funnels?|conversion|top of funnel/),
  c('onboarding', 'Onboarding & activation', /onboarding|activation|first-?run|time to value|setup flows?/),
  c('retention', 'Retention & engagement', /retention|engagement|churn|lifecycle|loyalty|habit/),
  c('gtm', 'Go-to-market', /go-?to-?market|\bgtm\b|launch plans?|product marketing|sales enablement|positioning/),
  c('sales', 'Working with sales', /sales|account executives?|revenue teams?|customer success|partnerships?/),
  c('support', 'Support & operations', /customer support|support teams?|support operations|customer service/),

  // ----- Methods -----
  c('experimentation', 'Experimentation / A/B testing', /a\/b tests?|a\/b testing|experiment\w*|split tests?|hypothes[ie]s/),
  c('research', 'User research', /user research|customer interviews?|usability|customer discovery|qualitative research|user interviews?/),
  c('analytics', 'Data & analytics', /analytics|data-?driven|metrics|kpis?|insights|quantitative|dashboards?/),
  c('sql', 'SQL', /\bsql\b/),
  c('tools_analytics', 'Analytics tools', /amplitude|mixpanel|looker|tableau|mode analytics|heap|segment|snowflake|dbt/),
  c('design', 'Working with design', /designers?|ux|user experience|prototyp\w*|figma/, 0.5),
  c('technical', 'Technical depth', /technical (background|product|depth)|engineering background|computer science|system design|architecture/, 0.5),
  c('strategy', 'Product strategy & vision', /product strategy|product vision|strategic|north star|long-?term (vision|strategy|roadmap)/, 0.5),
  c('roadmap', 'Roadmapping & prioritization', /roadmaps?|prioritiz\w*|trade-?offs?/, 0.5),
  c('stakeholders', 'Cross-functional leadership', /cross-?functional|stakeholders?|alignment|influence without authority/, 0.5),
  c('launch', 'Shipping & launching', /shipp?\w*|launch\w*|deliver\w*|execution/, 0.5),
  c('zero_to_one', '0→1 building', /0 ?(to|→|-) ?1|zero to one|from scratch|new products?|greenfield|early-?stage/),
  c('scale', 'Scaling products', /at scale|scaling (products?|platforms?|systems)|millions of (users|customers|members)|high-?growth/, 0.5),
  c('mentoring', 'Mentoring & leading PMs', /mentor\w*|coach\w*|people management|managing pms?|lead a team/),
  c('specs', 'Specs & requirements', /\bprds?\b|requirements|specs?\b|user stories/),
  c('agile', 'Agile delivery', /agile|scrum|sprints?|kanban/),
];

function c(id, label, re, w = 1) {
  return { id, label, w, re: new RegExp(`\\b(?:${re.source})\\b`, 'gi') };
}

/** Count each skill's mentions in text. Returns Map<id, count>. */
export function skillCounts(text) {
  const out = new Map();
  const t = String(text);
  for (const s of SKILLS) {
    s.re.lastIndex = 0;
    const n = (t.match(s.re) ?? []).length;
    if (n) out.set(s.id, n);
  }
  return out;
}

export const SKILL_BY_ID = new Map(SKILLS.map((s) => [s.id, s]));

/** Where a skill is first mentioned in text: {index, length} or null. */
export function findSkill(id, text) {
  const s = SKILL_BY_ID.get(id);
  if (!s) return null;
  const re = new RegExp(s.re.source, 'i');
  const m = re.exec(String(text));
  return m ? { index: m.index, length: m[0].length } : null;
}

// Resume section headings ("Education", "Skills:") say nothing about experience,
// so they never count as evidence of a skill.
const HEADING = /^\s*(education|experience|work experience|professional experience|skills?|technical skills|summary|profile|objective|projects?|certifications?|awards|honors|interests|languages|volunteer\w*|publications|references|contact)\s*:?\s*$/i;

export function isResumeHeading(line) {
  return HEADING.test(String(line));
}

/** Resume text minus section headings: what the match score reads from the resume. */
export function resumeEvidenceText(text) {
  return String(text)
    .split(/\r?\n/)
    .filter((l) => !isResumeHeading(l))
    .join('\n');
}
