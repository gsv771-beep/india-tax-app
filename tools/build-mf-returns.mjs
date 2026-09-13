/**
 * Builds public/data/mf_returns.json: historical returns of open-ended mutual fund
 * direct-growth plans, computed from AMFI NAV history.
 *
 * Source: https://api.mfapi.in (a free mirror of AMFI's published NAV data). This is a
 * community-run service, not AMFI itself; if it disappears, point `fetchHistory` at
 * AMFI's NAV history download instead. Re-run monthly:  node tools/build-mf-returns.mjs
 *
 * Per fund we store point-to-point CAGR for 1/3/5/10 years and, more usefully, the
 * median and worst 3-year and 5-year ROLLING returns sampled monthly. Rolling figures
 * answer "what did an investor typically get over any 5 years" instead of "what did the
 * last 5 years happen to deliver", which is what the app's expectation-check needs.
 *
 * Options:  --limit N   only process the first N candidate funds (for a quick test)
 *           --no-cache  ignore the on-disk cache in .cache/mf
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '../public/data/mf_returns.json');
const CACHE = path.join(here, '../.cache/mf');
const API = 'https://api.mfapi.in/mf';
const CONCURRENCY = 8;
const args = process.argv.slice(2);
const LIMIT = Number((args.find((a) => a.startsWith('--limit')) || '').split('=')[1] || args[args.indexOf('--limit') + 1]) || Infinity;
const USE_CACHE = !args.includes('--no-cache');

// Names that indicate closed-ended or oddball products; skipped before any per-fund call.
const EXCLUDE_NAME = /fixed (term|maturity)|fmp\b|interval|series|capital protection|dual advantage|multiple yield|yearly plan|year plus|annual interval|close[- ]?ended|target maturity|fixed horizon|tenure plan/i;

async function main() {
  await mkdir(CACHE, { recursive: true });
  console.log('Fetching scheme list...');
  const list = await getJSON(`${API}`, 'list.json');
  let candidates = list.filter((s) =>
    /direct/i.test(s.schemeName) && /growth/i.test(s.schemeName) &&
    !/idcw|dividend|bonus/i.test(s.schemeName) && !EXCLUDE_NAME.test(s.schemeName));
  // de-duplicate by ISIN where present (same plan sometimes appears twice)
  const seen = new Set();
  candidates = candidates.filter((s) => { const k = s.isinGrowth || `code:${s.schemeCode}`; if (seen.has(k)) return false; seen.add(k); return true; });
  if (Number.isFinite(LIMIT)) candidates = candidates.slice(0, LIMIT);
  console.log(`Candidates: ${candidates.length}`);

  const funds = [];
  let done = 0, skipped = 0, failed = 0;
  await pool(candidates, CONCURRENCY, async (s) => {
    try {
      const h = await getJSON(`${API}/${s.schemeCode}`, `${s.schemeCode}.json`);
      const f = summarise(h);
      if (f) funds.push(f); else skipped++;
    } catch (e) {
      failed++;
      if (failed < 20) console.warn(`  failed ${s.schemeCode} ${s.schemeName}: ${e.message}`);
    } finally {
      done++;
      if (done % 200 === 0) console.log(`  ${done}/${candidates.length} (kept ${funds.length}, skipped ${skipped}, failed ${failed})`);
    }
  });

  // Drop funds that have stopped publishing NAVs (merged or wound up): last NAV more than 45 days before the newest.
  const asOf = funds.map((f) => f.asOf).sort().at(-1);
  const cutoff = fmtDate(new Date(asOf).getTime() - 45 * MS_DAY);
  const stale = funds.filter((f) => f.asOf < cutoff).length;
  const live = funds.filter((f) => f.asOf >= cutoff);
  funds.length = 0; funds.push(...live);
  console.log(`Dropped ${stale} funds with no recent NAV`);

  funds.sort((a, b) => a.group.localeCompare(b.group) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  const categories = {};
  for (const f of funds) {
    const c = (categories[f.category] ||= { group: f.group, count: 0 });
    c.count++;
  }
  const out = {
    _meta: {
      built_on: new Date().toISOString().slice(0, 10),
      nav_as_of: asOf,
      source: 'AMFI NAV history via api.mfapi.in',
      plans: 'Direct plan, growth option, open-ended schemes only',
      fund_count: funds.length,
      fields: {
        cagr1: 'point-to-point CAGR over the last 1 year, % p.a.', cagr3: '3 years', cagr5: '5 years', cagr10: '10 years',
        r3: '[median, worst, best] of all 3-year rolling CAGRs sampled monthly', r5: 'same for 5-year windows',
        since: 'first NAV date available',
      },
      notes: 'Past performance is not indicative of future returns. Figures are before exit load and taxes. Categories are SEBI scheme categories as reported by AMFI.',
    },
    categories,
    funds,
  };
  await writeFile(OUT, JSON.stringify(out));
  console.log(`Wrote ${OUT}: ${funds.length} funds across ${Object.keys(categories).length} categories, NAV as of ${asOf}, skipped ${skipped}, failed ${failed}`);
}

function summarise(h) {
  const meta = h.meta || {};
  if (!/open ended/i.test(meta.scheme_type || '')) return null;
  const rows = (h.data || []).map((d) => ({ t: parseDate(d.date), nav: Number(d.nav) })).filter((r) => r.t && r.nav > 0);
  if (rows.length < 700) return null; // roughly < 3 years of daily NAVs
  rows.sort((a, b) => a.t - b.t);
  const first = rows[0], last = rows[rows.length - 1];
  const yearsAvail = (last.t - first.t) / MS_YEAR;
  if (yearsAvail < 3) return null;
  if (hasSplitArtefact(rows)) return null; // ETF unit splits, face-value changes, bad ticks
  // Exchange-traded funds are bought at market price, not NAV, and most have had unit splits; keep to NAV-priced funds.
  if (/\betf\b|bees\b/i.test(meta.scheme_name || '')) return null;

  const navAt = (t) => { // last NAV on or before t
    let lo = 0, hi = rows.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (rows[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans >= 0 ? rows[ans] : null;
  };
  const cagr = (a, b, years) => Math.pow(b.nav / a.nav, 1 / years) - 1;
  const p2p = (n) => {
    const t = addYears(last.t, -n);
    if (t < first.t - 15 * MS_DAY) return null;
    const a = navAt(t);
    return a ? round(cagr(a, last, n) * 100) : null;
  };
  const rolling = (n) => {
    const vals = [];
    for (let t = first.t; ; t = addMonths(t, 1)) {
      const end = addYears(t, n);
      if (end > last.t) break;
      const a = navAt(t), b = navAt(end);
      if (a && b && a.t >= first.t) vals.push(cagr(a, b, n) * 100);
    }
    if (vals.length < 12) return null;
    vals.sort((x, y) => x - y);
    return [round(vals[Math.floor(vals.length / 2)]), round(vals[0]), round(vals[vals.length - 1])];
  };
  const cat = normaliseCategory(meta.scheme_category, meta.scheme_name);
  if (!cat) return null; // legacy or unrecognised category
  return {
    code: Number(meta.scheme_code),
    name: cleanName(meta.scheme_name),
    house: String(meta.fund_house || '').replace(/ Mutual Fund$/i, ''),
    category: cat.category,
    group: cat.group,
    rawCategory: String(meta.scheme_category || '').trim(),
    since: fmtDate(first.t),
    asOf: fmtDate(last.t),
    cagr1: p2p(1), cagr3: p2p(3), cagr5: p2p(5), cagr10: p2p(10),
    r3: rolling(3), r5: rolling(5),
  };
}

function cleanName(n) {
  return String(n)
    .replace(/\s*-\s*direct( plan)?\s*-?\s*growth( option| plan)?\s*$/i, '')
    .replace(/\s*-\s*direct( plan)?\s*$/i, '')
    .replace(/\s*\(?direct( plan)?\)?\s*-?\s*growth( option)?/i, '')
    .replace(/\s*-\s*growth( option)?\s*$/i, '')
    .replace(/\s+growth\s+direct\s*$/i, '')
    .replace(/\s+direct\s+growth\s*$/i, '')
    .replace(/\s*\(g\)\s*$/i, '')
    .replace(/\s*-\s*$/, '')
    .replace(/\s+/g, ' ').trim();
}

/**
 * AMFI reports category strings in several historical spellings
 * ("Equity Scheme - ELSS", "Equity Schemes - ELSS- Tax Saver Fund", "Income/Debt Oriented Schemes - Liquid Fund").
 * Map them onto SEBI's scheme categories. Order matters: more specific patterns first.
 */
const CATEGORY_RULES = [
  // debt patterns that would otherwise be caught by equity keywords
  [/banking (and|&) psu/, 'Banking & PSU Debt', 'Debt'],
  // equity
  [/large\s*(&|and)\s*mid/, 'Large & Mid Cap', 'Equity'],
  [/flexi\s*cap/, 'Flexi Cap', 'Equity'],
  [/multi\s*cap/, 'Multi Cap', 'Equity'],
  [/small\s*cap/, 'Small Cap', 'Equity'],
  [/mid\s*cap/, 'Mid Cap', 'Equity'],
  [/large\s*cap/, 'Large Cap', 'Equity'],
  [/elss|tax sav/, 'ELSS (Tax Saver)', 'Equity'],
  [/dividend yield/, 'Dividend Yield', 'Equity'],
  [/focus/, 'Focused', 'Equity'],
  [/contra/, 'Contra', 'Equity'],
  [/equity savings/, 'Equity Savings', 'Hybrid'],
  [/\bvalue\b/, 'Value', 'Equity'],
  [/sector|thematic|infrastructure|pharma|technology|consumption|psu|mnc|business cycle|esg|quant|manufacturing|energy|banking|financial services/, 'Sectoral / Thematic', 'Equity'],
  // hybrid
  [/aggressive hybrid|equity oriented|balanced fund/, 'Aggressive Hybrid', 'Hybrid'],
  [/conservative hybrid|debt oriented|monthly income|\bmip\b/, 'Conservative Hybrid', 'Hybrid'],
  [/balanced advantage|dynamic asset/, 'Balanced Advantage', 'Hybrid'],
  [/multi asset/, 'Multi Asset Allocation', 'Hybrid'],
  [/arbitrage/, 'Arbitrage', 'Hybrid'],
  [/balanced hybrid/, 'Balanced Hybrid', 'Hybrid'],
  // debt
  [/overnight/, 'Overnight', 'Debt'],
  [/liquid/, 'Liquid', 'Debt'],
  [/ultra short/, 'Ultra Short Duration', 'Debt'],
  [/low duration/, 'Low Duration', 'Debt'],
  [/money market/, 'Money Market', 'Debt'],
  [/short (duration|term)/, 'Short Duration', 'Debt'],
  [/medium to long|medium long/, 'Medium to Long Duration', 'Debt'],
  [/medium (duration|term)/, 'Medium Duration', 'Debt'],
  [/long (duration|term)/, 'Long Duration', 'Debt'],
  [/dynamic (bond|term)/, 'Dynamic Bond', 'Debt'],
  [/corporate bond/, 'Corporate Bond', 'Debt'],
  [/credit risk|credit opportunit/, 'Credit Risk', 'Debt'],
  [/10 ?year|constant maturity/, 'Gilt (10-year Constant Maturity)', 'Debt'],
  [/gilt|government securities|g ?sec/, 'Gilt', 'Debt'],
  [/floater|floating/, 'Floater', 'Debt'],
  // commodities, index, international, solution-oriented
  [/gold|silver|commodit/, 'Gold / Silver', 'Commodity'],
  [/fof overseas|overseas|international|global/, 'International (FoF)', 'International'],
  [/index/, 'Index Fund', 'Index & ETF'],
  [/fof domestic|fund of fund/, 'Fund of Funds (Domestic)', 'Other'],
  [/retirement/, 'Retirement', 'Solution Oriented'],
  [/children/, "Children's", 'Solution Oriented'],
];

function normaliseCategory(raw, schemeName = '') {
  const full = String(raw || '').toLowerCase().replace(/[^a-z0-9&+/ -]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!full) return null;
  // AMFI strings are "<group> - <category>"; match the category part first so that a group
  // prefix like "Income/Debt Oriented Schemes" cannot be mistaken for a category keyword.
  const dash = full.indexOf(' - ');
  const candidates = dash >= 0 ? [full.slice(dash + 3), full] : [full];
  let hit = null;
  for (const s of candidates) {
    const clean = s.replace(/[^a-z0-9&+ ]/g, ' ');
    for (const [re, category, group] of CATEGORY_RULES) if (re.test(clean)) { hit = { category, group }; break; }
    if (hit) break;
  }
  if (!hit) return null;
  // Index funds tracking debt indices (gilt, SDL, target-maturity) behave like debt, not equity.
  if (hit.category === 'Index Fund') {
    const debtIndex = /gilt|sdl|bond|crisil|ibx|psu debt|g-?sec|t-?bill|money market|liquid|debt|corporate/i.test(schemeName);
    return debtIndex ? { category: 'Index Fund (Debt)', group: 'Debt' } : { category: 'Index Fund (Equity)', group: 'Index & ETF' };
  }
  return hit;
}

/** True if the NAV series contains a jump that can only be a unit split or a data error. */
function hasSplitArtefact(rows) {
  for (let i = 1; i < rows.length; i++) {
    const ratio = rows[i].nav / rows[i - 1].nav;
    if (ratio < 0.6 || ratio > 1.67) return true;
  }
  return false;
}

const MS_DAY = 86400000, MS_YEAR = 365.25 * MS_DAY;
function parseDate(s) { const [d, m, y] = String(s).split('-').map(Number); return d && m && y ? Date.UTC(y, m - 1, d) : null; }
function fmtDate(t) { return new Date(t).toISOString().slice(0, 10); }
function addYears(t, n) { const d = new Date(t); d.setUTCFullYear(d.getUTCFullYear() + n); return d.getTime(); }
function addMonths(t, n) { const d = new Date(t); d.setUTCMonth(d.getUTCMonth() + n); return d.getTime(); }
const round = (x) => Math.round(x * 100) / 100;

async function getJSON(url, cacheName) {
  const file = path.join(CACHE, cacheName);
  if (USE_CACHE && existsSync(file)) return JSON.parse(await readFile(file, 'utf8'));
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'india-tax-app-build/1.0 (returns dataset builder)' } });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { fatal: true });
      const json = await res.json();
      await writeFile(file, JSON.stringify(json));
      return json;
    } catch (e) {
      lastErr = e;
      if (e.fatal) break;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastErr;
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const item = items[i++]; await fn(item); }
  }));
}

main().catch((e) => { console.error(e); process.exit(1); });
