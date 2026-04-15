import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';

/**
 * Unified LLM provider interface.
 * Both Anthropic and Ollama implement the same contract,
 * so switching providers is a drop-in replacement.
 */
export interface LLMProvider {
  name: string;
  isAvailable(): boolean;
  complete(prompt: string, options?: LLMOptions): Promise<string>;
}

export interface LLMOptions {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

/**
 * Anthropic API provider (Claude).
 * Highest accuracy, requires API key.
 */
class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  }

  isAvailable(): boolean {
    return !!config.ANTHROPIC_API_KEY;
  }

  async complete(prompt: string, options?: LLMOptions): Promise<string> {
    const response = await this.client.messages.create({
      model: config.LLM_RECIPE_MODEL,
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0,
      system: options?.systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find(b => b.type === 'text');
    return textBlock?.text ?? '';
  }
}

/**
 * Local Ollama provider.
 * Free, no API key needed, but requires Ollama running with a model.
 * Uses the same prompt format as Anthropic for consistency.
 */
class OllamaProvider implements LLMProvider {
  name = 'ollama';

  isAvailable(): boolean {
    // Consider available if Ollama host is configured
    return !!config.OLLAMA_HOST && !!config.OLLAMA_LLM_MODEL;
  }

  async complete(prompt: string, options?: LLMOptions): Promise<string> {
    const fullPrompt = options?.systemPrompt
      ? `${options.systemPrompt}\n\n${prompt}`
      : prompt;

    const response = await fetch(`${config.OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.OLLAMA_LLM_MODEL,
        prompt: fullPrompt,
        stream: false,
        options: {
          temperature: options?.temperature ?? 0,
          num_predict: options?.maxTokens ?? 4096,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.status}`);
    }

    const data = await response.json() as { response: string };
    return data.response;
  }
}

// Singleton instances
let anthropicProvider: AnthropicProvider | null = null;
let ollamaProvider: OllamaProvider | null = null;

/**
 * Get the best available LLM provider.
 * Prefers Anthropic (higher accuracy), falls back to Ollama.
 * Returns null if no provider is available.
 */
export function getLLMProvider(): LLMProvider | null {
  // Try Anthropic first
  if (!anthropicProvider) {
    anthropicProvider = new AnthropicProvider();
  }
  if (anthropicProvider.isAvailable()) {
    return anthropicProvider;
  }

  // Fall back to Ollama
  if (!ollamaProvider) {
    ollamaProvider = new OllamaProvider();
  }
  if (ollamaProvider.isAvailable()) {
    return ollamaProvider;
  }

  return null;
}
