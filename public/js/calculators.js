import { inr, pct, el, debounce, setChildren, disclaimer } from './util.js';
import { renderFundPanel } from './funds.js';
import { renderBudget } from './budget.js';

// Formulas follow data/formulas.json. SIP uses the annuity-due form (instalment at start of month).

export function emi(P, annualRatePct, years) {
  const r = annualRatePct / 12 / 100;
  const n = Math.round(years * 12);
  if (n <= 0 || P <= 0) return { emi: 0, total: 0, interest: 0, n: 0, r };
  const e = r === 0 ? P / n : (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  return { emi: e, total: e * n, interest: e * n - P, n, r };
}

function emiFor(balance, r, months) {
  if (months <= 0) return balance;
  return r === 0 ? balance / months : (balance * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
}

/**
 * Month-by-month loan simulator.
 * opts: { principal, annualRatePct, tenureMonths,
 *         stepUpPct      EMI rises by this % once a year (or)
 *         stepUpAmount   EMI rises by this many rupees once a year,
 *         lumpsum: {amount, atMonth}, annualPrepay (paid at the end of every year, from year startYear),
 *         annualPrepayStartYear, mode: 'reduce_tenure' | 'reduce_emi' }
 * Step-up always shortens tenure; `mode` only governs how prepayments are applied.
 */
export function simulateLoan(opts) {
  const { principal: P, annualRatePct, tenureMonths: N } = opts;
  const r = annualRatePct / 12 / 100;
  const stepUpPct = (opts.stepUpPct || 0) / 100;
  const stepUpAmount = opts.stepUpAmount || 0;
  const lump = opts.lumpsum || { amount: 0, atMonth: 0 };
  const annual = opts.annualPrepay || 0;
  const startYear = opts.annualPrepayStartYear || 1;
  const mode = opts.mode || 'reduce_tenure';
  const baseEmi = emiFor(P, r, N);

  let bal = P, cur = baseEmi, m = 0, totalInterest = 0, totalPaid = 0, totalPrepaid = 0, maxEmi = baseEmi;
  const years = [];
  let yr = { year: 1, principal: 0, interest: 0, prepaid: 0, emi: cur };
  const cap = N + 600;
  let insufficient = false;

  while (bal > 0.5 && m < cap) {
    m++;
    if (m > 1 && (m - 1) % 12 === 0) {
      if (stepUpPct > 0) cur *= 1 + stepUpPct;
      else if (stepUpAmount > 0) cur += stepUpAmount;
      yr.emi = cur;
    }
    const interest = bal * r;
    const pay = Math.min(cur, bal + interest);
    const principalPart = pay - interest;
    if (principalPart <= 0) { insufficient = true; break; }
    bal -= principalPart;
    totalInterest += interest; totalPaid += pay;
    yr.interest += interest; yr.principal += principalPart;
    maxEmi = Math.max(maxEmi, cur);

    let prepaid = 0;
    if (lump.amount > 0 && m === lump.atMonth) prepaid += Math.min(lump.amount, bal);
    if (annual > 0 && m % 12 === 0 && m / 12 >= startYear) prepaid += Math.min(annual, bal - prepaid);
    if (prepaid > 0) {
      bal -= prepaid; totalPaid += prepaid; totalPrepaid += prepaid; yr.prepaid += prepaid;
      if (mode === 'reduce_emi' && bal > 0.5 && N - m > 0) cur = emiFor(bal, r, N - m);
    }
    if (m % 12 === 0 || bal <= 0.5) {
      yr.balance = Math.max(0, bal);
      years.push(yr);
      yr = { year: years.length + 1, principal: 0, interest: 0, prepaid: 0, emi: cur };
    }
  }
  return { emi: baseEmi, finalEmi: cur, maxEmi, months: m, totalInterest, totalPaid, totalPrepaid, years, insufficient };
}

export function amortisationByYear(P, annualRatePct, years) {
  return simulateLoan({ principal: P, annualRatePct, tenureMonths: Math.round(years * 12) }).years;
}

export function lumpsumFV(P, annualRatePct, years) {
  const r = annualRatePct / 100;
  const fv = P * Math.pow(1 + r, years);
  return { fv, gain: fv - P, absReturn: P > 0 ? (fv - P) / P : 0 };
}

/** SIP future value. Step up the instalment once a year by a percentage OR a fixed amount. */
export function sipFV(monthly, annualRatePct, years, stepUpPct = 0, stepUpAmount = 0) {
  const i = annualRatePct / 12 / 100;
  let bal = 0, amt = monthly, invested = 0;
  for (let y = 0; y < years; y++) {
    for (let m = 0; m < 12; m++) {
      bal = (bal + amt) * (1 + i);
      invested += amt;
    }
    if (stepUpPct > 0) amt *= 1 + stepUpPct / 100;
    else if (stepUpAmount > 0) amt += stepUpAmount;
  }
  return { fv: bal, invested, gain: bal - invested, finalMonthly: amt };
}

export function requiredSip(target, annualRatePct, years) {
  const i = annualRatePct / 12 / 100;
  const n = years * 12;
  if (n <= 0) return 0;
  if (i === 0) return target / n;
  return (target * i) / ((Math.pow(1 + i, n) - 1) * (1 + i));
}

// ---------- UI ----------

export function initCalculators() {
  const tabs = document.getElementById('calc-tabs');
  const body = document.getElementById('calc-body');
  const show = (name) => {
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.calc === name));
    body.replaceChildren(VIEWS[name]());
  };
  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-calc]');
    if (b) show(b.dataset.calc);
  });
  show('emi');
}

function field(label, attrs, hint) {
  const input = el('input', { type: 'number', ...attrs });
  return { node: el('label', {}, [label, hint ? el('small', {}, hint) : null, input]), input };
}
function selectField(label, options, value, hint) {
  const input = el('select', {}, options.map(([v, t]) => el('option', { value: v, selected: v === value }, t)));
  return { node: el('label', {}, [label, hint ? el('small', {}, hint) : null, input]), input };
}
function stat(k, v, hi = false) {
  return el('div', { class: 'stat' + (hi ? ' hi' : '') }, [el('div', { class: 'k' }, k), el('div', { class: 'v' }, v)]);
}
function splitBar(aLabel, a, bLabel, b) {
  const total = a + b || 1;
  return el('div', {}, [
    el('div', { class: 'legend' }, [
      el('span', {}, [el('i', { style: 'background:var(--accent)' }), `${aLabel} ${inr(a)}`]),
      el('span', {}, [el('i', { style: 'background:#c9a227' }), `${bLabel} ${inr(b)}`]),
    ]),
    el('div', { class: 'bar' }, [
      el('span', { class: 'a', style: `width:${(a / total) * 100}%` }),
      el('span', { class: 'b', style: `width:${(b / total) * 100}%` }),
    ]),
  ]);
}
function calcShell(inputs, out) {
  return el('div', { class: 'calc' }, [el('div', { class: 'card inputs' }, inputs), el('div', {}, out)]);
}
function months(n) {
  const y = Math.floor(n / 12), m = n % 12;
  return [y ? `${y} yr${y > 1 ? 's' : ''}` : '', m ? `${m} mo` : ''].filter(Boolean).join(' ') || '0 mo';
}
const v = (f) => +f.input.value || 0;
const RUPEE = '₹';

/** A "none / percent / amount" step-up control. Returns {node, mode(), value()} */
function stepUpControl(labelNoun) {
  const mode = selectField(`Step-up ${labelNoun}`, [
    ['none', 'No step-up'],
    ['pct', `Increase ${labelNoun} by a percentage every year`],
    ['amt', `Increase ${labelNoun} by a fixed amount every year`],
  ], 'none', `As your income grows, raise the ${labelNoun} once a year. Pick a percentage or an amount, not both.`);
  const pctF = field('Increase per year (%)', { value: 10, min: 0, max: 100, step: 1 });
  const amtF = field(`Increase per year (${RUPEE})`, { value: 1000, min: 0, step: 500 });
  pctF.node.hidden = true; amtF.node.hidden = true;
  const sync = () => { pctF.node.hidden = mode.input.value !== 'pct'; amtF.node.hidden = mode.input.value !== 'amt'; };
  mode.input.addEventListener('change', sync);
  return {
    node: el('div', { class: 'opts' }, [mode.node, pctF.node, amtF.node]),
    inputs: [mode.input, pctF.input, amtF.input],
    mode: () => mode.input.value,
    pct: () => (mode.input.value === 'pct' ? v(pctF) : 0),
    amount: () => (mode.input.value === 'amt' ? v(amtF) : 0),
  };
}

const VIEWS = {
  budget() { return renderBudget(); },

  emi() {
    const P = field(`Loan amount (${RUPEE})`, { value: 5000000, min: 0, step: 50000 });
    const R = field('Interest rate (% p.a.)', { value: 8.5, min: 0, step: 0.05 });
    const Y = field('Tenure (years)', { value: 20, min: 1, max: 40, step: 1 });
    const step = stepUpControl('EMI');

    const L = field(`Lump sum amount (${RUPEE})`, { value: 0, min: 0, step: 10000 }, 'leave 0 if none');
    const LM = field('Paid in month number', { value: 12, min: 1, step: 1 }, '12 = end of the first year, 24 = end of the second');
    const A = field(`Extra payment every year (${RUPEE})`, { value: 0, min: 0, step: 10000 }, 'e.g. from an annual bonus; leave 0 if none');
    const AS = field('Starting from year', { value: 1, min: 1, step: 1 });
    const M = selectField('After each prepayment, keep', [
      ['reduce_tenure', 'the same EMI and finish the loan sooner (recommended)'],
      ['reduce_emi', 'the same tenure and pay a lower EMI'],
    ], 'reduce_tenure');
    const out = el('div');
    const fundBox = el('div');
    let fundKey = '';

    const render = () => {
      const p = v(P), r = v(R), y = v(Y), n = Math.round(y * 12);
      const stepPct = step.pct(), stepAmt = step.amount();
      const hasStep = stepPct > 0 || stepAmt > 0;
      const hasLump = v(L) > 0, hasAnnual = v(A) > 0, hasPrepay = hasLump || hasAnnual;
      M.input.disabled = hasStep;
      const mode = hasStep ? 'reduce_tenure' : M.input.value;

      const base = simulateLoan({ principal: p, annualRatePct: r, tenureMonths: n });
      const scen = hasStep || hasPrepay ? simulateLoan({
        principal: p, annualRatePct: r, tenureMonths: n, stepUpPct: stepPct, stepUpAmount: stepAmt,
        lumpsum: { amount: v(L), atMonth: Math.round(v(LM)) }, annualPrepay: v(A), annualPrepayStartYear: Math.round(v(AS)) || 1, mode,
      }) : null;
      const show = scen || base;
      const saved = scen ? base.totalInterest - scen.totalInterest : 0;
      const monthsSaved = scen ? base.months - scen.months : 0;

      const stats = [stat('Monthly EMI' + (hasStep ? ' (first year)' : ''), inr(base.emi), true)];
      if (hasStep) stats.push(stat('EMI in the final year', inr(scen.maxEmi)));
      if (scen && mode === 'reduce_emi') stats.push(stat('EMI after prepayments', inr(scen.finalEmi)));
      stats.push(stat('Total interest', inr(show.totalInterest)));
      if (scen) stats.push(stat('Interest saved', inr(saved), saved > 0), stat('Loan closes in', months(scen.months)));
      else stats.push(stat('Total payment', inr(base.totalPaid)));

      // plain-English explanation of what was simulated
      const parts = [];
      if (stepPct > 0) parts.push(`raising the EMI by ${stepPct}% every year`);
      if (stepAmt > 0) parts.push(`raising the EMI by ${inr(stepAmt)} every year`);
      if (hasLump) parts.push(`paying a lump sum of ${inr(v(L))} in month ${Math.round(v(LM))}`);
      if (hasAnnual) parts.push(`paying an extra ${inr(v(A))} at the end of every year from year ${Math.round(v(AS)) || 1}`);
      const listJoin = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
      let sentence = null;
      if (scen) {
        sentence = mode === 'reduce_emi'
          ? `By ${listJoin(parts)}, while keeping the ${y}-year tenure, your EMI falls to ${inr(scen.finalEmi)} and you pay ${inr(saved)} less interest overall.`
          : `By ${listJoin(parts)}${hasPrepay ? ', while keeping the EMI unchanged after each prepayment' : ''}, the loan closes in ${months(scen.months)} instead of ${months(base.months)}. That is ${months(monthsSaved)} sooner and ${inr(saved)} less interest.`;
      }

      const head = ['Year', hasStep ? 'EMI' : null, 'Principal paid', 'Interest paid', hasPrepay ? 'Prepaid' : null, 'Balance at year end'].filter(Boolean);
      const rows = show.years.map((a) => el('tr', {}, [
        el('td', {}, a.year), hasStep ? el('td', {}, inr(a.emi)) : null, el('td', {}, inr(a.principal)), el('td', {}, inr(a.interest)),
        hasPrepay ? el('td', {}, a.prepaid ? inr(a.prepaid) : '—') : null, el('td', {}, inr(a.balance)),
      ]));

      setChildren(out, [
        el('div', { class: 'stats' }, stats),
        sentence ? el('p', { class: 'explain' }, sentence) : null,
        splitBar('Principal', p, 'Interest', show.totalInterest),
        scen ? el('div', { class: 'table-wrap' }, el('table', { class: 'compare compare-scen' }, [
          el('thead', {}, el('tr', {}, [el('th', {}, ''), el('th', {}, 'Plain EMI, no changes'), el('th', { class: 'on' }, hasStep && hasPrepay ? 'With step-up and prepayments' : hasStep ? 'With step-up EMI' : 'With prepayments')])),
          el('tbody', {}, [
            el('tr', {}, [el('td', {}, 'Loan closes in'), el('td', {}, months(base.months)), el('td', { class: 'on' }, months(scen.months))]),
            el('tr', {}, [el('td', {}, 'Total interest paid'), el('td', {}, inr(base.totalInterest)), el('td', { class: 'on' }, inr(scen.totalInterest))]),
            el('tr', {}, [el('td', {}, 'Total paid to the bank (EMIs + prepayments)'), el('td', {}, inr(base.totalPaid)), el('td', { class: 'on' }, inr(scen.totalPaid))]),
            el('tr', { class: 'total' }, [el('td', {}, 'Interest saved'), el('td', {}, '—'), el('td', { class: 'on' }, inr(saved))]),
          ]),
        ])) : null,
        !scen && base.totalInterest > p ? el('p', { class: 'notice warn' }, 'You will pay more in interest than the amount you borrowed. Try a step-up EMI or an extra payment every year on the left to see how much it saves.') : null,
        hasPrepay && !hasStep && mode === 'reduce_tenure' ? el('p', { class: 'muted' }, 'Keeping the EMI and finishing sooner almost always saves more interest than lowering the EMI. Change the last option on the left to compare.') : null,
        hasStep ? el('p', { class: 'muted' }, 'With a step-up EMI the loan always closes sooner, so the "lower EMI" option is switched off.') : null,
        scen && scen.insufficient ? el('p', { class: 'notice error' }, 'The EMI does not cover the interest with these inputs.') : null,
        el('h3', {}, 'Year-by-year schedule' + (scen ? ' (with your changes)' : '')),
        el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [el('thead', {}, el('tr', {}, head.map((h) => el('th', {}, h)))), el('tbody', {}, rows)])),
        el('p', { class: 'muted' }, `Tax note: for a self-occupied home, interest up to ${RUPEE}2,00,000 is deductible in the old regime only. For a let-out home, interest is deductible in both regimes but a loss cannot be set off against salary in the new regime.`),
        fundBox,
        disclaimer(['loan', 'invest']),
      ]);

      const key = `${r}|${y}`;
      if (key !== fundKey) {
        fundKey = key;
        renderFundPanel(fundBox, {
          mode: 'exceeds', target: r, horizon: y,
          title: 'Invest instead of prepaying?',
          intro: `Prepaying returns exactly your loan rate of ${r}% a year, guaranteed and tax-free. These fund categories have typically returned more than that over ${y >= 5 ? 5 : 3}-year periods, but with losses along the way and taxes on gains. Lower risk first.`,
        });
      }
    };
    [P, R, Y, L, LM, A, AS].forEach((f) => f.input.addEventListener('input', debounce(render, 80)));
    step.inputs.forEach((i) => { i.addEventListener('input', debounce(render, 80)); i.addEventListener('change', render); });
    M.input.addEventListener('change', render);
    render();
    return calcShell([
      P.node, R.node, Y.node,
      step.node,
      el('div', { class: 'opts' }, [
        el('div', { class: 'opt-title' }, 'Prepay principal'),
        el('p', { class: 'opt-help' }, 'Paying extra towards the principal cuts the interest you owe. You can make a one-time lump sum payment, an extra payment every year, or both.'),
        el('div', { class: 'sub' }, [el('div', { class: 'sub-title' }, 'One-time lump sum'), el('div', { class: 'two' }, [L.node, LM.node])]),
        el('div', { class: 'sub' }, [el('div', { class: 'sub-title' }, 'Extra payment every year'), el('div', { class: 'two' }, [A.node, AS.node])]),
        M.node,
      ]),
    ], out);
  },

  sip() {
    const A = field(`Monthly SIP (${RUPEE})`, { value: 10000, min: 0, step: 500 });
    const R = field('Expected return (% p.a.)', { value: 12, min: 0, step: 0.5 });
    const Y = field('Years', { value: 10, min: 1, max: 50, step: 1 });
    const step = stepUpControl('SIP');
    const out = el('div');
    const fundBox = el('div');
    let fundKey = '';
    const render = () => {
      const a = v(A), r = v(R), y = v(Y), sp = step.pct(), sa = step.amount();
      const flat = sipFV(a, r, y, 0);
      const stepped = sp > 0 || sa > 0 ? sipFV(a, r, y, sp, sa) : null;
      const main = stepped || flat;
      setChildren(out, [
        el('div', { class: 'stats' }, [
          stat('Projected value', inr(main.fv), true),
          stat('Amount invested', inr(main.invested)),
          stat('Wealth gained', inr(main.gain)),
          stepped ? stat('SIP in the final year', inr(sp > 0 ? main.finalMonthly / (1 + sp / 100) : main.finalMonthly - sa)) : null,
        ]),
        splitBar('Invested', main.invested, 'Gains', main.gain),
        stepped ? el('p', { class: 'explain' }, `A flat ${inr(a)} SIP would reach ${inr(flat.fv)}. Stepping it up ${sp > 0 ? `${sp}%` : inr(sa)} every year reaches ${inr(stepped.fv)}, ${inr(stepped.fv - flat.fv)} more, for ${inr(stepped.invested - flat.invested)} more invested.`) : null,
        el('p', { class: 'muted' }, 'Instalments are assumed at the start of each month (annuity-due), the convention most Indian SIP calculators use. Returns are illustrative and not guaranteed.'),
        fundBox,
        disclaimer('invest'),
      ]);
      const key = `${r}|${y}`;
      if (key !== fundKey) {
        fundKey = key;
        renderFundPanel(fundBox, {
          mode: 'near', target: r, horizon: y,
          title: `What has historically delivered about ${r}% a year?`,
          intro: `Fund categories whose typical ${y >= 5 ? '5' : '3'}-year rolling return sits close to the ${r}% you assumed, with the worst and best stretches investors in them have actually lived through.`,
        });
      }
    };
    [A, R, Y].forEach((f) => f.input.addEventListener('input', debounce(render, 80)));
    step.inputs.forEach((i) => { i.addEventListener('input', debounce(render, 80)); i.addEventListener('change', render); });
    render();
    return calcShell([A.node, R.node, Y.node, step.node], out);
  },

  lumpsum() {
    const P = field(`Amount invested (${RUPEE})`, { value: 1000000, min: 0, step: 10000 });
    const R = field('Expected return (% p.a.)', { value: 12, min: 0, step: 0.5 });
    const Y = field('Years', { value: 10, min: 1, max: 50, step: 1 });
    const out = el('div');
    const fundBox = el('div');
    let fundKey = '';
    const render = () => {
      const p = v(P), r = v(R), y = v(Y);
      const res = lumpsumFV(p, r, y);
      const rows = [];
      for (let k = 1; k <= y; k++) rows.push(el('tr', {}, [el('td', {}, k), el('td', {}, inr(lumpsumFV(p, r, k).fv))]));
      setChildren(out, [
        el('div', { class: 'stats' }, [
          stat('Projected value', inr(res.fv), true),
          stat('Gain', inr(res.gain)),
          stat('Absolute return', pct(res.absReturn, 1)),
          stat('Doubles in about', r > 0 ? `${(72 / r).toFixed(1)} yrs` : '—'),
        ]),
        splitBar('Invested', p, 'Gains', res.gain),
        el('h3', {}, 'Growth by year'),
        el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [
          el('thead', {}, el('tr', {}, [el('th', {}, 'Year'), el('th', {}, 'Value')])), el('tbody', {}, rows),
        ])),
        fundBox,
        disclaimer('invest'),
      ]);
      const key = `${r}|${y}`;
      if (key !== fundKey) {
        fundKey = key;
        renderFundPanel(fundBox, {
          mode: 'near', target: r, horizon: y,
          title: `What has historically delivered about ${r}% a year?`,
          intro: `Fund categories whose typical ${y >= 5 ? '5' : '3'}-year rolling return sits close to the ${r}% you assumed. A lumpsum is exposed to the timing of a single entry, so look hard at the worst window.`,
        });
      }
    };
    [P, R, Y].forEach((f) => f.input.addEventListener('input', debounce(render, 80)));
    render();
    return calcShell([P.node, R.node, Y.node], out);
  },

  goal() {
    const T = field(`Goal amount in today's money (${RUPEE})`, { value: 5000000, min: 0, step: 100000 });
    const Y = field('Years to goal', { value: 15, min: 1, max: 50, step: 1 });
    const R = field('Expected return (% p.a.)', { value: 12, min: 0, step: 0.5 });
    const I = field('Inflation (% p.a.)', { value: 6, min: 0, step: 0.5 });
    const out = el('div');
    const render = () => {
      const t = v(T), y = v(Y), r = v(R), inf = v(I);
      const future = t * Math.pow(1 + inf / 100, y);
      const sip = requiredSip(future, r, y);
      const lump = future / Math.pow(1 + r / 100, y);
      const real = ((1 + r / 100) / (1 + inf / 100) - 1) * 100;
      setChildren(out, [
        el('div', { class: 'stats' }, [
          stat('Future cost of goal', inr(future), true),
          stat('Monthly SIP needed', inr(sip)),
          stat('Or invest today', inr(lump)),
          stat('Real return', real.toFixed(2) + '%'),
        ]),
        el('p', { class: 'muted' }, `${inr(t)} today costs ${inr(future)} in ${y} years at ${inf}% inflation. The real return of ${real.toFixed(2)}% is computed as (1+nominal)/(1+inflation) − 1, not nominal minus inflation.`),
        disclaimer('invest'),
      ]);
    };
    [T, Y, R, I].forEach((f) => f.input.addEventListener('input', debounce(render, 80)));
    render();
    return calcShell([T.node, Y.node, R.node, I.node], out);
  },
};
