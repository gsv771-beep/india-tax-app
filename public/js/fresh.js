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

const FLAG = 'taxcompass.fresh-retry';

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
 * costs one small request; the answer never comes from the browser cache. Called from app.js on boot.
 */
export async function checkLiveBuild() {
  let retried = false; try { retried = sessionStorage.getItem(FLAG) === 'live'; } catch {}
  if (retried) return false;
  try {
    const m = await fetch('/js/manifest.json', { cache: 'reload' }).then((r) => (r.ok ? r.json() : null));
    if (!m || !m.build || m.build === BUILD) return false;
    try { sessionStorage.setItem(FLAG, 'live'); } catch {}
    const notice = document.getElementById('loading');
    if (notice) { notice.textContent = 'A newer version is available; loading it…'; notice.hidden = false; }
    await Promise.allSettled((m.files || []).map((f) => fetch(f, { cache: 'reload' })));
    await fetch(location.pathname, { cache: 'reload' }).catch(() => {});
    location.reload();
    return true;
  } catch { return false; }
}
