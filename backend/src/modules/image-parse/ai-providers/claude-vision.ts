import { loadSharp } from '../../../lib/sharp.js';
import { getClaudeKeyStatus } from '../../llm/claude/ai-backend.js';
import { claudeComplete } from '../../llm/claude/claude-call.js';
import { FALLBACK_CLAUDE_MODEL, getClaudeModel } from '../../llm/claude/claude-model.js';
import { DEFAULT_TRANSCRIPTION_PROMPT } from './ollama-vision.js';
import type { VisionProvider, VisionResult } from './index.js';

/**
 * Longest edge sent to Claude. Larger images are scaled down by the API
 * anyway, so sending more only costs upload time and tokens.
 */
const MAX_EDGE_PX = 1568;
const JPEG_QUALITY = 85;

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

    const rawText = await claudeComplete({
      // Generous: current Haiku models think before answering, and thinking
      // shares this budget. Unused budget costs nothing.
      maxTokens: 16000,
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
        { type: 'text', text: prompt.trim() || DEFAULT_TRANSCRIPTION_PROMPT },
      ],
    });

    // Text only, like the Ollama provider: the existing heuristic + CRF
    // pipeline turns the transcription into a recipe/list/event.
    return { rawText, processingTimeMs: Date.now() - startTime };
  }
}
