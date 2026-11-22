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
  c('insurance', 'Insurance', /insurance|insurtech|underwriting|claims/),
  c('payroll', 'Payroll & HR', /payroll|hris|benefits administration|\bpeo\b|hr tech|human resources/),
  c('healthcare', 'Healthcare', /healthtech|health tech|clinical|clinics?|patients?|payers?|ehr|emr|telehealth|care delivery|digital health/),
  c('ecommerce', 'E-commerce & retail', /e-?commerce|retail|merchants?|shopping|storefronts?|online ordering/),
  c('restaurants', 'Restaurants & food', /restaurants?|food delivery|dining|hospitality|menus?/),
  c('marketplace', 'Marketplaces', /marketplaces?|two-sided|supply and demand|sellers? and buyers?/),
  c('ads', 'Ads & ad tech', /advertis\w*|ad ?tech|\bads\b|campaigns?|auctions?|ad products?|programmatic/),
  c('media', 'Media & content', /media|content|publishing|creators?|streaming|video|audio|podcasts?|music/),
  c('fitness', 'Fitness & wellness', /fitness|workouts?|connected fitness|exercise/),
  c('mobility', 'Mobility & transportation', /transportation|transit|mobility|rides?|ride-?sharing|routing|fleets?|logistics/),
  c('travel', 'Travel', /travel|bookings?|hotels?|flights?/),
  c('real_estate', 'Real estate', /real estate|proptech|mortgages?|rentals?|leasing/),
  c('edtech', 'Education', /education|edtech|learning|students?|teachers?|courses?/),
  c('security', 'Security & identity', /security|identity|authentication|sso|access management|fraud|trust and safety/),
  c('compliance', 'Compliance & regulation', /complian\w*|regulat\w*|\bkyc\b|\baml\b|audits?|hipaa|soc ?2|gdpr|legal/),
  c('devtools', 'Developer tools', /developer tools?|developer experience|devtools|sdks?|developer platforms?/),
  c('infra', 'Infrastructure & cloud', /infrastructure|cloud|observability|databases?|data platform|reliability|devops|kubernetes|\baws\b|\bgcp\b|azure/),
  c('api', 'APIs & platform', /\bapis?\b|platform products?|integrations?|webhooks?|partner platform/),
  c('data_products', 'Data products & analytics tools', /data products?|analytics products?|business intelligence|dashboards?|reporting/),
  c('ai', 'AI & ML', /ai|artificial intelligence|machine learning|ml|llms?|large language models?|generative|gen ?ai|ml models?|ai models?|foundation models?|ai agents?|agentic|personaliz\w*/),
  c('search', 'Search & discovery', /search|discovery|relevance|recommendations?/),
  c('collab', 'Collaboration & productivity', /collaboration|productivity|workflows?|workspaces?|design tools?/),
  c('comms', 'Messaging & communications', /messaging|notifications?|in-app messages?|sms/),
  c('finance_ops', 'Finance operations', /finance operations|accounting|reconciliation|ledgers?|treasury|close process|spend management|expense/),

  // ----- Customer & business model -----
  c('b2b', 'B2B / enterprise', /\bb2b\b|enterprise|business customers?|smb|small businesses?|mid-?market|saas/),
  c('b2c', 'Consumer (B2C)', /b2c|consumers?|end users?|consumer apps?/),
  c('self_serve', 'Self-serve / PLG', /self-?serve|product-?led|\bplg\b|freemium|free trials?/),
  c('mobile', 'Mobile apps', /mobile|ios|android|app store|native apps?/),
  c('web', 'Web', /\bweb\b|websites?|browsers?|desktop/),
  c('hardware', 'Hardware & devices', /hardware|devices?|iot|firmware/),
  c('international', 'International / global', /international|global|localization|multi-?currency|cross-?border/),

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
  c('technical', 'Technical depth', /technical|engineering background|computer science|architecture|system design/),
  c('strategy', 'Product strategy & vision', /strategy|strategic|vision|north star|long-?term/),
  c('roadmap', 'Roadmapping & prioritization', /roadmaps?|prioritiz\w*|trade-?offs?/, 0.5),
  c('stakeholders', 'Cross-functional leadership', /cross-?functional|stakeholders?|alignment|influence without authority/, 0.5),
  c('launch', 'Shipping & launching', /shipp?\w*|launch\w*|deliver\w*|execution/, 0.5),
  c('zero_to_one', '0→1 building', /0 ?(to|→|-) ?1|zero to one|from scratch|new products?|greenfield|early-?stage/),
  c('scale', 'Scaling products', /at scale|scal(e|ing)|millions of|high-?growth/),
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
