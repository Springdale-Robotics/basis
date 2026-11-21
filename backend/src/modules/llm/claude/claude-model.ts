import type Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import { db } from '../../../config/database.js';
import { systemSettings } from '../../../db/schema/index.js';
import { logger } from '../../../lib/logger.js';
import { getClaudeClient } from './ai-backend.js';

/**
 * Which Claude model Basis uses: always the newest Haiku that takes images.
 *
 * Not pinned, so the box keeps working when Anthropic retires a version. The
 * Models API is asked at most once a day; between asks, and whenever asking
 * fails, the last answer is used.
 */
export const CLAUDE_MODEL_KEY = 'ai.claudeModel';
export const FALLBACK_CLAUDE_MODEL = { id: 'claude-haiku-5-5', displayName: 'Claude Haiku 5.5' } as const;

const RESOLVE_EVERY_MS = 24 * 60 * 60 * 1000;
/**
 * After a failed lookup (revoked key, no internet), wait this long before
 * asking again. Without it every page load and every scan waits on the same
 * failing request first.
 */
const RETRY_AFTER_FAILURE_MS = 10 * 60 * 1000;
let lastFailureAt: number | null = null;

export interface ResolvedClaudeModel {
  id: string;
  displayName: string;
  /** null when this is the built-in fallback, never confirmed by the API. */
  resolvedAt: string | null;
}

export function pickNewestHaiku(models: Anthropic.ModelInfo[]): Anthropic.ModelInfo | null {
  let newest: Anthropic.ModelInfo | null = null;
  for (const m of models) {
    if (!m.id.startsWith('claude-haiku-')) continue;
    // Photo import needs vision. A model that doesn't report capabilities is
    // given the benefit of the doubt; one that says "no images" is not.
    if (m.capabilities?.image_input?.supported === false) continue;
    if (!newest || Date.parse(m.created_at) > Date.parse(newest.created_at)) newest = m;
  }
  return newest;
}

async function readStored(): Promise<ResolvedClaudeModel | null> {
  const row = await db.query.systemSettings.findFirst({ where: eq(systemSettings.key, CLAUDE_MODEL_KEY) });
  const v = row?.value as Partial<ResolvedClaudeModel> | undefined;
  return typeof v?.id === 'string' && typeof v.displayName === 'string'
    ? { id: v.id, displayName: v.displayName, resolvedAt: typeof v.resolvedAt === 'string' ? v.resolvedAt : null }
    : null;
}

async function resolve(stored: ResolvedClaudeModel | null): Promise<ResolvedClaudeModel> {
  const fallback = stored ?? { ...FALLBACK_CLAUDE_MODEL, resolvedAt: null };
  const client = await getClaudeClient();
  if (!client) return fallback;

  try {
    const models: Anthropic.ModelInfo[] = [];
    for await (const m of client.models.list()) models.push(m);

    const newest = pickNewestHaiku(models);
    if (!newest) {
      logger.warn({ modelCount: models.length }, 'Models API listed no Claude Haiku that takes images');
      lastFailureAt = Date.now();
      return fallback;
    }

    const resolved: ResolvedClaudeModel = {
      id: newest.id,
      displayName: newest.display_name,
      resolvedAt: new Date().toISOString(),
    };
    await db
      .insert(systemSettings)
      .values({ key: CLAUDE_MODEL_KEY, value: resolved })
      .onConflictDoUpdate({ target: systemSettings.key, set: { value: resolved, updatedAt: new Date() } });
    lastFailureAt = null;
    return resolved;
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'Could not list Claude models; keeping the last known model'
    );
    lastFailureAt = Date.now();
    return fallback;
  }
}

// Bulk recipe capture starts many jobs at once; they share one lookup.
let inFlight: Promise<ResolvedClaudeModel> | null = null;

export async function getClaudeModel(opts: { force?: boolean } = {}): Promise<ResolvedClaudeModel> {
  // Checked before the DB read too: a caller whose read lands just after a
  // lookup finished would otherwise see the stale row and start a second one.
  if (inFlight) return inFlight;
  const stored = await readStored();
  const fresh =
    stored?.resolvedAt != null && Date.now() - Date.parse(stored.resolvedAt) < RESOLVE_EVERY_MS;
  if (fresh && !opts.force) return stored;

  const recentlyFailed = lastFailureAt !== null && Date.now() - lastFailureAt < RETRY_AFTER_FAILURE_MS;
  if (recentlyFailed && !opts.force) return stored ?? { ...FALLBACK_CLAUDE_MODEL, resolvedAt: null };

  if (!inFlight) {
    inFlight = resolve(stored).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

export function __resetClaudeModelForTests(): void {
  lastFailureAt = null;
  inFlight = null;
}
