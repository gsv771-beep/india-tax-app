/**
 * Builds the tax comparison workbook: Comparison, Break-even, Inputs, Notes.
 */
import { loadExcelJS, X, headerRow, dataRow, sheetTitle, toBase64, safeFileName } from './xlsx-style.js';
import { breakEven, headroom } from './tax-insights.js';

const FY_LABEL = { 'FY2026-27': 'FY 2026-27 (tax year 2026-27, Income-tax Act 2025)', 'FY2025-26': 'FY 2025-26 (AY 2026-27, Income-tax Act 1961)' };
const AGE_LABEL = { below_60: 'Below 60', senior_60_to_79: '60 to 79', super_senior_80_plus: '80 and above' };

export const taxFileName = (who) => safeFileName('taxcompass-tax-comparison', who);

export async function buildTaxWorkbookBase64(inputs, cmp, rates, flags, who = '', ExcelJSLib = null) {
  const ExcelJS = ExcelJSLib || (await loadExcelJS());
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TaxCompass India';
  const today = new Date().toISOString().slice(0, 10);
  const o = cmp.old, n = cmp.new;
  const inp = o.income.inputs;

  // ----- Comparison -----
  const ws = wb.addWorksheet('Comparison', { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 56 }, { width: 18 }, { width: 18 }];
  sheetTitle(ws, 'TaxCompass India: old regime vs new regime', `Prepared ${who ? 'for ' + who + ' ' : ''}on ${today} for ${FY_LABEL[inp.fy] || inp.fy}. Amounts in rupees.`, 'C');
  let r = 4;
  const verdict = cmp.better === 'same' ? 'Both regimes give the same tax.' : `The ${cmp.better} regime is lower by ₹${Math.round(cmp.saving).toLocaleString('en-IN')}.`;
  ws.mergeCells(`A${r}:C${r}`); ws.getCell(`A${r}`).value = verdict; ws.getCell(`A${r}`).font = { bold: true, size: 12, color: { argb: X.white } }; ws.getCell(`A${r}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: X.green } }; ws.getCell(`A${r}`).alignment = { vertical: 'middle', indent: 1 }; ws.getRow(r).height = 24;
  r += 2;
  headerRow(ws, r++, ['Line', 'Old regime', 'New regime']);
  const group = (label) => { const row = dataRow(ws, r++, [label, '', ''], [], { bold: true, fillArgb: X.greenSoft, color: X.green }); row.height = 18; };
  const line = (label, ov, nv, opts = {}) => dataRow(ws, r++, [label, ov, nv], [null, X.inr, X.inr], opts);
  const byId = (arr) => Object.fromEntries(arr.map((l) => [l.id, l]));
  const oL = byId(o.income.lines), nL = byId(n.income.lines);
  const ids = [...new Set([...o.income.lines.map((l) => l.id), ...n.income.lines.map((l) => l.id)])];
  if (ids.length) {
    group('Income');
    for (const id of ids) {
      const l = oL[id] || nL[id];
      if (l.info) continue;
      const ov = oL[id] ? oL[id].amount : 0, nv = nL[id] ? nL[id].amount : 0;
      if (ov === 0 && nv === 0 && !l.subtotal) continue;
      line(l.label, ov, nv, { bold: !!l.subtotal });
    }
  }
  const oV = byId(o.income.via), nV = byId(n.income.via);
  const vIds = [...new Set([...o.income.via.map((v) => v.id), ...n.income.via.map((v) => v.id)])];
  if (vIds.length) {
    group('Chapter VI-A deductions');
    for (const id of vIds) { const v = oV[id] || nV[id]; line(v.label, -(oV[id] ? oV[id].amount : 0), -(nV[id] ? nV[id].amount : 0)); }
    line('Total deductions', -o.income.viaTotal, -n.income.viaTotal, { bold: true });
  }
  const ot = o.tax, nt = n.tax;
  group('Tax computation');
  line('Slab-rate income', ot.slabIncome, nt.slabIncome, { bold: true });
  if (ot.specialTax || nt.specialTax) line('Special-rate income (capital gains, lottery)', ot.totalIncome - ot.slabIncome, nt.totalIncome - nt.slabIncome);
  line('Total income', ot.totalIncome, nt.totalIncome, { bold: true });
  line('Tax at slab rates', ot.slabTax, nt.slabTax);
  if (ot.specialTax || nt.specialTax) line('Tax on special-rate income', ot.specialTax, nt.specialTax);
  if (ot.rebate || nt.rebate) line('Less: rebate u/s 87A / s.156', -ot.rebate, -nt.rebate);
  if (ot.rebateRelief || nt.rebateRelief) line('Less: marginal relief on rebate', -ot.rebateRelief, -nt.rebateRelief);
  if (ot.surcharge || nt.surcharge) { line('Surcharge', ot.surcharge, nt.surcharge); if (ot.surchargeRelief || nt.surchargeRelief) line('Less: marginal relief on surcharge', -ot.surchargeRelief, -nt.surchargeRelief); }
  line('Health and education cess (4%)', ot.cess, nt.cess);
  line('Total tax payable', ot.total, nt.total, { bold: true, fillArgb: X.greenSoft });
  dataRow(ws, r++, ['Effective rate on total income', ot.effectiveRate, nt.effectiveRate], [null, X.pct2, X.pct2]);
  r++;
  const notes = [...o.income.notes.map((t) => 'Old regime: ' + t.replace(/^Old regime: /, '')), ...n.income.notes.map((t) => 'New regime: ' + t.replace(/^New regime: /, '')), ...cmp.warnings];
  if (notes.length) { headerRow(ws, r++, ['Notes', '', '']); for (const t of notes) { ws.mergeCells(`A${r}:C${r}`); dataRow(ws, r++, [t], [], { wrap: true }); } }

  // ----- Break-even -----
  const wb2 = wb.addWorksheet('Break-even', { views: [{ showGridLines: false }] });
  wb2.columns = [{ width: 70 }, { width: 18 }, { width: 18 }, { width: 16 }];
  sheetTitle(wb2, 'How far is the comparison from flipping?', 'Based on the figures you entered.', 'D');
  const be = breakEven(inp, rates, flags);
  const sentence = {
    need: `The new regime is lower by ₹${fmt(be.gap)}. The old regime would win only with about ₹${fmt(be.extra)} more in deductions or exemptions.`,
    impossible: `The new regime is lower by ₹${fmt(be.gap)}, and no amount of old-regime deductions would change that on these figures.`,
    cushion: `The old regime is lower by ₹${fmt(be.margin)}. It stays ahead until about ₹${fmt(be.cushion)} of the ₹${fmt(be.claimed)} you claim is lost.`,
    always: `The old regime is lower by ₹${fmt(be.margin)} and would stay lower even without any of its deductions.`,
    none: 'No income entered.',
  }[be.kind];
  wb2.mergeCells('A4:D4'); wb2.getCell('A4').value = sentence; wb2.getCell('A4').alignment = { wrapText: true, vertical: 'top' }; wb2.getRow(4).height = 34; wb2.getCell('A4').font = { bold: true };
  const hr = headroom(inp, rates, flags);
  headerRow(wb2, 6, ['Deduction', 'Room left', 'Tax saved if used', 'Regime']);
  let rr = 7;
  for (const it of hr.items) {
    dataRow(wb2, rr++, [it.label, it.room, it.saving, it.regime === 'both' ? 'New (old: ₹' + fmt(it.savingOld) + ')' : 'Old only'], [null, X.inr, X.inr, null], { zebra: rr % 2 === 0, wrap: true });
  }
  if (!hr.items.length) dataRow(wb2, rr++, ['No unused room in the common deductions.', '', '', '']);
  rr++;
  wb2.mergeCells(`A${rr}:D${rr}`); wb2.getCell(`A${rr}`).value = 'Tax saved is what these deductions would cut from your tax; you would still have to invest or spend the amount itself. Old-regime items help only if you opt for the old regime.'; wb2.getCell(`A${rr}`).alignment = { wrapText: true }; wb2.getRow(rr).height = 30; wb2.getCell(`A${rr}`).font = { italic: true, color: { argb: X.muted } };

  // ----- Inputs -----
  const wi = wb.addWorksheet('Inputs');
  wi.columns = [{ width: 46 }, { width: 24 }];
  headerRow(wi, 1, ['Field', 'Value']);
  const rows = [
    ['Financial year', FY_LABEL[inp.fy] || inp.fy], ['Residential status', inp.resident ? 'Resident' : 'Non-resident'], ['Age band', AGE_LABEL[inp.ageBand] || inp.ageBand],
    ['Gross salary / pension', inp.salary.gross], ['Basic + DA', inp.salary.basicDa], ['HRA received', inp.salary.hraReceived], ['Rent paid', inp.salary.rentPaid], ['City', inp.salary.city],
    ['LTA exemption', inp.salary.ltaExempt], ['Professional tax', inp.salary.professionalTax],
    ['Employer NPS contribution', inp.employer.npsContribution], ['Government employer', inp.employer.isGovernment ? 'Yes' : 'No'], ['Employer PF + superannuation + NPS', inp.employer.totalRetirementContribution], ['Other perquisites', inp.perquisites.other],
    ['Home loan interest, self-occupied', inp.houseProperty.selfOccupiedInterest], ['Let-out rent', inp.houseProperty.letOut.rent], ['Let-out municipal tax', inp.houseProperty.letOut.municipalTax], ['Let-out interest', inp.houseProperty.letOut.interest],
    ['Business / professional income', inp.business.income], ['Savings interest', inp.otherIncome.savingsInterest], ['FD / RD interest', inp.otherIncome.depositInterest], ['Dividends', inp.otherIncome.dividends], ['Other income', inp.otherIncome.other],
    ['STCG listed equity', inp.capitalGains.stcgEquity], ['LTCG listed equity', inp.capitalGains.ltcgEquity], ['LTCG other assets', inp.capitalGains.ltcgOther], ['Lottery / gaming / VDA', inp.capitalGains.lottery],
    ['EPF counted in 80C', inp.deductions.includeEpf === false ? 'No' : (inp.deductions.epfEmployee > 0 ? inp.deductions.epfEmployee : '12% of Basic + DA')], ['Other 80C investments', inp.deductions.s80c], ['80CCD(1B) own NPS', inp.deductions.nps1b], ['80D self and family', inp.deductions.healthSelf], ['80D parents', inp.deductions.healthParents], ['Parents 60+', inp.deductions.parentsSenior ? 'Yes' : 'No'],
    ['Education loan interest', inp.deductions.educationLoanInterest], ['Donations 80G', inp.deductions.donations], ['Donation category', inp.deductions.donationCategory], ['Disability', inp.deductions.disability],
  ];
  rows.forEach((row, i) => dataRow(wi, 2 + i, row, [null, typeof row[1] === 'number' ? X.inr : null], { zebra: i % 2 === 1 }));

  // ----- Notes -----
  const wn = wb.addWorksheet('Notes');
  wn.columns = [{ width: 110 }];
  [
    'Notes',
    'Rates, slabs, rebate, surcharge, cess and standard deduction are identical for FY 2025-26 (Income-tax Act 1961) and FY 2026-27 (Income-tax Act 2025); section numbers differ.',
    'The rebate under s.87A / s.156 applies to slab-rate tax only; tax on capital gains and lottery is never rebated. Marginal relief on the new-regime rebate is applied to slab-rate tax.',
    'In the new regime a house property loss cannot be set off against salary or carried forward. In the old regime the set-off is capped at ₹2,00,000 a year.',
    'This is an estimate for information only and is not tax advice. Please consult your tax consultant or chartered accountant before taking any decision.',
    'Generated by TaxCompass India on ' + today + '.',
  ].forEach((t, i) => { const c = wn.getCell(`A${i + 1}`); c.value = t; c.alignment = { wrapText: true, vertical: 'top' }; if (i === 0) c.font = { bold: true, size: 14, color: { argb: X.green } }; });

  return toBase64(await wb.xlsx.writeBuffer());
}

const fmt = (n) => Math.round(n || 0).toLocaleString('en-IN');
