import { eq } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { config } from '../../config/index.js';
import { systemSettings } from '../../db/schema/index.js';

export const TEXT_MODEL_KEY = 'llm.textModel';
export const VISION_MODEL_KEY = 'llm.visionModel';

export type ModelRole = 'text' | 'vision';

const KEY_BY_ROLE: Record<ModelRole, string> = {
  text: TEXT_MODEL_KEY,
  vision: VISION_MODEL_KEY,
};

async function readSetting(key: string): Promise<string | null> {
  const row = await db.query.systemSettings.findFirst({
    where: eq(systemSettings.key, key),
  });
  // jsonb round-trips a string as a string; anything else is a corrupted row
  // and is ignored in favour of the env default rather than crashing a scan.
  return typeof row?.value === 'string' ? row.value : null;
}

/**
 * The model used to structure OCR text into receipt lines. Falls back to the
 * env var so an install that never visits the settings page behaves exactly as
 * it did before this feature existed.
 */
export async function getTextModel(): Promise<string> {
  return (await readSetting(TEXT_MODEL_KEY)) ?? config.OLLAMA_LLM_MODEL;
}

/** The model used for image understanding. Same fallback rule. */
export async function getVisionModel(): Promise<string> {
  return (await readSetting(VISION_MODEL_KEY)) ?? config.OLLAMA_VLM_MODEL;
}

export async function setModel(role: ModelRole, tag: string): Promise<void> {
  const key = KEY_BY_ROLE[role];
  await db
    .insert(systemSettings)
    .values({ key, value: tag })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: tag, updatedAt: new Date() },
    });
}
