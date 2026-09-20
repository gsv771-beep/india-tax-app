/**
 * Stale-script guard. index.html is served fresh, but a browser (or a CDN setting) may keep the
 * scripts for hours; a fresh page with old scripts breaks quietly. The page carries the build stamp
 * of the scripts it was published with (<meta name="tc-build">) and version.js carries the stamp of
 * the script that actually loaded. If they differ, re-fetch every stamped file past the browser
 * cache and reload once. A session flag stops a loop if something upstream is genuinely broken.
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
