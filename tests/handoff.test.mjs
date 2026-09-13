// Calculator hand-offs. Run: node tests/handoff.test.mjs
// A tiny localStorage stand-in so the module runs in Node.
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.document = { createElement: () => ({ setAttribute() {}, append() {}, addEventListener() {}, classList: { toggle() {} } }), createTextNode: () => ({}) };

const { setHandoff, takeHandoff } = await import('../public/js/handoff.js');

let failures = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`); if (!cond) failures++; };

ok('nothing pending returns null', takeHandoff('sip') === null);
setHandoff('sip', { monthly: 12000, years: 10 }, 'budget');
ok('wrong destination does not consume it', takeHandoff('lumpsum') === null && store.has('taxcompass.handoff.v1'));
const h = takeHandoff('sip');
ok('right destination receives values and source', h && h.values.monthly === 12000 && h.values.years === 10 && h.from === 'budget');
ok('consumed once', takeHandoff('sip') === null);
store.set('taxcompass.handoff.v1', JSON.stringify({ to: 'budget', values: { income: 1 }, from: 'salary', at: Date.now() - 11 * 60 * 1000 }));
ok('stale handoff is ignored', takeHandoff('budget') === null);
store.set('taxcompass.handoff.v1', 'not json');
ok('corrupt handoff is ignored', takeHandoff('budget') === null);

console.log(failures === 0 ? '\nAll handoff tests passed.' : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
