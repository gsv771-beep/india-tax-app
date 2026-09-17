// Route table shared by the client router and the edge middleware. Run: node tests/routes.test.mjs
import { metaFor, parsePath, PAGES, CALCS } from '../public/js/routes.js';

let failures = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`); if (!cond) failures++; };

ok('root resolves to the tax page', metaFor('/').tab === 'tax' && /regime/.test(metaFor('/').title));
ok('index.html resolves to the tax page', metaFor('/index.html').url === 'https://taxcompass.org/tax');
ok('home-buying tool gets its own title', /True cost of buying/.test(metaFor('/calculators/home').title));
ok('home-buying description mentions the cities', /Mumbai/.test(metaFor('/calculators/home').desc));
ok('unknown calculator falls back to EMI', metaFor('/calculators/nonsense').url === 'https://taxcompass.org/calculators/emi');
ok('removed lumpsum route resolves to SIP', metaFor('/calculators/lumpsum').url === 'https://taxcompass.org/calculators/sip');
ok('removed advance-tax route resolves to tax', metaFor('/calculators/advance-tax').url === 'https://taxcompass.org/tax');
ok('schemes alias resolves to NPS', metaFor('/schemes').tab === 'nps');
ok('trailing slash ignored', metaFor('/nps/').url === 'https://taxcompass.org/nps');
ok('every title carries the site name', Object.keys(PAGES).every((t) => /· TaxCompass India$/.test(metaFor('/' + t).title)) && Object.keys(CALCS).every((c) => /· TaxCompass India$/.test(metaFor('/calculators/' + c).title)));
ok('compare route has its title', /Where should this money go/.test(metaFor('/calculators/compare').title));
ok('parsePath splits tab and sub', JSON.stringify(parsePath('/calculators/sip')) === JSON.stringify({ tab: 'calculators', sub: 'sip' }));

console.log(failures === 0 ? '\nAll route tests passed.' : `\n${failures} route test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
