/**
 * Historical mutual fund returns, by category: loading and summaries. They set the default return
 * assumptions in the retirement and goal planners' equity mix; no fund or category is put forward as a pick.
 *
 * Data: public/data/mf_returns.json, built by tools/build-mf-returns.mjs from AMFI NAV history.
 */

let dataPromise = null;
export function loadFunds({ timeoutMs = 8000 } = {}) {
  if (!dataPromise) {
    // the file is a megabyte of NAV history; on a slow connection a page must not wait for it forever
    dataPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('fund data timed out')), timeoutMs);
      fetch('/data/mf_returns.json')
        .then((r) => { if (!r.ok) throw new Error('fund data unavailable'); return r.json(); })
        .then((d) => { clearTimeout(timer); resolve(d); })
        .catch((e) => { clearTimeout(timer); dataPromise = null; reject(e); });   // let a later page try again
    });
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
