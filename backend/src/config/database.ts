import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type ReservedSql } from 'postgres';
import { AsyncLocalStorage } from 'node:async_hooks';
import { config } from './index.js';
import * as schema from '../db/schema/index.js';

const connectionString = config.DATABASE_URL;

export const sql = postgres(connectionString, {
  max: config.DB_POOL_MAX,
  idle_timeout: 20,
  connect_timeout: 10,
  ssl: config.DB_SSL ? 'require' : false,
});

type Db = PostgresJsDatabase<typeof schema>;

// The base handle uses the pool's login role (owner/superuser in dev), which
// BYPASSES row-level security. Everything without a request context — workers,
// backups, migrations, the pre-auth session lookup, startup — runs on this and
// sees every household's rows, which is what those paths need.
const baseDb: Db = drizzle(sql, { schema });

// Per-request RLS context. An authenticated request reserves a dedicated
// connection, puts it in `basis_rls` mode with its household set, and stashes
// it here (via AsyncLocalStorage) so the `db` proxy below routes that request's
// queries onto it — RLS-enforced. See docs/product-review-2026-07/RLS-PLAN.md.
interface RlsContext {
  db: Db;
  reserved: ReservedSql | null;
}

const rlsStorage = new AsyncLocalStorage<RlsContext>();

function effectiveDb(): Db {
  const ctx = rlsStorage.getStore();
  return ctx?.reserved ? ctx.db : baseDb;
}

/**
 * Establish a mutable per-request DB context holder. MUST run in an onRequest
 * hook: `enterWith` reliably propagates to the rest of the request only from
 * there (from a per-route preHandler it doesn't survive to the handler). The
 * holder starts on the base handle; auth fills in the RLS connection later by
 * mutating this same object — which is why it's a holder, not a fresh store.
 */
export function beginRequestDbContext(): void {
  rlsStorage.enterWith({ db: baseDb, reserved: null });
}

/**
 * Reserve a dedicated connection, switch it to the RLS role for `householdId`,
 * and point the current request's context holder at it — so `db` queries for
 * the rest of the request run RLS-scoped. Returns a release fn to call once.
 *
 * Leak defense: the connection's role/GUC are reset both at acquire time (in
 * case a crashed prior holder left it dirty) and on release, so a pooled
 * connection can never carry one household's context into another's request.
 */
export async function enterRlsContext(householdId: string): Promise<() => Promise<void>> {
  const holder = rlsStorage.getStore();
  const reserved = await sql.reserve();
  let scopedDb: Db;
  try {
    // A reserved connection is a stripped proxy: it lacks two things drizzle's
    // postgres-js driver needs. Backfill both, so `db` and `db.transaction()`
    // work transparently on the request's pinned RLS connection. Everything
    // fallible stays inside this try so a failure can't leak the reservation
    // (an unreleased reservation was exhausting the pool).
    const rawReserved = reserved as unknown as {
      options: unknown;
      begin?: (...args: unknown[]) => Promise<unknown>;
    };
    // 1) `.options` (type parsers/serializers), read at drizzle construction.
    rawReserved.options = (sql as unknown as { options: unknown }).options;
    // 2) `.begin` — drizzle's `.transaction()` calls `client.begin(fn)`, which
    //    a ReservedSql doesn't expose. Emulate it as BEGIN/COMMIT/ROLLBACK on
    //    this one pinned connection (the app never nests db.transaction).
    rawReserved.begin = (...args: unknown[]): Promise<unknown> => {
      const fn = (typeof args[0] === 'function' ? args[0] : args[1]) as (c: unknown) => Promise<unknown>;
      return (async () => {
        await reserved`BEGIN`;
        try {
          const result = await fn(reserved);
          await reserved`COMMIT`;
          return result;
        } catch (err) {
          try {
            await reserved`ROLLBACK`;
          } catch {
            /* connection may be broken */
          }
          throw err;
        }
      })();
    };
    await reserved`RESET ROLE`;
    await reserved`SET ROLE basis_rls`;
    await reserved`SELECT set_config('app.household_id', ${householdId}, false)`;
    scopedDb = drizzle(reserved, { schema });
  } catch (err) {
    reserved.release();
    throw err;
  }

  if (holder) {
    holder.db = scopedDb;
    holder.reserved = reserved;
  } else {
    // No onRequest holder (route outside the API scope) — establish one here.
    rlsStorage.enterWith({ db: scopedDb, reserved });
  }

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    const ctx = holder ?? rlsStorage.getStore();
    if (ctx) {
      ctx.reserved = null; // effectiveDb() falls back to baseDb for any late use
      ctx.db = baseDb;
    }
    try {
      await reserved`RESET ROLE`;
      await reserved`RESET app.household_id`;
    } catch {
      /* connection may be broken; release it anyway */
    }
    reserved.release();
  };
}

/**
 * The application-wide db handle. It is a proxy: inside an authenticated
 * request it resolves to that request's RLS-scoped connection; everywhere else
 * (workers, startup) it resolves to the RLS-bypassing base handle. Existing
 * `import { db }` call sites need no change.
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const active = effectiveDb() as unknown as Record<string | symbol, unknown>;
    const value = active[prop];
    return typeof value === 'function'
      ? (value as (...a: unknown[]) => unknown).bind(active)
      : value;
  },
}) as Db;

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export async function closeDatabaseConnection(): Promise<void> {
  await sql.end();
}
