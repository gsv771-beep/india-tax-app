/**
 * One workbook builder for every calculator. A calculator describes its export as a spec:
 *
 *   { title, subtitle, sheets: [ { name, columns: [{ header, width, fmt }], rows: [[...]],
 *                                  sections?: [{ label, rows: [[...]] }], note?: string } ],
 *     inputs: [[label, value, fmt?]], notes: [string] }
 *
 * and gets back a styled .xlsx as base64 (Inputs and Notes sheets are added automatically).
 * Works in the browser and in Node (pass ExcelJS in for tests).
 */
import { loadExcelJS, X, headerRow, dataRow, sheetTitle, toBase64, safeFileName } from './xlsx-style.js';

const COL = (n) => String.fromCharCode(64 + Math.max(1, Math.min(26, n)));

export const calcFileName = (prefix) => (who) => safeFileName(`taxcompass-${prefix}`, who);

export async function buildCalcWorkbookBase64(spec, who = '', ExcelJSLib = null) {
  const ExcelJS = ExcelJSLib || (await loadExcelJS());
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TaxCompass India';
  const today = new Date().toISOString().slice(0, 10);
  const stamp = `Prepared ${who ? 'for ' + who + ' ' : ''}on ${today}. Amounts in rupees unless stated.`;

  for (const sh of spec.sheets) {
    const ws = wb.addWorksheet(sh.name.slice(0, 31), { views: [{ showGridLines: false }] });
    const cols = sh.columns;
    ws.columns = cols.map((c) => ({ width: c.width || 18 }));
    sheetTitle(ws, spec.title, sh.subtitle || spec.subtitle || stamp, COL(cols.length));
    let r = 4;
    if (sh.headline) {
      ws.mergeCells(`A${r}:${COL(cols.length)}${r}`);
      const c = ws.getCell(`A${r}`); c.value = sh.headline; c.font = { bold: true, size: 12, color: { argb: X.white } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: X.green } }; c.alignment = { vertical: 'middle', indent: 1, wrapText: true }; ws.getRow(r).height = 24;
      r += 2;
    }
    headerRow(ws, r++, cols.map((c) => c.header));
    const fmts = cols.map((c) => c.fmt || null);
    const emit = (rows) => rows.forEach((row, i) => {
      const values = Array.isArray(row) ? row : row.values;   // arrays have a .values() method, so test the shape
      const opts = Array.isArray(row) ? {} : row.opts || {};
      dataRow(ws, r++, values.map((v) => (v === undefined || v === null ? '' : v)), fmts, { zebra: !opts.bold && i % 2 === 1, ...opts });
    });
    if (sh.sections) {
      for (const sec of sh.sections) {
        dataRow(ws, r++, [sec.label, ...cols.slice(1).map(() => '')], [], { bold: true, fillArgb: X.greenSoft, color: X.green });
        emit(sec.rows);
      }
    } else emit(sh.rows || []);
    if (sh.note) { r++; ws.mergeCells(`A${r}:${COL(cols.length)}${r}`); const c = ws.getCell(`A${r}`); c.value = sh.note; c.font = { italic: true, size: 9, color: { argb: X.muted } }; c.alignment = { wrapText: true, vertical: 'top' }; ws.getRow(r).height = Math.min(90, 15 * Math.ceil(sh.note.length / 110)); }
  }

  if (spec.inputs && spec.inputs.length) {
    const ws = wb.addWorksheet('Inputs', { views: [{ showGridLines: false }] });
    ws.columns = [{ width: 46 }, { width: 24 }];
    sheetTitle(ws, spec.title, 'Every figure you entered, so it can be checked.', 'B');
    let r = 4;
    headerRow(ws, r++, ['Field', 'Value']);
    spec.inputs.forEach(([label, value, fmt], i) => dataRow(ws, r++, [label, value], [null, fmt || (typeof value === 'number' && Math.abs(value) >= 1000 ? X.inr : null)], { zebra: i % 2 === 1 }));
  }

  const notes = [...(spec.notes || []), 'Built by TaxCompass India (taxcompass.org). Nothing you enter leaves your browser except this workbook, sent once to the address you gave.', 'This is an illustration for information only and is not tax, legal, financial or investment advice. Please consult your chartered accountant, bank or a SEBI-registered adviser before acting.'];
  const wn = wb.addWorksheet('Notes', { views: [{ showGridLines: false }] });
  wn.columns = [{ width: 110 }];
  sheetTitle(wn, spec.title, 'Assumptions and sources behind the numbers.', 'A');
  let r = 4;
  for (const n of notes) { const c = wn.getCell(`A${r}`); c.value = n; c.alignment = { wrapText: true, vertical: 'top' }; wn.getRow(r).height = Math.max(18, 15 * Math.ceil(n.length / 100)); r++; }

  return toBase64(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------------------------------------
// Per-calculator specs. Each takes the plain numbers the calculator just computed and returns a spec.
const bold = (values) => ({ values, opts: { bold: true } });
const fmtINR = (n) => Math.round(n).toLocaleString('en-IN');

export const SPECS = {
  salary(x) {
    const { st, r } = x;
    return {
      title: 'TaxCompass India: in-hand salary',
      sheets: [{
        name: 'Salary', headline: `About ₹${fmtINR(r.monthly)} a month in hand under the ${r.regime} regime`,
        columns: [{ header: 'Component', width: 52 }, { header: 'Per year', fmt: X.inr }, { header: 'Per month', fmt: X.inr }],
        sections: [
          { label: 'Cost to company', rows: [['Basic + DA', r.basic, r.basic / 12], ['HRA', r.hra, r.hra / 12], ['Special allowance', r.special, r.special / 12], r.employerNps ? ['Employer NPS (80CCD(2))', r.employerNps, r.employerNps / 12] : null, r.employerPf ? ['Employer PF', r.employerPf, r.employerPf / 12] : null, r.gratuity ? ['Gratuity provision', r.gratuity, r.gratuity / 12] : null, bold(['Cost to company', r.ctc, r.ctc / 12])].filter(Boolean) },
          { label: 'From gross salary to in-hand', rows: [bold(['Gross salary paid to you', r.grossSalary, r.grossSalary / 12]), ['Less: your PF (12% of basic)', -r.employeePf, -r.employeePf / 12], r.professionalTax ? ['Less: professional tax', -r.professionalTax, -r.professionalTax / 12] : null, [`Less: income tax, ${r.regime} regime`, -r.tax, -r.tax / 12], bold(['In hand', r.annual, r.monthly])].filter(Boolean) },
          { label: 'The other regime', rows: [['In hand under the old regime', r.inHandOld, r.inHandOld / 12], ['In hand under the new regime', r.inHandNew, r.inHandNew / 12]] },
        ],
      }],
      inputs: [['Annual CTC', r.ctc], ['Basic as % of CTC', +st.basicPct, '0.00'], ['HRA as % of basic', +st.hraPct, '0.00'], ['Employer PF in CTC', st.includeEmployerPf !== false ? 'Yes' : 'No'], ['Gratuity in CTC', st.includeGratuity !== false ? 'Yes' : 'No'], ['Employer NPS as % of basic', +st.employerNpsPct || 0, '0.00'], ['City', st.city], ['Annual rent paid', +st.rentPaid || 0], ['Professional tax per year', +st.professionalTax || 0], ['Other 80C', +st.other80c || 0], ['Own NPS 80CCD(1B)', +st.nps1b || 0], ['Health insurance', +st.healthSelf || 0], ['Age band', st.ageBand], ['Regime', st.regime]],
      notes: ['Income tax is computed by the TaxCompass engine for FY 2026-27 with the standard deduction, your own EPF in 80C (old regime), HRA exemption from the rent you entered (old regime) and employer NPS under 80CCD(2) in both regimes.', 'Bonuses, variable pay, meal cards and other perquisites are not modelled; add them to CTC if paid in cash.'],
    };
  },

  emi(x) {
    const { p, r, y, base, scen, mode, stepPct, stepAmt, lump, lumpMonth, annual, annualStart, preEmi, cm, price, down } = x;
    const show = scen || base;
    const summary = [['Loan amount', p], ['Interest rate (% p.a.)', r], ['Tenure (years)', y], bold(['Monthly EMI', base.emi]), ['Total interest without changes', base.totalInterest], ['Total payment without changes', base.totalPaid]];
    if (scen) summary.push(['Interest with your changes', scen.totalInterest], bold(['Interest saved', base.totalInterest - scen.totalInterest]), ['Loan closes in (months)', scen.months], ['Months saved', base.months - scen.months], mode === 'reduce_emi' ? ['EMI after prepayments', scen.finalEmi] : null, stepPct || stepAmt ? ['EMI in the final year', scen.maxEmi] : null);
    if (price > 0) summary.unshift(['Property price', price], ['Down payment', down]);
    if (preEmi > 0) summary.push([`Pre-EMI interest over ${cm} months of construction`, preEmi]);
    return {
      title: 'TaxCompass India: EMI and prepayment plan',
      sheets: [
        { name: 'Summary', headline: `EMI ₹${fmtINR(base.emi)} a month on ₹${fmtINR(p)} at ${r}% for ${y} years`, columns: [{ header: 'Item', width: 48 }, { header: 'Value', width: 20, fmt: '#,##0.00' }], rows: summary.filter(Boolean), note: 'Rupee figures are amounts; the rate is % a year; tenure and months are counts.' },
        { name: 'Schedule', columns: [{ header: 'Year', width: 8, fmt: '0' }, { header: 'EMI', fmt: X.inr }, { header: 'Principal repaid', fmt: X.inr }, { header: 'Interest paid', fmt: X.inr }, { header: 'Prepaid', fmt: X.inr }, { header: 'Balance at year end', fmt: X.inr }], rows: show.years.map((yr) => [yr.year, yr.emi, yr.principal, yr.interest, yr.prepaid, yr.balance]), note: scen ? 'Schedule with your step-up and prepayments applied.' : 'Plain schedule with no step-up or prepayment.' },
      ],
      inputs: [['Loan amount', p], ['Interest rate (% p.a.)', r, '0.00'], ['Tenure (years)', y, '0'], ['Step-up per year (%)', stepPct, '0.00'], ['Step-up per year (rupees)', stepAmt], ['Lump sum prepayment', lump], ['Lump sum paid in month', lumpMonth, '0'], ['Extra payment every year', annual], ['Extra payment from year', annualStart, '0'], ['After each prepayment keep', mode === 'reduce_emi' ? 'the same tenure, lower EMI' : 'the same EMI, shorter tenure'], price > 0 ? ['Property price', price] : null, price > 0 ? ['Down payment', down] : null, cm > 0 ? ['Construction months', cm, '0'] : null].filter(Boolean),
      notes: ['Monthly rests: EMI = P x r x (1+r)^n / ((1+r)^n - 1) with r the annual rate / 12. A step-up always shortens the tenure. Prepayments reduce the tenure or the EMI as chosen.', 'Pre-EMI interest assumes the loan is released evenly over the construction months; the home-buying tool models the exact stage plan.', 'Tax: for a self-occupied home, interest up to 2,00,000 a year is deductible in the old regime only.'],
    };
  },

  sip(x) {
    const { a, r, y, sp, sa, lumps, main, flat, sipOnly, series } = x;
    return {
      title: 'TaxCompass India: SIP projection',
      sheets: [
        { name: 'Summary', headline: `About ₹${fmtINR(main.fv)} after ${y} years at ${r}% a year`, columns: [{ header: 'Item', width: 44 }, { header: 'Value', width: 20, fmt: X.inr }], rows: [['Monthly SIP', a], ['Lump sums added', lumps.reduce((s, l) => s + l.amount, 0)], bold(['Amount invested', main.invested]), bold(['Projected value', main.fv]), ['Wealth gained', main.gain], sp || sa ? ['Value with a flat SIP (no step-up)', flat.fv] : null, lumps.length && a > 0 ? ['Value from the SIP alone', sipOnly.fv] : null].filter(Boolean) },
        { name: 'Year by year', columns: [{ header: 'Year', width: 8, fmt: '0' }, { header: 'Invested so far', fmt: X.inr }, { header: 'Value', fmt: X.inr }, { header: 'Gain', fmt: X.inr }], rows: series.map((s) => [s.year, s.invested, s.fv, s.fv - s.invested]) },
        lumps.length ? { name: 'Lump sums', columns: [{ header: 'Amount', fmt: X.inr }, { header: 'At end of year', width: 16, fmt: '0' }], rows: lumps.map((l) => [l.amount, l.atYear]) } : null,
      ].filter(Boolean),
      inputs: [['Monthly SIP', a], ['Expected return (% p.a.)', r, '0.00'], ['Years', y, '0'], ['Step-up per year (%)', sp, '0.00'], ['Step-up per year (rupees)', sa]],
      notes: ['Instalments at the start of each month (annuity-due); everything compounds monthly at the annual rate / 12; lump sums earn from the end of the year they are added. Returns are illustrative, not guaranteed.'],
    };
  },

  goal(x) {
    const { target, y, r, inf, sip, lump, invested, todayValue } = x;
    return {
      title: 'TaxCompass India: goal plan',
      sheets: [{ name: 'Goal', headline: `₹${fmtINR(sip)} a month for ${y} years reaches ₹${fmtINR(target)}`, columns: [{ header: 'Item', width: 44 }, { header: 'Value', width: 20, fmt: X.inr }], rows: [['Amount you want to have', target], bold(['Monthly SIP needed', sip]), bold(['Or invest today, once', lump]), ['Total put in via SIP', invested], ['Worth in today’s money', todayValue]] }],
      inputs: [['Target amount', target], ['Years', y, '0'], ['Expected return (% p.a.)', r, '0.00'], ['Inflation (% p.a.)', inf, '0.00']],
      notes: ['SIP needed = target x i / (((1+i)^n - 1) x (1+i)), i = annual return / 12, n = months. The one-time amount discounts the target at the annual return. Inflation is used only to state the target in today’s money.'],
    };
  },

  capgains(x) {
    const { st, r } = x;
    const rows = r.lines.map((l) => (l.subtotal ? bold([l.label, l.amount]) : [l.label, l.amount]));
    if (r.gain > 0) { if (r.exemptionUsed) rows.push(['Taxable gain', r.taxableGain]); rows.push([`Tax at ${r.rateLabel}`, r.tax], ['Health and education cess (4%)', r.cess], bold(['Tax on this sale', r.total])); }
    const sheets = [{ name: 'Computation', headline: r.gain <= 0 ? `${r.longTerm ? 'Long-term' : 'Short-term'} capital loss of ₹${fmtINR(-r.gain)}: no tax due` : `${r.classification} gain of ₹${fmtINR(r.gain)}, tax ₹${fmtINR(r.total)} at ${r.rateLabel}`, columns: [{ header: 'Line', width: 60 }, { header: 'Amount', width: 20, fmt: X.inr }], rows }];
    if (r.options) sheets.push({ name: 'Two options', columns: [{ header: 'Item', width: 30 }, { header: r.options.plain.label, width: 26, fmt: X.inr }, { header: r.options.indexed.label, width: 26, fmt: X.inr }], rows: [['Gain', r.options.plain.gain, r.options.indexed.gain], bold(['Tax before cess', r.options.plain.tax, r.options.indexed.tax]), [`Applied: ${r.options[r.options.chosen].label}`, '', '']], note: `Indexation: cost x CII of FY ${r.options.indexed.ciiSell.fy} (${r.options.indexed.ciiSell.value}) / CII of FY ${r.options.indexed.ciiBuy.fy} (${r.options.indexed.ciiBuy.value}).` });
    return {
      title: 'TaxCompass India: capital gains',
      sheets,
      inputs: [['Asset', st.asset], ['Bought on', st.buyDate], ['Sold on', st.sellDate], ['Cost of acquisition', +st.cost || 0], ['Sale value', +st.sale || 0], ['Expenses on transfer', +st.expenses || 0], st.fmv2018 ? ['FMV on 31 Jan 2018', +st.fmv2018] : null, st.fmv2001 ? ['FMV on 1 Apr 2001', +st.fmv2001] : null, st.impAmount ? ['Cost of improvement', +st.impAmount] : null, ['Slab rate', +st.slabRate, '0%'], ['Other equity LTCG this year', +st.otherEquityLtcgThisYear || 0]].filter(Boolean),
      notes: [`Holding period ${r.months} months against a ${r.holdingRule} threshold. Section ${r.section1961} of the 1961 Act, ${r.section2025} of the 2025 Act.`, ...r.notes],
    };
  },

  home(x) {
    const { st, c, e, plan, downPayment, cashNeeded } = x;
    return {
      title: 'TaxCompass India: buying a home',
      sheets: [
        { name: 'Cost', headline: `₹${fmtINR(c.total)} to actually own a ₹${fmtINR(c.price)} home in ${c.city}`, columns: [{ header: 'Item', width: 64 }, { header: 'Amount', width: 20, fmt: X.inr }, { header: '% of price', width: 12, fmt: X.pct }], rows: [...c.lines.map((l) => (l.kind === 'price' ? bold([l.label, l.amount, '']) : [l.label, l.amount, c.price ? l.amount / c.price : 0])), bold(['All-in cost', c.total, c.price ? c.total / c.price : 0]), ['Of which not on the sticker', c.hiddenTotal, c.hiddenPct], ['Your money in total (all-in cost less loan)', cashNeeded, '']], note: [...c.warnings, ...c.notes].join(' ') },
        { name: 'Loan', headline: e.rejected ? 'A lender is unlikely to sanction at this credit score' : `Loan ₹${fmtINR(e.loan)}, EMI ₹${fmtINR(e.emi)} at ${e.rate.effective.toFixed(2)}% for ${e.tenure.used} years`, columns: [{ header: 'Item', width: 60 }, { header: 'Value', width: 22, fmt: '#,##0.##' }], sections: [
          { label: 'Result', rows: [['Down payment', downPayment], bold(['Loan', e.loan]), ['Monthly EMI', e.emi], ['Rate after credit-score premium (%)', +e.rate.effective.toFixed(2)], ['Tenure (years)', e.tenure.used], ['EMIs as a share of counted income after this loan', `${(e.foir.after * 100).toFixed(1)}%`], ['Lender FOIR cap', `${(e.foir.rate * 100).toFixed(0)}%`]] },
          { label: 'The tests', rows: [['Income the lender counts (per month)', e.income.counted], ['Existing obligations (per month)', e.existingEmi], ['Room for a new EMI (per month)', e.maxEmi], ['Ceiling by repayment capacity', e.maxByFoir], ['Ceiling by RBI loan-to-value cap', e.maxByLtv ?? 'n/a'], ['Tenure allowed by age (years)', e.tenure.allowedByAge], ['Binding constraint', e.binding]] },
          { label: 'What would raise the ceiling', rows: e.levers.length ? e.levers.map((l) => [l.label, l.info ? '' : l.gain]) : [['Nothing material', '']] },
        ], note: e.warnings.join(' ') },
        { name: 'Payment plan', headline: plan.constructionMonths > 0 ? `Pre-EMI interest ₹${fmtINR(plan.preEmiTotal)} over ${plan.constructionMonths} months; EMI from month ${plan.emiStartMonth}` : 'One payment on registration; EMI from the following month', columns: [{ header: 'Month', width: 8, fmt: '0' }, { header: 'Stage', width: 32 }, { header: 'Builder demands', fmt: X.inr }, { header: 'From you', fmt: X.inr }, { header: 'Bank releases', fmt: X.inr }, { header: 'Loan released so far', fmt: X.inr }, { header: 'Pre-EMI until next stage', fmt: X.inr }], rows: plan.rows.map((row) => [row.month, `${row.label} (${+row.pct.toFixed(1)}%)`, row.due + row.gst, row.fromYou, row.fromBank, row.cumulativeLoan, row.preEmiUntilNext || 0]), note: `Cash at booking ₹${fmtINR(plan.cashAtBooking)}; paid by you by possession ₹${fmtINR(plan.youByPossession)} including GST of ₹${fmtINR(plan.gstTotal)} and pre-EMI interest. ${plan.warnings.join(' ')}` },
      ],
      inputs: [['City', st.city], ['Agreed price', +st.price], ['What you are buying', st.status], ['Registered in the name of', st.buyer], ['Affordable housing (GST 1%)', st.affordable ? 'Yes' : 'No'], ['Brokerage (%)', +st.brokerageRate || 0, '0.00'], ['Interiors', +st.interiors || 0], ['Legal and valuation', +st.legalAndValuation || 0], ['Net monthly take-home', +st.netMonthly || 0], ['Variable pay per month', +st.variablePayMonthly || 0], ['Rental income per month', +st.rentalMonthly || 0], ['Co-applicant net monthly income', +st.coApplicantMonthly || 0], ['Existing EMIs per month', +st.existingEmi || 0], ['Credit card balances', +st.creditCardOutstanding || 0], ['Credit score', +st.creditScore || 0, '0'], ['Age', +st.age || 0, '0'], ['Employment', st.employment], ['Interest rate offered (%)', +st.ratePct, '0.00'], ['Tenure wanted (years)', +st.tenureYears, '0'], ['Down payment entered', st.downPayment === '' ? 'least the lender allows' : +st.downPayment], ['Income basis', st.incomeBasis], ['FOIR override (%)', st.foirOverride === '' ? 'by income band' : +st.foirOverride], ['Loan must end by age', st.loanEndAge === '' ? 'lender default' : +st.loanEndAge]],
      notes: ['Stamp duty, registration and GST rates are from data/property_charges.json with a source, date and confidence per city; rates marked corroborated or unverified should be confirmed with the sub-registrar or lender. Only the RBI loan-to-value cap is law; FOIR bands, age cutoffs and credit-score pricing are lender conventions and every one is editable on the page.', 'Your own money is used before any loan is released. Pre-EMI interest is charged monthly on the released amount at the loan rate; interest paid before possession is deductible in five equal yearly instalments from the year of possession, within the 2,00,000 self-occupied cap, old regime only.', 'If the price is 50 lakh or more, deduct 1% TDS from what you pay the seller (Form 26QB).'],
    };
  },
};
