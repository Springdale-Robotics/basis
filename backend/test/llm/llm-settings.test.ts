import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../src/config/database.js';
import { systemSettings } from '../../src/db/schema/index.js';
import { config } from '../../src/config/index.js';
import {
  getTextModel,
  getVisionModel,
  setModel,
  TEXT_MODEL_KEY,
  VISION_MODEL_KEY,
} from '../../src/modules/llm/llm-settings.js';

const clearModelSettings = async (): Promise<void> => {
  await db
    .delete(systemSettings)
    .where(inArray(systemSettings.key, [TEXT_MODEL_KEY, VISION_MODEL_KEY]));
};

// `system_settings` is box-global by design — no householdId, no RLS policy —
// so these two keys are shared mutable state across every llm test file. Clear
// on the way in as well as out, so this file is self-seeding rather than
// dependent on a sibling's cleanup having run first.
beforeAll(clearModelSettings);
afterEach(clearModelSettings);

describe('llm settings accessor', () => {
  it('falls back to the env default when unset', async () => {
    // This is what guarantees an untouched install behaves exactly as it does
    // today — the env vars keep working as defaults.
    expect(await getTextModel()).toBe(config.OLLAMA_LLM_MODEL);
    expect(await getVisionModel()).toBe(config.OLLAMA_VLM_MODEL);
  });

  it('prefers the stored value once set', async () => {
    await setModel('text', 'qwen2.5:3b');
    expect(await getTextModel()).toBe('qwen2.5:3b');
    // The other role is untouched.
    expect(await getVisionModel()).toBe(config.OLLAMA_VLM_MODEL);
  });

  it('overwrites rather than duplicating on a second set', async () => {
    await setModel('vision', 'llava:7b');
    await setModel('vision', 'qwen2.5vl:7b');

    expect(await getVisionModel()).toBe('qwen2.5vl:7b');
    const rows = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, VISION_MODEL_KEY));
    expect(rows).toHaveLength(1);
  });

  it('falls back to the env default when the stored value is not a string', async () => {
    // Called on every receipt scan — a corrupted row must degrade to the
    // default rather than putting a non-string into the Ollama request.
    await db.insert(systemSettings).values({ key: TEXT_MODEL_KEY, value: { oops: true } });
    expect(await getTextModel()).toBe(config.OLLAMA_LLM_MODEL);
  });

  // A JSON `null` value was also considered, but `value` is notNull() and
  // drizzle-orm sends a JS `null` as SQL NULL rather than a `'null'::jsonb`
  // literal — the column constraint rejects the insert outright (23502,
  // "null value in column value violates not-null constraint"). That's the
  // constraint doing its job, so there is no row for the accessor to see;
  // see the fix-report addendum for the reproduction.
});
