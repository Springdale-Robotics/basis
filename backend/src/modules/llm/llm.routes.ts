import { statfs } from 'fs/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware, requireAdmin } from '../../middleware/auth.middleware.js';
import { Errors } from '../../lib/errors.js';
import { config } from '../../config/index.js';
import { detectHardware } from './llm-hardware.js';
import { catalogWithFit, combinedFootprint, normalizeTag, CATALOG } from './llm-catalog.js';
import { fetchInstalledTags, deleteModel } from './ollama-client.js';
import { getTextModel, getVisionModel, setModel } from './llm-settings.js';
import { startPull } from './llm.ws.js';
import {
  type AiBackend,
  type ClaudeKeyState,
  clearClaudeKey,
  createClaudeClient,
  getAiBackend,
  getClaudeKeyStatus,
  saveClaudeKey,
  setAiBackend,
} from './claude/ai-backend.js';
import { ClaudeError } from './claude/claude-call.js';
import { getClaudeModel, MODELS_LIST_TIMEOUT_MS } from './claude/claude-model.js';
import Anthropic from '@anthropic-ai/sdk';

const updateSettingsSchema = z.object({
  textModel: z.string().min(1).max(200).optional(),
  visionModel: z.string().min(1).max(200).optional(),
});

const pullSchema = z.object({ tag: z.string().min(1).max(200) });

const backendSchema = z.object({ backend: z.enum(['local', 'claude']) });
const claudeKeySchema = z.object({ apiKey: z.string().trim().min(20).max(300) });

interface BackendState {
  backend: AiBackend | null;
  keyState: ClaudeKeyState;
  keyHint: string | null;
  model: { id: string; displayName: string } | null;
}

/** What the settings page renders. Never includes the key itself. */
async function backendState(): Promise<BackendState> {
  const [backend, key] = await Promise.all([getAiBackend(), getClaudeKeyStatus()]);
  // Only ask Anthropic about models when Claude is the chosen backend: on
  // "This server" nothing — not even a model list request — leaves the box.
  const model = backend === 'claude' && key.state === 'set' ? await getClaudeModel() : null;
  return {
    backend,
    keyState: key.state,
    keyHint: key.hint,
    model: model ? { id: model.id, displayName: model.displayName } : null,
  };
}

/**
 * Prove a key works before saving it, with the cheapest real call there is.
 * The failure message is the same mapped text a scan would show.
 */
async function verifyClaudeKey(apiKey: string): Promise<void> {
  try {
    const page = createClaudeClient(apiKey).models.list(undefined, { timeout: MODELS_LIST_TIMEOUT_MS });
    for await (const _model of page) break; // first entry is enough
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      throw Errors.validation('Anthropic rejected this key. Check it and try again.');
    }
    if (error instanceof Anthropic.RateLimitError) throw Errors.validation(new ClaudeError('rate_limit').message);
    if (error instanceof Anthropic.APIError && error.status === 402) {
      throw Errors.validation(new ClaudeError('billing').message);
    }
    if (error instanceof Anthropic.APIConnectionError) throw Errors.validation(new ClaudeError('network').message);
    const status = error instanceof Anthropic.APIError ? error.status : undefined;
    throw Errors.validation(new ClaudeError('api', status).message);
  }
}

/**
 * Where Ollama keeps its blobs on a systemd install. Deliberately not the
 * app's STORAGE_PATH: the two may share a filesystem on any given box, but
 * nothing guarantees it, and measuring the wrong volume both false-refuses
 * viable pulls and waves through ones that will die at 90%.
 */
const DEFAULT_OLLAMA_MODELS_PATH = '/usr/share/ollama/.ollama/models';

/**
 * True when OLLAMA_HOST points at another machine. Its disk is not ours to
 * measure, so no local statfs could say anything useful and the pre-check has
 * to stand down rather than guess.
 */
function ollamaIsRemote(): boolean {
  try {
    // URL keeps IPv6 literals bracketed — `[::1]` — so strip those to compare.
    const hostname = new URL(config.OLLAMA_HOST).hostname.replace(/^\[|\]$/g, '');
    return !['localhost', '127.0.0.1', '::1', '0.0.0.0', ''].includes(hostname);
  } catch {
    // Unparseable host: assume local and let the check run. A wrong skip is
    // worse than a wrong measurement — the latter still fails loudly.
    return false;
  }
}

/** Free bytes on the filesystem Ollama will write the blobs to, or null when
 *  none of the candidates can be measured. `/` is the last resort: the models
 *  directory does not exist until the first pull creates it. */
async function ollamaFreeBytes(): Promise<number | null> {
  const configured = process.env.OLLAMA_MODELS?.trim();
  for (const path of [configured || DEFAULT_OLLAMA_MODELS_PATH, '/']) {
    try {
      const stats = await statfs(path);
      return stats.bavail * stats.bsize;
    } catch {
      // Not there — fall through to the next candidate.
    }
  }
  return null;
}

/** Refuse a pull we can already tell will not fit, rather than dying at 90%. */
async function assertDiskSpaceFor(tag: string): Promise<void> {
  const wanted = normalizeTag(tag);
  const entry = CATALOG.find((m) => normalizeTag(m.tag) === wanted);
  if (!entry) return; // unknown tag from the advanced field — size unknowable

  if (ollamaIsRemote()) return; // that machine's disk is invisible from here

  const freeBytes = await ollamaFreeBytes();
  // A statfs failure must not block a pull that might well succeed.
  if (freeBytes === null) return;

  if (freeBytes < entry.downloadBytes * 1.1) {
    throw Errors.validation(
      `Not enough disk space for ${entry.label}: needs about ` +
        `${Math.ceil(entry.downloadBytes / 1e9)}GB, ${Math.floor(freeBytes / 1e9)}GB free.`
    );
  }
}

export async function llmRoutes(app: FastifyInstance): Promise<void> {
  app.get('/hardware', { preHandler: [authMiddleware, requireAdmin()] }, async () => ({
    success: true,
    data: await detectHardware(),
  }));

  app.get('/catalog', { preHandler: [authMiddleware, requireAdmin()] }, async () => {
    const hw = await detectHardware();
    return { success: true, data: { models: catalogWithFit(hw) } };
  });

  app.get('/status', { preHandler: [authMiddleware, requireAdmin()] }, async () => {
    // One request for both facts. Asking twice let them disagree: a timeout on
    // the second while the first succeeded produced "reachable, nothing
    // installed", which this route reports as every selection being missing.
    const [{ reachable, tags: installed }, hw, text, vision] = await Promise.all([
      fetchInstalledTags(),
      detectHardware(),
      getTextModel(),
      getVisionModel(),
    ]);

    // Ollama reports `moondream` as `moondream:latest`; comparing raw strings
    // would flag a perfectly good selection as missing.
    const installedNormalized = new Set(installed.map(normalizeTag));

    return {
      success: true,
      data: {
        backend: await getAiBackend(),
        reachable,
        installed,
        selected: { text, vision },
        // A selection whose model is gone must be visible here — otherwise
        // deleting the active model turns every scan into a silent failure.
        missing: {
          text: reachable && !installedNormalized.has(normalizeTag(text)),
          vision: reachable && !installedNormalized.has(normalizeTag(vision)),
        },
        footprint: combinedFootprint([text, vision], hw),
      },
    };
  });

  app.get('/backend', { preHandler: [authMiddleware, requireAdmin()] }, async () => ({
    success: true,
    data: await backendState(),
  }));

  app.put('/backend', { preHandler: [authMiddleware, requireAdmin()] }, async (request) => {
    const { backend } = backendSchema.parse(request.body);
    await setAiBackend(backend);
    return { success: true, data: await backendState() };
  });

  app.put('/claude-key', { preHandler: [authMiddleware, requireAdmin()] }, async (request) => {
    const { apiKey } = claudeKeySchema.parse(request.body);
    await verifyClaudeKey(apiKey);
    await saveClaudeKey(apiKey);
    // A new key may see different models; look up the newest Haiku now —
    // but only if Claude is in use (see backendState).
    if ((await getAiBackend()) === 'claude') await getClaudeModel({ force: true });
    return { success: true, data: await backendState() };
  });

  app.delete('/claude-key', { preHandler: [authMiddleware, requireAdmin()] }, async () => {
    await clearClaudeKey();
    return { success: true, data: await backendState() };
  });

  app.put('/settings', { preHandler: [authMiddleware, requireAdmin()] }, async (request) => {
    const input = updateSettingsSchema.parse(request.body);
    const { reachable, tags: installed } = await fetchInstalledTags();

    // "We couldn't ask" is not "it isn't installed". The frontend fires this
    // PUT the moment a pull completes, so a momentary blip used to reject the
    // model that had just finished downloading, telling the user to install
    // something they had only just installed. Say what actually went wrong and
    // let them retry.
    if (!reachable) {
      throw Errors.unavailable(
        "Can't reach Ollama right now, so the model list is unknown. Try again in a moment."
      );
    }

    const installedNormalized = new Set(installed.map(normalizeTag));

    const requested = (
      [
        ['text', input.textModel],
        ['vision', input.visionModel],
      ] as const
    ).filter((pair): pair is readonly ['text' | 'vision', string] => Boolean(pair[1]));

    // Validate every requested tag BEFORE writing any of them. Validating and
    // writing in the same loop pass would persist a valid text model and then
    // reject on an invalid vision model in the same request — the caller sees
    // a 400 while half their change silently took effect. The frontend submits
    // both fields together, so this is the normal path, not an edge case.
    for (const [, tag] of requested) {
      if (!installedNormalized.has(normalizeTag(tag))) {
        throw Errors.validation(`${tag} is not installed. Install it before selecting it.`);
      }
    }

    for (const [role, tag] of requested) {
      await setModel(role, tag);
    }

    return {
      success: true,
      data: { text: await getTextModel(), vision: await getVisionModel() },
    };
  });

  app.delete<{ Params: { tag: string } }>(
    '/models/:tag',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      let tag: string;
      try {
        tag = decodeURIComponent(request.params.tag);
      } catch {
        // decodeURIComponent throws URIError on malformed input like `%zz`,
        // which would otherwise surface as an unhandled 500 on what is
        // plainly a bad request.
        throw Errors.validation('That model tag is not valid URL-encoded text.');
      }
      await deleteModel(tag);
      return { success: true, data: { message: 'Model removed' } };
    }
  );

  app.post('/models/pull', { preHandler: [authMiddleware, requireAdmin()] }, async (request) => {
    const { tag } = pullSchema.parse(request.body);
    await assertDiskSpaceFor(tag);
    return { success: true, data: { pullId: startPull(tag) } };
  });
}
