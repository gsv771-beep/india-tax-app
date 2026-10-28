// A new car's cost by fuel: on-road price, running cost, ownership and payback. Run: node tests/car.test.mjs
// The expected figures are worked out by hand from the slabs in public/data/car_charges.json.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { onRoad, roadTaxFor, runningPerMonth, ownership, cityById, FUELS } from '../public/engine/car.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(path.join(here, '../public/data/car_charges.json'), 'utf8'));
let failures = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`); if (!cond) failures++; };
const near = (name, a, e, tol = 1) => ok(name, Math.abs(a - e) <= tol, `got ${Math.round(a)}, expected ${Math.round(e)}`);
const city = (id) => cityById(data, id);

// ---- the data file holds together ----
for (const c of data.cities) for (const f of FUELS) {
  const r = roadTaxFor(c, f, 1500000, data);
  ok(`${c.label} ${f}: a road-tax rate is found`, r.pct != null && r.pct >= 0 && r.pct <= 25, String(r.pct));
}
ok('every city has fuel prices, a date and a confidence note', data.cities.every((c) => c.fuel.petrol > 80 && c.fuel.diesel > 80 && c.fuel.as_of && c.confidence));

// ---- on-road price ----
{
  const b = onRoad({ city: city('bengaluru'), fuel: 'petrol', price: 1200000 }, data);
  ok('Bengaluru petrol ₹12 lakh: 17% road tax', b.pct === 17 && b.roadTax === 204000);
  near('... plus the 11% cess on it', b.cess, 22440);
  near('... on the road at ₹14,71,440 (with ₹3,000 fees and 3.5% insurance)', b.total, 1471440);
  near('... and ₹12,000 TCS, cash at purchase but not a cost', b.tcs, 12000);
  const d = onRoad({ city: city('delhi'), fuel: 'diesel', price: 900000 }, data);
  near('Delhi diesel ₹9 lakh: 8.75% road tax, ₹10,13,250 on the road, no TCS', d.total, 1013250); ok('... no TCS under ₹10 lakh', d.tcs === 0);
  const h = onRoad({ city: city('hyderabad'), fuel: 'ev', price: 1500000 }, data);
  near('Hyderabad EV ₹15 lakh: no road tax, the ₹5,000 road safety cess', h.total, 1500000 + 5000 + 3000 + 52500);
  ok('a price on a slab edge takes the lower slab (Chennai ₹10 lakh petrol: 13%)', onRoad({ city: city('chennai'), fuel: 'petrol', price: 1000000 }, data).pct === 13);
  ok('Pune follows Mumbai (Maharashtra)', onRoad({ city: city('pune'), fuel: 'diesel', price: 1500000 }, data).pct === 14);
  ok('Karnataka taxes electric cars from April 2026 (₹15 lakh: 8%), without the cess', (() => { const k = onRoad({ city: city('bengaluru'), fuel: 'ev', price: 1500000 }, data); return k.pct === 8 && k.cess === 0; })());
  ok('a dealer quote replaces the rate', onRoad({ city: city('delhi'), fuel: 'petrol', price: 1000000, roadTaxPct: 9 }, data).roadTax === 90000);
  ok('a hybrid is taxed as petrol unless a state says otherwise', onRoad({ city: city('mumbai'), fuel: 'hybrid', price: 1800000 }, data).pct === 12);
}

// ---- running cost ----
{
  const e = { kmPerMonth: 1000, efficiency: 14, maintenance: 9000, petrolPrice: 102.12, dieselPrice: 95.2, homeRate: 4.5, publicPct: 20, publicRate: 22 };
  near('Delhi petrol at 14 km a litre, 1,000 km a month: ₹7,294 of fuel', runningPerMonth('petrol', 1000000, e, data).energy, 1000 / 14 * 102.12);
  near('Delhi EV at 6.5 km a kWh, 80% home at ₹4.50, 20% public at ₹22: ₹1,231', runningPerMonth('ev', 1400000, { ...e, efficiency: 6.5 }, data).energy, 1000 / 6.5 * 8);
}

// ---- ownership and payback: Delhi, ₹10 lakh petrol against a ₹14 lakh EV, 1,000 km a month, 5 years ----
{
  const r = ownership({ cityId: 'delhi', years: 5, kmPerMonth: 1000, prices: { petrol: 1000000, ev: 1400000 } }, data);
  const p = r.options.find((o) => o.fuel === 'petrol'), v = r.options.find((o) => o.fuel === 'ev');
  near('petrol on the road ₹11,08,000 (7% on ₹10 lakh)', p.road.total, 1108000);
  near('EV on the road ₹14,52,000', v.road.total, 1452000);
  near('petrol over 5 years: on-road + fuel and service for 60 months + 4 renewals', p.total, 1108000 + (1000 / 14 * 102.12 + 750) * 60 + 1000000 * 0.02 / 12 * 48, 2);
  near('EV over 5 years', v.total, 1452000 + (1000 / 6.5 * 8 + 5000 / 12) * 60 + 1400000 * 0.02 / 12 * 48, 2);
  ok('the lower total is named (the EV, by a little)', r.cheapest.fuel === 'ev' && p.total - v.total > 5000 && p.total - v.total < 10000, String(Math.round(p.total - v.total)));
  const pb = r.payback.find((x) => x.fuel === 'ev');
  // money spent so far: the gap of ₹3,44,000 closes by ₹6,397 a month in year one (fuel and service),
  // then by ₹5,730 (the EV's dearer insurance renewal starts): 12 + (3,44,000 − 12 × 6,397) / 5,730
  const gap1 = (1000 / 14 * 102.12 + 750) - (1000 / 6.5 * 8 + 5000 / 12), gap2 = gap1 - (1400000 - 1000000) * 0.02 / 12;
  near('the EV breaks even after about 58.6 months', pb.months * 100, (12 + (344000 - 12 * gap1) / gap2) * 100, 1);
  ok('... against the petrol, ₹3,44,000 dearer to buy', pb.against === 'petrol' && Math.abs(pb.extra - 344000) < 1);
  // over 5 years: ₹3,44,000 − ₹20,000 less servicing + ₹32,000 more insurance = ₹3,56,000 to recover,
  // at ₹6.06 a km less for fuel (₹7.29 against ₹1.23) over 60 months
  near('the EV costs less over 5 years above about 11,742 km a year', pb.kmPerYear, 356000 / ((102.12 / 14 - 8 / 6.5) * 60) * 12, 1);
  ok('... which 12,000 km a year clears (so the EV is lower) and 3,600 does not', pb.kmPerYear < 12000 && pb.kmPerYear > 3600);
  ok('spentBy draws the lines: on-road at month 0, equal at the break-even', Math.abs(r.spentBy(p, 0) - 1108000) < 1 && Math.abs(r.spentBy(p, pb.months) - r.spentBy(v, pb.months)) < 1);
  const shortTrips = ownership({ cityId: 'delhi', years: 5, kmPerMonth: 300, prices: { petrol: 1000000, ev: 1400000 } }, data);
  ok('driving little, the petrol car costs less over 5 years', shortTrips.cheapest.fuel === 'petrol');
  ok('nothing priced, nothing shown', ownership({ cityId: 'delhi', prices: {} }, data).options.length === 0);
  const other = ownership({ cityId: 'other', otherCityPct: 10, prices: { petrol: 1000000 }, petrolPrice: 105 }, data);
  ok('another city: the typed road-tax % is used', other.options[0].road.roadTax === 100000);
}

// ---- cars by slot: two of the same fuel, a resale value ----
{
  const r = ownership({ cityId: 'delhi', years: 5, kmPerMonth: 1000, cars: [{ id: 'A', name: 'Car A', fuel: 'petrol', price: 1000000 }, { id: 'B', name: 'Car B', fuel: 'petrol', price: 1200000, resale: 500000 }] }, data);
  ok('two petrol cars are compared side by side', r.options.length === 2 && r.options.map((o) => o.id).join() === 'A,B');
  const a = r.options[0], b = r.options[1];
  near('Car B on the road: ₹12 lakh at 10%, fees and 3.5% insurance', b.road.total, 1200000 + 120000 + 3000 + 42000);
  const bGross = b.road.total + (1000 / 14 * 102.12 + 750) * 60 + 1200000 * 0.02 / 12 * 48;
  near('a ₹5 lakh resale comes off Car B’s total', b.total, bGross - 500000, 2);
  ok('with the resale, the dearer car costs less over 5 years', r.cheapest.id === 'B' && a.total > b.total);
  ok('payback is reported per car, against the cheaper one to buy; same fuel, so it never catches up', r.payback.length === 1 && r.payback[0].id === 'B' && r.payback[0].againstId === 'A' && r.payback[0].months === null);
  ok('... but its resale makes it lower over 5 years at any distance', r.payback[0].kmPerYear === 0, String(r.payback[0].kmPerYear));
  const per = ownership({ cityId: 'delhi', years: 5, kmPerMonth: 1000, cars: [{ fuel: 'petrol', price: 1000000, efficiency: 20, maintenance: 6000, roadTaxPct: 9 }] }, data).options[0];
  ok('mileage, servicing and the quoted road tax are per car', per.road.roadTax === 90000 && per.efficiency === 20 && per.maintenance === 6000);
}

console.log(failures ? `\n${failures} failure(s)` : '\nAll car tests passed');
process.exit(failures ? 1 : 0);
