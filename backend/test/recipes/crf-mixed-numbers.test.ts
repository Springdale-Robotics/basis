import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseIngredientsWithCRF } from '../../src/services/crf-ingredient-parser.js';

/**
 * The CRF parser reads a hyphenated mixed number as only its fraction:
 * "1-½ c (6oz) Mild Cheddar" came back as 0.5 cup, on every photo of a real
 * recipe card (photo-import eval, item B). Written "1 ½" or "1½" it reads 1.5.
 */
function captureSentLines(): () => string[] {
  let sent: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body)).ingredients;
      return new Response(JSON.stringify({ results: sent.map((name) => ({ name, confidence: 1 })) }), { status: 200 });
    })
  );
  return () => sent;
}

afterEach(() => vi.unstubAllGlobals());

describe('parseIngredientsWithCRF mixed numbers', () => {
  it('sends a hyphenated mixed number as whole + fraction', async () => {
    const sent = captureSentLines();
    await parseIngredientsWithCRF(['1-½ c (6oz) Mild Cheddar, divided', '2-1/4 cups flour', '1 - ¾ tsp salt']);
    expect(sent()).toEqual(['1 ½ c (6oz) Mild Cheddar, divided', '2 1/4 cups flour', '1 ¾ tsp salt']);
  });

  it('leaves ranges and other hyphens alone', async () => {
    const sent = captureSentLines();
    await parseIngredientsWithCRF(['2-3 cups stock', '1 10-inch pie crust', 'salt-free seasoning']);
    expect(sent()).toEqual(['2-3 cups stock', '1 10-inch pie crust', 'salt-free seasoning']);
  });
});
