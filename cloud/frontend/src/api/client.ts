/**
 * Typed fetch wrapper for the Basis Cloud control-plane API.
 *
 * Every response follows the envelope:
 *   { success: true, data: {...} } | { success: false, error: { code, message } }
 *
 * Auth is a same-origin session cookie. The server rejects cookie-authed
 * mutations without the `X-Requested-With: fetch` header, so it is sent on
 * every request.
 */

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export function isApiError(error: unknown, code?: string): error is ApiError {
  if (!(error instanceof ApiError)) return false;
  return code === undefined || error.code === code;
}

type Envelope<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } };

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'fetch',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(
      'NETWORK_ERROR',
      'Could not reach the server. Check your connection and try again.',
      0,
    );
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // Non-JSON body — fall through to the BAD_RESPONSE error below.
  }

  if (payload !== null && typeof payload === 'object' && 'success' in payload) {
    const envelope = payload as Envelope<T>;
    if (envelope.success) return envelope.data;
    throw new ApiError(
      envelope.error?.code ?? 'UNKNOWN',
      envelope.error?.message ?? 'Something went wrong.',
      res.status,
    );
  }

  throw new ApiError(
    'BAD_RESPONSE',
    `Unexpected response from the server (HTTP ${res.status}).`,
    res.status,
  );
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
};
