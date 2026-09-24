/**
 * Stale-build guard, in two parts, because a browser can be stale in two different ways.
 *
 * 1. Page fresh, scripts old. The page carries the stamp it was published with
 *    (<meta name="tc-build">) and version.js carries the stamp of the script that actually loaded;
 *    when they differ, refresh every stamped file past the browser cache and reload once.
 * 2. Page and scripts both old, and agreeing with each other, which the first check cannot see. This
 *    is what a CDN or zone cache setting does to a phone that has visited before. So after the page
 *    has rendered we fetch the tiny manifest with cache: 'reload' (which ignores the browser cache)
 *    and compare the live build with ours; a newer build means everything held locally is stale.
 *
 * A session flag stops a reload loop if something upstream is genuinely broken.
 */
import { BUILD } from './version.js';

const FLAG = 'taxcompass.fresh-retry';        // the page-versus-script check
const LIVE_FLAG = 'taxcompass.fresh-live';    // the live-build check; kept apart so neither can clear the other's guard

/** Resolves true when the page should stop booting because a reload is under way. */
export async function ensureFresh() {
  const meta = document.querySelector('meta[name="tc-build"]');
  const want = meta && meta.content;
  if (!want || want === BUILD) { try { sessionStorage.removeItem(FLAG); } catch {} return false; }
  let retried = false; try { retried = sessionStorage.getItem(FLAG) === want; } catch {}
  if (retried) return false;   // already tried once for this build; run with what we have
  try { sessionStorage.setItem(FLAG, want); } catch {}
  const notice = document.getElementById('loading');
  if (notice) { notice.textContent = 'Updating to the latest version…'; notice.hidden = false; }
  try {
    const m = await fetch('/js/manifest.json', { cache: 'reload' }).then((r) => r.json());
    await Promise.allSettled(m.files.map((f) => fetch(f, { cache: 'reload' })));
  } catch { /* fall through to the reload anyway */ }
  location.reload();
  return true;
}

/**
 * The second check: is the build we are running still the live one? Runs after the page is usable and
 * costs one small request; the answer never comes from the browser cache.
 *
 * This one never reloads the page. An earlier version did, and it could loop: when a browser served a
 * whole stale copy, the first check saw page and script agreeing and cleared its flag, this check saw
 * the live build differ and reloaded, and round it went. A reload cannot fix a copy the browser keeps
 * handing back anyway, so instead we warm the cache with the new files and offer the person a reload
 * they choose. At most one notice per session.
 */
export async function checkLiveBuild() {
  let done = false; try { done = sessionStorage.getItem(LIVE_FLAG) === '1'; } catch {}
  if (done) return false;
  try {
    const m = await fetch('/js/manifest.json', { cache: 'reload' }).then((r) => (r.ok ? r.json() : null));
    if (!m || !m.build || m.build === BUILD) return false;
    try { sessionStorage.setItem(LIVE_FLAG, '1'); } catch {}
    // pull the new files into the cache so the reload the person chooses is the fast one
    await Promise.allSettled((m.files || []).map((f) => fetch(f, { cache: 'reload' })));
    const notice = document.getElementById('loading');
    if (notice) {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'btn secondary'; btn.style.marginLeft = '10px'; btn.textContent = 'Reload';
      btn.addEventListener('click', () => location.reload());
      notice.textContent = 'A newer version of this site is available. ';
      notice.append(btn);
      notice.hidden = false;
    }
    return true;
  } catch { return false; }
}
