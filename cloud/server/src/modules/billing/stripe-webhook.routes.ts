import type { FastifyInstance } from 'fastify';
import type Stripe from 'stripe';
import { db } from '../../db/index.js';
import { stripeEvents } from '../../db/schema/index.js';
import { stripe } from '../../lib/stripe.js';
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import { applyStripeEvent } from './billing.service.js';

/**
 * Stripe webhook. Registered with a raw-body content-type parser so
 * constructEvent() verifies the signature over the exact bytes Stripe sent.
 */
export async function stripeWebhookRoutes(app: FastifyInstance): Promise<void> {
  // Scope a raw parser to this plugin only (Fastify encapsulation).
  app.removeAllContentTypeParsers();
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body)
  );

  app.post('/webhook', async (request, reply) => {
    const signature = request.headers['stripe-signature'];
    if (!signature || typeof signature !== 'string') {
      reply.code(400);
      return { received: false };
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        request.body as Buffer,
        signature,
        config.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      logger.warn({ err }, 'Stripe webhook signature verification failed');
      reply.code(400);
      return { received: false };
    }

    // Idempotency: first insert wins; replays and Stripe's at-least-once
    // delivery are no-ops.
    const inserted = await db
      .insert(stripeEvents)
      .values({ id: event.id, type: event.type })
      .onConflictDoNothing()
      .returning({ id: stripeEvents.id });
    if (inserted.length === 0) {
      logger.debug({ eventId: event.id }, 'Stripe event already processed');
      return { received: true };
    }

    try {
      await applyStripeEvent(event);
    } catch (err) {
      // Undo the idempotency marker so Stripe's retry can reprocess.
      logger.error({ err, eventId: event.id, type: event.type }, 'Stripe event processing failed');
      const { eq } = await import('drizzle-orm');
      await db.delete(stripeEvents).where(eq(stripeEvents.id, event.id));
      reply.code(500);
      return { received: false };
    }

    return { received: true };
  });
}
