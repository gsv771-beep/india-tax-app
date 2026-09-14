/**
 * Historical mutual fund returns: loading, category summaries, matching to a target return,
 * and the panel shown under the SIP, lumpsum and EMI calculators.
 *
 * Data: public/data/mf_returns.json, built by tools/build-mf-returns.mjs from AMFI NAV history.
 * The matching here is deliberately category-first and descriptive: it answers "what has
 * historically delivered about X% a year" and never "which fund should I buy".
 */
import { el } from './util.js';

let dataPromise = null;
export function loadFunds() {
  if (!dataPromise) {
    dataPromise = fetch('/data/mf_returns.json').then((r) => { if (!r.ok) throw new Error('fund data unavailable'); return r.json(); });
  }
  return dataPromise;
}

// Typical riskometer level by SEBI category. 1 = low to moderate ... 5 = very high.
const RISK_BY_CATEGORY = {
  'Small Cap': 5, 'Mid Cap': 5, 'Sectoral / Thematic': 5, 'Multi Cap': 5, 'Flexi Cap': 5, 'Large & Mid Cap': 5, 'Large Cap': 5,
  'ELSS (Tax Saver)': 5, 'Value': 5, 'Contra': 5, 'Focused': 5, 'Dividend Yield': 5, 'Aggressive Hybrid': 5, 'Index Fund (Equity)': 5,
  'International (FoF)': 5, 'Retirement': 5, "Children's": 5,
  'Balanced Advantage': 4, 'Multi Asset Allocation': 4, 'Balanced Hybrid': 4, 'Credit Risk': 4, 'Gold / Silver': 4, 'Fund of Funds (Domestic)': 4,
  'Conservative Hybrid': 3, 'Equity Savings': 3, 'Medium Duration': 3, 'Medium to Long Duration': 3, 'Long Duration': 3, 'Dynamic Bond': 3,
  'Gilt': 3, 'Gilt (10-year Constant Maturity)': 3,
  'Short Duration': 2, 'Corporate Bond': 2, 'Banking & PSU Debt': 2, 'Floater': 2, 'Index Fund (Debt)': 2,
  'Overnight': 1, 'Liquid': 1, 'Ultra Short Duration': 1, 'Low Duration': 1, 'Money Market': 1, 'Arbitrage': 1,
};
const RISK_BY_GROUP = { Equity: 5, Hybrid: 4, Debt: 2, 'Index & ETF': 5, Commodity: 4, International: 5, 'Solution Oriented': 5, Other: 4 };
const RISK_LABEL = { 1: 'Low to moderate risk', 2: 'Moderate risk', 3: 'Moderately high risk', 4: 'High risk', 5: 'Very high risk' };

export function riskOf(category, group) {
  const rank = RISK_BY_CATEGORY[category] || RISK_BY_GROUP[group] || 4;
  return { rank, label: RISK_LABEL[rank] };
}

/** The return figure used to describe a fund for a given horizon: median rolling 5y for long horizons, else rolling 3y. */
export function metricOf(fund, horizonYears) {
  if (horizonYears >= 5 && fund.r5) return fund.r5[0];
  if (fund.r3) return fund.r3[0];
  if (fund.r5) return fund.r5[0];
  return fund.cagr5 ?? fund.cagr3 ?? null;
}
export function metricLabel(horizonYears) {
  return horizonYears >= 5 ? 'median 5-year rolling return' : 'median 3-year rolling return';
}

function median(arr) {
  const a = arr.filter((x) => x != null).sort((x, y) => x - y);
  if (!a.length) return null;
  return a[Math.floor(a.length / 2)];
}

/** One row per category with typical, worst-window and best-window returns for the horizon. */
export function summariseCategories(data, horizonYears) {
  const by = {};
  for (const f of data.funds) {
    const m = metricOf(f, horizonYears);
    if (m == null) continue;
    const roll = horizonYears >= 5 && f.r5 ? f.r5 : f.r3 || f.r5;
    const c = (by[f.category] ||= { category: f.category, group: f.group, metrics: [], worst: [], best: [], count: 0 });
    c.metrics.push(m);
    if (roll) { c.worst.push(roll[1]); c.best.push(roll[2]); }
    c.count++;
  }
  return Object.values(by)
    .filter((c) => c.count >= 3)
    .map((c) => ({
      category: c.category, group: c.group, count: c.count,
      typical: median(c.metrics), low: median(c.worst), high: median(c.best),
      risk: riskOf(c.category, c.group),
    }));
}

/** Categories whose typical return is within `tol` points of the target, nearest first. */
export function matchNear(categories, target, tol = 3) {
  const scored = categories.map((c) => ({ ...c, distance: Math.abs(c.typical - target) })).sort((a, b) => a.distance - b.distance || a.risk.rank - b.risk.rank);
  const within = scored.filter((c) => c.distance <= tol);
  const maxTypical = Math.max(...categories.map((c) => c.typical));
  const minTypical = Math.min(...categories.map((c) => c.typical));
  let note = null;
  if (target > maxTypical + 1.5) note = { kind: 'high', maxTypical, best: scored.find((c) => c.typical === maxTypical) };
  else if (target < minTypical - 1.5) note = { kind: 'low', minTypical };
  return { matches: (within.length ? within : scored.slice(0, 2)).slice(0, 4), note, exact: within.length > 0 };
}

/** Categories whose typical return exceeds the target (e.g. a loan rate), lowest risk first. */
export function matchExceeds(categories, target) {
  return categories.filter((c) => c.typical > target).sort((a, b) => a.risk.rank - b.risk.rank || a.typical - b.typical).slice(0, 6);
}

/** Funds in a category, ordered by closeness to the target (near) or by the metric (exceeds). */
export function fundsFor(data, category, horizonYears, target, mode, limit = 15) {
  return data.funds
    .filter((f) => f.category === category && metricOf(f, horizonYears) != null)
    .map((f) => ({ ...f, metric: metricOf(f, horizonYears) }))
    .sort((a, b) => (mode === 'near' ? Math.abs(a.metric - target) - Math.abs(b.metric - target) : b.metric - a.metric))
    .slice(0, limit);
}

// ---------- panel ----------

const pctOrDash = (v) => (v == null ? '—' : v.toFixed(1) + '%');
const signCls = (v) => (v == null ? '' : v < 0 ? 'neg' : '');

/**
 * Render the panel into `container`.
 * opts: { mode: 'near' | 'exceeds', target: number (% p.a.), horizon: years, title, intro }
 */
export async function renderFundPanel(container, opts) {
  container.replaceChildren(el('div', { class: 'fund-panel' }, [el('h3', {}, opts.title), el('p', { class: 'intro' }, 'Loading historical fund returns…')]));
  let data;
  try { data = await loadFunds(); } catch {
    container.replaceChildren(el('div', { class: 'fund-panel' }, [el('h3', {}, opts.title), el('p', { class: 'intro' }, 'Historical fund data is not available in this build. Run npm run build:funds to generate it.')]));
    return;
  }
  const horizon = Math.max(1, Math.round(opts.horizon || 5));
  const cats = summariseCategories(data, horizon);
  const label = metricLabel(horizon);
  const panel = el('div', { class: 'fund-panel' });
  panel.append(el('h3', {}, opts.title), el('p', { class: 'intro' }, opts.intro));

  let list;
  if (opts.mode === 'exceeds') {
    list = matchExceeds(cats, opts.target);
    if (!list.length) panel.append(el('div', { class: 'notice' }, `No fund category has typically returned more than ${opts.target.toFixed(2)}% a year over ${horizon >= 5 ? 5 : 3}-year periods. Prepaying the loan is the better use of the money on these numbers.`));
  } else {
    const r = matchNear(cats, opts.target);
    list = r.matches;
    if (r.note && r.note.kind === 'high') {
      panel.append(el('div', { class: 'notice warn' }, `No broad fund category has typically delivered ${opts.target}% a year over ${horizon >= 5 ? 5 : 3}-year periods. The highest ${label} is ${r.note.best.category} at about ${r.note.maxTypical.toFixed(1)}%, with much worse stretches along the way. Consider a lower assumption.`));
    } else if (r.note && r.note.kind === 'low') {
      panel.append(el('div', { class: 'notice' }, `Your assumption of ${opts.target}% is below what even the lowest-risk fund categories have typically returned (about ${r.note.minTypical.toFixed(1)}%). It is a conservative estimate.`));
    } else if (!r.exact) {
      panel.append(el('div', { class: 'notice' }, `No category sits close to ${opts.target}%; the nearest are shown.`));
    }
  }

  panel.append(el('div', { class: 'cat-grid' }, list.map((c) => categoryCard(c, data, horizon, opts, label))));
  panel.append(el('p', { class: 'muted', style: 'font-size:.8rem;margin-top:10px' },
    `Direct plan, growth option returns computed from AMFI NAV history as of ${data._meta.nav_as_of}; ${data._meta.fund_count} open-ended funds. "Typical" is the ${label} across funds in the category; "worst window" is the median across funds of their single worst rolling period. Past returns do not predict future returns. Funds within a category differ widely. Read the scheme document and riskometer; this is not a recommendation.`));
  container.replaceChildren(panel);
}

function categoryCard(c, data, horizon, opts, label) {
  const detail = el('details');
  const summary = el('summary', {}, `Show funds in this category (${c.count})`);
  detail.append(summary);
  detail.addEventListener('toggle', () => {
    detail.closest('.cat')?.classList.toggle('wide', detail.open);
    if (!detail.open || detail.dataset.loaded) return;
    detail.dataset.loaded = '1';
    const rows = fundsFor(data, c.category, horizon, opts.target, opts.mode);
    detail.append(el('div', { class: 'fund-table' }, el('table', {}, [
      el('thead', {}, [
        el('tr', { class: 'grp' }, [el('th', {}), el('th', { colspan: 3, class: 'grp-head' }, 'Recent, absolute'), el('th', { colspan: 4, class: 'grp-head' }, 'Long-term, % a year')]),
        el('tr', {}, [el('th', {}, 'Fund'), el('th', {}, '1m'), el('th', {}, '3m'), el('th', {}, '6m'), el('th', {}, '1y'), el('th', {}, '3y'), el('th', {}, '5y'), el('th', {}, 'Worst 3y')]),
      ]),
      el('tbody', {}, rows.map((f) => el('tr', {}, [
        el('td', {}, [f.name, el('div', { class: 'muted', style: 'font-size:.75rem' }, `${f.house} · since ${f.since.slice(0, 4)}`)]),
        el('td', { class: signCls(f.m1) }, pctOrDash(f.m1)), el('td', { class: signCls(f.m3) }, pctOrDash(f.m3)), el('td', { class: signCls(f.m6) }, pctOrDash(f.m6)),
        el('td', {}, pctOrDash(f.cagr1)), el('td', {}, pctOrDash(f.cagr3)), el('td', {}, pctOrDash(f.cagr5)), el('td', {}, f.r3 ? pctOrDash(f.r3[1]) : '—'),
      ]))),
    ])));
    detail.append(el('p', { class: 'muted', style: 'font-size:.75rem;margin:6px 0 0' }, opts.mode === 'near'
      ? `Ordered by closeness of the ${label} to ${opts.target}%. The 1, 3 and 6-month figures are total change over that period, not annualised, and say more about the market's mood than the fund. "Worst 3y" is the fund's weakest 3-year stretch.`
      : `Ordered by ${label}. The 1, 3 and 6-month figures are total change over that period, not annualised. "Worst 3y" is the fund's weakest 3-year stretch, which a loan prepayment never has.`));
  });
  return el('div', { class: 'cat' }, [
    el('h4', {}, [c.category, el('span', { class: `risk risk-${c.risk.rank}` }, c.risk.label)]),
    el('div', { class: 'typical' }, `${c.typical.toFixed(1)}% a year`),
    el('div', { class: 'range' }, `typical (${label}) · worst window ${pctOrDash(c.low)} · best window ${pctOrDash(c.high)}`),
    detail,
  ]);
}
