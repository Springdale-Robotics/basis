import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../../../lib/logger.js';
import { getClaudeClient, getClaudeKeyStatus } from './ai-backend.js';
import { getClaudeModel } from './claude-model.js';

export type ClaudeErrorKind =
  | 'no_key'
  | 'key_unreadable'
  | 'auth'
  | 'rate_limit'
  | 'network'
  | 'refusal'
  | 'truncated'
  | 'api';

/** What the user sees. Photo import and receipts already surface error.message as-is. */
export const CLAUDE_ERROR_MESSAGES: Record<ClaudeErrorKind, string> = {
  no_key: 'No Claude API key is saved. Add one in Settings → AI Models.',
  key_unreadable: "The saved Claude API key can't be read — please re-enter it in Settings → AI Models.",
  auth: 'The Claude API key was rejected — replace it in Settings → AI Models.',
  rate_limit: 'Claude is busy right now. Try again in a minute.',
  network: "Can't reach Anthropic right now. Check this server's internet connection and try again.",
  refusal: 'Claude declined to read this.',
  truncated: "Claude's answer was cut off because the input was too long.",
  api: 'Claude returned an error',
};

/**
 * A Claude failure whose message is safe to show a user. It never carries the
 * SDK's own error text, which can quote request details.
 */
export class ClaudeError extends Error {
  constructor(
    readonly kind: ClaudeErrorKind,
    readonly status?: number
  ) {
    super(kind === 'api' ? `${CLAUDE_ERROR_MESSAGES.api}${status ? ` (HTTP ${status})` : ''}.` : CLAUDE_ERROR_MESSAGES[kind]);
    this.name = 'ClaudeError';
  }
}

function mapSdkError(error: unknown): ClaudeError {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new ClaudeError('auth', error.status);
  }
  if (error instanceof Anthropic.RateLimitError) return new ClaudeError('rate_limit', 429);
  if (error instanceof Anthropic.APIConnectionError) return new ClaudeError('network');
  if (error instanceof Anthropic.APIError) return new ClaudeError('api', error.status);
  return new ClaudeError('api');
}

export interface ClaudeCompleteInput {
  system?: string;
  content: string | Anthropic.ContentBlockParam[];
  maxTokens: number;
}

/**
 * One Claude request, kept deliberately plain so a newer Haiku can't break it:
 * no sampling parameters, no thinking config, no prefill, no forced tools.
 */
export async function claudeComplete(input: ClaudeCompleteInput): Promise<string> {
  const { state } = await getClaudeKeyStatus();
  if (state === 'none') throw new ClaudeError('no_key');
  if (state === 'unreadable') throw new ClaudeError('key_unreadable');

  const client = await getClaudeClient();
  if (!client) throw new ClaudeError('no_key');

  const send = async (model: string): Promise<Anthropic.Message> =>
    client.messages.create({
      model,
      max_tokens: input.maxTokens,
      ...(input.system ? { system: input.system } : {}),
      messages: [{ role: 'user', content: input.content }],
    });

  let response: Anthropic.Message;
  try {
    try {
      response = await send((await getClaudeModel()).id);
    } catch (error) {
      // The model is the only thing a Messages request addresses, so a 404
      // means it was retired. Look up the current newest Haiku and try once more.
      if (!(error instanceof Anthropic.NotFoundError)) throw error;
      logger.warn('Claude model not found; re-resolving the newest Haiku and retrying once');
      response = await send((await getClaudeModel({ force: true })).id);
    }
  } catch (error) {
    const mapped = mapSdkError(error);
    logger.warn({ kind: mapped.kind, status: mapped.status }, 'Claude request failed');
    throw mapped;
  }

  if (response.stop_reason === 'refusal') throw new ClaudeError('refusal');
  if (response.stop_reason === 'max_tokens') throw new ClaudeError('truncated');

  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
}
