/**
 * True cost of buying a home: the sticker price plus everything that is not on the sticker.
 * Pure functions; rates come from data/property_charges.json (passed in as `data`).
 *
 * propertyCost(inputs, data) -> { lines, price, statutory, total, hiddenTotal, hiddenPct, cashBeforeLoan, notes, warnings }
 *
 * inputs: {
 *   city, price,
 *   status: 'under_construction' | 'ready' | 'resale',
 *   buyer: 'man' | 'woman' | 'joint',
 *   affordable: bool            (GST 1% band: carpet area and value limits)
 *   brokerageRate: 0.01         (applies to resale only unless brokerageOnNew is true)
 *   brokerageOnNew: bool
 *   builderCharges: [{ label, amount }]   free-form, rupees
 *   interiors: 0                optional
 *   legalAndValuation: 10000
 *   loanAmount: 0               drives processing fee and mortgage-deed stamp
 *   processingFeeRate: 0.005, processingFeeCap: 25000
 * }
 */

export const PROPERTY_CITIES = ['Mumbai', 'Delhi', 'Bengaluru', 'Hyderabad', 'Chennai', 'Kolkata', 'Pune'];
export const STATUSES = ['under_construction', 'ready', 'resale'];
export const BUYERS = ['man', 'woman', 'joint'];

const num = (v) => (Number.isFinite(+v) ? +v : 0);

/** Stamp duty for a city on a value, by buyer category. Returns { amount, rate, label }. */
export function stampDuty(city, value, buyer, data) {
  const c = data.cities[city];
  if (!c) throw new Error(`No charge data for ${city}`);
  const sd = c.stamp_duty;
  let rate;
  if (sd.slabs) {
    const slab = sd.slabs.find((s) => s.upto == null || value <= s.upto);
    rate = slab.rate;
  } else {
    rate = sd.by_buyer[buyer] ?? sd.by_buyer.man;
  }
  let amount = value * rate;
  const parts = [`${pct(rate)} stamp duty`];
  if (sd.surcharge_on_duty) { amount *= 1 + sd.surcharge_on_duty; parts.push(`${pct(sd.surcharge_on_duty)} cess and surcharge on the duty`); }
  if (sd.transfer_duty) { amount += value * sd.transfer_duty; parts.push(`${pct(sd.transfer_duty)} transfer duty`); }
  return { amount, rate: value > 0 ? amount / value : 0, label: parts.join(' + '), confidence: sd.confidence, composition: sd.composition };
}

/** Registration fee: rate with an optional cap and fixed extra. */
export function registrationFee(city, value, data) {
  const r = data.cities[city].registration;
  let amount = value * r.rate;
  if (r.cap != null) amount = Math.min(amount, r.cap);
  amount += r.fixed_extra || 0;
  return { amount, rate: r.rate, cap: r.cap, note: r.note, confidence: r.confidence };
}

export function gstOnPurchase(price, status, affordable, data) {
  if (status !== 'under_construction') return { amount: 0, rate: 0 };
  const rate = affordable ? data.gst.under_construction.affordable : data.gst.under_construction.standard;
  return { amount: price * rate, rate };
}

function pct(x) { return `${+(x * 100).toFixed(2)}%`; }

export function propertyCost(inputsIn, data) {
  const i = { status: 'ready', buyer: 'man', affordable: false, brokerageRate: data.customary.brokerage.default_rate, brokerageOnNew: false, builderCharges: [], interiors: 0, legalAndValuation: data.customary.legal_and_valuation.default_amount, loanAmount: 0, processingFeeRate: data.customary.loan_processing_fee.default_rate, processingFeeCap: data.customary.loan_processing_fee.cap, ...inputsIn };
  const price = num(i.price);
  const city = data.cities[i.city] ? i.city : PROPERTY_CITIES[0];
  const lines = [];
  const warnings = [];
  const notes = [];
  const add = (id, label, amount, extra = {}) => { if (amount > 0) lines.push({ id, label, amount, ...extra }); };

  add('price', 'Agreed price', price, { kind: 'price' });

  // --- statutory: paid to the state on registration ---
  const sd = stampDuty(city, price, i.buyer, data);
  add('stamp_duty', `Stamp duty, ${city} (${sd.label})`, sd.amount, { kind: 'statutory', confidence: sd.confidence, detail: sd.composition });
  if (sd.confidence !== 'verified') warnings.push(`Stamp duty for ${city} is ${sd.confidence}: ${data.cities[city].stamp_duty.conflict || 'confirm with the sub-registrar before relying on it'}.`);
  const reg = registrationFee(city, price, data);
  add('registration', `Registration fee (${pct(reg.rate)}${reg.cap ? `, capped at ₹${reg.cap.toLocaleString('en-IN')}` : ''})`, reg.amount, { kind: 'statutory', confidence: reg.confidence, detail: reg.note });
  const gst = gstOnPurchase(price, i.status, i.affordable, data);
  if (i.status === 'under_construction') add('gst', `GST on under-construction property (${pct(gst.rate)}${i.affordable ? ', affordable housing' : ''})`, gst.amount, { kind: 'statutory', confidence: data.gst.confidence, detail: data.gst.note });
  else notes.push('No GST: it applies only to under-construction property bought from a builder.');

  // --- customary: brokerage, legal, builder extras ---
  const brokerage = i.status === 'resale' || i.brokerageOnNew ? price * num(i.brokerageRate) : 0;
  add('brokerage', `Brokerage (${pct(num(i.brokerageRate))})`, brokerage, { kind: 'customary' });
  add('legal', 'Legal, title search and valuation', num(i.legalAndValuation), { kind: 'customary' });
  for (const [k, b] of (i.builderCharges || []).entries()) add(`builder_${k}`, b.label || 'Builder charge', num(b.amount), { kind: 'builder' });
  add('interiors', 'Interiors and furnishing', num(i.interiors), { kind: 'optional' });

  // --- loan-linked ---
  const loan = num(i.loanAmount);
  if (loan > 0) {
    const fee = Math.min(loan * num(i.processingFeeRate), num(i.processingFeeCap) || Infinity);
    add('processing_fee', `Loan processing fee (${pct(num(i.processingFeeRate))}${i.processingFeeCap ? `, capped at ₹${num(i.processingFeeCap).toLocaleString('en-IN')}` : ''})`, fee, { kind: 'loan' });
    const md = data.cities[city].mortgage_deed_stamp;
    if (md) {
      const stamp = Math.min(loan * md.rate, md.cap || Infinity);
      add('mortgage_stamp', `Stamp duty on the mortgage deed (${pct(md.rate)} of loan${md.cap ? `, max ₹${md.cap.toLocaleString('en-IN')}` : ''})`, stamp, { kind: 'loan', confidence: md.confidence, detail: md.note });
      if (md.confidence === 'unverified') warnings.push(`The mortgage-deed stamp for ${city} is unverified; your lender will quote the exact figure.`);
    }
  }

  if (price >= 5000000) notes.push(data.customary.tds_note);

  const sum = (kind) => lines.filter((l) => l.kind === kind).reduce((s, l) => s + l.amount, 0);
  const statutory = sum('statutory');
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const hiddenTotal = total - price;
  return {
    city, price, lines, statutory, customary: sum('customary'), builder: sum('builder'), optional: sum('optional'), loanCosts: sum('loan'),
    total, hiddenTotal, hiddenPct: price > 0 ? hiddenTotal / price : 0,
    financeable: price, // the bank lends against the price only
    cashBeforeLoan: total,
    notes, warnings,
  };
}
