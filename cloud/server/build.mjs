#!/usr/bin/env node
// Production build for the cloud control plane. Same policy as backend/build.mjs:
// compile with tsc, tolerate type errors (tracked via `npm run typecheck`), but
// hard-fail on TS1xxx syntax errors (they emit corrupt JS) and on missing
// entrypoints.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const tscBin = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');

const result = spawnSync(tscBin, [], { encoding: 'utf8' });
const tscOutput = `${result.stdout ?? ''}${result.stderr ?? ''}`;
process.stdout.write(tscOutput);

if (result.error) {
  console.error(`\nBuild failed — could not run tsc: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0 && result.status !== 1 && result.status !== 2) {
  process.exit(result.status ?? 1);
}

const syntaxErrors = tscOutput.split('\n').filter((l) => /error TS1\d{3}:/.test(l));
if (syntaxErrors.length > 0) {
  console.error(`\nBuild failed — ${syntaxErrors.length} TypeScript SYNTAX error(s) (TS1xxx).`);
  for (const l of syntaxErrors.slice(0, 10)) console.error(`  ${l.trim()}`);
  process.exit(1);
}

const required = ['dist/index.js', 'dist/migrate.js'];
const missing = required.filter((f) => !existsSync(join(root, f)));
if (missing.length > 0) {
  console.error(`\nBuild failed — tsc did not emit: ${missing.join(', ')}`);
  process.exit(1);
}

if (result.status === 0) {
  console.log('\n✓ Build complete (type-clean).');
} else {
  console.log('\n✓ Build complete — dist/ emitted. Run `npm run typecheck` for type errors.');
}
