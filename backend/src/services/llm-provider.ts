import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';
import { getAiBackend } from '../modules/llm/claude/ai-backend.js';
import { claudeComplete } from '../modules/llm/claude/claude-call.js';

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
      // No sampling params: current Claude models reject non-default values,
      // and API version 2026-10-21 rejects them on every model.
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
          temperature: 0,
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

/**
 * Claude via the key saved in Settings → AI Models. Always "available" when
 * selected: a missing or unreadable key surfaces as a ClaudeError with a
 * user-facing message instead of silently skipping the AI step.
 */
class ClaudeTextProvider implements LLMProvider {
  name = 'claude';

  isAvailable(): boolean {
    return true;
  }

  async complete(prompt: string, options?: LLMOptions): Promise<string> {
    return claudeComplete({
      system: options?.systemPrompt,
      content: prompt,
      maxTokens: options?.maxTokens ?? 4096,
    });
  }
}

// Singleton instances
let anthropicProvider: AnthropicProvider | null = null;
let ollamaProvider: OllamaProvider | null = null;
const claudeTextProvider = new ClaudeTextProvider();

function getOllamaProvider(): OllamaProvider | null {
  if (!ollamaProvider) {
    ollamaProvider = new OllamaProvider();
  }
  return ollamaProvider.isAvailable() ? ollamaProvider : null;
}

/**
 * Get the LLM provider for recipe text, following the AI backend switch:
 * - 'claude': Claude with the key from Settings, nothing else.
 * - 'local': Ollama only. The ANTHROPIC_API_KEY env var is ignored, because
 *   the admin chose to keep everything on this box.
 * - not chosen: the original order — env-key Anthropic, then Ollama.
 * Returns null if no provider is available.
 */
export async function getLLMProvider(): Promise<LLMProvider | null> {
  const backend = await getAiBackend();
  if (backend === 'claude') return claudeTextProvider;
  if (backend === 'local') return getOllamaProvider();

  // Try Anthropic first
  if (!anthropicProvider) {
    anthropicProvider = new AnthropicProvider();
  }
  if (anthropicProvider.isAvailable()) {
    return anthropicProvider;
  }

  // Fall back to Ollama
  return getOllamaProvider();
}
