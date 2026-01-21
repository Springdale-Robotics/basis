import { z } from 'zod';

const envSchema = z.object({
  // Required
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string(),
  SESSION_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().length(64).regex(/^[0-9a-f]+$/i),

  // Optional with defaults
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  WEBSOCKET_PORT: z.coerce.number().default(3001),

  // Security
  CORS_ORIGINS: z.string().optional(),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),

  // Database
  DB_POOL_MIN: z.coerce.number().default(2),
  DB_POOL_MAX: z.coerce.number().default(10),
  DB_SSL: z.coerce.boolean().default(false),

  // Session
  SESSION_MAX_AGE_MS: z.coerce.number().default(604800000), // 7 days

  // File Storage
  STORAGE_PATH: z.string().default('./storage'),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().default(100),

  // External Integrations
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  CLOUDFLARE_TUNNEL_TOKEN: z.string().optional(),
  SPOTIFY_CLIENT_ID: z.string().optional(),
  SPOTIFY_CLIENT_SECRET: z.string().optional(),

  // Feature Flags
  ENABLE_AI_FEATURES: z.coerce.boolean().default(false),
  ENABLE_SMART_HOME: z.coerce.boolean().default(true),
  ENABLE_DLNA_SERVER: z.coerce.boolean().default(true),
  ENABLE_METRICS: z.coerce.boolean().default(true),

  // Development
  DISABLE_RATE_LIMIT: z.coerce.boolean().default(false),
  DISABLE_CSRF: z.coerce.boolean().default(false),
});

export type Config = z.infer<typeof envSchema>;

let config: Config;

try {
  config = envSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('Environment validation failed:');
    error.errors.forEach((err) => {
      console.error(`  - ${err.path.join('.')}: ${err.message}`);
    });
    process.exit(1);
  }
  throw error;
}

export { config };

export const isDev = config.NODE_ENV === 'development';
export const isProd = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';
