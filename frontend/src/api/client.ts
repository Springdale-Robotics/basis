import { ApiError, type ApiErrorResponse } from '@/lib/api-error';
import type { ApiResponse } from '@/types/api';
import { API_BASE_URL } from '@/lib/constants';

interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
  data?: unknown;
}

// Global 401 hook. AuthProvider registers a handler that tears down an expired
// session and redirects to login. Kept out of React so any request path can
// trigger it. See setUnauthorizedHandler.
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

function notifyIfUnauthorized(status: number): void {
  if (status === 401) {
    unauthorizedHandler?.();
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  const text = await response.text();

  // Handle empty responses
  if (!text) {
    if (response.ok) {
      // For successful empty responses (like 204 No Content), return empty object
      return {} as T;
    }
    notifyIfUnauthorized(response.status);
    throw new ApiError({
      success: false,
      error: { code: 'EMPTY_RESPONSE', message: 'Server returned an empty response' },
    }, response.status);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError({
      success: false,
      error: { code: 'INVALID_JSON', message: 'Server returned invalid JSON' },
    }, response.status);
  }

  if (!response.ok) {
    notifyIfUnauthorized(response.status);
    throw new ApiError(data as ApiErrorResponse, response.status);
  }

  const apiResponse = data as ApiResponse<T>;
  if (!apiResponse.success) {
    throw new ApiError(data as ApiErrorResponse, response.status);
  }

  return apiResponse.data as T;
}

// ─── CSRF (double-submit cookie) ──────────────────────────────────────────
// The backend seeds a readable `csrf-token` cookie on safe requests and
// requires the same value in the X-CSRF-Token header on state-changing ones.
const CSRF_COOKIE = 'csrf-token';
export const CSRF_HEADER = 'X-CSRF-Token';
let cachedCsrfToken: string | null = null;

function readCsrfCookie(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)csrf-token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function getCsrfToken(forceRefresh = false): Promise<string | null> {
  if (!forceRefresh) {
    const fromCookie = readCsrfCookie();
    if (fromCookie) return (cachedCsrfToken = fromCookie);
    if (cachedCsrfToken) return cachedCsrfToken;
  }
  try {
    const res = await fetch(`${API_BASE_URL}/auth/csrf`, { credentials: 'include' });
    if (res.ok) {
      const json = await res.json();
      cachedCsrfToken = json?.data?.token ?? readCsrfCookie();
      return cachedCsrfToken;
    }
  } catch {
    /* offline or unreachable — fall through, the request will fail normally */
  }
  return readCsrfCookie();
}

// Shared path for POST/PUT/PATCH/DELETE: injects the CSRF header and retries
// once with a fresh token if the server rejects it (e.g. cookie rotated).
async function mutatingRequest<T>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  body: string | undefined,
  baseHeaders: HeadersInit | undefined,
  extraFetchOptions: RequestInit
): Promise<T> {
  const send = async (token: string | null): Promise<Response> =>
    fetch(url, {
      method,
      credentials: 'include',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { [CSRF_HEADER]: token } : {}),
        ...baseHeaders,
      },
      body,
      ...extraFetchOptions,
    });

  let response = await send(await getCsrfToken());
  if (response.status === 403) {
    // Might be a stale/missing CSRF token — refresh once and retry.
    const cloned = response.clone();
    let isCsrf = false;
    try {
      isCsrf = (await cloned.json())?.error?.code === 'AUTH_1006';
    } catch {
      /* not JSON — treat as a real 403 */
    }
    if (isCsrf) {
      response = await send(await getCsrfToken(true));
    }
  }
  return handleResponse<T>(response);
}

function buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
  const url = new URL(`${API_BASE_URL}${path}`, window.location.origin);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.append(key, String(value));
      }
    });
  }

  return url.toString();
}

export async function apiGet<T>(path: string, options?: RequestOptions): Promise<T> {
  const { params, ...fetchOptions } = options || {};
  const url = buildUrl(path, params);

  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...fetchOptions?.headers,
    },
    ...fetchOptions,
  });

  return handleResponse<T>(response);
}

export async function apiPost<T, D = unknown>(
  path: string,
  data?: D,
  options?: RequestOptions
): Promise<T> {
  const { params, headers, ...fetchOptions } = options || {};
  const url = buildUrl(path, params);
  return mutatingRequest<T>(
    'POST',
    url,
    data ? JSON.stringify(data) : undefined,
    headers,
    fetchOptions
  );
}

export async function apiPut<T, D = unknown>(
  path: string,
  data?: D,
  options?: RequestOptions
): Promise<T> {
  const { params, headers, ...fetchOptions } = options || {};
  const url = buildUrl(path, params);
  return mutatingRequest<T>(
    'PUT',
    url,
    data ? JSON.stringify(data) : undefined,
    headers,
    fetchOptions
  );
}

export async function apiPatch<T, D = unknown>(
  path: string,
  data?: D,
  options?: RequestOptions
): Promise<T> {
  const { params, headers, ...fetchOptions } = options || {};
  const url = buildUrl(path, params);
  return mutatingRequest<T>(
    'PATCH',
    url,
    data ? JSON.stringify(data) : undefined,
    headers,
    fetchOptions
  );
}

export async function apiDelete<T>(path: string, options?: RequestOptions): Promise<T> {
  const { params, data, headers, ...fetchOptions } = options || {};
  const url = buildUrl(path, params);
  return mutatingRequest<T>(
    'DELETE',
    url,
    data ? JSON.stringify(data) : undefined,
    headers,
    fetchOptions
  );
}

export async function apiUpload<T>(
  path: string,
  file: File,
  options?: RequestOptions & { onProgress?: (progress: number) => void }
): Promise<T> {
  const { params, onProgress, headers, ...fetchOptions } = options || {};
  const url = buildUrl(path, params);

  const formData = new FormData();
  formData.append('file', file);

  const csrfToken = await getCsrfToken();

  // For upload progress, we need XMLHttpRequest
  if (onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      });

      xhr.addEventListener('load', async () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const data = JSON.parse(xhr.responseText) as ApiResponse<T>;
          if (data.success) {
            resolve(data.data as T);
          } else {
            reject(new ApiError(data as unknown as ApiErrorResponse, xhr.status));
          }
        } else {
          const errorData = JSON.parse(xhr.responseText) as ApiErrorResponse;
          reject(new ApiError(errorData, xhr.status));
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error('Upload failed'));
      });

      xhr.open('POST', url);
      xhr.withCredentials = true;
      if (csrfToken) xhr.setRequestHeader(CSRF_HEADER, csrfToken);
      xhr.send(formData);
    });
  }

  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    ...fetchOptions,
    headers: {
      ...(csrfToken ? { [CSRF_HEADER]: csrfToken } : {}),
      ...headers,
    },
    body: formData,
  });

  return handleResponse<T>(response);
}
