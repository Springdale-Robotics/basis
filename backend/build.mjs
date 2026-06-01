#!/usr/bin/env node
// Production build for the backend.
//
// We compile with `tsc`, which (unlike a raw transpiler) does correct
// type-only import elision and emits a complete, runnable dist/. We do NOT fail
// the build on *type* errors: the dev runtime (tsx) already runs this exact
// code, and the backend currently carries known type-check debt (mostly Drizzle
// schema-generic inference plus unused-symbol lint) tracked separately via
// `npm run typecheck`. tsc still emits JS in that state (noEmitOnError is off).
//
// We DO fail the build when tsc can't run at all, or when an entrypoint we ship
// (dist/index.js for the API, dist/worker.js for the job runner) wasn't emitted
// — that only happens on genuine/syntax breakage, which must stop a release or
// an install.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const tscBin = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');

// Capture (not inherit) so we can scan for syntax errors; echo it through after.
const result = spawnSync(tscBin, [], { encoding: 'utf8' });
const tscOutput = `${result.stdout ?? ''}${result.stderr ?? ''}`;
process.stdout.write(tscOutput);

if (result.error) {
  console.error(`\nBuild failed — could not run tsc: ${result.error.message}`);
  process.exit(1);
}
// tsc exit codes: 0 = clean, 1/2 = errors (emit still happened). Anything else
// (or a terminating signal) means tsc itself failed — propagate it.
if (result.status !== 0 && result.status !== 1 && result.status !== 2) {
  process.exit(result.status ?? 1);
}

// Type errors (TS2xxx+) are non-fatal here (see header). But SYNTAX errors
// (TS1xxx) mean tsc emitted CORRUPT JavaScript — and not necessarily in an
// entrypoint, so the dist/index.js existence check below won't catch them. A
// stray backtick in a template-literal comment once shipped a broken
// installer-commands.js this way and crash-looped production on boot. Fail hard
// on any TS1xxx so corrupt output can never reach a release or an install.
const syntaxErrors = tscOutput
  .split('\n')
  .filter((l) => /error TS1\d{3}:/.test(l));
if (syntaxErrors.length > 0) {
  console.error(`\nBuild failed — ${syntaxErrors.length} TypeScript SYNTAX error(s) (TS1xxx).`);
  console.error('These emit corrupt JS. Fix before releasing/installing:');
  for (const l of syntaxErrors.slice(0, 10)) console.error(`  ${l.trim()}`);
  process.exit(1);
}

const required = ['dist/index.js', 'dist/worker.js'];
const missing = required.filter((f) => !existsSync(join(root, f)));
if (missing.length > 0) {
  console.error(`\nBuild failed — tsc did not emit: ${missing.join(', ')}`);
  console.error('(A syntax error, not just a type error, usually causes this.)');
  process.exit(1);
}

if (result.status === 0) {
  console.log('\n✓ Build complete (type-clean).');
} else {
  console.log(
    '\n✓ Build complete — dist/ emitted. Type errors are non-fatal here; run `npm run typecheck` to see them.'
  );
}
