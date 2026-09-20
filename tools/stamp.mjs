/**
 * npm run stamp   (also runs before `npm test`, so a commit never ships unstamped)
 *
 * There is no build step and no hashed filenames, and Cloudflare's zone setting can hold scripts in
 * the browser for hours while index.html is always fresh. A fresh page with a stale script silently
 * breaks (a new tab that does nothing, form groups that never unhide). So:
 *   - the BUILD stamp is a hash of the content of every script and stylesheet;
 *   - it is written to public/js/version.js and to <meta name="tc-build"> in index.html;
 *   - public/js/manifest.json lists every file the stamp covers.
 * At boot, app.js compares the two stamps; if they differ, it re-fetches every listed file past the
 * browser cache and reloads once. tests/build-stamp.test.mjs fails when the stamp is out of date.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');

function walk(dir, keep) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, keep));
    else if (keep(p)) out.push(p);
  }
  return out;
}

/** The files the stamp covers, as site paths, sorted. version.js and the manifest are outputs, not inputs. */
export function stampedFiles() {
  const files = [
    ...walk(path.join(pub, 'js'), (p) => p.endsWith('.js') && !p.endsWith('version.js')),
    ...walk(path.join(pub, 'engine'), (p) => p.endsWith('.js')),
    ...walk(path.join(pub, 'css'), (p) => p.endsWith('.css')),
  ];
  return files.map((p) => '/' + path.relative(pub, p).split(path.sep).join('/')).sort();
}

export function computeStamp() {
  const h = createHash('sha1');
  for (const f of stampedFiles()) { h.update(f); h.update(readFileSync(path.join(pub, f))); }
  return h.digest('hex').slice(0, 10);
}

export function currentStamps() {
  const html = readFileSync(path.join(pub, 'index.html'), 'utf8');
  const meta = (html.match(/<meta name="tc-build" content="([^"]*)"/) || [])[1] || null;
  let version = null;
  try { version = (readFileSync(path.join(pub, 'js/version.js'), 'utf8').match(/BUILD = '([^']*)'/) || [])[1] || null; } catch {}
  let manifest = null;
  try { manifest = JSON.parse(readFileSync(path.join(pub, 'js/manifest.json'), 'utf8')); } catch {}
  return { meta, version, manifest };
}

export function writeStamp() {
  const build = computeStamp();
  const files = stampedFiles();
  writeFileSync(path.join(pub, 'js/version.js'), `// Written by tools/stamp.mjs; do not edit. Must equal <meta name="tc-build"> in index.html.\nexport const BUILD = '${build}';\n`);
  writeFileSync(path.join(pub, 'js/manifest.json'), JSON.stringify({ build, files }, null, 0) + '\n');
  const htmlPath = path.join(pub, 'index.html');
  const html = readFileSync(htmlPath, 'utf8');
  const tag = `<meta name="tc-build" content="${build}">`;
  const next = /<meta name="tc-build" content="[^"]*">/.test(html) ? html.replace(/<meta name="tc-build" content="[^"]*">/, tag) : html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  ${tag}`);
  writeFileSync(htmlPath, next);
  return { build, files: files.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = writeStamp();
  console.log(`build ${r.build}: ${r.files} files stamped`);
}
