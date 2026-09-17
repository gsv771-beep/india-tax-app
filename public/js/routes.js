/**
 * The site's routes and their titles and descriptions. Shared by the client router (app.js) and the
 * edge middleware (functions/_middleware.js) that rewrites <title> and the Open Graph tags per path,
 * so links to /calculators/home unfurl as the home-buying tool, not as the tax page.
 * Pure data, no DOM.
 */
export const SITE = 'TaxCompass India';
export const ORIGIN = 'https://taxcompass.org';

export const PAGES = {
  tax: { title: 'Old vs new tax regime calculator', desc: 'Compare the old and new income tax regimes line by line for FY 2025-26 and FY 2026-27, see how far you are from the other regime winning, and what unused deductions would save.' },
  calculators: { title: 'Calculators', desc: 'In-hand salary, expenses and savings, EMI with step-up and prepayment, SIP with lump sums, home loan eligibility with the true cost of buying, capital gains and a goal planner, with historical mutual fund returns for context.' },
  nps: { title: 'NPS explained, with a corpus and pension projector', desc: 'How the National Pension System works, what your contributions could grow into, the lump sum and pension at 60, and its tax treatment in the old and new regimes.' },
  glossary: { title: 'Glossary of Indian tax and finance terms', desc: 'Plain-language definitions of about 150 Indian tax, mutual fund, loan and retirement terms.' },
  about: { title: 'About, sources and methodology', desc: 'How TaxCompass India computes its numbers, where the data comes from, how fresh it is, and what stays private.' },
};

export const CALCS = {
  salary: { title: 'In-hand salary calculator from CTC', desc: 'Split a CTC into basic, HRA, allowances, PF and gratuity, then take off PF, professional tax and income tax under the lower regime to get the monthly take-home.' },
  budget: { title: 'Expenses and savings calculator', desc: 'Monthly take-home, expenses by category, SIPs and deposits, and what is left, with an emailed Excel workbook.' },
  emi: { title: 'EMI calculator with step-up and prepayment', desc: 'EMI, total interest and a year-by-year schedule, with step-up EMIs, lump-sum and yearly prepayments, and the loan worked out from price and down payment.' },
  sip: { title: 'SIP calculator with step-up and lump sums', desc: 'What a monthly SIP grows into, with yearly step-ups and lump sums added today or at the end of any year, against what fund categories have historically delivered.' },
  home: { title: 'True cost of buying a home, and how to fund it', desc: 'Stamp duty, registration, GST and builder charges in Mumbai, Delhi, Bengaluru, Hyderabad, Chennai, Kolkata and Pune, then the loan, down payment, EMI and the stage-by-stage payment plan with pre-EMI interest.' },
  'capital-gains': { title: 'Capital gains tax calculator', desc: 'Tax on selling listed equity, equity and debt funds, property and other assets, with the ₹1.25 lakh exemption, grandfathering and the 12.5% or 20%-with-indexation choice for property.' },
  compare: { title: 'Where should this money go? PPF, FD, funds and NPS compared after tax', desc: 'The same rupee in every common instrument, after tax, over your horizon and at your slab: what you keep, the after-tax return and the pre-tax equivalent. Answers whether PPF is worth it under the new regime, FD versus debt fund, and where to park money for six months.' },
  retirement: { title: 'Retirement planner: will the money last?', desc: 'Your age, when you want to retire, what you spend, what you have saved and what you add each month: will the money last, and how much more a month closes the gap. Plain assumptions you can change.' },
  goal: { title: 'Goal planner', desc: 'The monthly SIP or one-time investment that reaches a target in N years, and what that target is worth in today’s money.' },
};

export const ALIASES = { schemes: 'nps' };
/** Removed pages and where they went; public/_redirects carries the same map for the edge. */
export const REMOVED = { '/calculators/lumpsum': '/calculators/sip', '/calculators/advance-tax': '/tax' };

export function parsePath(pathname) {
  const parts = String(pathname || '/').replace(/\/+$/, '').split('/').filter(Boolean);
  const first = ALIASES[parts[0]] || parts[0];
  const tab = PAGES[first] ? first : 'tax';
  return { tab, sub: parts[1] || null };
}

/** Title, description and canonical URL for a path. */
export function metaFor(pathname) {
  const clean = String(pathname || '/').replace(/\/+$/, '') || '/tax';
  const target = REMOVED[clean] || (clean === '/' || clean === '/index.html' ? '/tax' : clean);
  const { tab, sub } = parsePath(target);
  const page = tab === 'calculators' && CALCS[sub] ? CALCS[sub] : PAGES[tab];
  const path = tab === 'calculators' ? `/calculators/${CALCS[sub] ? sub : 'emi'}` : `/${tab}`;
  return { title: `${page.title} · ${SITE}`, desc: page.desc, url: ORIGIN + path, tab, sub };
}
