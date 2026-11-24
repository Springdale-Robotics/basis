import { loadSharp } from '../../../lib/sharp.js';
import { getClaudeKeyStatus } from '../../llm/claude/ai-backend.js';
import { claudeComplete } from '../../llm/claude/claude-call.js';
import { FALLBACK_CLAUDE_MODEL, getClaudeModel } from '../../llm/claude/claude-model.js';
import { z } from 'zod';
import type { VisionProvider, VisionResult } from './index.js';

/**
 * Longest edge sent to Claude. Larger images are scaled down by the API
 * anyway, so sending more only costs upload time and tokens.
 */
const MAX_EDGE_PX = 1568;
const JPEG_QUALITY = 85;

/**
 * Claude reads the photo AND sorts it, in one reply. The verbatim transcription
 * is kept alongside the structure because the multi-photo recipe path joins
 * pages as plain text. Ingredient lines stay as written: quantities and units
 * come from the CRF parser downstream, the same as for every other provider.
 */
export const CLAUDE_VISION_PROMPT = `Read this photo for a household app. Reply with ONLY a JSON object, no commentary:

{
  "transcription": "every word of text in the photo, exactly as written, keeping line breaks",
  "type": "recipe" | "list" | "calendar_event" | "unknown",
  "recipe": {
    "title": "the dish name (often in a printed card header such as \"Here's what's cookin':\")",
    "description": "tips, serving notes or comments that are not steps, or null",
    "servings": number or null,
    "prepTimeMinutes": number or null,
    "cookTimeMinutes": number or null,
    "ingredients": ["each ingredient line exactly as written, quantity included"],
    "instructions": ["each step, in order, in the card's words"]
  },
  "list": { "title": "string or null", "items": ["each item as written"] }
}

Rules:
- Include "recipe" only when type is "recipe", and "list" only when type is "list".
- Copy wording from the photo. Do not add, correct or complete anything that is not written there.
- The photo may be rotated or upside down; read it in its correct orientation.
- Printed card labels (such as "Recipe from the kitchen of:" or "Serves:") are not steps.
- If servings is a range (such as "10-12"), use the lower number.
- If the photo has no readable text, reply {"transcription": "", "type": "unknown"}.`;

const lines = z.array(z.string()).catch([]);
const numberOrNull = z.number().positive().nullish().catch(null);
const replySchema = z.object({
  transcription: z.string().catch(''),
  type: z.enum(['recipe', 'list', 'calendar_event', 'unknown']).catch('unknown'),
  recipe: z
    .object({
      title: z.string().nullish(),
      description: z.string().nullish(),
      servings: numberOrNull,
      prepTimeMinutes: numberOrNull,
      cookTimeMinutes: numberOrNull,
      ingredients: lines,
      instructions: lines,
    })
    .nullish(),
  list: z.object({ title: z.string().nullish(), items: lines }).nullish(),
});

/** Models wrap JSON in fences or prose often enough to handle it here. */
function parseReply(text: string): z.infer<typeof replySchema> | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced
    ? fenced[1]
    : trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1);
  if (!candidate.startsWith('{')) return null;
  try {
    const parsed = replySchema.safeParse(JSON.parse(candidate));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const nonEmpty = (xs: string[]) => xs.map((x) => x.trim()).filter(Boolean);

function toStructured(reply: z.infer<typeof replySchema>): VisionResult['structured'] {
  if (reply.type === 'recipe' && reply.recipe) {
    const r = reply.recipe;
    return {
      type: 'recipe',
      confidence: 0.9,
      data: {
        title: r.title?.trim() || undefined,
        description: r.description?.trim() || undefined,
        servings: r.servings ?? undefined,
        prepTimeMinutes: r.prepTimeMinutes ?? undefined,
        cookTimeMinutes: r.cookTimeMinutes ?? undefined,
        ingredients: nonEmpty(r.ingredients).map((name) => ({ name })),
        instructions: nonEmpty(r.instructions),
      },
    };
  }
  if (reply.type === 'list' && reply.list) {
    return {
      type: 'list',
      confidence: 0.9,
      data: {
        title: reply.list.title?.trim() || undefined,
        items: nonEmpty(reply.list.items).map((content) => ({ content })),
      },
    };
  }
  // Calendar and anything else: the existing text parsers handle these.
  return undefined;
}

/**
 * Always re-encode to JPEG. Claude accepts only jpeg/png/gif/webp up to 5 MB,
 * and phones hand us HEIC and 12 MP originals. Unlike the Ollama path, an
 * image sharp can't decode is an error here: sending the original would just
 * come back as an opaque 400 from the API.
 */
async function prepareForClaude(imageBuffer: Buffer): Promise<string> {
  try {
    const sharp = await loadSharp();
    const jpeg = await sharp(imageBuffer)
      .rotate() // honour EXIF orientation before the metadata is dropped
      .resize(MAX_EDGE_PX, MAX_EDGE_PX, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
    return jpeg.toString('base64');
  } catch {
    throw new Error("This photo couldn't be read. Try a JPEG or PNG.");
  }
}

export class ClaudeVisionProvider implements VisionProvider {
  name = 'claude';
  private model: string = FALLBACK_CLAUDE_MODEL.id;

  async isAvailable(): Promise<boolean> {
    return (await getClaudeKeyStatus()).state === 'set';
  }

  getModel(): string {
    return this.model;
  }

  isLightweightModel(): boolean {
    return false;
  }

  async parseImage(imageBuffer: Buffer, _mimeType: string, prompt: string): Promise<VisionResult> {
    const startTime = Date.now();
    const data = await prepareForClaude(imageBuffer);
    this.model = (await getClaudeModel()).id;

    const reply = await claudeComplete({
      // Generous: current Haiku models think before answering, and thinking
      // shares this budget. Unused budget costs nothing.
      maxTokens: 16000,
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
        { type: 'text', text: prompt.trim() || CLAUDE_VISION_PROMPT },
      ],
    });
    const processingTimeMs = Date.now() - startTime;

    // A caller-supplied prompt asks for plain text; so does a reply that
    // isn't the JSON we asked for — either way the existing text parsers run.
    const parsed = prompt.trim() ? null : parseReply(reply);
    if (!parsed) return { rawText: reply, processingTimeMs };

    if (!parsed.transcription.trim()) {
      throw new Error('No readable text was found in this photo.');
    }
    return { rawText: parsed.transcription, structured: toStructured(parsed), processingTimeMs };
  }
}
