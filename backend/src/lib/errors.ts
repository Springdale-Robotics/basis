export enum ErrorCode {
  // Authentication Errors (1xxx)
  AUTH_INVALID_CREDENTIALS = 'AUTH_1001',
  AUTH_SESSION_EXPIRED = 'AUTH_1002',
  AUTH_SESSION_INVALID = 'AUTH_1003',
  AUTH_INSUFFICIENT_PERMISSIONS = 'AUTH_1004',
  AUTH_ACCOUNT_LOCKED = 'AUTH_1005',
  AUTH_CSRF_INVALID = 'AUTH_1006',
  AUTH_NOT_AUTHENTICATED = 'AUTH_1007',

  // Validation Errors (2xxx)
  VALIDATION_REQUIRED_FIELD = 'VAL_2001',
  VALIDATION_INVALID_FORMAT = 'VAL_2002',
  VALIDATION_OUT_OF_RANGE = 'VAL_2003',
  VALIDATION_DUPLICATE_VALUE = 'VAL_2004',
  VALIDATION_INVALID_REFERENCE = 'VAL_2005',
  VALIDATION_FAILED = 'VAL_2006',

  // Resource Errors (3xxx)
  RESOURCE_NOT_FOUND = 'RES_3001',
  RESOURCE_ALREADY_EXISTS = 'RES_3002',
  RESOURCE_CONFLICT = 'RES_3003',
  RESOURCE_DELETED = 'RES_3004',
  RESOURCE_LIMIT_EXCEEDED = 'RES_3005',

  // External Service Errors (4xxx)
  EXTERNAL_GOOGLE_API_ERROR = 'EXT_4001',
  EXTERNAL_OUTLOOK_API_ERROR = 'EXT_4002',
  EXTERNAL_HOME_ASSISTANT_ERROR = 'EXT_4003',
  EXTERNAL_BARCODE_API_ERROR = 'EXT_4004',
  EXTERNAL_SERVICE_UNAVAILABLE = 'EXT_4005',
  EXTERNAL_TIMEOUT = 'EXT_4006',

  // Sync Errors (41xx)
  SYNC_HOUSEHOLD_UNREACHABLE = 'SYNC_4101',
  SYNC_AUTHENTICATION_FAILED = 'SYNC_4102',
  SYNC_VERSION_MISMATCH = 'SYNC_4103',
  SYNC_CONFLICT = 'SYNC_4104',

  // Recipe Import Errors (42xx)
  IMPORT_SESSION_EXPIRED = 'IMP_4201',
  IMPORT_PARSE_FAILED = 'IMP_4202',
  IMPORT_INVALID_SOURCE = 'IMP_4203',
  IMPORT_ALREADY_CONFIRMED = 'IMP_4204',

  // Inventory Deduction Errors (43xx)
  DEDUCTION_INSUFFICIENT_STOCK = 'DED_4301',
  DEDUCTION_ITEM_NOT_LINKED = 'DED_4302',

  // System Errors (5xxx)
  SYSTEM_DATABASE_ERROR = 'SYS_5001',
  SYSTEM_REDIS_ERROR = 'SYS_5002',
  SYSTEM_FILE_SYSTEM_ERROR = 'SYS_5003',
  SYSTEM_INTERNAL_ERROR = 'SYS_5004',
  SYSTEM_RATE_LIMITED = 'SYS_5005',
  SYSTEM_MAINTENANCE_MODE = 'SYS_5006',
}

const errorStatusMap: Record<string, number> = {
  'AUTH_1001': 401,
  'AUTH_1002': 401,
  'AUTH_1003': 401,
  'AUTH_1004': 403,
  'AUTH_1005': 403,
  'AUTH_1006': 403,
  'AUTH_1007': 401,
  'VAL_': 400,
  'RES_3001': 404,
  'RES_3002': 409,
  'RES_3003': 409,
  'RES_3004': 410,
  'RES_3005': 400,
  'EXT_': 502,
  'SYNC_': 502,
  'SYS_5005': 429,
  'SYS_': 500,
};

function getStatusCode(code: string): number {
  // Check for exact match first
  if (errorStatusMap[code]) {
    return errorStatusMap[code];
  }
  // Check for prefix match
  for (const [prefix, status] of Object.entries(errorStatusMap)) {
    if (prefix.endsWith('_') && code.startsWith(prefix)) {
      return status;
    }
  }
  return 500;
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;
  public readonly isOperational: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
    statusCode?: number
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
    this.statusCode = statusCode ?? getStatusCode(code);
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

// Convenience error factories
export const Errors = {
  notFound: (resource: string, id?: string) =>
    new AppError(
      ErrorCode.RESOURCE_NOT_FOUND,
      `${resource} not found`,
      id ? { id } : undefined
    ),

  unauthorized: (message = 'Authentication required') =>
    new AppError(ErrorCode.AUTH_NOT_AUTHENTICATED, message),

  forbidden: (message = 'Access denied') =>
    new AppError(ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS, message),

  invalidCredentials: () =>
    new AppError(ErrorCode.AUTH_INVALID_CREDENTIALS, 'Invalid email or password'),

  sessionExpired: () =>
    new AppError(ErrorCode.AUTH_SESSION_EXPIRED, 'Session has expired'),

  validation: (message: string, details?: Record<string, unknown>) =>
    new AppError(ErrorCode.VALIDATION_FAILED, message, details),

  duplicate: (field: string) =>
    new AppError(
      ErrorCode.VALIDATION_DUPLICATE_VALUE,
      `${field} already exists`,
      { field }
    ),

  conflict: (message: string) =>
    new AppError(ErrorCode.RESOURCE_CONFLICT, message),

  internal: (message = 'Internal server error') =>
    new AppError(ErrorCode.SYSTEM_INTERNAL_ERROR, message),

  database: (message = 'Database error') =>
    new AppError(ErrorCode.SYSTEM_DATABASE_ERROR, message),

  rateLimit: () =>
    new AppError(ErrorCode.SYSTEM_RATE_LIMITED, 'Too many requests'),
};
