/**
 * The owner's moderation page for the public feedback wall. One file, three behaviours:
 *   GET  /api/feedback-admin                       -> the admin page (plain HTML, noindex); asks for the token once
 *   GET  /api/feedback-admin  Authorization: Bearer -> { items: [every feedback row, newest first] }
 *   POST /api/feedback-admin  Authorization: Bearer  { id, approved: true|false } -> { ok }
 * The token is FEEDBACK_ADMIN_TOKEN (Cloudflare Pages -> Settings -> Variables and Secrets; 16+ characters,
 * mark as secret). Without it, the page says so and nothing can be changed. Emails are never shown here.
 */
import { json, ensureSchema, adminAuthorised } from '../_lib.js';

export async function onRequestGet({ request, env }) {
  if (!request.headers.get('authorization')) return page(env);
  if (!adminAuthorised(request, env)) return json({ error: 'Wrong token.' }, 401);
  if (!env.DB) return json({ error: 'No database bound.' }, 503);
  await ensureSchema(env.DB);
  const { results } = await env.DB.prepare('SELECT id, ts, name, rating, message, page, public_ok, approved FROM feedback ORDER BY ts DESC LIMIT 500').all();
  return json({ items: results || [] });
}

export async function onRequestPost({ request, env }) {
  if (!adminAuthorised(request, env)) return json({ error: 'Wrong token.' }, 401);
  if (!env.DB) return json({ error: 'No database bound.' }, 503);
  let body; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body.' }, 400); }
  const id = Number.parseInt(body.id, 10);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'id required.' }, 400);
  await ensureSchema(env.DB);
  await env.DB.prepare('UPDATE feedback SET approved = ? WHERE id = ?').bind(body.approved ? 1 : 0, id).run();
  return json({ ok: true, id, approved: !!body.approved });
}

function page(env) {
  const configured = String(env.FEEDBACK_ADMIN_TOKEN || '').length >= 16;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Feedback moderation</title>
<style>body{font:15px/1.5 system-ui,Segoe UI,Roboto,sans-serif;margin:0;background:#f4f6f3;color:#1c2321}main{max-width:820px;margin:0 auto;padding:24px 16px}h1{font-size:1.3rem;margin:0 0 4px}.muted{color:#5c6763;font-size:.9rem}.card{background:#fff;border:1px solid #e3e8e0;border-radius:12px;padding:14px 16px;margin:12px 0}input{font:inherit;padding:8px 10px;border:1px solid #c9d1c5;border-radius:8px;width:100%;max-width:420px}button{font:inherit;padding:8px 14px;border-radius:999px;border:1px solid #1d6b3d;background:#1d6b3d;color:#fff;cursor:pointer}button.secondary{background:#fff;color:#1d6b3d}.item{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:start}.item.on{border-left:4px solid #1d6b3d}.item.off{border-left:4px solid #c9d1c5}.msg{white-space:pre-wrap;margin:6px 0}.tag{display:inline-block;font-size:.78rem;padding:2px 8px;border-radius:999px;background:#eef3ec;margin-right:6px}.tag.no{background:#fbe9e9;color:#9b1c1c}.stars{color:#b7861c}</style></head>
<body><main>
<h1>Feedback moderation</h1>
<p class="muted">Tick what appears under "What people say". Names show as first name plus an initial; emails never leave the database. ${configured ? '' : '<strong style="color:#9b1c1c">FEEDBACK_ADMIN_TOKEN is not set on this deployment (needs 16+ characters), so nothing can be changed here.</strong>'}</p>
<div class="card" id="auth"><label>Admin token<br><input id="tok" type="password" autocomplete="off"></label> <button id="go">Load feedback</button> <span id="err" class="muted"></span></div>
<div id="list"></div>
<script>
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let token = sessionStorage.getItem('fb-admin-token') || '';
if (token) $('#tok').value = token;
const hdr = () => ({ authorization: 'Bearer ' + token, 'content-type': 'application/json' });
async function load() {
  token = $('#tok').value.trim(); sessionStorage.setItem('fb-admin-token', token); $('#err').textContent = '';
  const r = await fetch('/api/feedback-admin', { headers: hdr() }); const d = await r.json().catch(() => ({}));
  if (!r.ok) { $('#err').textContent = d.error || ('Error ' + r.status); return; }
  const list = $('#list'); list.innerHTML = '';
  if (!d.items.length) { list.innerHTML = '<p class="muted">No feedback yet.</p>'; return; }
  for (const it of d.items) {
    const div = document.createElement('div'); div.className = 'card item ' + (it.approved ? 'on' : 'off');
    div.innerHTML = '<div><strong>' + esc(it.name) + '</strong> <span class="stars">' + (it.rating ? '★'.repeat(it.rating) + '☆'.repeat(5 - it.rating) : '') + '</span><div class="muted">' + esc(it.ts.slice(0, 10)) + ' · ' + esc(it.page || '') + '</div><div class="msg">' + esc(it.message) + '</div><span class="tag ' + (it.public_ok ? '' : 'no') + '">' + (it.public_ok ? 'agreed to be shown' : 'did not tick "show on site"') + '</span><span class="tag">' + (it.approved ? 'showing' : 'hidden') + '</span></div>'
      + '<div><button class="' + (it.approved ? 'secondary' : '') + '" data-id="' + it.id + '" data-to="' + (it.approved ? 0 : 1) + '">' + (it.approved ? 'Hide' : 'Show on site') + '</button></div>';
    list.append(div);
  }
}
$('#go').addEventListener('click', load);
$('#tok').addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-id]'); if (!b) return;
  b.disabled = true;
  const r = await fetch('/api/feedback-admin', { method: 'POST', headers: hdr(), body: JSON.stringify({ id: +b.dataset.id, approved: b.dataset.to === '1' }) });
  if (!r.ok) { $('#err').textContent = 'Could not save.'; b.disabled = false; return; }
  load();
});
if (token) load();
</script></main></body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } });
}
