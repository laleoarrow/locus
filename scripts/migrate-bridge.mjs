/**
 * One-time migration bridge for installs made before the manifest `key` was
 * pinned (Locus ≤ v0.3.0).
 *
 * An unpacked extension's ID is derived from the folder it was loaded from, and
 * IndexedDB is scoped to that ID. Switching to the keyed build therefore changes
 * the ID once, leaving the old install's annotations unreachable. This script
 * builds a keyless variant (same path-derived ID as the old install) that *does*
 * include the Export button, and drops it into the folder you loaded from — so
 * you can export, then switch to the real build and import.
 *
 * Usage:
 *   1. node scripts/migrate-bridge.mjs [--browser edge|chrome]
 *   2. Reload Locus in edge://extensions, open the side panel, Backup → Export.
 *   3. pnpm build:edge   (restores the real, keyed build)
 *   4. Reload again, then Backup → Import the file from step 2.
 */
import { spawnSync } from 'node:child_process';
import { cp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browserArg = process.argv.indexOf('--browser');
const browser = browserArg === -1 ? 'edge' : (process.argv[browserArg + 1] ?? 'edge');
if (browser !== 'edge' && browser !== 'chrome') {
  console.error(`Unsupported browser "${browser}" — use edge or chrome.`);
  process.exit(1);
}

const target = path.join(ROOT, '.output', `${browser}-mv3`);
const staging = path.join(ROOT, '.output', `${browser}-mv3-migrate`);

const build = spawnSync(
  'npx',
  ['wxt', 'build', '-b', browser, '--mode', 'migrate'],
  { cwd: ROOT, stdio: 'inherit' },
);
if (build.status !== 0) process.exit(build.status ?? 1);

const manifest = JSON.parse(await readFile(path.join(staging, 'manifest.json'), 'utf8'));
if (manifest.key) {
  console.error('Refusing to continue: the migrate build still carries a manifest key.');
  process.exit(1);
}

await rm(target, { recursive: true, force: true });
await cp(staging, target, { recursive: true });

console.log(`
Migration build is now at ${path.relative(ROOT, target)} (no manifest key, so it
keeps your existing install's ID and can read its annotations).

Next:
  1. ${browser}://extensions  →  Reload on the Locus card
  2. Open the Locus side panel  →  Backup  →  Export  (save the .json)
  3. pnpm ${browser === 'edge' ? 'build:edge' : 'build'}   ← restores the real keyed build
  4. Reload once more  →  Backup  →  Import the .json from step 2

After step 4 the extension ID is stable for good: future updates keep your data.
`);
