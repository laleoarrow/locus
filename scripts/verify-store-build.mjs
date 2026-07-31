import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import JSZip from 'jszip';

const browser = process.argv[2];
if (browser !== 'chrome' && browser !== 'edge') {
  throw new Error('Usage: node scripts/verify-store-build.mjs <chrome|edge>');
}

const root = process.cwd();
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const zipPath = path.join(root, '.output', `locus-${pkg.version}-${browser}-store.zip`);
const bytes = await readFile(zipPath);
const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
const manifestEntry = zip.file('manifest.json');
if (!manifestEntry) throw new Error('Store ZIP has no manifest.json.');

const manifest = JSON.parse(await manifestEntry.async('string'));
if (manifest.manifest_version !== 3) throw new Error('Store ZIP is not Manifest V3.');
if (manifest.version !== pkg.version) {
  throw new Error(`Store ZIP version ${manifest.version} does not match package ${pkg.version}.`);
}
if (Object.hasOwn(manifest, 'key')) {
  throw new Error('Store ZIP must not contain manifest.key.');
}

const jsEntries = Object.values(zip.files).filter((entry) => !entry.dir && entry.name.endsWith('.js'));
const jsText = (await Promise.all(jsEntries.map((entry) => entry.async('string')))).join('\n');
if (jsEntries.some((entry) => entry.name.includes('jsx-dev-runtime')) || jsText.includes('jsxDEV')) {
  throw new Error('Store ZIP contains the React development runtime.');
}
if (jsText.includes(root)) {
  throw new Error('Store ZIP contains an absolute path to the local checkout.');
}
if (!jsText.includes('PageNote ZIP')) {
  throw new Error('Store ZIP is missing the PageNote import UI.');
}

const digest = createHash('sha256').update(bytes).digest('hex');
console.log(`Verified production store ZIP: ${path.relative(root, zipPath)} (${digest})`);
