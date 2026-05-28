import { z } from 'zod';
import 'dotenv/config';

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

  // Background jobs. When true (default), the API process runs the BullMQ
  // workers in-process — correct for single-process deployments (dev, Docker).
  // The native systemd install sets this false on the API service and runs a
  // dedicated worker process (dist/worker.js) instead, so jobs aren't run twice.
  // NB: parsed explicitly rather than z.coerce.boolean(), which maps the string
  // "false" to true (Boolean("false") === true).
  WORKERS_IN_PROCESS: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? true : !/^(false|0|no|off)$/i.test(v.trim()))),

  // File Storage
  STORAGE_PATH: z.string().default('./storage'),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().default(100),
  STORAGE_QUOTA_GB: z.coerce.number().optional(),

  // Frontend (production single-port deployment)
  // When set, the backend serves the built frontend's dist/ at / and falls
  // back to index.html for client-side routes. Unset in dev — Vite handles
  // the frontend at :5173 and proxies /api here.
  FRONTEND_DIST: z.string().optional(),

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

  // Media Processing
  THUMBNAIL_SIZES: z.string().default('150,400,800'),
  THUMBNAIL_QUALITY: z.coerce.number().default(80),
  FFMPEG_PATH: z.string().optional(),
  ENABLE_TRANSCODING: z.coerce.boolean().default(true),
  HLS_SEGMENT_DURATION: z.coerce.number().default(6),

  // External Media APIs (optional)
  TMDB_API_KEY: z.string().optional(),
  TMDB_LANGUAGE: z.string().default('en-US'),

  // Development
  DISABLE_RATE_LIMIT: z.coerce.boolean().default(false),
  DISABLE_CSRF: z.coerce.boolean().default(false),

  // Ollama connection (used by VLM-LLM service)
  OLLAMA_HOST: z.string().default('http://localhost:11434'),

  // VLM + LLM Service (two-stage pipeline)
  VLM_LLM_SERVICE_URL: z.string().default('http://localhost:8010'),
  VLM_LLM_TIMEOUT_MS: z.coerce.number().default(180000), // 3 minutes for CPU mode
  OLLAMA_VLM_MODEL: z.string().default('llava:7b'),      // Vision model for reading images
  OLLAMA_LLM_MODEL: z.string().default('qwen2.5:7b'),    // Text model for structuring

  // Anthropic API (for LLM recipe parsing fallback)
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_RECIPE_MODEL: z.string().default('claude-haiku-4-5-20251001'),

  // Handwriting OCR API (handwritingocr.com)
  HANDWRITING_OCR_API_KEY: z.string().optional(),
  HANDWRITING_OCR_API_URL: z.string().default('https://api.handwritingocr.com'),

  // Image parsing configuration
  IMAGE_PARSE_PROVIDER: z.enum(['vlm-llm', 'handwriting-ocr', 'auto']).default('auto'),
  IMAGE_PARSE_TIMEOUT_MS: z.coerce.number().default(180000), // 3 minutes for CPU processing
  IMAGE_PARSE_MAX_SIZE_MB: z.coerce.number().default(10),
  IMAGE_PARSE_SESSION_TTL_HOURS: z.coerce.number().default(24),
  IMAGE_PARSE_REQUIRE_AI: z.coerce.boolean().default(false),

  // Bug reports — POSTed to a Cloudflare Worker relay (see
  // worker/bug-report-relay/) which holds the GitHub PAT and creates the
  // issue. When unset, reports are stored locally but not pushed.
  BUG_REPORT_WEBHOOK_URL: z.string().url().optional(),
  BUG_REPORT_WEBHOOK_SECRET: z.string().optional(),
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
