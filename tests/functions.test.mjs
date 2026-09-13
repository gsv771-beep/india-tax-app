// Feedback and counter functions, exercised with a tiny in-memory stand-in for D1. No network.
import { onRequestPost as feedbackPost, onRequestGet as feedbackGet } from '../functions/api/feedback.js';
import { onRequestGet as counterGet, onRequestPost as counterPost } from '../functions/api/counter.js';

let failures = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`); if (!cond) failures++; };

/** Minimal fake of the D1 API used by the functions: batch/prepare/bind/run/all. */
function fakeDb() {
  const counters = new Map(); const feedback = [];
  const stmt = (sql) => ({
    _args: [],
    bind(...a) { this._args = a; return this; },
    async run() {
      if (/INSERT INTO counters/.test(sql)) { const [name] = this._args; counters.set(name, (counters.get(name) || 0) + 1); return { success: true }; }
      if (/INSERT INTO feedback/.test(sql)) { feedback.push(this._args); return { success: true }; }
      return { success: true };
    },
    async all() { if (/FROM counters/.test(sql)) return { results: [...counters].map(([name, value]) => ({ name, value })) }; return { results: [] }; },
  });
  return { prepare: stmt, async batch() { return []; }, _counters: counters, _feedback: feedback };
}
const post = (fn, body, env = {}) => fn({ request: new Request('http://x/api', { method: 'POST', headers: { 'user-agent': 'test' }, body: JSON.stringify(body) }), env });

// feedback guards
{
  let r = await post(feedbackPost, { name: 'A', message: 'hello there' }, {});
  ok('feedback: 503 when nothing configured', r.status === 503);
  const env = { DB: fakeDb() };
  r = await post(feedbackPost, { name: '', message: 'hello there' }, env); ok('feedback: name required', r.status === 400);
  r = await post(feedbackPost, { name: 'A', message: 'hi' }, env); ok('feedback: message too short', r.status === 400);
  r = await post(feedbackPost, { name: 'A', message: 'hello there', email: 'nope' }, env); ok('feedback: bad email rejected', r.status === 400);
  r = await post(feedbackPost, { name: 'A', message: 'hello there', website: 'spam' }, env); ok('feedback: honeypot returns ok without storing', r.status === 200 && env.DB._feedback.length === 0);
  r = await post(feedbackPost, { name: 'Asha', message: 'The HRA field confused me', rating: 4, page: '/tax' }, env);
  const j = await r.json();
  ok('feedback: stored in D1 with no email', r.status === 200 && j.stored === true && j.mailed === false && env.DB._feedback.length === 1 && env.DB._feedback[0][2] === null);
  ok('feedback: rating kept', env.DB._feedback[0][3] === 4);
  r = await post(feedbackPost, { name: 'A', message: 'hello there', rating: 9 }, env); ok('feedback: out-of-range rating dropped', (await r.json()).ok && env.DB._feedback[1][3] === null);
  ok('feedback GET -> 405', feedbackGet().status === 405);
}
// counter
{
  let r = await counterGet({ env: {} }); ok('counter: unavailable without DB', (await r.json()).available === false);
  const env = { DB: fakeDb() };
  await post(counterPost, { event: 'visit' }, env); await post(counterPost, { event: 'visit' }, env); await post(counterPost, { event: 'compare' }, env);
  r = await post(counterPost, { event: 'bogus' }, env); ok('counter: unknown event rejected', r.status === 400);
  const j = await (await counterGet({ env })).json();
  ok('counter: counts visits and comparisons', j.available && j.counts.visits === 2 && j.counts.comparisons === 1 && j.counts.workbooks === 0, JSON.stringify(j.counts));
}

console.log(failures === 0 ? '\nAll function tests passed.' : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
