import { afterEach, describe, expect, it, vi } from 'vitest';
import { inArray } from 'drizzle-orm';
import { db } from '../../src/config/database.js';
import { systemSettings } from '../../src/db/schema/index.js';
import { config } from '../../src/config/index.js';
import { setModel, TEXT_MODEL_KEY, VISION_MODEL_KEY } from '../../src/modules/llm/llm-settings.js';
import { structureReceipt } from '../../src/modules/receipts/receipt-structurer.js';

afterEach(async () => {
  await db.delete(systemSettings).where(inArray(systemSettings.key, [TEXT_MODEL_KEY, VISION_MODEL_KEY]));
  vi.unstubAllGlobals();
});

/** Capture the model name the structurer asks Ollama for. */
function stubOllamaAndCaptureModel(): { seen: () => string | undefined } {
  let seen: string | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      seen = JSON.parse(String(init.body)).model;
      return new Response(JSON.stringify({ response: '{"lines":[{"raw_text":"MILK"}]}' }), {
        status: 200,
      });
    })
  );
  return { seen: () => seen };
}

describe('receipt structurer model selection', () => {
  it('uses the env default when nothing is selected', async () => {
    const cap = stubOllamaAndCaptureModel();
    await structureReceipt('MILK 3.50');
    expect(cap.seen()).toBe(config.OLLAMA_LLM_MODEL);
  });

  it('uses the selected model once one is set, with no restart', async () => {
    await setModel('text', 'qwen2.5:3b');
    const cap = stubOllamaAndCaptureModel();
    await structureReceipt('MILK 3.50');
    expect(cap.seen()).toBe('qwen2.5:3b');
  });
});
