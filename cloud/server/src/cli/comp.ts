/**
 * Comp (or un-comp) an account for beta access — no Stripe objects involved.
 *
 * Lives under src/ (not scripts/) so `node build.mjs` emits dist/cli/comp.js
 * and it ships in the release tarball. On a provisioned box, run it through
 * the `basis-comp` wrapper (installed by provision.sh), which loads
 * /opt/basis-cloud/.env first:
 *
 *   sudo basis-comp --email family@example.com --tier streaming --note "beta"
 *   sudo basis-comp --email family@example.com --remove
 *
 * For local dev: npm run comp -- --email ... --tier ...
 */
import { eq } from 'drizzle-orm';
import { db, sql } from '../db/index.js';
import { accounts, subscriptions, tenants } from '../db/schema/index.js';

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

const email = arg('email')?.toLowerCase();
const tier = (arg('tier') ?? 'basic') as 'basic' | 'streaming';
const note = arg('note') ?? 'comped';
const remove = process.argv.includes('--remove');

const USAGE =
  'Usage: basis-comp --email <email> [--tier basic|streaming] [--note "..."] [--remove]';

async function main(): Promise<void> {
  if (!email) {
    console.error(USAGE);
    process.exit(1);
  }
  if (!['basic', 'streaming'].includes(tier)) {
    console.error(`Unknown tier: ${tier}\n${USAGE}`);
    process.exit(1);
  }

  const account = await db.query.accounts.findFirst({ where: eq(accounts.email, email) });
  if (!account) {
    console.error(`No account for ${email}`);
    process.exit(1);
  }
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.accountId, account.id),
  });
  if (!tenant) {
    console.error(`${email} has no claimed subdomain yet — they need to claim one first`);
    process.exit(1);
  }

  const existing = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.tenantId, tenant.id),
  });

  if (remove) {
    if (!existing?.isComp) {
      console.error('Not a comped subscription — refusing (manage paid subs via Stripe)');
      process.exit(1);
    }
    await db
      .update(subscriptions)
      .set({ isComp: false, tier: null, compNote: null, updatedAt: new Date() })
      .where(eq(subscriptions.id, existing.id));
    await db
      .update(tenants)
      .set({ status: 'suspended', updatedAt: new Date() })
      .where(eq(tenants.id, tenant.id));
    console.log(`Removed comp from ${email} (${tenant.subdomain}) — tenant suspended`);
    return;
  }

  if (existing?.stripeSubscriptionId) {
    console.error('This tenant has a real Stripe subscription — refusing to comp over it');
    process.exit(1);
  }

  if (existing) {
    await db
      .update(subscriptions)
      .set({ isComp: true, tier, compNote: note, updatedAt: new Date() })
      .where(eq(subscriptions.id, existing.id));
  } else {
    await db
      .insert(subscriptions)
      .values({ tenantId: tenant.id, isComp: true, tier, compNote: note });
  }
  await db
    .update(tenants)
    .set({ status: 'active', updatedAt: new Date() })
    .where(eq(tenants.id, tenant.id));
  console.log(`Comped ${email} (${tenant.subdomain}) on tier "${tier}"`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void sql.end());
