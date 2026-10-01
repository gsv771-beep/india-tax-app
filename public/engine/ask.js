/**
 * "Ask TaxCompass": a question in, a short answer and the right tool out. It explains terms from the
 * glossary and sends people to the calculator that answers their question, with any amount they
 * mentioned filled in. It never calculates or advises; the calculators do the arithmetic. Pure, runs
 * in the browser: nothing typed here is sent anywhere.
 *
 *   ask(question, { glossary }) -> { kind, text, term?, links: [{ href, label, primary? }] }
 *   kind: 'tool' | 'define' | 'advice' | 'greeting' | 'unknown'
 */
import { SALARY_CTCS, salarySlug, ctcWords } from '../js/routes.js';

const inWords = (n) => (n >= 10000000 ? `₹${+(n / 10000000).toFixed(2)} crore` : n >= 100000 ? `₹${+(n / 100000).toFixed(2)} lakh` : `₹${Math.round(n).toLocaleString('en-IN')}`);

/** The first amount in a question: "25 lakh", "25L", "25 LPA", "1.5 cr", "₹25,00,000", "80k a month". */
export function parseAmount(text) {
  const s = String(text || '').toLowerCase().replace(/₹|rs\.?|inr/g, ' ').replace(/(\d),(?=\d)/g, '$1');
  const unit = [
    [/(\d+(?:\.\d+)?)\s*(?:crores?|cr)\b/, 1e7],
    [/(\d+(?:\.\d+)?)\s*(?:lakhs?|lacs?|lpa|l)\b/, 1e5],
    [/(\d+(?:\.\d+)?)\s*(?:k|thousand)\b/, 1e3],
  ];
  let amount = null, at = -1;
  for (const [re, mult] of unit) {
    const m = re.exec(s);
    if (m && (at < 0 || m.index < at)) { amount = Math.round(+m[1] * mult); at = m.index; }
  }
  if (amount == null) {
    const m = /\b(\d{4,9})\b/.exec(s);
    if (m && !/^(19|20)\d\d$/.test(m[1])) { amount = +m[1]; at = m.index; }   // a bare year is not an amount
  }
  if (amount == null || !(amount > 0)) return null;
  const monthly = /(per|a|every|each|\/)\s*(month|mon|mo)\b|monthly|\bpm\b|\bp\.m\b/.test(s);
  return { amount, monthly };
}

// ---- the tools, and the questions that lead to each ----
const has = (q, ...res) => res.some((re) => re.test(q));
const INTENTS = [
  {
    id: 'regime',
    test: (q) => has(q, /\bregimes?\b/, /\bold\s*(or|vs\.?|versus)\s*new\b/, /\bnew\s*(or|vs\.?|versus)\s*old\b/, /\b(old|new)\s+(tax\s+)?(scheme|system|slab)s?\b/, /which\s+(tax\s+)?(scheme|system)\b/, /\b115bac\b/),
    reply: (a) => `Which regime is better depends on your deductions: rent (HRA), home-loan interest, 80C, NPS and health insurance. For most salaries with few deductions the new regime wins.${a ? ` Open the calculator with ${inWords(a)} filled in and tick what you have.` : ' Type your CTC in the calculator and tick what you have.'}`,
    links: (a) => salaryLinks(a, '/tax', 'Old vs new regime'),
  },
  {
    id: 'inhand',
    test: (q) => has(q, /in[\s-]?hand/, /take[\s-]?home/, /net\s+salary/, /salary\s+after\s+tax/, /\bctc\b.*\b(month|monthly)\b/, /how much.*\b(get|receive|credited)\b/, /\bsalary\b.*\bmonth\b/),
    reply: (a) => `The in-hand salary calculator splits a CTC into Basic, HRA, PF and tax and shows what reaches your bank each month.${a ? ` It opens with ${inWords(a)} filled in.` : ''}`,
    links: (a) => salaryLinks(a, '/calculators/salary', 'In-hand salary calculator'),
  },
  {
    id: 'tax-on-salary',
    test: (q) => has(q, /how much (income\s+)?tax/, /\btax\b.*\b(on|for)\b.*\b(salary|ctc|income|lakh|lpa|crore)/, /\b(income|salary)\s+tax\b/, /\btax\s+(liability|payable|calculat)/),
    reply: (a) => `The tax calculator works out your tax in both regimes, line by line.${a ? ` It opens with ${inWords(a)} filled in.` : ''}`,
    links: (a) => salaryLinks(a, '/tax', 'Tax calculator'),
  },
  {
    id: 'offer',
    test: (q) => has(q, /\b(job\s+)?offers?\b.*\b(compare|vs|versus|or|better|which|choose|accept)\b/, /\b(compare|which|better)\b.*\boffers?\b/, /\b(accept|take|join)\b.*\boffers?\b/, /\b(switch(ing)?|change)\s+(job|company|companies)\b/, /\bjoining\s+bonus\b/, /\bcounter[\s-]?offer\b/),
    reply: () => 'The offer comparison puts two offers (or your current job and an offer) side by side: what each puts in the bank every month and over two years, with variable pay at what you expect it to pay and the joining bonus taxed.',
    links: () => [{ href: '/calculators/offer', label: 'Compare two offers', primary: true }, { href: '/calculators/salary', label: 'One CTC split in full' }],
  },
  {
    id: 'capital-gains',
    test: (q) => has(q, /capital\s+gains?/, /\b(ltcg|stcg)\b/, /\bsell(ing)?\b.*\b(shares?|stocks?|funds?|mutual|property|house|flat|land|gold)\b/, /\bsold\b/, /\bindexation\b/, /grandfather/),
    reply: () => 'The capital gains calculator works out the tax on selling shares, mutual funds, property or gold: short or long term, the ₹1.25 lakh exemption, and grandfathering for shares bought before February 2018.',
    links: () => [{ href: '/calculators/capital-gains', label: 'Capital gains calculator', primary: true }],
  },
  {
    id: 'home',
    test: (q) => has(q, /stamp\s+duty/, /registration\s+(fee|charge)/, /\bbuy(ing)?\b.*\b(house|home|flat|apartment|property)\b/, /\b(house|home|flat|property)\b.*\b(cost|price|afford|buy)/, /builder/, /down\s*payment/),
    reply: () => 'The home-buying tool adds stamp duty, registration, GST and builder charges to the price for your city, then works out the loan, down payment and EMI.',
    links: () => [{ href: '/calculators/home', label: 'True cost of buying a home', primary: true }, { href: '/calculators/emi', label: 'EMI calculator' }],
  },
  {
    id: 'debt',
    test: (q) => has(q, /credit\s*card/, /which\s+loan.*(first|clear|close)/, /\b(clear|pay\s*off|close)\b.*\b(loans?|debts?)\b/, /\bdebts?\b/, /prepay.*or.*invest/, /invest.*or.*prepay/),
    reply: () => 'The debt planner puts your loans and cards in one place: the order that clears them fastest, what each really costs, and whether a spare rupee should prepay or be invested.',
    links: () => [{ href: '/calculators/debt', label: 'Which loan to clear first', primary: true }],
  },
  {
    id: 'emi',
    test: (q) => has(q, /\bemi\b/, /home\s+loan/, /car\s+loan/, /personal\s+loan/, /\bloan\b/, /prepay/, /\binterest\s+rate\b/),
    reply: (a) => `The EMI calculator works out the EMI, total interest and a year-by-year schedule, with step-ups and prepayments.${a ? ` Enter ${inWords(a)} as the loan amount.` : ''}`,
    links: () => [{ href: '/calculators/emi', label: 'EMI calculator', primary: true }, { href: '/calculators/debt', label: 'Which loan to clear first' }],
  },
  {
    id: 'nps',
    test: (q) => has(q, /\bnps\b/, /national\s+pension/, /80ccd/, /\bannuity\b/, /\btier\s*(1|i|2|ii)\b/),
    reply: () => 'The NPS page explains how the National Pension System works, projects the corpus and pension at 60, and shows its tax treatment in both regimes.',
    links: () => [{ href: '/nps', label: 'NPS explained, with a projector', primary: true }],
  },
  {
    id: 'retirement',
    test: (q) => has(q, /retire/, /\bcorpus\b/, /\bpension\b/, /\bfire\b/, /money\s+last/),
    reply: () => 'The retirement planner checks whether your savings last through retirement, and how much more a month closes the gap.',
    links: () => [{ href: '/calculators/retirement', label: 'Retirement planner', primary: true }, { href: '/nps', label: 'NPS' }],
  },
  {
    id: 'goal',
    test: (q) => has(q, /\bgoal\b/, /child.*(education|college|study)/, /\b(wedding|marriage)\b/, /\bsave\b.*\bfor\b.*\b(car|house|trip|education|wedding)/),
    reply: () => 'The goal planner works out what a goal will cost when it arrives and the monthly SIP that gets you there.',
    links: () => [{ href: '/calculators/goal', label: 'Goal planner', primary: true }],
  },
  {
    id: 'compare',
    test: (q) => has(q, /\bppf\b.*\b(or|vs|versus)\b/, /\b(fd|fixed\s+deposit)\b.*\b(or|vs|versus)\b/, /where\s+(should|to|can)\s+i?\s*(invest|put|park)/, /\bpark\b.*\bmoney\b/, /after[\s-]tax\s+return/, /better\s+(investment|return)/),
    reply: () => 'The comparison puts the same money in PPF, FDs, debt and equity funds, gold and NPS side by side, after tax at your slab and over your horizon. It compares categories; it does not pick funds.',
    links: () => [{ href: '/calculators/compare', label: 'Compare investments after tax', primary: true }],
  },
  {
    id: 'sip',
    test: (q) => has(q, /\bsip\b/, /\bmutual\s+funds?\b.*\b(grow|return|worth)/, /\b(grow|become)\b.*\b(invest|sip|month)/, /\blump\s*sum\b/, /\bcompound/),
    reply: (a) => `The SIP calculator shows what a monthly investment grows into, with yearly step-ups and lump sums.${a ? ` Enter ${inWords(a)} as the amount.` : ''}`,
    links: () => [{ href: '/calculators/sip', label: 'SIP calculator', primary: true }],
  },
  {
    id: 'budget',
    test: (q) => has(q, /\bexpenses?\b/, /\bbudget\b/, /\bsavings?\s+rate\b/, /how\s+much.*\bsave\b/, /where.*money\s+go/),
    reply: () => 'The savings calculator takes your take-home pay, your expenses by category and your SIPs, and shows what is left each month.',
    links: () => [{ href: '/calculators/budget', label: 'Savings calculator', primary: true }],
  },
  {
    id: 'filing',
    test: (q) => has(q, /\bitr\b/, /\bfile\b.*\breturn/, /\bfiling\b/, /\bdeadline\b/, /due\s+date/, /\brefund\b/),
    reply: () => 'TaxCompass does not file returns. You file on the Income Tax Department’s e-filing portal, or through a chartered accountant. The calculator here helps you check the figures first.',
    links: () => [{ href: 'https://www.incometax.gov.in/', label: 'Income Tax e-filing portal', primary: true, external: true }, { href: '/tax', label: 'Check your tax first' }],
  },
  {
    // last: a salary named with nothing else asked ("CTC is 70 lakh", "offered 45 LPA") gets both answers
    id: 'salary',
    test: (q) => has(q, /\bctc\b/, /\bsalar(y|ies)\b/, /\bpackage\b/, /\d\s*lpa\b|\blpa\b/, /\bearn(s|ing|ings)?\b/, /(?<!other\s)\bincome\b/, /\b(offer|offered|hike|appraisal)\b/, /\bpaid\b/),
    reply: (a) => `The calculator shows ${a ? `what ${inWords(a)} pays` : 'what your CTC pays'} in hand each month and which tax regime saves you more, as you type.${a ? ` It opens with ${inWords(a)} filled in.` : ' Type your CTC to start.'}`,
    links: (a) => salaryLinks(a, '/tax', 'In-hand pay and old vs new regime'),
  },
];

// deduction and allowance words lead to the tax calculator after the definition
const DEDUCTION = /\b(80c|80d|80ccd|80tta|80ttb|24\s*\(?b\)?|hra|lta|deductions?|exemptions?|standard\s+deduction|elss|ppf)\b/;

function salaryLinks(amount, tool, label) {
  const links = [];
  const href = amount ? `${tool}?ctc=${amount}` : tool;
  links.push({ href, label: amount ? `${label}, with ${inWords(amount)} filled in` : label, primary: true });
  if (amount && SALARY_CTCS.includes(amount)) links.push({ href: `/salary/${salarySlug(amount)}`, label: `What a ${ctcWords(amount)} salary pays in hand` });
  else links.push({ href: '/salary', label: 'In-hand pay at common salaries' });
  return links;
}

// ---- the glossary: names and the short forms people type ----
function aliasesFor(term) {
  const t = term.toLowerCase();
  const out = new Set([t]);
  for (const part of t.split(/\s*\/\s*|\s*\(\s*|\s*\)\s*/)) if (part.trim()) out.add(part.trim());
  for (const a of [...out]) {
    const m = /^section\s+(.+)$/.exec(a); if (m) out.add(m[1]);                 // "section 80c" -> "80c"
    const r = /under section\s+(.+)$/.exec(a); if (r) out.add(r[1]);            // "rebate under section 87a" -> "87a"
  }
  return [...out].filter((a) => a.length >= 2);
}
const glossaryIndex = new WeakMap();
function indexOf(glossary) {
  if (!glossary || !glossary.terms) return [];
  if (!glossaryIndex.has(glossary)) glossaryIndex.set(glossary, glossary.terms.map((t) => ({ t, aliases: aliasesFor(t.term) })));
  return glossaryIndex.get(glossary);
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * The glossary entry the question names: the one mentioned first ("direct plan vs regular plan" is
 * about Direct Plan), and of two starting at the same place the longer ("NPS Tier II" over "NPS").
 */
export function findTerm(question, glossary) {
  const q = ` ${String(question || '').toLowerCase().replace(/[?!.,;:]/g, ' ').replace(/\s+/g, ' ')} `;
  let best = null, bestAt = Infinity, bestLen = 0;
  for (const { t, aliases } of indexOf(glossary)) {
    for (const a of aliases) {
      const m = new RegExp(`(^|[^a-z0-9])${escapeRe(a)}([^a-z0-9]|$)`).exec(q);
      if (!m) continue;
      const at = m.index + m[1].length;
      if (at < bestAt || (at === bestAt && a.length > bestLen)) { best = t; bestAt = at; bestLen = a.length; }
    }
  }
  return best;
}

const TOOL_FOR_CATEGORY = {
  'tax-basics': ['/tax', 'Tax calculator'], 'tax-computation': ['/tax', 'Tax calculator'], deductions: ['/tax', 'Tax calculator'], compliance: ['/tax', 'Tax calculator'],
  'capital-gains': ['/calculators/capital-gains', 'Capital gains calculator'], 'mutual-funds': ['/calculators/sip', 'SIP calculator'], equity: ['/calculators/compare', 'Compare investments after tax'],
  retirement: ['/calculators/retirement', 'Retirement planner'], 'debt-and-banking': ['/calculators/emi', 'EMI calculator'], 'real-estate': ['/calculators/home', 'True cost of buying a home'],
  'general-finance': ['/calculators', 'All money tools'], insurance: ['/calculators', 'All money tools'],
};

const ASKS_DEFINITION = /\b(what\s+(is|are|does|do)|what's|whats|define|definition|meaning|means|mean\b|explain|full\s+form|stands?\s+for|tell\s+me\s+about)\b/;
// asking which product to buy crosses from education into advice, which this site does not give
const ASKS_ADVICE = /\b(which|what|best|good|top|recommend|suggest)\b.*\b(stocks?|shares?|mutual\s+funds?|funds?|smallcase|ipo|crypto|elss\s+fund)\b.*\b(buy|invest|choose|pick|best|good|top|now)\b|\b(best|top|good)\s+(stocks?|shares?|mutual\s+funds?|funds?|sip)\b|\bshould\s+i\s+(buy|sell|invest)\b|\bstock\s+tips?\b/;
const GREETING = /^\s*(hi+|hello|hey|namaste|good\s+(morning|evening|afternoon)|thanks?|thank\s+you)\b[\s!.]*$/;

export const SUGGESTIONS = ['My CTC is 25 lakh. Old or new regime?', 'What is HRA?', 'In-hand salary for 18 LPA', 'EMI on a 50 lakh home loan', 'Tax on selling shares', 'What is ELSS?'];

export function ask(question, { glossary } = {}) {
  const raw = String(question || '').trim();
  const q = raw.toLowerCase().replace(/\s+/g, ' ');
  if (!q) return { kind: 'unknown', text: 'Type a question, or pick one below.', links: [] };
  if (GREETING.test(q)) return { kind: 'greeting', text: 'Hello. Ask me what a tax or money term means, or which calculator answers your question.', links: [] };

  const amt = parseAmount(q);
  // a monthly figure becomes a yearly CTC for the salary and tax tools
  const yearly = amt ? (amt.monthly ? amt.amount * 12 : amt.amount) : null;
  const monthlyNote = amt && amt.monthly ? ` I have taken ${inWords(amt.amount)} a month as about ${inWords(yearly)} a year.` : '';

  const intent = INTENTS.find((i) => i.test(q));
  // the tax tools only make sense for a salary-sized figure; a loan or SIP amount is passed through as said
  const salaryish = intent && ['regime', 'inhand', 'tax-on-salary', 'salary'].includes(intent.id);
  const amountFor = salaryish ? (yearly >= 100000 && yearly <= 1e9 ? yearly : null) : amt ? amt.amount : null;

  if (ASKS_ADVICE.test(q) && !(intent && ['regime', 'tax-on-salary', 'inhand'].includes(intent.id))) {
    return {
      kind: 'advice',
      text: 'TaxCompass does not recommend specific stocks or funds; that needs a SEBI-registered adviser. What it can do is show how each kind of investment is taxed and what it returns after tax, over your horizon.',
      links: [{ href: '/calculators/compare', label: 'Compare investments after tax', primary: true }, { href: '/glossary', label: 'Glossary of investment terms' }],
    };
  }

  const term = findTerm(q, glossary);
  const wantsDefinition = ASKS_DEFINITION.test(q) || (term && q.replace(/[?!.]/g, '').trim().length <= term.term.length + 4);
  // "what is my take-home on 30 lakh" asks for a figure, not a definition: with an amount and a tool, the tool wins
  if (term && ((wantsDefinition && !(amt && intent)) || !intent)) {
    const [href, label] = DEDUCTION.test(q) ? ['/tax', 'Tax calculator'] : intent ? [intent.links(amountFor)[0].href, intent.links(amountFor)[0].label] : TOOL_FOR_CATEGORY[term.cat] || ['/calculators', 'All money tools'];
    return {
      kind: 'define', term: term.term, text: term.def,
      links: [{ href, label, primary: true }, { href: `/glossary?q=${encodeURIComponent(term.term)}`, label: 'More in the glossary' }],
    };
  }
  if (intent) return { kind: 'tool', intent: intent.id, text: intent.reply(amountFor) + (salaryish ? monthlyNote : ''), links: intent.links(amountFor) };

  // an amount and nothing else ("70 lakh"): most people mean a salary, so lead with that, and offer the rest
  if (amt && !term && q.replace(/[^a-z]+/g, ' ').replace(/\b(rs|inr|crores?|cr|lakhs?|lacs?|l|k|thousand|rupees?|per|a|month|monthly|pm|is|my|of|about|around)\b/g, '').trim() === '') {
    const ctc = yearly >= 100000 && yearly <= 1e9 ? yearly : null;
    return {
      kind: 'tool', intent: 'amount',
      text: `If ${inWords(amt.amount)}${amt.monthly ? ' a month' : ''} is your salary, the calculator shows your in-hand pay and which tax regime saves more.${ctc ? ` It opens with ${inWords(ctc)} a year filled in.` : ''} If it is a loan or a home’s price, the other two answer that.`,
      links: [
        ...(ctc ? salaryLinks(ctc, '/tax', 'In-hand pay and old vs new regime').slice(0, 1) : [{ href: '/tax', label: 'In-hand pay and old vs new regime', primary: true }]),
        { href: '/calculators/emi', label: 'EMI on a loan' },
        { href: '/calculators/home', label: 'True cost of buying a home' },
      ],
    };
  }

  return {
    kind: 'unknown',
    text: 'I did not catch that. I can explain a tax or money term (try “What is 80C?”) or point you to the calculator that answers your question (try “EMI on a 40 lakh loan”).',
    links: [{ href: '/calculators', label: 'All money tools', primary: true }, { href: '/glossary', label: 'Glossary' }],
  };
}
