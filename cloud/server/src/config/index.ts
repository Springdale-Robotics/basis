import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  // Required
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  /** Shared secret embedded in the frps httpPlugin path — see deploy/frps.toml. */
  FRP_PLUGIN_SECRET: z.string().min(16),

  // Stripe
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_PRICE_BASIC_ANNUAL: z.string().min(1),
  STRIPE_PRICE_STREAMING_ANNUAL: z.string().min(1),

  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // Caddy is the only public ingress in prod — bind loopback by default.
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().default(4000),
  /** Origin for Stripe redirect URLs and links in copy. */
  APP_ORIGIN: z.string().url().default('https://home-basis.com'),
  /** When set, serve the built SPA (cloud/frontend/dist) with index.html fallback. */
  FRONTEND_DIST: z.string().optional(),

  // Email (SMTP) — optional. When unset, outbound mail (e.g. password-reset
  // links) is logged instead of sent, so dev and an unconfigured prod still
  // function. Configure with a single connection URL, e.g.
  //   smtps://user:pass@smtp.example.com:465   (implicit TLS)
  //   smtp://user:pass@smtp.example.com:587     (STARTTLS)
  SMTP_URL: z.string().optional(),
  /** From header on outbound mail. */
  EMAIL_FROM: z.string().default('Basis Remote <noreply@home-basis.com>'),

  // Session
  SESSION_MAX_AGE_MS: z.coerce.number().default(604800000), // 7 days

  // frps relay
  FRPS_ADMIN_URL: z.string().url().default('http://127.0.0.1:7500'),
  FRPS_ADMIN_USER: z.string().default('admin'),
  FRPS_ADMIN_PASSWORD: z.string().default('admin'),
  /** What claim responses tell boxes to dial. */
  RELAY_SERVER_ADDR: z.string().default('home-basis.com'),
  RELAY_SERVER_PORT: z.coerce.number().default(7000),

  // Tiers / enforcement
  CAP_BASIC_GB: z.coerce.number().default(250),
  CAP_STREAMING_GB: z.coerce.number().default(2048),
  THROTTLE_BASIC_MBPS: z.coerce.number().default(4),
  USAGE_POLL_INTERVAL_MS: z.coerce.number().default(60000),
  GRACE_PERIOD_DAYS: z.coerce.number().default(14),
  TOMBSTONE_DAYS: z.coerce.number().default(90),

  // Dev conveniences
  DISABLE_RATE_LIMIT: z.coerce.boolean().default(false),
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
