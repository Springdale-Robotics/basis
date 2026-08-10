import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware, requireAdmin } from '../../middleware/auth.middleware.js';
import { Errors } from '../../lib/errors.js';
import { detectHardware } from './llm-hardware.js';
import { catalogWithFit, combinedFootprint } from './llm-catalog.js';
import { isReachable, listInstalledTags, deleteModel } from './ollama-client.js';
import { getTextModel, getVisionModel, setModel } from './llm-settings.js';

const updateSettingsSchema = z.object({
  textModel: z.string().min(1).max(200).optional(),
  visionModel: z.string().min(1).max(200).optional(),
});

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

    return {
      success: true,
      data: {
        reachable,
        installed,
        selected: { text, vision },
        // A selection whose model is gone must be visible here — otherwise
        // deleting the active model turns every scan into a silent failure.
        missing: {
          text: reachable && !installed.includes(text),
          vision: reachable && !installed.includes(vision),
        },
        footprint: combinedFootprint([text, vision], hw),
      },
    };
  });

  app.put('/settings', { preHandler: [authMiddleware, requireAdmin()] }, async (request) => {
    const input = updateSettingsSchema.parse(request.body);
    const installed = await listInstalledTags();

    for (const [role, tag] of [
      ['text', input.textModel],
      ['vision', input.visionModel],
    ] as const) {
      if (!tag) continue;
      if (!installed.includes(tag)) {
        throw Errors.validation(`${tag} is not installed. Install it before selecting it.`);
      }
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

  // POST /models/pull is added in Task 6, together with llm.ws.ts's startPull
  // and the disk pre-check that guards it.
}
