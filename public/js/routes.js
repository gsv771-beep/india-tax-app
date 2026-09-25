/**
 * The site's routes and their titles and descriptions. Shared by the client router (app.js) and the
 * edge middleware (functions/_middleware.js) that rewrites <title> and the Open Graph tags per path,
 * so links to /calculators/home unfurl as the home-buying tool, not as the tax page.
 * Pure data, no DOM.
 */
export const SITE = 'TaxCompass India';
export const ORIGIN = 'https://taxcompass.org';

export const PAGES = {
  home: { title: 'TaxCompass India: in-hand salary and old vs new tax regime from your CTC', desc: 'Type your CTC and see your monthly in-hand salary and whether the old or new tax regime saves you more, for FY 2026-27. Tick your rent, home loan and 80C to see if the old regime can still win. Free, and nothing you type leaves your browser.' },
  tax: { title: 'Old vs new tax regime calculator', desc: 'Compare the old and new income tax regimes line by line for FY 2025-26 and FY 2026-27, see how far you are from the other regime winning, and what unused deductions would save.' },
  calculators: { title: 'Money tools: tax, salary, loans, investing and goals', desc: 'Practical calculators for salary, expenses, EMI, SIP, home buying, capital gains, debt, retirement and goals, connected by one private profile in your browser.' },
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
  debt: { title: 'Which loan to clear first, and what it really costs', desc: 'Credit cards and loans in one place: the order that clears them fastest, the real annual cost of each, the months and interest it saves, and whether the next spare rupee should prepay a loan or be invested.' },
  goal: { title: 'Goal planner', desc: 'A child’s education or wedding, a house, a car: what it costs today, what it will cost when it arrives, and the SIP that gets there at the equity share you choose.' },
};

export const ALIASES = { schemes: 'nps', decide: 'calculators', decisions: 'calculators' };
/** Removed pages and where they went; public/_redirects carries the same map for the edge. */
export const REMOVED = { '/calculators/lumpsum': '/calculators/sip', '/calculators/advance-tax': '/tax', '/calculators/insurance': '/calculators' };

export function parsePath(pathname) {
  const parts = String(pathname || '/').replace(/\/+$/, '').split('/').filter(Boolean);
  const first = ALIASES[parts[0]] || parts[0];
  const tab = !parts.length || first === 'index.html' ? 'home' : PAGES[first] ? first : 'tax';
  return { tab, sub: parts[1] || null };
}

/** Title, description and canonical URL for a path. */
export function metaFor(pathname) {
  const clean = String(pathname || '/').replace(/\/+$/, '') || '/';
  const target = REMOVED[clean] || (clean === '/index.html' ? '/' : clean);
  const { tab, sub } = parsePath(target);
  const page = tab === 'calculators' && CALCS[sub] ? CALCS[sub] : PAGES[tab];
  const path = tab === 'home' ? '/' : tab === 'calculators' ? (CALCS[sub] ? `/calculators/${sub}` : sub ? '/calculators/emi' : '/calculators') : `/${tab}`;
  return { title: tab === 'home' ? page.title : `${page.title} · ${SITE}`, desc: page.desc, url: ORIGIN + path, tab, sub };
}
