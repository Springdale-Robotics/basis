import { statfs } from 'fs/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware, requireAdmin } from '../../middleware/auth.middleware.js';
import { Errors } from '../../lib/errors.js';
import { config } from '../../config/index.js';
import { detectHardware } from './llm-hardware.js';
import { catalogWithFit, combinedFootprint, normalizeTag, CATALOG } from './llm-catalog.js';
import { isReachable, listInstalledTags, deleteModel } from './ollama-client.js';
import { getTextModel, getVisionModel, setModel } from './llm-settings.js';
import { startPull } from './llm.ws.js';

const updateSettingsSchema = z.object({
  textModel: z.string().min(1).max(200).optional(),
  visionModel: z.string().min(1).max(200).optional(),
});

const pullSchema = z.object({ tag: z.string().min(1).max(200) });

/** Refuse a pull we can already tell will not fit, rather than dying at 90%. */
async function assertDiskSpaceFor(tag: string): Promise<void> {
  const wanted = normalizeTag(tag);
  const entry = CATALOG.find((m) => normalizeTag(m.tag) === wanted);
  if (!entry) return; // unknown tag from the advanced field — size unknowable

  let freeBytes: number;
  try {
    const stats = await statfs(config.STORAGE_PATH);
    freeBytes = stats.bavail * stats.bsize;
  } catch {
    return; // a statfs failure must not block a pull that might well succeed
  }

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
    const [reachable, installed, hw, text, vision] = await Promise.all([
      isReachable(),
      listInstalledTags(),
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

  app.put('/settings', { preHandler: [authMiddleware, requireAdmin()] }, async (request) => {
    const input = updateSettingsSchema.parse(request.body);
    const installed = await listInstalledTags();
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
      await deleteModel(decodeURIComponent(request.params.tag));
      return { success: true, data: { message: 'Model removed' } };
    }
  );

  app.post('/models/pull', { preHandler: [authMiddleware, requireAdmin()] }, async (request) => {
    const { tag } = pullSchema.parse(request.body);
    await assertDiskSpaceFor(tag);
    return { success: true, data: { pullId: startPull(tag) } };
  });
}
