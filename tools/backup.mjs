/**
 * npm run backup
 * Writes a self-contained copy of the whole repository (every branch and tag) to a folder OUTSIDE the
 * project, as a git bundle: ~/TaxCompass-backups/taxcompass-<date>.bundle. Restore with
 *   git clone taxcompass-<date>.bundle india-tax-app
 * Then, if wrangler is installed and logged in, exports the production D1 database (feedback and
 * counters) next to it as .sql. Nothing here touches the live site. See docs/RECOVERY.md.
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, readdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.TAXCOMPASS_BACKUP_DIR || path.join(homedir(), 'TaxCompass-backups');
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const bundle = path.join(outDir, `taxcompass-${stamp}.bundle`);

const dirty = execSync('git status --porcelain', { cwd: root }).toString().trim();
if (dirty) console.log('Note: uncommitted changes are NOT in the bundle (a bundle holds commits only). Commit first if you want them kept.');

execSync(`git bundle create "${bundle}" --all`, { cwd: root, stdio: 'inherit' });
execSync(`git bundle verify "${bundle}"`, { cwd: root, stdio: 'pipe' });
const mb = (statSync(bundle).size / 1048576).toFixed(1);
const head = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
console.log(`\nRepository bundle: ${bundle} (${mb} MB, HEAD ${head}, all branches)`);

// D1: best effort. Needs `npx wrangler login` once; skipped quietly when not available.
const sql = bundle.replace(/\.bundle$/, '-d1.sql');
const r = spawnSync('npx', ['wrangler', 'd1', 'export', 'taxcompass', '--remote', `--output=${sql}`], { cwd: root, shell: true, encoding: 'utf8', timeout: 120000 });
if (r.status === 0 && existsSync(sql)) console.log(`Database export:  ${sql}`);
else console.log('Database export skipped (run "npx wrangler login" once to include the feedback and counter tables; see docs/RECOVERY.md).');

// keep the newest 10 bundles so the folder does not grow forever
const old = readdirSync(outDir).filter((f) => /^taxcompass-.*\.bundle$/.test(f)).sort().reverse().slice(10);
for (const f of old) { unlinkSync(path.join(outDir, f)); const s = path.join(outDir, f.replace(/\.bundle$/, '-d1.sql')); if (existsSync(s)) unlinkSync(s); }
console.log(`\nCopy the ${outDir} folder somewhere that is not this computer (OneDrive, Google Drive, a USB stick).`);
