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

const result = spawnSync(tscBin, [], { stdio: 'inherit' });

if (result.error) {
  console.error(`\nBuild failed — could not run tsc: ${result.error.message}`);
  process.exit(1);
}
// tsc exit codes: 0 = clean, 1/2 = type errors (emit still happened). Anything
// else (or a terminating signal) means tsc itself failed — propagate it.
if (result.status !== 0 && result.status !== 1 && result.status !== 2) {
  process.exit(result.status ?? 1);
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
