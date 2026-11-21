import Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import { db } from '../../../config/database.js';
import { systemSettings } from '../../../db/schema/index.js';
import { decrypt, encrypt } from '../../../lib/crypto.js';
import { Errors } from '../../../lib/errors.js';

/**
 * The box-wide "Where AI runs" switch and the Claude API key behind it.
 *
 * Box-level on purpose, like the Ollama model selection in llm-settings.ts:
 * which AI service a machine uses is a property of the machine.
 *
 * The switch is tri-state. Absent means the admin never chose, and every AI
 * job behaves exactly as it did before this setting existed. 'local' means
 * nothing leaves the box. 'claude' means Claude and nothing else.
 */
export type AiBackend = 'local' | 'claude';
export type ClaudeKeyState = 'none' | 'set' | 'unreadable';

export const AI_BACKEND_KEY = 'ai.backend';
export const CLAUDE_API_KEY_KEY = 'ai.claudeApiKey';

interface StoredKey {
  ciphertext: string;
  /** '••••' + last four characters — safe to show, never enough to use. */
  hint: string;
}

async function readValue(key: string): Promise<unknown> {
  const row = await db.query.systemSettings.findFirst({ where: eq(systemSettings.key, key) });
  return row?.value ?? null;
}

async function writeValue(key: string, value: unknown, tx: Pick<typeof db, 'insert'> = db): Promise<void> {
  await tx
    .insert(systemSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value, updatedAt: new Date() } });
}

function isStoredKey(value: unknown): value is StoredKey {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as StoredKey).ciphertext === 'string' &&
    typeof (value as StoredKey).hint === 'string'
  );
}

export async function getAiBackend(): Promise<AiBackend | null> {
  const value = await readValue(AI_BACKEND_KEY);
  return value === 'local' || value === 'claude' ? value : null;
}

export async function setAiBackend(backend: AiBackend): Promise<void> {
  if (backend === 'claude' && (await getClaudeKeyStatus()).state !== 'set') {
    throw Errors.validation('Add a Claude API key before choosing Claude.');
  }
  await writeValue(AI_BACKEND_KEY, backend);
}

/** Decrypts the stored key. A row that won't decrypt is 'unreadable', never an exception. */
async function readKey(): Promise<{ state: ClaudeKeyState; hint: string | null; key: string | null }> {
  const value = await readValue(CLAUDE_API_KEY_KEY);
  if (!isStoredKey(value)) return { state: 'none', hint: null, key: null };
  try {
    return { state: 'set', hint: value.hint, key: decrypt(value.ciphertext) };
  } catch {
    // Most likely cause: ENCRYPTION_KEY changed, e.g. a move to a new host.
    return { state: 'unreadable', hint: value.hint, key: null };
  }
}

export async function getClaudeKeyStatus(): Promise<{ state: ClaudeKeyState; hint: string | null }> {
  const { state, hint } = await readKey();
  return { state, hint };
}

export async function getClaudeKey(): Promise<string | null> {
  return (await readKey()).key;
}

export async function saveClaudeKey(rawKey: string): Promise<void> {
  const key = rawKey.trim();
  const stored: StoredKey = { ciphertext: encrypt(key), hint: `••••${key.slice(-4)}` };
  await writeValue(CLAUDE_API_KEY_KEY, stored);
}

export async function clearClaudeKey(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(systemSettings).where(eq(systemSettings.key, CLAUDE_API_KEY_KEY));
    const row = await tx.query.systemSettings.findFirst({ where: eq(systemSettings.key, AI_BACKEND_KEY) });
    // Claude can't run without a key; leaving 'claude' selected would just
    // fail every job. Switching to local is what removing the key means.
    if (row?.value === 'claude') await writeValue(AI_BACKEND_KEY, 'local', tx);
  });
}

/** The one place a Claude client is constructed — tests mock this. */
export function createClaudeClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, maxRetries: 2 });
}

let cached: { key: string; client: Anthropic } | null = null;

export async function getClaudeClient(): Promise<Anthropic | null> {
  const key = await getClaudeKey();
  if (!key) return null;
  if (cached?.key !== key) cached = { key, client: createClaudeClient(key) };
  return cached.client;
}

export function __resetClaudeClientForTests(): void {
  cached = null;
}
