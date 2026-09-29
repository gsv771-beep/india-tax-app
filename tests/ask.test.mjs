// Ask TaxCompass: questions in, a definition or the right tool out. Run: node tests/ask.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ask, parseAmount, findTerm } from '../public/engine/ask.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const glossary = JSON.parse(readFileSync(path.join(here, '../public/data/glossary.json'), 'utf8'));
let failures = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`); if (!cond) failures++; };
const A = (q) => ask(q, { glossary });
const primary = (r) => (r.links.find((l) => l.primary) || r.links[0] || {}).href;

// ---- amounts, as people write them ----
const amounts = [
  ['my ctc is 25 lakh', 2500000], ['25L ctc', 2500000], ['18 LPA', 1800000], ['1.5 cr package', 15000000], ['₹25,00,000', 2500000],
  ['salary 80k per month', 80000], ['2500000', 2500000], ['12.5 lakhs', 1250000], ['1 crore', 10000000], ['in 2024 i earned', null],
];
for (const [q, want] of amounts) { const got = parseAmount(q); ok(`amount: "${q}"`, want === null ? got === null : got && got.amount === want, JSON.stringify(got)); }
ok('amount: "80k per month" is monthly', parseAmount('salary 80k per month').monthly === true);
ok('amount: "25 lakh ctc" is not monthly', parseAmount('25 lakh ctc').monthly === false);

// ---- the owner's example, and its variants: point to the calculator with the CTC filled in ----
for (const q of ['My CTC is 25 lakh, which is best for me old or new scheme?', 'old vs new regime for 25 LPA', 'which tax regime is better for 25 lakh', 'new or old tax regime 25L', 'old regime or new regime']) {
  const r = A(q);
  ok(`regime: "${q}" -> tax calculator`, r.kind === 'tool' && r.intent === 'regime' && /^\/tax/.test(primary(r)), `${r.kind}/${r.intent} ${primary(r)}`);
}
{
  const r = A('My CTC is 25 lakh, which is best for me old or new scheme?');
  ok('regime at 25L: the calculator opens with 25 lakh filled in', primary(r) === '/tax?ctc=2500000', primary(r));
  ok('regime at 25L: links the ₹25 lakh salary page', r.links.some((l) => l.href === '/salary/25-lakh'));
  ok('regime: it does not name a winner itself', !/new regime wins for you|old regime wins for you/i.test(r.text));
  const m = A('my salary is 1.5 lakh per month, old or new regime');
  ok('regime from a monthly salary: yearly figure filled in, and it says so', primary(m) === '/tax?ctc=1800000' && /₹1.5 lakh a month as about ₹18 lakh a year/.test(m.text), primary(m) + ' | ' + m.text);
}

// ---- tools ----
const tools = [
  ['in hand salary for 18 LPA', '/calculators/salary?ctc=1800000'], ['what is my take home on 30 lakh ctc', '/calculators/salary?ctc=3000000'],
  ['how much tax on 15 lakh salary', '/tax?ctc=1500000'], ['EMI on a 50 lakh home loan', '/calculators/emi'], ['car loan emi', '/calculators/emi'],
  ['tax on selling shares', '/calculators/capital-gains'], ['I sold my flat, how much capital gains tax', '/calculators/capital-gains'], ['ltcg on mutual funds', '/calculators/capital-gains'],
  ['stamp duty in mumbai', '/calculators/home'], ['cost of buying a flat in pune', '/calculators/home'], ['how much will my sip of 10000 grow', '/calculators/sip'],
  ['will my money last in retirement', '/calculators/retirement'], ['saving for child education', '/calculators/goal'], ['track my monthly expenses', '/calculators/budget'],
  ['which loan should i clear first', '/calculators/debt'], ['credit card debt', '/calculators/debt'], ['ppf or fd which is better', '/calculators/compare'],
  ['where should i park money for 6 months', '/calculators/compare'], ['nps tax benefit', '/nps'], ['when is the itr filing deadline', 'https://www.incometax.gov.in/'],
];
for (const [q, want] of tools) { const r = A(q); ok(`tool: "${q}"`, primary(r) === want, `${r.kind}/${r.intent || r.term || ''} -> ${primary(r)}`); }

// ---- definitions from the glossary ----
const defs = [
  ['What is HRA?', 'HRA'], ['what is 80c', 'Section 80C'], ['meaning of ELSS', 'ELSS'], ['explain LTCG', 'Long-Term Capital Gain (LTCG)'], ['define expense ratio', 'Expense Ratio'],
  ['what is xirr', 'XIRR'], ['whats a demat account', 'Demat Account'], ['what is nps tier 1', 'NPS'], ['what does AY mean', 'Assessment Year (AY)'], ['87A rebate', 'Rebate under Section 87A / 156'],
  ['sovereign gold bond', 'Sovereign Gold Bond'], ['what is standard deduction', 'Standard Deduction'], ['direct plan vs regular plan meaning', 'Direct Plan'],
];
for (const [q, want] of defs) { const r = A(q); ok(`define: "${q}" -> ${want}`, r.kind === 'define' && r.term === want, `${r.kind} ${r.term || ''}`); }
{
  const r = A('What is HRA?');
  ok('HRA definition points to the tax calculator and the glossary', primary(r) === '/tax' && r.links.some((l) => l.href.startsWith('/glossary?q=')));
  ok('a definition is the glossary text itself', r.text === glossary.terms.find((t) => t.term === 'HRA').def);
}
ok('term matching prefers the longer name', findTerm('what is nps tier ii', glossary)?.term === 'NPS Tier II');
ok('short names match whole words only ("pan" is not in "company")', findTerm('my company pays well', glossary) === null);

// ---- a salary and nothing else asked: in-hand pay and the regime, with the figure filled in ----
const salaries = [
  ['Ctc is 70 lakh', '/tax?ctc=7000000'], ['CTC 70L', '/tax?ctc=7000000'], ['my salary is 1.2 crore', '/tax?ctc=12000000'], ['package 30 lpa', '/tax?ctc=3000000'],
  ['I earn 40 lakh', '/tax?ctc=4000000'], ['offered 45 LPA', '/tax?ctc=4500000'], ['got a hike to 32 lakh', '/tax?ctc=3200000'], ['income 12 lakh', '/tax?ctc=1200000'], ['salary', '/tax'],
];
for (const [q, want] of salaries) { const r = A(q); ok(`salary: "${q}"`, r.kind === 'tool' && primary(r) === want, `${r.kind}/${r.intent || r.term || ''} -> ${primary(r)}`); }
{
  const r = A('Ctc is 70 lakh');
  ok('70L: links the ₹70 lakh salary page and names both answers', r.links.some((l) => l.href === '/salary/70-lakh') && /in hand/.test(r.text) && /regime/.test(r.text), r.text);
  const bare = A('70 lakh');
  ok('an amount alone leads with salary and offers loan and home', bare.kind === 'tool' && primary(bare) === '/tax?ctc=7000000' && bare.links.some((l) => l.href === '/calculators/emi') && bare.links.some((l) => l.href === '/calculators/home'), bare.links.map((l) => l.href).join(' '));
  ok('a monthly amount alone is filled in as a year', primary(A('1.5 lakh per month')) === '/tax?ctc=1800000');
  ok('"what is ctc" is a definition', A('what is ctc').kind === 'define' && A('what is ctc').term === 'CTC (Cost to Company)');
  ok('a question with an amount and a tool gets the tool, even worded "what is"', primary(A('what is my take home on 30 lakh ctc')) === '/calculators/salary?ctc=3000000');
  ok('other income is not a salary', A('other income 50000').intent !== 'salary');
  ok('salary words do not unlock fund picks', A('which mutual fund is best, my salary is 20 lakh').kind === 'advice');
}

// ---- the advice line ----
for (const q of ['which mutual fund should i buy', 'best stocks to buy now', 'should i buy reliance', 'suggest a good elss fund to invest', 'stock tips']) {
  const r = A(q); ok(`advice declined: "${q}"`, r.kind === 'advice' && /does not recommend/.test(r.text), r.kind);
}
ok('"old or new scheme" is about tax, not advice', A('which scheme is better old or new').kind === 'tool');

// ---- the rest ----
ok('greeting', A('hi').kind === 'greeting');
ok('empty', A('   ').kind === 'unknown');
ok('nonsense gets the help text and links', A('asdf qwerty').kind === 'unknown' && A('asdf qwerty').links.length > 0);
ok('every link is a site path or the e-filing portal', [...amounts, ...tools, ...defs, ...salaries].every(([q]) => A(q).links.every((l) => l.href.startsWith('/') || l.href === 'https://www.incometax.gov.in/')));

console.log(failures ? `\n${failures} failure(s)` : '\nAll ask tests passed');
process.exit(failures ? 1 : 0);
