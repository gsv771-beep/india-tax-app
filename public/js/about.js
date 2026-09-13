import { el, setChildren, loadJSON } from './util.js';

const FEEDBACK_EMAIL = 'gsv771@gmail.com';

export function initAbout({ rates, schemes, capgains }) {
  const body = document.getElementById('about-body');
  const fundStamp = el('span', {}, 'loading…');
  loadJSON('/data/mf_returns.json').then((d) => { fundStamp.textContent = `${d._meta.fund_count} open-ended funds, NAV as of ${d._meta.nav_as_of}, source ${d._meta.source}`; }).catch(() => { fundStamp.textContent = 'not available in this build'; });

  const sources = Object.entries(rates.primary_sources || {}).map(([k, url]) => el('li', {}, [el('a', { href: url, target: '_blank', rel: 'noopener' }, k.replace(/_/g, ' ')), ' ']));

  setChildren(body, [
    section('What this is', [
      el('p', {}, 'TaxCompass India is a free, independent tool for salaried and self-employed people in India. It compares the old and new income tax regimes line by line, helps plan loans and investments, and explains government savings schemes in plain language. It is built and maintained by an individual, not a company, bank or fund house, and it earns nothing from anything you do here.'),
      el('p', {}, 'It is not tax, legal or investment advice, and it is not a substitute for a chartered accountant. Its job is to make the conversation with your CA or adviser shorter and better informed.'),
    ]),
    section('How the numbers are computed', [
      el('p', {}, 'Every rate, slab, threshold and cap lives in structured data files that the calculators read; nothing is estimated from prose. The tax engine follows the statutory order of operations: income head by head, the house property loss rules, brought-forward losses, Chapter VI-A deductions against slab income only, special-rate income kept separate, the rebate against slab-rate tax only, marginal relief, surcharge with the 15% cap on capital gains and dividends, and cess last.'),
      el('ul', {}, [
        'Marginal relief on the new-regime rebate is applied to slab-rate tax only; tax on capital gains is never rebated.',
        'For residents, unused basic exemption is set against short-term equity gains first, then long-term equity gains, then other long-term gains.',
        'The 15% surcharge cap on dividend income is approximated in proportion to the dividend share of slab income; this only matters above ₹2 crore.',
        'Employer contributions above ₹7.5 lakh are treated as a perquisite; the accretion on the excess is not modelled.',
        'Tax is rounded to the nearest rupee rather than the nearest ten.',
        'Two items ship switched off pending confirmation against the notified Rules: the eight-city metro list for HRA from FY 2026-27, and marginal relief on the old-regime rebate.',
      ].map((t) => el('li', {}, t))),
      el('p', {}, 'The engine is covered by regression tests that lock in the ten reference cases published with the data, plus break-even, calculator, capital gains and workbook tests. No build is deployed unless all of them pass.'),
    ]),
    section('Data and how fresh it is', [
      el('dl', { class: 'kv' }, [
        el('dt', {}, 'Tax rates and deductions'), el('dd', {}, `Compiled ${rates._meta.compiled_on} for FY 2025-26 (Income-tax Act 1961) and FY 2026-27 (Income-tax Act 2025), as amended by Finance Act 2026. Identical figures for both years; section numbers differ.`),
        el('dt', {}, 'Small-savings rates'), el('dd', {}, `${schemes._meta.rate_quarter_in_force}. ${schemes._meta.next_rate_notification}`),
        el('dt', {}, 'Cost Inflation Index'), el('dd', {}, `Through FY ${Object.keys(capgains.cii).sort().pop()}. ${capgains._meta.cii_note}`),
        el('dt', {}, 'Mutual fund returns'), el('dd', {}, [fundStamp, '. Rebuilt monthly. Historical returns are shown to sanity-check assumptions, never as recommendations.']),
      ]),
    ]),
    section('Sources', [
      el('p', {}, 'Primary sources used for the tax data, as listed in the compilation notes:'),
      el('ul', { class: 'sources' }, sources),
      el('p', {}, 'Other sources: Ministry of Finance small-savings notifications via nsiindia.gov.in; PFRDA for NPS and APY; EPFO for EPF; RBI for Floating Rate Savings Bonds; AMFI for mutual fund NAV history; CBDT notifications for the Cost Inflation Index. Where the compiled data marks an item as corroborated rather than verified, the app says so in the relevant place.'),
    ]),
    section('Privacy', [
      el('ul', {}, [
        'Everything you type into the tax comparison and the calculators stays in your own browser, in its local storage. It is never sent anywhere, and the site has no user accounts.',
        'If you ask for an Excel workbook by email, your name, email address and the workbook are sent once to our email provider (Brevo) for delivery. With your consent on that form, we keep your name and email to ask for feedback about the app. We do not sell or share them, and you can ask to be removed by replying to any email.',
        'The site uses no advertising or tracking cookies. If aggregate visitor statistics are enabled, they come from Cloudflare Web Analytics, which does not use cookies or identify individuals.',
      ].map((t) => el('li', {}, t))),
    ]),
    section('Feedback and corrections', [
      el('p', {}, ['Found a mistake, a rule that changed, or something confusing? Please write to ', el('a', { href: `mailto:${FEEDBACK_EMAIL}?subject=TaxCompass%20feedback` }, FEEDBACK_EMAIL), '. Corrections to rates or limits are especially welcome, with a link to the notification or circular if you have one.']),
    ]),
  ]);
}

function section(title, children) {
  return el('div', { class: 'card about-section' }, [el('h2', { style: 'margin-top:0' }, title), ...children]);
}
