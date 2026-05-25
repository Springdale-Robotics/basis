import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // argon2 password verification takes ~1-3 seconds per call in dev. Each
    // CalDAV request authenticates via Basic auth, so per-test budgets need
    // to be generous.
    testTimeout: 60000,
    hookTimeout: 60000,
    // argon2 is CPU-bound; parallel test files contend and timeout. Run
    // CalDAV tests sequentially.
    fileParallelism: false,
  },
});
