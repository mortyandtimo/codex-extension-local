// Diagnose and repair malformed table headers in ~/.codex/config.toml.
// Usage: node fix-config.mjs <path> [--apply]
import fs from 'node:fs';

const target = process.argv[2];
const apply = process.argv.includes('--apply');
if (!target) {
  console.error('usage: node fix-config.mjs <config.toml> [--apply]');
  process.exit(2);
}

const raw = fs.readFileSync(target, 'utf8');
const lines = raw.split(/\r?\n/);
const bad = [];

lines.forEach((line, i) => {
  const t = line.trim();
  // A literal-string table header must close with ']
  if (t.startsWith("[projects.'") && !t.endsWith("']")) {
    bad.push([i, line]);
  }
});

console.log(`total lines: ${lines.length}`);
console.log(`headers missing closing quote: ${bad.length}`);

for (const [i, line] of bad) {
  const cps = [...line];
  const pua = cps.filter((c) => {
    const cp = c.codePointAt(0);
    return cp >= 0xe000 && cp <= 0xf8ff;
  });
  console.log(`\n  line ${i + 1}  (PUA chars: ${pua.length})`);
  console.log(`  ${JSON.stringify(line)}`);
}

if (!apply) {
  console.log('\n(dry run — pass --apply to repair)');
  process.exit(0);
}

if (!bad.length) {
  console.log('\nnothing to repair');
  process.exit(0);
}

// Repair: close the literal string before the trailing bracket, and drop any
// private-use-area characters that leaked in from an earlier encoding mixup.
let repaired = 0;
for (const [i, line] of bad) {
  const cleaned = [...line]
    .filter((c) => {
      const cp = c.codePointAt(0);
      return !(cp >= 0xe000 && cp <= 0xf8ff);
    })
    .join('');
  lines[i] = cleaned.replace(/\]\s*$/, "']");
  repaired++;
}

const backup = `${target}.pre-repair-${Date.now()}`;
fs.copyFileSync(target, backup);
fs.writeFileSync(target, lines.join('\r\n'), 'utf8');
console.log(`\nrepaired ${repaired} header(s)`);
console.log(`backup: ${backup}`);
