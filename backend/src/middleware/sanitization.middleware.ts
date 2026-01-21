import { FastifyRequest, FastifyReply } from 'fastify';
import sanitizeHtml from 'sanitize-html';

const defaultSanitizeOptions: sanitizeHtml.IOptions = {
  allowedTags: [
    'b', 'i', 'em', 'strong', 'u', 'p', 'br', 'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code',
    'a', 'span',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target'],
    span: ['class'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: {
    a: ['http', 'https', 'mailto'],
  },
};

export function sanitizeString(
  value: string,
  options: sanitizeHtml.IOptions = defaultSanitizeOptions
): string {
  return sanitizeHtml(value, options);
}

export function sanitizeObject<T extends Record<string, unknown>>(
  obj: T,
  fieldsToSanitize: string[] = []
): T {
  const result = { ...obj };

  for (const field of fieldsToSanitize) {
    if (field in result && typeof result[field] === 'string') {
      (result as any)[field] = sanitizeString(result[field] as string);
    }
  }

  return result;
}

// Middleware to sanitize common fields in request body
export async function sanitizeRequestBody(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!request.body || typeof request.body !== 'object') {
    return;
  }

  const commonHtmlFields = [
    'description',
    'body',
    'content',
    'notes',
    'message',
    'instructions',
  ];

  request.body = sanitizeObject(
    request.body as Record<string, unknown>,
    commonHtmlFields
  );
}

// Strip all HTML tags (for plain text fields)
export function stripHtml(value: string): string {
  return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} });
}

// Escape HTML entities
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
