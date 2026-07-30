/**
 * Put one store-submission field on the clipboard at a time, so each can be
 * pasted into Partner Center / the Web Store console with a single ⌘V.
 *
 *   node scripts/store-copy.mjs               # list the Edge sequence
 *   node scripts/store-copy.mjs --chrome      # list the Chrome sequence
 *   node scripts/store-copy.mjs 3             # copy step 3 of that sequence
 *   node scripts/store-copy.mjs description-en  # copy by field name
 *   node scripts/store-copy.mjs next          # copy the step after the last one
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FIELDS, UPLOADS } from './store-fields.mjs';

const STATE = path.join(tmpdir(), 'locus-store-copy-state.json');
const args = process.argv.slice(2);
const store = args.includes('--chrome') ? 'chrome' : 'edge';
const target = args.find((a) => !a.startsWith('--'));

const sequence = FIELDS.filter((f) => f.where === store || f.where === 'both');

function copy(text) {
  const result = spawnSync('pbcopy', { input: text });
  if (result.status !== 0) throw new Error('pbcopy failed');
}

function readState() {
  try {
    return JSON.parse(readFileSync(STATE, 'utf8'));
  } catch {
    return {};
  }
}

function list() {
  const uploads = UPLOADS.filter((u) => u.where === store || u.where === 'both');
  console.log(`\n${store === 'edge' ? 'Edge Add-ons' : 'Chrome Web Store'} — ${sequence.length} text fields\n`);
  sequence.forEach((field, index) => {
    const preview = field.value.replace(/\s+/g, ' ').slice(0, 58);
    console.log(`${String(index + 1).padStart(2)}. ${field.label}`);
    console.log(`    ${preview}${field.value.length > 58 ? '…' : ''}`);
  });
  console.log(`\nFiles to drag in (~/Desktop/locus-store-upload):`);
  for (const upload of uploads) console.log(`  • ${upload.label} → ${upload.file}`);
  console.log(`\nCopy one with:  node scripts/store-copy.mjs ${store === 'chrome' ? '--chrome ' : ''}1`);
  console.log(`Then advance:   node scripts/store-copy.mjs ${store === 'chrome' ? '--chrome ' : ''}next\n`);
}

if (!target) {
  list();
} else {
  let index;
  if (target === 'next') {
    const state = readState();
    index = (state[store] ?? 0) % sequence.length;
  } else if (/^\d+$/.test(target)) {
    index = Number(target) - 1;
  } else {
    index = sequence.findIndex((f) => f.key === target);
  }
  const field = sequence[index];
  if (!field) {
    console.error(`No such field: ${target}`);
    list();
    process.exit(1);
  }
  copy(field.value);
  const state = readState();
  state[store] = index + 1;
  writeFileSync(STATE, JSON.stringify(state));
  const lines = field.value.split('\n').length;
  console.log(
    `✔ Copied step ${index + 1}/${sequence.length} — ${field.label}` +
      ` (${field.value.length} chars, ${lines} line${lines === 1 ? '' : 's'})`,
  );
  console.log('  Click the field in the browser and press ⌘V.');
  const next = sequence[index + 1];
  if (next) console.log(`  Next: ${next.label}`);
  else console.log('  That was the last text field.');
}
