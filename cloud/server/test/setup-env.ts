// Vitest setup: config/index.ts validates env at import time.
process.env.DATABASE_URL ??= 'postgres://basis_cloud:devpassword@localhost:5433/basis_cloud';
process.env.SESSION_SECRET ??= 'test-session-secret-0123456789abcdef';
process.env.FRP_PLUGIN_SECRET ??= 'test-plugin-secret-0123456789abcdef';
process.env.STRIPE_SECRET_KEY ??= 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_dummy';
process.env.STRIPE_PRICE_BASIC_ANNUAL ??= 'price_basic_dummy';
process.env.STRIPE_PRICE_STREAMING_ANNUAL ??= 'price_streaming_dummy';
process.env.NODE_ENV ??= 'test';
