// The salary pages: /salary and /salary/<n>-lakh, rendered at the edge and in the app. Run: node tests/salary-pages.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SALARY_CTCS, salarySlug, ctcFromSlug, ctcWords, metaFor, parsePath } from '../public/js/routes.js';
import { salaryPageModel, salaryPageHtml, salaryIndexHtml, salaryJsonLd } from '../public/engine/salary-page.js';
import { quickAnswer } from '../public/js/quick-engine.js';
import { salarySsr } from '../functions/_middleware.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rates = JSON.parse(readFileSync(path.join(here, '../public/data/tax_rates.json'), 'utf8'));
let failures = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`); if (!cond) failures++; };

// ---- addresses ----
ok('41 salary pages, ₹3 lakh to ₹2 crore', SALARY_CTCS.length === 41 && SALARY_CTCS[0] === 300000 && SALARY_CTCS.at(-1) === 20000000);
ok('every CTC round-trips through its slug', SALARY_CTCS.every((c) => ctcFromSlug(salarySlug(c)) === c));
ok('slugs read like searches', salarySlug(1800000) === '18-lakh' && salarySlug(10000000) === '1-crore' && salarySlug(15000000) === '1.5-crore');
ok('a figure that is not a page is not minted', ctcFromSlug('23.5-lakh') === null && ctcFromSlug('18') === null && ctcFromSlug('abc') === null);
ok('names: ₹18 lakh, ₹1.5 crore', ctcWords(1800000) === '₹18 lakh' && ctcWords(15000000) === '₹1.5 crore');
{
  const m = metaFor('/salary/18-lakh');
  ok('/salary/18-lakh has its own title and canonical', m.tab === 'salary' && m.ctc === 1800000 && m.url === 'https://taxcompass.org/salary/18-lakh' && /₹18 lakh salary in hand/.test(m.title), m.title);
  ok('an unknown salary canonicalises to the index', metaFor('/salary/23.5-lakh').url === 'https://taxcompass.org/salary' && !metaFor('/salary/23.5-lakh').ctc);
  ok('/salary is the index', metaFor('/salary').tab === 'salary' && parsePath('/salary/18-lakh').sub === '18-lakh');
}
{
  const sitemap = readFileSync(path.join(here, '../public/sitemap.xml'), 'utf8');
  ok('the sitemap lists the index and every salary page', sitemap.includes('<loc>https://taxcompass.org/salary</loc>') && SALARY_CTCS.every((c) => sitemap.includes(`<loc>https://taxcompass.org/salary/${salarySlug(c)}</loc>`)));
}

// ---- every page renders, with the quick answer's numbers ----
const bad = [];
for (const ctc of SALARY_CTCS) {
  const m = salaryPageModel(ctc, rates);
  const html = salaryPageHtml(m);
  const a = quickAnswer({ ctc }, rates);
  if (/NaN|undefined|null|Infinity/.test(html)) bad.push(`${ctc}: bad value in HTML`);
  if (!html.includes('id="salary-quick"')) bad.push(`${ctc}: no slot for the card`);
  if (Math.round(m.a.monthly.best) !== Math.round(a.monthly.best)) bad.push(`${ctc}: in-hand differs from the quick answer`);
  if ((html.match(/<h1>/g) || []).length !== 1) bad.push(`${ctc}: one h1`);
  const b = m.breakup;
  const gross = b.find((r) => r[0] === 'Gross pay')[1], inHand = b.find((r) => r[0] === 'In hand')[1];
  const deductions = b.filter((r) => r[1] < 0).reduce((s, r) => s + r[1], 0);
  if (Math.abs(gross + deductions - inHand) > 1) bad.push(`${ctc}: breakup does not add up`);
  const parts = b.filter((r) => ['Basic', 'HRA', 'Special allowance'].includes(r[0])).reduce((s, r) => s + r[1], 0);
  if (Math.abs(parts - gross) > 1) bad.push(`${ctc}: Basic + HRA + special is not the gross`);
  const ld = salaryJsonLd(m);
  if (ld['@type'] !== 'FAQPage' || ld.mainEntity.length < 3 || ld.mainEntity.some((q) => !q.name || !q.acceptedAnswer.text)) bad.push(`${ctc}: FAQ data`);
}
ok('all 41 pages render with sound, consistent figures', bad.length === 0, bad.slice(0, 3).join('; '));
{
  const m = salaryPageModel(1800000, rates);
  ok('18L: the answer leads with the monthly in-hand', /₹1,22,045 a month/.test(m.answer) && /new regime saves ₹1,59,900/.test(m.answer), m.answer);
  ok('18L: neighbours are linked', m.nearby.includes(1700000) && m.nearby.includes(1900000) && !m.nearby.includes(1800000));
  const t = salaryPageModel(1200000, rates);
  ok('12L: explains the rebate with the Act 2025 section', t.faq.some((f) => /section 156 of the Income-tax Act 2025, formerly 87A/.test(f.a) && /₹75,000 standard deduction/.test(f.a)));
  ok('3L: says there is no tax either way', /no income tax at ₹3 lakh in either regime/.test(salaryPageModel(300000, rates).answer));
  const idx = salaryIndexHtml(rates);
  ok('the index links every page', SALARY_CTCS.every((c) => idx.includes(`href="/salary/${salarySlug(c)}"`)) && !/NaN|undefined/.test(idx));
}

// ---- the edge render, against a stand-in for the Pages asset binding ----
{
  const env = { ASSETS: { fetch: async (u) => ({ ok: String(u).endsWith('/data/tax_rates.json'), json: async () => rates }) } };
  const url = new URL('https://taxcompass.org/salary/18-lakh');
  const page = await salarySsr(metaFor('/salary/18-lakh'), env, url);
  ok('edge: a salary page renders with its description and FAQ data', page && page.html.includes('<h1>₹18 lakh salary: ₹1,22,045 in hand a month</h1>') && /₹1,22,045 a month/.test(page.desc) && page.jsonLd['@type'] === 'FAQPage');
  const index = await salarySsr(metaFor('/salary'), env, url);
  ok('edge: the index renders, without FAQ data', index && index.html.includes('In-hand salary for every CTC') && index.jsonLd === null);
  ok('edge: other pages are left alone', (await salarySsr(metaFor('/tax'), env, url)) === null);
  ok('edge: no asset binding, no render (the page still works in the browser)', (await salarySsr(metaFor('/salary/18-lakh'), {}, url)) === null);
}

console.log(failures ? `\n${failures} failure(s)` : '\nAll salary page tests passed');
process.exit(failures ? 1 : 0);
