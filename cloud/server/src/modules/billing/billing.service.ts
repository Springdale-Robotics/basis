import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';
import { db } from '../../db/index.js';
import { subscriptions, tenants } from '../../db/schema/index.js';
import { priceIdForTier, stripe, tierForPriceId, type Tier } from '../../lib/stripe.js';
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import { invalidateTenantState } from '../../services/tenant-state.js';

export type CheckoutError = 'TENANT_REQUIRED' | 'ALREADY_SUBSCRIBED';

export async function createCheckoutSession(
  accountId: string,
  email: string,
  tier: Tier
): Promise<{ url: string } | CheckoutError> {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.accountId, accountId),
  });
  if (!tenant || tenant.status === 'canceled') return 'TENANT_REQUIRED';

  let sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.tenantId, tenant.id),
  });
  if (sub?.isComp || (sub?.stripeSubscriptionId && tenant.status !== 'unpaid')) {
    return 'ALREADY_SUBSCRIBED';
  }

  // Reuse the Stripe customer across attempts.
  let customerId = sub?.stripeCustomerId ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email,
      metadata: { tenantId: tenant.id, accountId },
    });
    customerId = customer.id;
  }

  if (!sub) {
    [sub] = await db
      .insert(subscriptions)
      .values({ tenantId: tenant.id, stripeCustomerId: customerId })
      .returning();
  } else if (!sub.stripeCustomerId) {
    await db
      .update(subscriptions)
      .set({ stripeCustomerId: customerId, updatedAt: new Date() })
      .where(eq(subscriptions.id, sub.id));
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceIdForTier(tier), quantity: 1 }],
    client_reference_id: tenant.id,
    subscription_data: { metadata: { tenantId: tenant.id } },
    allow_promotion_codes: true,
    success_url: `${config.APP_ORIGIN}/app?checkout=success`,
    cancel_url: `${config.APP_ORIGIN}/app?checkout=canceled`,
  });

  if (!session.url) throw new Error('Stripe returned a session without a URL');
  return { url: session.url };
}

export async function createPortalSession(
  accountId: string
): Promise<{ url: string } | 'NO_BILLING'> {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.accountId, accountId),
  });
  if (!tenant) return 'NO_BILLING';
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.tenantId, tenant.id),
  });
  if (!sub?.stripeCustomerId || sub.isComp) return 'NO_BILLING';

  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: `${config.APP_ORIGIN}/app`,
  });
  return { url: session.url };
}

// ─── webhook state machine ──────────────────────────────────────────────────

async function tenantIdForEvent(
  object: { metadata?: Record<string, string> | null; customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null },
  subscriptionMetaId?: string | null
): Promise<string | null> {
  if (subscriptionMetaId) return subscriptionMetaId;
  if (object.metadata?.tenantId) return object.metadata.tenantId;
  const customerId = typeof object.customer === 'string' ? object.customer : object.customer?.id;
  if (!customerId) return null;
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.stripeCustomerId, customerId),
  });
  return sub?.tenantId ?? null;
}

async function setTenantStatus(
  tenantId: string,
  status: 'active' | 'past_due' | 'suspended' | 'canceled',
  extra: Partial<typeof tenants.$inferInsert> = {}
): Promise<void> {
  await db
    .update(tenants)
    .set({ status, updatedAt: new Date(), ...extra })
    .where(eq(tenants.id, tenantId));
  invalidateTenantState(tenantId);
}

/** Guard: comp subscriptions are managed by the comp CLI, never by Stripe. */
async function subForTenant(tenantId: string) {
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.tenantId, tenantId),
  });
  if (sub?.isComp) return null;
  return sub ?? null;
}

export async function applyStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const tenantId = session.client_reference_id;
      if (!tenantId) return;
      const sub = await subForTenant(tenantId);
      if (!sub) return;

      const subscriptionId =
        typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription?.id;
      let tier: Tier | null = null;
      let periodEnd: Date | null = null;
      if (subscriptionId) {
        const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = stripeSub.items.data[0]?.price?.id;
        tier = priceId ? tierForPriceId(priceId) : null;
        periodEnd = stripeSub.current_period_end
          ? new Date(stripeSub.current_period_end * 1000)
          : null;
      }

      await db
        .update(subscriptions)
        .set({
          stripeSubscriptionId: subscriptionId,
          tier: tier ?? undefined,
          stripeStatus: 'active',
          currentPeriodEnd: periodEnd,
          graceUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, sub.id));
      await setTenantStatus(tenantId, 'active');
      logger.info({ tenantId, tier }, 'Checkout completed — tenant active');
      return;
    }

    case 'customer.subscription.updated': {
      const stripeSub = event.data.object;
      const tenantId = await tenantIdForEvent(stripeSub, stripeSub.metadata?.tenantId);
      if (!tenantId) return;
      const sub = await subForTenant(tenantId);
      if (!sub) return;

      const priceId = stripeSub.items.data[0]?.price?.id;
      const tier = priceId ? tierForPriceId(priceId) : null;
      await db
        .update(subscriptions)
        .set({
          stripeStatus: stripeSub.status,
          tier: tier ?? undefined,
          cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
          currentPeriodEnd: stripeSub.current_period_end
            ? new Date(stripeSub.current_period_end * 1000)
            : null,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, sub.id));

      if (stripeSub.status === 'active') {
        await db
          .update(subscriptions)
          .set({ graceUntil: null })
          .where(eq(subscriptions.id, sub.id));
        await setTenantStatus(tenantId, 'active');
      } else if (stripeSub.status === 'past_due') {
        await enterGrace(tenantId, sub.id);
      } else if (stripeSub.status === 'unpaid') {
        await setTenantStatus(tenantId, 'suspended');
      }
      return;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const tenantId = await tenantIdForEvent(invoice, invoice.subscription_details?.metadata?.tenantId);
      if (!tenantId) return;
      const sub = await subForTenant(tenantId);
      if (!sub) return;
      await enterGrace(tenantId, sub.id);
      return;
    }

    case 'invoice.paid': {
      const invoice = event.data.object;
      const tenantId = await tenantIdForEvent(invoice, invoice.subscription_details?.metadata?.tenantId);
      if (!tenantId) return;
      const sub = await subForTenant(tenantId);
      if (!sub) return;
      await db
        .update(subscriptions)
        .set({ graceUntil: null, stripeStatus: 'active', updatedAt: new Date() })
        .where(eq(subscriptions.id, sub.id));
      await setTenantStatus(tenantId, 'active');
      return;
    }

    case 'customer.subscription.deleted': {
      const stripeSub = event.data.object;
      const tenantId = await tenantIdForEvent(stripeSub, stripeSub.metadata?.tenantId);
      if (!tenantId) return;
      const sub = await subForTenant(tenantId);
      if (!sub) return;

      const tombstonedUntil = new Date(
        Date.now() + config.TOMBSTONE_DAYS * 24 * 60 * 60 * 1000
      );
      await db
        .update(subscriptions)
        .set({ stripeStatus: 'canceled', updatedAt: new Date() })
        .where(eq(subscriptions.id, sub.id));
      await setTenantStatus(tenantId, 'canceled', {
        canceledAt: new Date(),
        tombstonedUntil,
      });
      // Cut the boxes loose: heartbeats 401, frp Pings reject.
      const { tunnelTokens } = await import('../../db/schema/index.js');
      await db
        .update(tunnelTokens)
        .set({ revokedAt: new Date() })
        .where(eq(tunnelTokens.tenantId, tenantId));
      invalidateTenantState(tenantId);
      logger.info({ tenantId, tombstonedUntil }, 'Subscription deleted — tenant canceled');
      return;
    }

    default:
      logger.debug({ type: event.type }, 'Ignoring Stripe event type');
  }
}

async function enterGrace(tenantId: string, subId: string): Promise<void> {
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.id, subId),
  });
  const graceUntil =
    sub?.graceUntil ??
    new Date(Date.now() + config.GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  await db
    .update(subscriptions)
    .set({ stripeStatus: 'past_due', graceUntil, updatedAt: new Date() })
    .where(eq(subscriptions.id, subId));
  await setTenantStatus(tenantId, 'past_due');
  logger.info({ tenantId, graceUntil }, 'Payment failed — tenant in grace period');
}
