// Safe surgical edits to ~/.codex/config.toml.
//
// Why this exists: PowerShell text pipelines (Get-Content -Raw | ... | WriteAllText)
// re-encode non-ASCII content and destroy literal-quoted table headers that
// contain non-ASCII path segments. Everything here stays in UTF-8 end to end and
// does exact regex surgery instead of splitting/joinging the whole file, so line
// endings and every other byte are preserved.
//
// Usage:
//   node edit-config.mjs <config.toml> drop-key <key>     [--apply]
//   node edit-config.mjs <config.toml> show-key <key>
import fs from 'node:fs';

const [, , target, cmd, key, ...rest] = process.argv;
const apply = rest.includes('--apply') || process.argv.includes('--apply');

if (!target || !cmd || !key) {
  console.error('usage: node edit-config.mjs <config.toml> <drop-key|show-key> <key> [--apply]');
  process.exit(2);
}

const raw = fs.readFileSync(target, 'utf8');

function occurrences(text, k) {
  const re = new RegExp('^[ \\t]*' + k + '[ \\t]*=.*$', 'gm');
  return text.match(re) || [];
}

if (cmd === 'show-key') {
  for (const line of occurrences(raw, key)) console.log(line);
  process.exit(0);
}

if (cmd !== 'drop-key') {
  console.error('unknown command: ' + cmd);
  process.exit(2);
}

const found = occurrences(raw, key);
console.log(`occurrences of "${key}": ${found.length}`);
for (const l of found) console.log('  ' + l.trim());

if (found.length !== 1) {
  console.error(`refusing to edit: expected exactly 1 occurrence, found ${found.length}`);
  process.exit(1);
}

if (!apply) {
  console.log('\n(dry run — pass --apply to remove it)');
  process.exit(0);
}

// Remove the line plus its own terminating newline, touch nothing else.
const re = new RegExp('^[ \\t]*' + key + '[ \\t]*=.*(\\r?\\n)?', 'm');
const after = raw.replace(re, '');

if (after === raw) {
  console.error('no change made');
  process.exit(1);
}

const backup = `${target}.pre-edit-${Date.now()}`;
fs.copyFileSync(target, backup);
fs.writeFileSync(target, after, 'utf8');

// Re-verify the header integrity we broke last time.
const broken = after
  .split(/\r?\n/)
  .filter((l) => l.trim().startsWith("[projects.'") && !l.trim().endsWith("']")).length;

console.log(`\nremoved "${key}"  (${raw.length} -> ${after.length} bytes)`);
console.log(`backup: ${backup}`);
console.log(`malformed project headers after edit: ${broken}`);
process.exit(broken ? 1 : 0);
