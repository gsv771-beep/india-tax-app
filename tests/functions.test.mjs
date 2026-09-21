// Feedback and counter functions, exercised with a tiny in-memory stand-in for D1. No network.
import { onRequestPost as feedbackPost, onRequestGet as feedbackGet } from '../functions/api/feedback.js';
import { onRequestGet as counterGet, onRequestPost as counterPost } from '../functions/api/counter.js';
import { onRequestPost as workbookPost } from '../functions/api/send-workbook.js';
import { onRequestGet as adminGet, onRequestPost as adminPost } from '../functions/api/feedback-admin.js';
import { displayName } from '../functions/_lib.js';

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
      if (/INSERT INTO feedback/.test(sql)) { const [ts, name, email, rating, message, page, ua, public_ok] = this._args; feedback.push({ id: feedback.length + 1, ts, name, email, rating, message, page, ua, public_ok: public_ok || 0, approved: 0 }); return { success: true }; }
      if (/UPDATE feedback SET approved/.test(sql)) { const [approved, id] = this._args; const row = feedback.find((r) => r.id === id); if (row) row.approved = approved; return { success: true }; }
      if (/ALTER TABLE/.test(sql)) throw new Error('duplicate column');   // as SQLite does once the column exists
      return { success: true };
    },
    async all() {
      if (/FROM counters/.test(sql)) return { results: [...counters].map(([name, value]) => ({ name, value })) };
      if (/COUNT\(rating\)/.test(sql)) { const rated = feedback.filter((r) => r.rating != null); return { results: [{ count: rated.length, average: rated.length ? rated.reduce((a, r) => a + r.rating, 0) / rated.length : null }] }; }
      if (/WHERE approved = 1/.test(sql)) return { results: feedback.filter((r) => r.approved === 1).slice().reverse() };
      if (/FROM feedback ORDER BY/.test(sql)) return { results: feedback.slice().reverse().map(({ email, ua, ...r }) => r) };   // the real query names its columns
      return { results: [] };
    },
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
  ok('feedback: stored in D1 with no email', r.status === 200 && j.stored === true && j.mailed === false && env.DB._feedback.length === 1 && env.DB._feedback[0].email === null);
  ok('feedback: rating kept', env.DB._feedback[0].rating === 4);
  r = await post(feedbackPost, { name: 'A', message: 'hello there', rating: 9 }, env); ok('feedback: out-of-range rating dropped', (await r.json()).ok && env.DB._feedback[1].rating === null);
  ok('feedback GET without a database -> available:false', (await (await feedbackGet({ env: {} })).json()).available === false);
}
// counter
{
  let r = await counterGet({ env: {} }); ok('counter: unavailable without DB', (await r.json()).available === false);
  const env = { DB: fakeDb() };
  await post(counterPost, { event: 'visit' }, env); await post(counterPost, { event: 'visit' }, env); await post(counterPost, { event: 'compare' }, env);
  r = await post(counterPost, { event: 'bogus' }, env); ok('counter: unknown event rejected', r.status === 400);
  r = await post(counterPost, { event: 'calc:nonsense' }, env); ok('counter: unknown calculator rejected', r.status === 400);
  await post(counterPost, { event: 'calc:emi' }, env); await post(counterPost, { event: 'calc:emi' }, env); await post(counterPost, { event: 'calc:sip' }, env);
  const j = await (await counterGet({ env })).json();
  ok('counter: counts visits and comparisons', j.available && j.counts.visits === 2 && j.counts.comparisons === 1 && j.counts.workbooks === 0, JSON.stringify(j.counts));
  ok('counter: calculations total and per calculator', j.counts.calculations === 3 && j.calculators.emi === 2 && j.calculators.sip === 1, JSON.stringify(j.calculators));
}

// send-workbook: the profile source takes a .json file; workbooks still need .xlsx. Brevo is stubbed.
{
  const env = { BREVO_API_KEY: 'k', MAIL_FROM_EMAIL: 'me@x.org' };
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response('{}', { status: 200 }); };
  try {
    const b64 = Buffer.from('{"profile":{}}').toString('base64');
    let r = await post(workbookPost, { name: 'A', email: 'a@b.co', filename: 'taxcompass-profile.json', xlsxBase64: b64, source: 'profile' }, env);
    ok('send-workbook: profile source accepts a .json attachment', r.status === 200, String(r.status));
    const mail = calls.find((c) => /smtp\/email/.test(c.url));
    ok('send-workbook: profile email explains Restore from file and attaches the json', mail && /Restore from file/.test(mail.body.htmlContent) && mail.body.attachment[0].name === 'taxcompass-profile.json');
    r = await post(workbookPost, { name: 'A', email: 'a@b.co', filename: 'x.xlsx', xlsxBase64: b64, source: 'profile' }, env);
    ok('send-workbook: profile source rejects .xlsx', r.status === 400);
    r = await post(workbookPost, { name: 'A', email: 'a@b.co', filename: 'x.json', xlsxBase64: b64, source: 'goal' }, env);
    ok('send-workbook: workbook sources still reject .json', r.status === 400);
  } finally { globalThis.fetch = realFetch; }
}

// public wall and moderation
{
  const env = { DB: fakeDb(), FEEDBACK_ADMIN_TOKEN: 'a-long-enough-secret-token' };
  await post(feedbackPost, { name: 'Priya Sharma', message: 'Loved the EMI tool', rating: 5, page: '/calculators/emi', publicOk: true }, env);
  await post(feedbackPost, { name: 'Rahul', message: 'Chart was clipped', rating: 3, page: '/calculators/retirement' }, env);
  let r = await feedbackGet({ env }); let j = await r.json();
  ok('wall: nothing approved yet, but the rating counts everyone who rated', j.available && j.items.length === 0 && j.rating.count === 2 && j.rating.average === 4);
  ok('wall: public_ok stored from the tick box', env.DB._feedback[0].public_ok === 1 && env.DB._feedback[1].public_ok === 0);
  const get = (headers = {}) => adminGet({ request: new Request('http://x/api/feedback-admin', { headers }), env });
  r = await get(); ok('admin: no token -> the moderation page, not indexed', r.status === 200 && /text\/html/.test(r.headers.get('content-type')) && /noindex/.test(r.headers.get('x-robots-tag')));
  r = await get({ authorization: 'Bearer wrong-token-of-the-same-length' }); ok('admin: wrong token rejected', r.status === 401);
  r = await get({ authorization: 'Bearer a-long-enough-secret-token' }); j = await r.json();
  ok('admin: right token lists every row, newest first, without emails', r.status === 200 && j.items.length === 2 && j.items[0].name === 'Rahul' && !('email' in j.items[0]));
  r = await adminPost({ request: new Request('http://x/api/feedback-admin', { method: 'POST', headers: { authorization: 'Bearer a-long-enough-secret-token' }, body: JSON.stringify({ id: 1, approved: true }) }), env });
  ok('admin: approve', r.status === 200);
  r = await adminPost({ request: new Request('http://x/api/feedback-admin', { method: 'POST', body: JSON.stringify({ id: 2, approved: true }) }), env });
  ok('admin: approving without a token is refused', r.status === 401);
  j = await (await feedbackGet({ env })).json();
  ok('wall: the approved item appears with first name and initial', j.items.length === 1 && j.items[0].name === 'Priya S.' && j.items[0].message === 'Loved the EMI tool' && j.items[0].rating === 5);
  ok('admin: a short or missing token never authorises', (await adminGet({ request: new Request('http://x/api/feedback-admin', { headers: { authorization: 'Bearer short' } }), env: { DB: fakeDb(), FEEDBACK_ADMIN_TOKEN: 'short' } })).status === 401);
  ok('displayName: single names stay, blanks become Anonymous', displayName('Rahul') === 'Rahul' && displayName('') === 'Anonymous' && displayName('Anita Rao Iyer') === 'Anita I.');
}

console.log(failures === 0 ? '\nAll function tests passed.' : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
