/**
 * Dev seed: an account (dev@example.com / devpassword123), a claimed tenant
 * "smith" comped on streaming, and a fresh claim code printed to stdout.
 */
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { db, sql } from '../src/db/index.js';
import { accounts, subscriptions, tenants, claimCodes } from '../src/db/schema/index.js';
import { newClaimCode, sha256Hex } from '../src/lib/tokens.js';

async function main(): Promise<void> {
  const email = 'dev@example.com';
  let account = await db.query.accounts.findFirst({ where: eq(accounts.email, email) });
  if (!account) {
    [account] = await db
      .insert(accounts)
      .values({ email, passwordHash: await argon2.hash('devpassword123') })
      .returning();
    console.log(`Created account ${email} / devpassword123`);
  }

  let tenant = await db.query.tenants.findFirst({
    where: eq(tenants.accountId, account.id),
  });
  if (!tenant) {
    [tenant] = await db
      .insert(tenants)
      .values({ accountId: account.id, subdomain: 'smith', status: 'active' })
      .returning();
    await db
      .insert(subscriptions)
      .values({ tenantId: tenant.id, isComp: true, tier: 'streaming', compNote: 'dev seed' });
    console.log('Created tenant smith (comped, streaming)');
  }

  const code = newClaimCode();
  await db.insert(claimCodes).values({
    tenantId: tenant.id,
    codeHash: sha256Hex(code),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  console.log(`Claim code (1h): ${code}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void sql.end());
