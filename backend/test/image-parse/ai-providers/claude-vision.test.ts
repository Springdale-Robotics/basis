import { afterEach, describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'fs/promises';
import { loadSharp } from '../../../src/lib/sharp.js';

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('../../../src/modules/llm/claude/ai-backend.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/modules/llm/claude/ai-backend.js')>()),
  getClaudeKeyStatus: async () => ({ state: 'set', hint: '••••1234' }),
  getClaudeClient: async () => ({ messages: { create: mocks.create } }),
}));
vi.mock('../../../src/modules/llm/claude/claude-model.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/modules/llm/claude/claude-model.js')>()),
  getClaudeModel: async () => ({ id: 'claude-haiku-5-5', displayName: 'Claude Haiku 5.5', resolvedAt: null }),
}));

const { ClaudeVisionProvider } = await import('../../../src/modules/image-parse/ai-providers/claude-vision.js');
const { CLAUDE_VISION_PROMPT } = await import('../../../src/modules/image-parse/ai-providers/claude-vision.js');
const { CLAUDE_ERROR_MESSAGES } = await import('../../../src/modules/llm/claude/claude-call.js');

afterEach(() => mocks.create.mockReset());

async function bigPng(): Promise<Buffer> {
  const sharp = await loadSharp();
  return sharp({ create: { width: 4000, height: 3000, channels: 3, background: { r: 240, g: 240, b: 240 } } })
    .png()
    .toBuffer();
}

function sentBlocks() {
  return mocks.create.mock.calls[0][0].messages[0].content as Array<Record<string, any>>;
}

describe('ClaudeVisionProvider', () => {
  it('sends a large PNG as a JPEG no longer than 1568px on its long edge', async () => {
    mocks.create.mockResolvedValue({ content: [{ type: 'text', text: 'Pancakes' }], stop_reason: 'end_turn' });

    const result = await new ClaudeVisionProvider().parseImage(await bigPng(), 'image/png', '');

    expect(result.rawText).toBe('Pancakes');
    expect(result.structured).toBeUndefined();
    const image = sentBlocks()[0];
    expect(image.type).toBe('image');
    expect(image.source.media_type).toBe('image/jpeg');
    const sharp = await loadSharp();
    const meta = await sharp(Buffer.from(image.source.data, 'base64')).metadata();
    expect(meta.format).toBe('jpeg');
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1568);
  });

  it('re-encodes even a small image so the declared type is always right', async () => {
    mocks.create.mockResolvedValue({ content: [{ type: 'text', text: 'x' }], stop_reason: 'end_turn' });
    const sharp = await loadSharp();
    const small = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#fff' } }).webp().toBuffer();

    await new ClaudeVisionProvider().parseImage(small, 'image/webp', '');

    const meta = await sharp(Buffer.from(sentBlocks()[0].source.data, 'base64')).metadata();
    expect(meta.format).toBe('jpeg');
  });

  it('uses the structured-reply prompt when the caller passes none', async () => {
    mocks.create.mockResolvedValue({ content: [{ type: 'text', text: 'x' }], stop_reason: 'end_turn' });
    await new ClaudeVisionProvider().parseImage(await bigPng(), 'image/png', '  ');
    expect(sentBlocks()[1]).toEqual({ type: 'text', text: CLAUDE_VISION_PROMPT });
  });

  it('leaves room for thinking and a long transcription (max_tokens 16000)', async () => {
    mocks.create.mockResolvedValue({ content: [{ type: 'text', text: 'x' }], stop_reason: 'end_turn' });
    await new ClaudeVisionProvider().parseImage(await bigPng(), 'image/png', '');
    expect(mocks.create.mock.calls[0][0].max_tokens).toBe(16000);
  });

  it('a real iPhone HEIC photo fails with the clear message, not a raw API error', async () => {
    const heic = await readFile(new URL('../../receipts/fixtures/sample-receipt.heic', import.meta.url));
    const result = await new ClaudeVisionProvider().parseImage(heic, 'image/heic', '').then(
      () => 'sent',
      (e: Error) => e.message
    );
    // sharp here has no HEVC decoder; if a future build gains one the photo is
    // simply sent as a JPEG, which is also fine.
    if (result !== 'sent') expect(result).toBe("This photo couldn't be read. Try a JPEG or PNG.");
    else expect(sentBlocks()[0].source.media_type).toBe('image/jpeg');
  });

  it('refuses an image it cannot decode instead of sending it', async () => {
    await expect(
      new ClaudeVisionProvider().parseImage(Buffer.from('definitely not an image'), 'image/heic', '')
    ).rejects.toThrow("This photo couldn't be read. Try a JPEG or PNG.");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('reports a revoked key with the key-rejected message', async () => {
    mocks.create.mockRejectedValue(
      new Anthropic.AuthenticationError(401, { error: { message: 'invalid x-api-key' } }, 'invalid', new Headers())
    );
    await expect(new ClaudeVisionProvider().parseImage(await bigPng(), 'image/png', '')).rejects.toThrow(
      CLAUDE_ERROR_MESSAGES.auth
    );
  });
});

describe('ClaudeVisionProvider structured output', () => {
  const reply = (obj: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }], stop_reason: 'end_turn' });

  it('asks for JSON with a verbatim transcription', async () => {
    mocks.create.mockResolvedValue(reply({ transcription: 'Soup', type: 'unknown' }));
    await new ClaudeVisionProvider().parseImage(await bigPng(), 'image/png', '');
    const prompt = sentBlocks()[1].text as string;
    expect(prompt).toContain('JSON');
    expect(prompt).toContain('transcription');
    // "Serves 10-12" came back as 11 in the first real test.
    expect(prompt).toContain('lower number');
  });

  it('returns the recipe structured, with the printed-card title, notes as description, and ingredient lines as written', async () => {
    mocks.create.mockResolvedValue(
      reply({
        transcription: "Here's what's cookin': Chocolate-Nut Zucchini Cake\n3 sq. unsweetened chocolate\nMelt chocolate.",
        type: 'recipe',
        recipe: {
          title: 'Chocolate-Nut Zucchini Cake',
          description: 'Excellent à la mode with french vanilla ice cream.',
          servings: 10,
          ingredients: ['3 sq. unsweetened chocolate', '1½ tsp. baking powder'],
          instructions: ['Melt chocolate over hot, not boiling, water.', 'Let cool.'],
        },
      })
    );

    const result = await new ClaudeVisionProvider().parseImage(await bigPng(), 'image/png', '');

    expect(result.rawText).toContain("Here's what's cookin'");
    expect(result.structured?.type).toBe('recipe');
    const data = result.structured?.data as Record<string, any>;
    expect(data.title).toBe('Chocolate-Nut Zucchini Cake');
    expect(data.description).toBe('Excellent à la mode with french vanilla ice cream.');
    expect(data.servings).toBe(10);
    expect(data.ingredients).toEqual([{ name: '3 sq. unsweetened chocolate' }, { name: '1½ tsp. baking powder' }]);
    expect(data.instructions).toEqual(['Melt chocolate over hot, not boiling, water.', 'Let cool.']);
  });

  it('returns a list structured as items', async () => {
    mocks.create.mockResolvedValue(
      reply({ transcription: 'milk\neggs', type: 'list', list: { title: 'Groceries', items: ['milk', 'eggs'] } })
    );
    const result = await new ClaudeVisionProvider().parseImage(await bigPng(), 'image/png', '');
    expect(result.structured?.type).toBe('list');
    expect((result.structured?.data as any).items).toEqual([{ content: 'milk' }, { content: 'eggs' }]);
  });

  it('keeps other kinds of content as plain text for the existing parsers', async () => {
    mocks.create.mockResolvedValue(reply({ transcription: 'Dentist Tue 3pm', type: 'calendar_event' }));
    const result = await new ClaudeVisionProvider().parseImage(await bigPng(), 'image/png', '');
    expect(result.rawText).toBe('Dentist Tue 3pm');
    expect(result.structured).toBeUndefined();
  });

  it('fails clearly, without inventing anything, when the photo has no readable text', async () => {
    mocks.create.mockResolvedValue(reply({ transcription: '', type: 'unknown' }));
    await expect(new ClaudeVisionProvider().parseImage(await bigPng(), 'image/png', '')).rejects.toThrow(
      'No readable text was found in this photo.'
    );
  });

  it('falls back to the whole reply as plain text when it is not valid JSON', async () => {
    mocks.create.mockResolvedValue({ content: [{ type: 'text', text: 'Pancakes\n1 cup flour' }], stop_reason: 'end_turn' });
    const result = await new ClaudeVisionProvider().parseImage(await bigPng(), 'image/png', '');
    expect(result.rawText).toBe('Pancakes\n1 cup flour');
    expect(result.structured).toBeUndefined();
  });

  it('accepts JSON wrapped in a code fence', async () => {
    mocks.create.mockResolvedValue({
      content: [{ type: 'text', text: '```json\n' + JSON.stringify({ transcription: 'milk', type: 'list', list: { items: ['milk'] } }) + '\n```' }],
      stop_reason: 'end_turn',
    });
    const result = await new ClaudeVisionProvider().parseImage(await bigPng(), 'image/png', '');
    expect(result.structured?.type).toBe('list');
  });
});

describe('ClaudeVisionProvider steps', () => {
  const reply = (obj: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }], stop_reason: 'end_turn' });

  it("keeps Claude's step boundaries rather than re-splitting them by rule", async () => {
    const steps = ['Melt chocolate. Let cool.', 'Preheat oven to 350°. Grease a tube pan.'];
    mocks.create.mockResolvedValue(
      reply({ transcription: 'x', type: 'recipe', recipe: { title: 'X', ingredients: ['1 egg'], instructions: steps } })
    );
    const result = await new ClaudeVisionProvider().parseImage(await bigPng(), 'image/png', '');
    expect((result.structured?.data as any).instructions).toEqual(steps);
  });

  it('asks Claude to leave out text that is not part of the recipe', () => {
    // A product sticker's own instructions ended up in a recipe's notes (eval item D).
    expect(CLAUDE_VISION_PROMPT).toContain("Leave out text that isn't part of this recipe");
  });

  it('does not let Claude invent structure on a partial page', () => {
    // Eval item C (back of a card): a completed opening fragment ("Mix
    // cheese, …") and Claude's own comment as the description ("The card is
    // cut off at the top…"). Pulling ingredients out of a method is wanted —
    // it's what lets prose-only recipes match the inventory.
    expect(CLAUDE_VISION_PROMPT).toContain("keep it as it is; don't complete it");
    expect(CLAUDE_VISION_PROMPT).toContain("Don't add your own comments or explanations");
  });

  it('asks for one action per step and carries no card-specific examples', () => {
    expect(CLAUDE_VISION_PROMPT).toContain('one action per step');
    expect(CLAUDE_VISION_PROMPT).not.toContain("what's cookin");
  });
});
