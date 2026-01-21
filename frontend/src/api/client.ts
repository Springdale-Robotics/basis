import { ApiError, type ApiErrorResponse } from '@/lib/api-error';
import type { ApiResponse } from '@/types/api';
import { API_BASE_URL } from '@/lib/constants';

interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
  data?: unknown;
}

async function handleResponse<T>(response: Response): Promise<T> {
  const text = await response.text();

  // Handle empty responses
  if (!text) {
    if (response.ok) {
      // For successful empty responses (like 204 No Content), return empty object
      return {} as T;
    }
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
    throw new ApiError(data as ApiErrorResponse, response.status);
  }

  const apiResponse = data as ApiResponse<T>;
  if (!apiResponse.success) {
    throw new ApiError(data as ApiErrorResponse, response.status);
  }

  return apiResponse.data as T;
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
  const { params, ...fetchOptions } = options || {};
  const url = buildUrl(path, params);

  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...fetchOptions?.headers,
    },
    body: data ? JSON.stringify(data) : undefined,
    ...fetchOptions,
  });

  return handleResponse<T>(response);
}

export async function apiPut<T, D = unknown>(
  path: string,
  data?: D,
  options?: RequestOptions
): Promise<T> {
  const { params, ...fetchOptions } = options || {};
  const url = buildUrl(path, params);

  const response = await fetch(url, {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...fetchOptions?.headers,
    },
    body: data ? JSON.stringify(data) : undefined,
    ...fetchOptions,
  });

  return handleResponse<T>(response);
}

export async function apiPatch<T, D = unknown>(
  path: string,
  data?: D,
  options?: RequestOptions
): Promise<T> {
  const { params, ...fetchOptions } = options || {};
  const url = buildUrl(path, params);

  const response = await fetch(url, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...fetchOptions?.headers,
    },
    body: data ? JSON.stringify(data) : undefined,
    ...fetchOptions,
  });

  return handleResponse<T>(response);
}

export async function apiDelete<T>(path: string, options?: RequestOptions): Promise<T> {
  const { params, data, ...fetchOptions } = options || {};
  const url = buildUrl(path, params);

  const response = await fetch(url, {
    method: 'DELETE',
    credentials: 'include',
    headers: data ? {
      'Content-Type': 'application/json',
      ...fetchOptions?.headers,
    } : fetchOptions?.headers,
    body: data ? JSON.stringify(data) : undefined,
    ...fetchOptions,
  });

  return handleResponse<T>(response);
}

export async function apiUpload<T>(
  path: string,
  file: File,
  options?: RequestOptions & { onProgress?: (progress: number) => void }
): Promise<T> {
  const { params, onProgress, ...fetchOptions } = options || {};
  const url = buildUrl(path, params);

  const formData = new FormData();
  formData.append('file', file);

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
      xhr.send(formData);
    });
  }

  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    body: formData,
    ...fetchOptions,
  });

  return handleResponse<T>(response);
}
