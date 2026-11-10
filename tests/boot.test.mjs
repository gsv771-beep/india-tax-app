// What the landing page loads before its card works. Run: node tests/boot.test.mjs
// The card must answer from a short list of scripts; everything else (the tax form, the calculators,
// the glossary) loads after it. These checks fail when an import or a tag quietly undoes that.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public');
let failures = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`); if (!cond) failures++; };

/** Every module reached from app.js through static imports (import() calls load later and do not count). */
function staticGraph(entry) {
  const seen = new Set(), todo = [entry];
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(path.join(pub, f), 'utf8');
    for (const m of src.matchAll(/^\s*(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm)) {
      todo.push(path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1] || m[2])));
    }
  }
  return [...seen].sort();
}

const html = readFileSync(path.join(pub, 'index.html'), 'utf8');
const graph = staticGraph('/js/app.js');
const LATER = ['/js/tax-ui.js', '/js/calculators.js', '/js/charts.js', '/js/profile-panel.js', '/js/tooltips.js', '/js/feedback-wall.js', '/js/salary.js', '/js/xlsx-style.js', '/js/glossary.js'];
ok('the landing card loads from 20 scripts or fewer', graph.length <= 20, `${graph.length}: ${graph.map((f) => path.basename(f, '.js')).join(' ')}`);
ok('... and none of the rest of the site is among them', LATER.every((f) => !graph.includes(f)), LATER.filter((f) => graph.includes(f)).join(' '));
const bytes = graph.reduce((s, f) => s + readFileSync(path.join(pub, f)).length, 0);
ok('... under 220 KB of script before compression', bytes < 220 * 1024, `${Math.round(bytes / 1024)} KB`);

const preloads = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1]);
ok('every preloaded script exists', preloads.every((f) => existsSync(path.join(pub, f))), preloads.filter((f) => !existsSync(path.join(pub, f))).join(' '));
ok('only scripts the landing card needs are preloaded', preloads.every((f) => graph.includes(f)), preloads.filter((f) => !graph.includes(f)).join(' '));
ok('... and all of them are (app.js is the entry itself)', graph.filter((f) => f !== '/js/app.js').every((f) => preloads.includes(f)), graph.filter((f) => f !== '/js/app.js' && !preloads.includes(f)).join(' '));

// nothing on the page is fetched from another site: fonts are served from /fonts
const outside = [...html.matchAll(/<(?:link|script|img)\b[^>]*\b(?:href|src)="(https?:)?\/\/([^"/]+)[^"]*"[^>]*>/g)].filter((m) => !/rel="canonical"/.test(m[0])).map((m) => m[2]);
ok('the page loads nothing from another host', outside.length === 0, outside.join(' '));
const css = readFileSync(path.join(pub, 'css/style.css'), 'utf8');
const fonts = [...css.matchAll(/url\((\/fonts\/[^)]+)\)/g)].map((m) => m[1]);
ok('the stylesheet names no outside host', !/url\(\s*['"]?https?:/.test(css) && !/@import/.test(css));
ok('both font files are there, preloaded, and licensed', fonts.length === 2 && fonts.every((f) => existsSync(path.join(pub, f)) && html.includes(`<link rel="preload" href="${f}" as="font" type="font/woff2" crossorigin>`)) && existsSync(path.join(pub, 'fonts/OFL.txt')), fonts.join(' '));

// the card is in the page itself, so it is on screen before any script
const slot = (html.match(/<div id="tax-quick" class="quick-slot">([\s\S]*?)<\/div>\s*<script>/) || [])[1] || '';
ok('the CTC box is in the page markup', /<input[^>]*class="quick-ctc"[^>]*data-pre=""/.test(slot));
ok('... with the same label and privacy line the script draws', slot.includes('Your annual CTC (₹)') && slot.includes('what you type stays on this device'));
const quick = readFileSync(path.join(pub, 'js/quick.js'), 'utf8');
ok('... and quick.js takes over what was typed into it', quick.includes("input.quick-ctc[data-pre]") && quick.includes("slot.setAttribute('data-live', '')"));
ok('the tax rates are asked for with the page, and loadJSON picks them up', html.includes("window.__tcPre.json['/data/tax_rates.json'] = fetch(") && readFileSync(path.join(pub, 'js/util.js'), 'utf8').includes('window.__tcPre?.json?.[path]'));

console.log(failures ? `\n${failures} failure(s)` : '\nAll boot tests passed');
process.exit(failures ? 1 : 0);
