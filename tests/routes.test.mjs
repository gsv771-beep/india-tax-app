// Route table shared by the client router and the edge middleware. Run: node tests/routes.test.mjs
import { metaFor, parsePath, PAGES, CALCS } from '../public/js/routes.js';

let failures = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`); if (!cond) failures++; };

ok('root is the landing page', metaFor('/').tab === 'home' && /in-hand salary/i.test(metaFor('/').title) && /regime/i.test(metaFor('/').title) && metaFor('/').url === 'https://taxcompass.org/');
ok('index.html is the landing page too', metaFor('/index.html').tab === 'home');
ok('/tax is still the regime comparison', metaFor('/tax').tab === 'tax' && /regime/.test(metaFor('/tax').title));
ok('home-buying tool gets its own title', /True cost of buying/.test(metaFor('/calculators/home').title));
ok('home-buying description mentions the cities', /Mumbai/.test(metaFor('/calculators/home').desc));
ok('unknown calculator falls back to EMI', metaFor('/calculators/nonsense').url === 'https://taxcompass.org/calculators/emi');
ok('removed lumpsum route resolves to SIP', metaFor('/calculators/lumpsum').url === 'https://taxcompass.org/calculators/sip');
ok('removed advance-tax route resolves to tax', metaFor('/calculators/advance-tax').url === 'https://taxcompass.org/tax');
ok('retired insurance tool resolves to the money-tools index', metaFor('/calculators/insurance').url === 'https://taxcompass.org/calculators');
ok('schemes alias resolves to NPS', metaFor('/schemes').tab === 'nps');
ok('trailing slash ignored', metaFor('/nps/').url === 'https://taxcompass.org/nps');
ok('every title carries the site name', Object.keys(PAGES).filter((t) => t !== 'home').every((t) => /· TaxCompass India$/.test(metaFor('/' + t).title)) && /TaxCompass India/.test(metaFor('/').title) && Object.keys(CALCS).every((c) => /· TaxCompass India$/.test(metaFor('/calculators/' + c).title)));
ok('compare route has its title', /Where should this money go/.test(metaFor('/calculators/compare').title));
ok('parsePath splits tab and sub', JSON.stringify(parsePath('/calculators/sip')) === JSON.stringify({ tab: 'calculators', sub: 'sip' }));

// the page shell: two elements with one id means getElementById silently picks the first (a results
// fold once toggled the tax form's step 3 instead of itself)
{
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dups = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
  ok('index.html has no duplicate ids', dups.length === 0, dups.join(', '));
  // every page section must close where it opened: a stray closing tag once spilled the tax page's
  // working, email card and disclaimer onto every other page
  const stack = [], bad = [];
  for (const m of html.matchAll(/<(\/?)(div|section|details|main)\b[^>]*>/g)) {
    if (!m[1]) stack.push(m[2]); else if (stack.pop() !== m[2]) bad.push(`${m[0]} at offset ${m.index}`);
  }
  ok('index.html opens and closes every div, section and details in order', bad.length === 0 && stack.length === 0, bad.slice(0, 2).join('; ') || stack.join(','));
  for (const id of ['home', 'tax', 'calculators', 'nps', 'glossary', 'about']) {
    const open = html.indexOf(`<section id="${id}"`);
    const next = html.indexOf('<section id="', open + 1);
    const chunk = html.slice(open, next < 0 ? html.indexOf('</main>') : next);
    ok(`the ${id} page ends before the next page begins`, /<\/section>\s*(<!--[^>]*-->\s*)*$/.test(chunk.trimEnd()));
  }
}

console.log(failures === 0 ? '\nAll route tests passed.' : `\n${failures} route test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
