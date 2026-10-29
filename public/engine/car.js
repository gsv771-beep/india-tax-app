/**
 * A new car's real cost by fuel: what it costs on the road, what it costs to run, and over the years
 * it is kept, petrol, diesel, strong hybrid and electric side by side. Pure (no DOM).
 * Data: public/data/car_charges.json (road-tax slabs by city and fuel, fees, insurance, fuel prices).
 *
 *   roadTaxFor(city, fuel, price, data) -> { pct, tax, cess, total }
 *   onRoad({ city, fuel, price, roadTaxPct? }, data) -> { exShowroom, pct, roadTax, cess, fees, insurance, total, tcs, cashAtPurchase }
 *   fromOnRoad({ city, fuel, onRoad, roadTaxPct? }, data) -> the same, from the on-road price on a dealer's quote
 *   blendedEfficiency(city, highway, cityPct) -> km a litre (or kWh) over a mix of city and highway driving
 *   ownership(input, data) -> { options: [...], cheapest, lowestUpfront, payback: [...] }
 *
 * Nothing here says which car to buy: it puts the costs side by side and works out how long a dearer
 * car takes to earn back its higher price in running costs, on the figures given.
 */
export const FUELS = ['petrol', 'diesel', 'hybrid', 'ev'];
export const FUEL_LABEL = { petrol: 'Petrol', diesel: 'Diesel', hybrid: 'Strong hybrid', ev: 'Electric' };
const num = (v, d = 0) => (v === '' || v == null || !Number.isFinite(+v) ? d : +v);

/** Another city's fuel price, until one is typed: the average of the cities in the file. */
const avgFuel = (data, f) => data.cities.reduce((s, c) => s + c.fuel[f], 0) / data.cities.length;

export function cityById(data, id) {
  return data.cities.find((c) => c.id === id) || null;
}

/** The slab list for a fuel in a city, following 'same_as' links (to another fuel, or another city). */
function slabsFor(city, fuel, data) {
  let rt = city.road_tax;
  if (typeof rt === 'string' && rt.startsWith('same_as:')) rt = cityById(data, rt.slice(8)).road_tax;
  let s = rt[fuel];
  for (let i = 0; typeof s === 'string' && s.startsWith('same_as:') && i < 4; i++) s = rt[s.slice(8)];
  return s;
}

export function roadTaxFor(city, fuel, price, data, overridePct) {
  const p = Math.max(0, num(price));
  let pct;
  if (overridePct !== '' && overridePct != null && Number.isFinite(+overridePct)) pct = +overridePct;
  else {
    const slabs = city ? slabsFor(city, fuel, data) : null;
    if (!slabs) return { pct: null, tax: 0, cess: 0, total: 0 };
    pct = slabs.find(([upTo]) => upTo == null || p <= upTo)[1];
  }
  const tax = p * pct / 100;
  const isEv = fuel === 'ev';
  const cessPct = city && (!isEv || city.cess_applies_to_ev !== false) ? num(city.cess_pct_of_tax) : 0;
  const flat = city && (!isEv || city.flat_cess_applies_to_ev !== false) ? num(city.flat_cess) : 0;
  const cess = tax * cessPct / 100 + (p > 0 ? flat : 0);
  return { pct, tax, cess, total: tax + cess };
}

export function onRoad({ city, fuel, price, roadTaxPct }, data) {
  const ex = Math.max(0, num(price));
  const rt = roadTaxFor(city, fuel, ex, data, roadTaxPct);
  const fees = ex > 0 ? num(data.fees.registration_and_plates) : 0;
  const insurance = ex * num(data.insurance.first_year_pct) / 100;
  const total = ex + rt.total + fees + insurance;
  // TCS: paid at purchase, claimed back against the year's income tax, so it is cash, not cost
  const tcs = ex > num(data.tcs.threshold) ? ex * num(data.tcs.rate_pct) / 100 : 0;
  return { exShowroom: ex, pct: rt.pct, roadTax: rt.tax, cess: rt.cess, fees, insurance, total, tcs, cashAtPurchase: total + tcs };
}

/**
 * The on-road price as typed, with the ex-showroom price inside it worked back through the city's road
 * tax, fees and first-year insurance. The ex-showroom price only sets the insurance renewals and the TCS;
 * the on-road price is the money paid. A city not in the file is taken at 10% road tax.
 */
export function fromOnRoad({ city, fuel, onRoad: typed, roadTaxPct }, data) {
  const total = Math.max(0, num(typed));
  const pct = city ? roadTaxPct : (roadTaxPct !== '' && roadTaxPct != null ? roadTaxPct : 10);
  let lo = 0, hi = total;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (onRoad({ city, fuel, price: mid, roadTaxPct: pct }, data).total > total) hi = mid; else lo = mid; }
  const r = onRoad({ city, fuel, price: lo, roadTaxPct: pct }, data);
  return { ...r, total, cashAtPurchase: total + r.tcs, fromQuote: true };
}

/** Mileage over a mix of driving: the fuel a km is what adds up, so it is blended per km (a harmonic mean). */
export function blendedEfficiency(city, highway, cityPct) {
  const c = Math.min(100, Math.max(0, num(cityPct))) / 100;
  return 1 / (c / Math.max(0.1, num(city)) + (1 - c) / Math.max(0.1, num(highway)));
}

/**
 * The running cost a month: fuel or electricity, servicing, and the insurance renewal spread over the year.
 * e: { efficiency, maintenance, petrolPrice, dieselPrice, homeRate, publicPct, publicRate, kmPerMonth }
 */
export function runningPerMonth(fuel, exShowroom, e, data) {
  const km = Math.max(0, num(e.kmPerMonth));
  let energyPerKm;
  if (fuel === 'ev') {
    const share = Math.min(100, Math.max(0, num(e.publicPct))) / 100;
    const rate = (1 - share) * num(e.homeRate) + share * num(e.publicRate);
    energyPerKm = rate / Math.max(0.1, num(e.efficiency));
  } else {
    const price = fuel === 'diesel' ? num(e.dieselPrice) : num(e.petrolPrice);
    energyPerKm = price / Math.max(0.1, num(e.efficiency));
  }
  const energy = km * energyPerKm;
  const service = num(e.maintenance) / 12;
  const insurance = exShowroom * num(data.insurance.renewal_pct) / 100 / 12;
  return { energy, energyPerKm, service, insurance, total: energy + service + insurance };
}

/**
 * input: { cityId, years, kmPerMonth, cityPct, cars: [{ id, name, fuel, onRoad (or price, ex-showroom), roadTaxPct?,
 *          effCity?, effHighway? (or efficiency, one figure), maintenance?, resale? }],
 *          otherCityPct, petrolPrice, dieselPrice, homeRate, publicPct, publicRate }
 * (or, instead of cars, one car per fuel: prices: { fuel }, roadTaxPct: { fuel }, efficiency: { fuel }, maintenance: { fuel }).
 * Blank fields take the city's and the file's defaults. A resale value, when given, comes off the total.
 */
export function ownership(input, data) {
  const city = cityById(data, input.cityId);
  const d = data.defaults;
  const years = Math.max(1, num(input.years, d.years)), months = years * 12;
  const kmPerMonth = num(input.kmPerMonth, d.km_per_month);
  const set = (v) => v !== '' && v != null;
  const cars = input.cars || FUELS.map((fuel) => ({ fuel, price: input.prices?.[fuel], roadTaxPct: input.roadTaxPct?.[fuel], efficiency: input.efficiency?.[fuel], maintenance: input.maintenance?.[fuel] }));
  const options = [];
  for (const car of cars) {
    const { fuel } = car, typed = num(car.onRoad);
    if (!FUELS.includes(fuel) || !(typed > 0 || num(car.price) > 0)) continue;
    const override = set(car.roadTaxPct) ? car.roadTaxPct : city ? undefined : input.otherCityPct;
    const road = typed > 0 ? fromOnRoad({ city, fuel, onRoad: typed, roadTaxPct: override }, data) : onRoad({ city, fuel, price: num(car.price), roadTaxPct: override }, data);
    const price = road.exShowroom;
    const effCity = num(car.effCity, d.efficiency_city[fuel]), effHighway = num(car.effHighway, d.efficiency_highway[fuel]);
    const e = {
      kmPerMonth,
      efficiency: set(car.efficiency) ? num(car.efficiency) : blendedEfficiency(effCity, effHighway, num(input.cityPct, d.city_pct)),
      maintenance: num(car.maintenance, d.maintenance_per_year[fuel]),
      petrolPrice: num(input.petrolPrice, city ? city.fuel.petrol : avgFuel(data, 'petrol')),
      dieselPrice: num(input.dieselPrice, city ? city.fuel.diesel : avgFuel(data, 'diesel')),
      homeRate: num(input.homeRate, city ? city.electricity : 7),
      publicPct: num(input.publicPct, d.public_charging_pct),
      publicRate: num(input.publicRate, d.public_charging_rate),
    };
    const run = runningPerMonth(fuel, price, e, data);
    const resale = Math.max(0, num(car.resale));
    // the first year's insurance is in the on-road price; renewals start in year two
    const total = road.total + run.energy * months + run.service * months + run.insurance * (months - 12) - resale;
    const km = kmPerMonth * months;
    options.push({ id: car.id ?? fuel, name: car.name ?? FUEL_LABEL[fuel], fuel, label: FUEL_LABEL[fuel], price, road, run, resale, efficiency: e.efficiency, effCity, effHighway, maintenance: e.maintenance, total, km, perKm: km > 0 ? total / km : 0, runPerKm: kmPerMonth > 0 ? (run.energy + run.service) / kmPerMonth : 0 });
  }
  if (!options.length) return { options, cheapest: null, payback: [], years, kmPerMonth };
  const cheapest = options.reduce((a, b) => (b.total < a.total ? b : a));
  const lowestUpfront = options.reduce((a, b) => (b.road.total < a.road.total ? b : a));
  // Break-even for each car that costs more to buy than the cheapest one to buy:
  //  months: when the money spent so far is equal (the first year's insurance is in the on-road price,
  //          so renewals only start counting from month 12)
  //  kmPerYear: the driving a year above which it costs less over the whole period, resale included
  //          (0: less at any distance; null: never, it costs as much or more a km to run)
  const payback = options.filter((o) => o !== lowestUpfront).map((o) => {
    const c = lowestUpfront, extra = o.road.total - c.road.total;
    const slope1 = (o.run.energy + o.run.service) - (c.run.energy + c.run.service);
    const slope2 = slope1 + (o.run.insurance - c.run.insurance);
    let at = null;
    if (extra <= 0) at = 0;
    else if (slope1 < 0 && extra + slope1 * 12 <= 0) at = extra / -slope1;
    else if (slope2 < 0) at = 12 + (extra + slope1 * 12) / -slope2;
    const fixed = extra + (o.run.service - c.run.service) * months + (o.run.insurance - c.run.insurance) * (months - 12) - (o.resale - c.resale);
    const perKm = (o.run.energyPerKm - c.run.energyPerKm) * months;
    const kmPerYear = perKm < 0 ? Math.max(0, fixed / -perKm) * 12 : fixed < 0 ? 0 : null;
    return { id: o.id, fuel: o.fuel, againstId: c.id, against: c.fuel, extra, savingPerMonth: -slope2, months: at, km: at != null ? at * kmPerMonth : null, withinYears: at != null && at <= months, kmPerYear };
  });
  /** The money spent on a car by month t (before any resale): for drawing the lines that cross. */
  const spentBy = (o, t) => o.road.total + (o.run.energy + o.run.service) * t + o.run.insurance * Math.max(0, t - 12);
  return { options, cheapest, lowestUpfront, payback, spentBy, years, kmPerMonth, city };
}
