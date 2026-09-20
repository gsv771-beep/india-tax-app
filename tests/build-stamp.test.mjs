// The build stamp in index.html, version.js and manifest.json must match the scripts on disk.
// Run: node tests/build-stamp.test.mjs   (fix with: npm run stamp)
import { computeStamp, currentStamps, stampedFiles } from '../tools/stamp.mjs';
let failures = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`); if (!cond) failures++; };

const want = computeStamp();
const { meta, version, manifest } = currentStamps();
ok('index.html carries the current build stamp', meta === want, `meta ${meta}, scripts ${want}; run npm run stamp`);
ok('version.js carries the current build stamp', version === want, `version ${version}, scripts ${want}`);
ok('manifest.json carries the current build stamp and file list', manifest && manifest.build === want && JSON.stringify(manifest.files) === JSON.stringify(stampedFiles()), manifest ? `manifest ${manifest.build}` : 'no manifest');
ok('manifest covers app.js, the engine and the stylesheet', manifest && ['/js/app.js', '/js/tax-ui.js', '/engine/profile.js', '/css/style.css'].every((f) => manifest.files.includes(f)));
ok('version.js is not in its own manifest', manifest && !manifest.files.includes('/js/version.js'));

console.log(failures === 0 ? '\nAll build stamp tests passed.' : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
