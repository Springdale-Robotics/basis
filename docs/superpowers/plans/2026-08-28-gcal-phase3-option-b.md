# Google Calendar Sync — Phase 3: Option B (the Basis Google Client) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Basis Remote subscriber connect Google Calendar by clicking Connect — no Google Cloud project, no client id to paste — and get near-real-time sync via push notifications instead of polling.

**Architecture:** Basis owns one verified Google OAuth client. Its client id and secret reach a paid box from a cloud endpoint the box calls *on demand*, at the moment a household starts a Google connect — not on the recurring heartbeat, so a box that never uses Google never holds the secret and a lapsed subscription stops getting one. The tunnel's public HTTPS certificate is what makes `events.watch` possible, which is why push is a paid-tier capability and not a general one.

**Tech Stack:** Fastify + TypeScript (both box and cloud), Drizzle ORM, BullMQ, vitest.

**Spec:** `docs/superpowers/specs/2026-08-27-google-calendar-sync-design.md` — read "Option B: the Basis client" and "Where the secret lives" in full. The two decisions recorded there were signed off by the owner on 2026-08-28 and are not open.

**Prerequisites, both hard:**
- Phase 1 has shipped. The relay is the redirect URI on the Basis client too.
- Phase 2 has shipped. Option B is a different way to *obtain credentials*; the sync engine underneath is the same one.

## Global Constraints

- **`drizzle-kit generate` is broken in this repo.** Migrations are hand-authored: `.sql` + `meta/_journal.json` entry + `meta/NNNN_snapshot.json`. Both this plan's migrations restate it.
- **Box↔cloud boundary rule (owner, 2026-07-04):** the cloud service must never sync household accounts or data. Config flows *down*; nothing about a household flows *up*. The endpoint in Task 2 sends configuration to a box and receives nothing but an authenticated request. Do not add household identifiers, calendar names, or counts to any cloud request.
- **Never proxy tokens through the cloud.** The box performs its own token exchange and holds its own tokens. A cloud token proxy was considered and rejected in the spec precisely because it would put every household's Google tokens through the cloud.
- **Secrets are stored `encrypt()`ed** (`backend/src/lib/crypto.ts`), like everything else in `sync_credentials`.
- **Multi-tenancy:** the notify endpoint in Task 5 is unauthenticated by nature. It must be scoped by channel token to exactly one calendar and nothing else, and it needs a tenancy test.
- **Deploys are repo → deploy.** Steps marked **[OPS]** are for the owner.

## What is settled, and what is not

**Settled (do not reopen):**
- Google **enforces** `client_secret` for Web application clients. Measured 2026-08-28: a PKCE-only exchange returns `invalid_request` / "client_secret is missing." There is no version of Option B where a box holds only a client id.
- Client config reaches paid boxes from a **separate on-demand endpoint**, not the claim/heartbeat payload. Owner sign-off, 2026-08-28.
- Calendar scopes are **sensitive**, not restricted: the verification is documents and a video, 3–5 business days, no CASA security assessment.

**Open, and informational only:** whether a refresh token survives its issuing secret being deleted. A Google client can hold two live secrets at once, so rotation is a rolling migration with an overlap window; the answer only bites at the final delete, where it is recoverable by re-adding. The harness at `~/basis-gcal-review-2026-08-27/gcal-spike/` has the procedure if it becomes worth knowing.

## A note on resolution

Tasks 1–3 are specified to the same depth as phases 1 and 2: exact files, exact code, exact tests.

**Tasks 4 and 5 are deliberately coarser.** Both depend on artefacts that do not exist yet — a verified Google client, a live `events.watch` response, the real shape of a push notification against this box's routes — and writing precise-looking code against guesses would be worse than saying so. Their steps state the required behaviour and the traps, and name every file to touch, but the executor will be filling in more than transcribing.

Re-detail Tasks 4 and 5 once O1–O6 are complete and the client exists. That is the natural checkpoint: at that point the responses can be observed rather than predicted.

## Out of Scope

- Outlook, in any form.
- Migrating an existing Option A connection to Option B in place. A household that wants to switch disconnects and reconnects.
- Option A going away. It stays available to everyone, paid boxes included, as an override.

---

## Owner steps — do these first

These are not executor tasks. They require a human with access to the Google Cloud console, the DNS zone, and a camera. **Task 2 onward can be built and tested before these finish** — only the [OPS] deploy steps and any real end-to-end test are blocked on them.

- [ ] **O1: Prove domain ownership in Search Console**

Sensitive-scope verification requires the app's domain to be verified in Google Search Console, by an account that is also an owner of the Google Cloud project. Basis controls the DNS for `home-basis.com`, so this is a TXT record.

- [x] **O2: Publish a privacy policy at `https://home-basis.com/privacy`** —
      **done 2026-08-29.** `cloud/frontend/src/pages/marketing/PrivacyPage.tsx`,
      linked from the marketing footer (Google's verification checks that the
      homepage links the policy). It carries a "Google user data" heading, names
      both scopes exactly, states that calendar data moves directly between
      Google and the household's box, and includes the Limited Use sentence.
      Written for the phase 3 reviewer, not just to satisfy the Branding form.

It must be on the same domain as the app, reachable without a login, and it must describe what Basis does with Google user data specifically: that calendar data is synced directly between Google and the household's own box, that it is not stored on Basis servers, and that the tokens live encrypted on the household's hardware. Verification reviewers read this against the scopes requested.

- [ ] **O3: Create the Google Cloud project and Web application client**

- Project owned by the Basis account, not a personal one.
- **Web application** client type. Not Desktop — installed-app clients allow only loopback redirects, which no box can use.
- Authorised redirect URI, exactly one: `https://connect.home-basis.com/oauth/google`
- Scopes: `https://www.googleapis.com/auth/calendar.readonly` and `https://www.googleapis.com/auth/calendar.events`. These are the two the box already requests; do not add more, since each additional sensitive scope needs its own justification at review.

- [ ] **O4: Record the demo video**

A screen recording showing the consent screen, what a household sees, and what Basis does with the data afterwards. Reviewers want the OAuth grant visible end to end.

- [ ] **O5: Submit for verification and wait**

Typically 3–5 business days. **Do not ship Option B to any household before this clears.** An unverified app requesting sensitive scopes is capped at 100 new users *for the lifetime of the project*, and that cap cannot be reset or raised — burning it on testing would permanently cripple the client.

- [ ] **O6: Put the client credentials into the cloud's environment**

Once verified, add to the cloud server's env file (`/etc/basis-cloud/env`, the same file the Stripe keys live in; see `cloud/deploy/provision.sh`):

```
GOOGLE_BASIS_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_BASIS_CLIENT_SECRET=GOCSPX-...
```

Then `sudo systemctl restart basis-cloud`.

---

### Task 1: Cloud config for the Basis Google client

The control plane needs to know the client credentials before it can hand them out, and must behave sanely when they are absent — a development cloud, or production before O6 has run, should report "not available" rather than crash or serve empty strings.

**Files:**
- Modify: `cloud/server/src/config/index.ts`
- Test: `cloud/server/test/google-client-config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `config.GOOGLE_BASIS_CLIENT_ID?: string`
  - `config.GOOGLE_BASIS_CLIENT_SECRET?: string`
  - `googleClientConfigured(): boolean`

- [ ] **Step 1: Write the failing test**

Create `cloud/server/test/google-client-config.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { googleClientConfigured } from '../src/config/index.js';

describe('googleClientConfigured', () => {
  it('is false when neither value is set', () => {
    expect(googleClientConfigured({ })).toBe(false);
  });

  it('is false when only the id is set — a half-configured client is not usable', () => {
    expect(googleClientConfigured({ GOOGLE_BASIS_CLIENT_ID: 'x.apps.googleusercontent.com' })).toBe(
      false
    );
  });

  it('is true when both are set', () => {
    expect(
      googleClientConfigured({
        GOOGLE_BASIS_CLIENT_ID: 'x.apps.googleusercontent.com',
        GOOGLE_BASIS_CLIENT_SECRET: 'GOCSPX-secret',
      })
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cloud/server && npx vitest run test/google-client-config.test.ts`
Expected: FAIL — not exported.

- [ ] **Step 3: Add the config**

In `cloud/server/src/config/index.ts`, add to the schema — both optional, following how the existing optional keys are declared in that file:

```typescript
  // The Basis-owned Google OAuth client, handed to paid boxes on demand.
  // Optional so a dev cloud and a pre-verification production both start
  // cleanly; the endpoint reports the feature unavailable when they are unset.
  GOOGLE_BASIS_CLIENT_ID: z.string().optional(),
  GOOGLE_BASIS_CLIENT_SECRET: z.string().optional(),
```

And export the predicate, taking its input as a parameter so it is testable without process env:

```typescript
/**
 * Both halves or nothing. A client id without its secret cannot complete a
 * token exchange — Google enforces the secret for Web application clients —
 * so a half-configured client is worse than none: it would let a box start a
 * flow it cannot finish.
 */
export function googleClientConfigured(
  env: { GOOGLE_BASIS_CLIENT_ID?: string; GOOGLE_BASIS_CLIENT_SECRET?: string } = config
): boolean {
  return Boolean(env.GOOGLE_BASIS_CLIENT_ID && env.GOOGLE_BASIS_CLIENT_SECRET);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cloud/server && npx vitest run test/google-client-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Document the keys in provision.sh**

In `cloud/deploy/provision.sh`, in the env-file heredoc beside the Stripe placeholders, add:

```
# ── Google Calendar (Option B) — OPTIONAL ────────────────────────────────
# The Basis-owned OAuth client handed to paid boxes on demand. Leave unset
# until the client has passed Google's sensitive-scope verification; the
# box-facing endpoint reports the feature unavailable while it is.
GOOGLE_BASIS_CLIENT_ID=
GOOGLE_BASIS_CLIENT_SECRET=
```

- [ ] **Step 6: Commit**

```bash
git add cloud/server/src/config/index.ts cloud/server/test/google-client-config.test.ts cloud/deploy/provision.sh
git commit -m "feat(cloud): config for the Basis-owned Google OAuth client

Both optional, and treated as configured only when both are present — a
client id without its secret cannot complete a token exchange, since
Google enforces the secret for Web application clients."
```

---

### Task 2: The on-demand client-config endpoint

The decision the owner signed off: a box fetches the client config when a household starts a Google connect, rather than receiving it on every heartbeat.

The reasoning is worth restating, because it is what the tests assert. Enforcement in Basis Remote is two-layer, and **a box that stops calling home keeps whatever it last cached**. Anything handed out on a recurring broadcast is therefore handed out permanently — a canceled tenant would hold a live secret indefinitely. Fetched on demand, the entitlement check happens at the moment of use, and a lapsed tenant simply does not get one.

**Files:**
- Modify: `cloud/server/src/modules/boxes/boxes.routes.ts`
- Modify: `cloud/server/src/modules/boxes/boxes.service.ts`
- Test: `cloud/server/test/google-client-endpoint.test.ts`

**Interfaces:**
- Consumes: `googleClientConfigured` (Task 1); `tunnelTokens`, `tenants`, `subscriptions` as `processHeartbeat` already uses them.
- Produces:
  - `POST /api/v1/boxes/google-client`, `Authorization: Bearer <tunnelToken>`, empty body.
  - Success: `{ success: true, data: { clientId: string, clientSecret: string } }`
  - `resolveGoogleClient(bearerToken: string): Promise<GoogleClientPayload | GoogleClientRefusal>` in `boxes.service.ts`, where `GoogleClientRefusal` is `'TOKEN_REVOKED' | 'NOT_ENTITLED' | 'NOT_AVAILABLE'`.

- [ ] **Step 1: Write the failing test**

Create `cloud/server/test/google-client-endpoint.test.ts`. Read `cloud/server/test/box-status.test.ts` first for how that suite builds tenants, subscriptions, and tunnel tokens, and follow it — do not invent a second fixture style.

```typescript
import { describe, expect, it } from 'vitest';
import { resolveGoogleClient } from '../src/modules/boxes/boxes.service.js';

/**
 * Fixtures follow box-status.test.ts. Each helper returns a raw tunnel token
 * for a tenant in the named state.
 */

describe('resolveGoogleClient', () => {
  it('hands the client config to an active paid box', async () => {
    const token = await tokenForTenant({ status: 'active', tier: 'basic' });
    const result = await resolveGoogleClient(token);
    expect(result).toEqual({
      clientId: expect.stringContaining('apps.googleusercontent.com'),
      clientSecret: expect.any(String),
    });
  });

  it('refuses a suspended tenant — the whole point of fetching on demand', async () => {
    const token = await tokenForTenant({ status: 'suspended', tier: 'basic' });
    expect(await resolveGoogleClient(token)).toBe('NOT_ENTITLED');
  });

  it('refuses a canceled tenant', async () => {
    const token = await tokenForTenant({ status: 'canceled', tier: 'basic' });
    expect(await resolveGoogleClient(token)).toBe('NOT_ENTITLED');
  });

  it('refuses a tenant with no subscription tier', async () => {
    const token = await tokenForTenant({ status: 'active', tier: null });
    expect(await resolveGoogleClient(token)).toBe('NOT_ENTITLED');
  });

  it('refuses a revoked tunnel token', async () => {
    const token = await revokedToken();
    expect(await resolveGoogleClient(token)).toBe('TOKEN_REVOKED');
  });

  it('refuses an unknown token', async () => {
    expect(await resolveGoogleClient('not-a-real-token')).toBe('TOKEN_REVOKED');
  });

  it('reports unavailable when the cloud has no client configured', async () => {
    // with GOOGLE_BASIS_CLIENT_ID / _SECRET unset
    const token = await tokenForTenant({ status: 'active', tier: 'basic' });
    expect(await resolveGoogleClient(token)).toBe('NOT_AVAILABLE');
  });
});
```

Write `tokenForTenant` and `revokedToken` against the fixture helpers `box-status.test.ts` already uses. The last case needs the config unset for that test only — use `vi.stubEnv` or the pattern that suite already uses for env, whichever it has.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cloud/server && npx vitest run test/google-client-endpoint.test.ts`
Expected: FAIL — `resolveGoogleClient` not exported.

- [ ] **Step 3: Write the service function**

Add to `cloud/server/src/modules/boxes/boxes.service.ts`, following the shape of `processHeartbeat` directly above it:

```typescript
export interface GoogleClientPayload {
  clientId: string;
  clientSecret: string;
}

export type GoogleClientRefusal = 'TOKEN_REVOKED' | 'NOT_ENTITLED' | 'NOT_AVAILABLE';

/**
 * Hand the Basis-owned Google OAuth client to a paid box, on demand.
 *
 * Deliberately not part of the heartbeat payload. Enforcement here is
 * two-layer and a box that stops calling home keeps what it last cached, so
 * anything broadcast on a recurring channel is effectively granted forever —
 * a canceled tenant would hold a live client secret indefinitely. Fetched at
 * the moment a household starts a Google connect, the entitlement check is
 * evaluated when it actually matters.
 *
 * Config flows down; nothing about the household flows up. The request body
 * is empty by design.
 */
export async function resolveGoogleClient(
  bearerToken: string
): Promise<GoogleClientPayload | GoogleClientRefusal> {
  const tokenHash = sha256Hex(bearerToken);
  const token = await db.query.tunnelTokens.findFirst({
    where: and(eq(tunnelTokens.tokenHash, tokenHash), isNull(tunnelTokens.revokedAt)),
  });
  if (!token) return 'TOKEN_REVOKED';

  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, token.tenantId) });
  if (!tenant) return 'TOKEN_REVOKED';

  // Same status set the tunnel gate treats as allowed to serve.
  if (tenant.status !== 'active' && tenant.status !== 'past_due') {
    return 'NOT_ENTITLED';
  }

  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.tenantId, tenant.id),
  });
  if (!sub?.tier) return 'NOT_ENTITLED';

  if (!googleClientConfigured()) return 'NOT_AVAILABLE';

  return {
    clientId: config.GOOGLE_BASIS_CLIENT_ID!,
    clientSecret: config.GOOGLE_BASIS_CLIENT_SECRET!,
  };
}
```

Check `boxStatusFor` and the status values `processHeartbeat` and `gate.routes.ts` treat as serving, and match them exactly rather than the literals above if they differ — the suspension gate is the authority on what "entitled" means.

- [ ] **Step 4: Add the route**

In `cloud/server/src/modules/boxes/boxes.routes.ts`, beside `/heartbeat`, following its exact shape:

```typescript
  app.post('/google-client', { preHandler: [heartbeatLimiter] }, async (request, reply) => {
    const auth = request.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      return fail(reply, 401, 'UNAUTHENTICATED', 'Missing bearer token');
    }
    const result = await resolveGoogleClient(auth.slice('Bearer '.length).trim());

    if (result === 'TOKEN_REVOKED') {
      return fail(reply, 401, 'TOKEN_REVOKED', 'This box is no longer linked');
    }
    if (result === 'NOT_ENTITLED') {
      return fail(
        reply,
        403,
        'NOT_ENTITLED',
        'Connecting with the Basis Google client needs an active Basis Remote subscription'
      );
    }
    if (result === 'NOT_AVAILABLE') {
      return fail(reply, 503, 'NOT_AVAILABLE', 'The Basis Google client is not available yet');
    }

    return { success: true, data: result };
  });
```

Add `resolveGoogleClient` to the import from `boxes.service.js`.

- [ ] **Step 5: Run tests**

Run: `cd cloud/server && npx vitest run && npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add cloud/server/src/modules/boxes/boxes.routes.ts cloud/server/src/modules/boxes/boxes.service.ts cloud/server/test/google-client-endpoint.test.ts
git commit -m "feat(cloud): on-demand endpoint for the Basis Google client

Boxes fetch the client config when a household starts a Google connect,
not on the heartbeat. A box that stops calling home keeps what it last
cached, so a recurring broadcast would leave a canceled tenant holding a
live secret forever; on demand, entitlement is checked when it matters."
```

---

### Task 3: The box fetches and stores the client config

`basis-cloud.ts` is the box's whole surface onto the control plane. It validates strictly — an incomplete payload throws — so a third call joins the two that exist without loosening either.

**Files:**
- Modify: `backend/src/lib/basis-cloud.ts`
- Test: `backend/test/devices/basis-cloud-google.test.ts`

**Interfaces:**
- Consumes: `POST /api/v1/boxes/google-client` (Task 2).
- Produces:
  - `fetchGoogleClient(tunnelToken: string): Promise<GoogleClientResult>`
  - `interface GoogleClientResult { clientId: string; clientSecret: string }`
  - `class GoogleClientUnavailableError extends Error` — 503 from the cloud, or the feature is off.
  - `class GoogleClientNotEntitledError extends Error` — 403; subscription lapsed.

- [ ] **Step 1: Write the failing test**

Create `backend/test/devices/basis-cloud-google.test.ts`. `basis-cloud.ts` exports `__setFetchForTests` for exactly this.

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GoogleClientNotEntitledError,
  GoogleClientUnavailableError,
  HeartbeatAuthError,
  __setFetchForTests,
  fetchGoogleClient,
} from '../../src/lib/basis-cloud.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

afterEach(() => __setFetchForTests(null));

describe('fetchGoogleClient', () => {
  it('returns the client config', async () => {
    __setFetchForTests(
      vi.fn(async () =>
        json(200, {
          success: true,
          data: { clientId: 'x.apps.googleusercontent.com', clientSecret: 'GOCSPX-s' },
        })
      ) as never
    );

    await expect(fetchGoogleClient('tok')).resolves.toEqual({
      clientId: 'x.apps.googleusercontent.com',
      clientSecret: 'GOCSPX-s',
    });
  });

  it('sends the tunnel token as a bearer and an empty body', async () => {
    const fetchMock = vi.fn(async () =>
      json(200, { success: true, data: { clientId: 'a', clientSecret: 'b' } })
    );
    __setFetchForTests(fetchMock as never);

    await fetchGoogleClient('tok-123');

    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok-123' });
    expect((init as RequestInit).body).toBe('{}');
  });

  it('throws HeartbeatAuthError on 401 so the caller can unlink', async () => {
    __setFetchForTests(vi.fn(async () => json(401, { success: false })) as never);
    await expect(fetchGoogleClient('tok')).rejects.toBeInstanceOf(HeartbeatAuthError);
  });

  it('throws NotEntitled on 403', async () => {
    __setFetchForTests(
      vi.fn(async () => json(403, { success: false, error: { code: 'NOT_ENTITLED' } })) as never
    );
    await expect(fetchGoogleClient('tok')).rejects.toBeInstanceOf(GoogleClientNotEntitledError);
  });

  it('throws Unavailable on 503', async () => {
    __setFetchForTests(
      vi.fn(async () => json(503, { success: false, error: { code: 'NOT_AVAILABLE' } })) as never
    );
    await expect(fetchGoogleClient('tok')).rejects.toBeInstanceOf(GoogleClientUnavailableError);
  });

  it('rejects an incomplete payload rather than storing half a client', async () => {
    __setFetchForTests(
      vi.fn(async () => json(200, { success: true, data: { clientId: 'only-the-id' } })) as never
    );
    await expect(fetchGoogleClient('tok')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/devices/basis-cloud-google.test.ts`
Expected: FAIL — not exported.

- [ ] **Step 3: Write it**

Add to `backend/src/lib/basis-cloud.ts`, following `sendHeartbeat`'s structure exactly:

```typescript
export interface GoogleClientResult {
  clientId: string;
  clientSecret: string;
}

/** 403 — the Basis Remote subscription does not cover this, or has lapsed. */
export class GoogleClientNotEntitledError extends Error {
  constructor(message = 'This box is not entitled to the Basis Google client') {
    super(message);
    this.name = 'GoogleClientNotEntitledError';
  }
}

/** 503 — the cloud has no verified Google client configured yet. */
export class GoogleClientUnavailableError extends Error {
  constructor(message = 'The Basis Google client is not available') {
    super(message);
    this.name = 'GoogleClientUnavailableError';
  }
}

/**
 * Fetch the Basis-owned Google OAuth client, at the moment a household starts
 * a Google connect.
 *
 * Called on demand rather than cached from the heartbeat, so entitlement is
 * evaluated when it matters — see resolveGoogleClient in the control plane.
 * The request body is empty: config flows down, nothing about the household
 * flows up.
 */
export async function fetchGoogleClient(tunnelToken: string): Promise<GoogleClientResult> {
  let res: Response;
  try {
    res = await post('/api/v1/boxes/google-client', {}, { Authorization: `Bearer ${tunnelToken}` });
  } catch (err) {
    throw new CloudUnreachableError(err instanceof Error ? err.message : String(err));
  }

  if (res.status === 401) throw new HeartbeatAuthError();
  if (res.status === 403) throw new GoogleClientNotEntitledError();
  if (res.status === 503) throw new GoogleClientUnavailableError();

  let payload: any;
  try {
    payload = await res.json();
  } catch {
    payload = undefined;
  }

  if (!res.ok || !payload?.success) {
    throw new CloudUnreachableError(
      (payload?.error?.message as string | undefined) ?? `Google client fetch failed (HTTP ${res.status})`
    );
  }

  const data = payload.data;
  if (!data?.clientId || !data?.clientSecret) {
    // Half a client cannot complete a token exchange. Better to fail here
    // than to start a flow the household cannot finish.
    throw new CloudUnreachableError('Cloud returned an incomplete Google client response');
  }

  return { clientId: data.clientId, clientSecret: data.clientSecret };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/devices/basis-cloud-google.test.ts`
Expected: PASS, all six.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/basis-cloud.ts backend/test/devices/basis-cloud-google.test.ts
git commit -m "feat(devices): fetch the Basis Google client from the control plane

A third call on the box's only surface onto the cloud, fetched when a
household starts a connect rather than cached from the heartbeat.
Refuses an incomplete payload — half a client cannot finish a token
exchange, and failing here beats failing mid-flow."
```

---

### Task 4: Connect without a Google project

The connect flow gains a second path. Where Option A asks for a client id and secret, Option B asks for nothing — the box fetches the client config, uses it for the same OAuth flow through the same relay, and stores the resulting tokens exactly as before.

Option B is offered when the box is in Basis Remote mode with a live tunnel. Option A stays available to everyone, paid boxes included, as an override.

**Files:**
- Modify: `backend/src/modules/calendars/sync.routes.ts`
- Modify: `frontend/src/pages/settings/CalendarSettingsPage.tsx`
- Modify: `frontend/src/api/calendars.ts`
- Test: `backend/test/calendars/option-b.test.ts`

**Interfaces:**
- Consumes: `fetchGoogleClient` (Task 3); `basis-remote.ts`'s status for tunnel liveness; `relayStartUrl`, `googleRedirectUri` (phase 1 Task 5).
- Produces:
  - `GET /calendars/sync/google/options` → `{ optionA: true, optionB: boolean, optionBReason?: string }`
  - `POST /calendars/sync/google/connect` accepts `{ useBasisClient?: boolean }`.

- [ ] **Step 1: Write the failing test**

Create `backend/test/calendars/option-b.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { googleConnectOptions } from '../../src/modules/calendars/sync.routes.js';

describe('googleConnectOptions', () => {
  it('offers Option A whenever the household has its own credentials', () => {
    const options = googleConnectOptions({
      hasOwnCredentials: true,
      remoteMode: false,
      tunnelUp: false,
    });
    expect(options.optionA).toBe(true);
    expect(options.optionB).toBe(false);
  });

  it('offers Option B on a paid box with a live tunnel', () => {
    expect(
      googleConnectOptions({ hasOwnCredentials: false, remoteMode: true, tunnelUp: true }).optionB
    ).toBe(true);
  });

  it('withholds Option B when the tunnel is down, and says why', () => {
    const options = googleConnectOptions({
      hasOwnCredentials: false,
      remoteMode: true,
      tunnelUp: false,
    });
    expect(options.optionB).toBe(false);
    expect(options.optionBReason).toMatch(/tunnel|remote/i);
  });

  it('withholds Option B on a box that is not on Basis Remote', () => {
    expect(
      googleConnectOptions({ hasOwnCredentials: false, remoteMode: false, tunnelUp: false }).optionB
    ).toBe(false);
  });

  it('keeps Option A available on a paid box — it is an override, not a fallback', () => {
    expect(
      googleConnectOptions({ hasOwnCredentials: true, remoteMode: true, tunnelUp: true }).optionA
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/calendars/option-b.test.ts`
Expected: FAIL — not exported.

- [ ] **Step 3: Write the entitlement predicate**

In `backend/src/modules/calendars/sync.routes.ts`, above the route registrations:

```typescript
export interface GoogleConnectOptions {
  optionA: boolean;
  optionB: boolean;
  optionBReason?: string;
}

/**
 * Which ways can this box connect a Google calendar?
 *
 * Option A — the household's own Google Cloud project — is always available,
 * including on paid boxes, as an override. Option B needs Basis Remote with a
 * live tunnel: the tunnel is what gives the box a public HTTPS address with a
 * real certificate, which is also what makes push notifications possible.
 */
export function googleConnectOptions(state: {
  hasOwnCredentials: boolean;
  remoteMode: boolean;
  tunnelUp: boolean;
}): GoogleConnectOptions {
  if (!state.remoteMode) {
    return { optionA: true, optionB: false };
  }
  if (!state.tunnelUp) {
    return {
      optionA: true,
      optionB: false,
      optionBReason:
        'Connecting with the Basis client needs the Basis Remote tunnel to be up. Check Settings → Basis Remote.',
    };
  }
  return { optionA: true, optionB: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/calendars/option-b.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the options route and the connect branch**

Add a `GET /sync/google/options` route behind `authMiddleware` that reads the box's Basis Remote status (`getBasisRemoteStatus()` from `lib/basis-remote.js` — read its return shape and use the fields that mean "configured" and "tunnel is up") and whether `config.GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set, then returns `googleConnectOptions(...)`.

Then, in `POST /sync/google/connect`, accept an optional `useBasisClient` boolean. When it is true:

1. Read the tunnel token the box holds for Basis Remote.
2. `const client = await fetchGoogleClient(tunnelToken)`.
3. Build the OAuth client from `client.clientId` / `client.clientSecret` instead of `config.GOOGLE_CLIENT_ID` / `config.GOOGLE_CLIENT_SECRET`.
4. Record `useBasisClient: true` in the Redis state blob, so the callback knows to fetch the client config again for the token exchange rather than reading it from config.

Map the three error classes to responses a household can act on:
- `GoogleClientNotEntitledError` → 403, "Connecting with the Basis client needs an active Basis Remote subscription."
- `GoogleClientUnavailableError` → 503, "The Basis Google client is not available yet. You can connect with your own Google project instead."
- `CloudUnreachableError` → 503, "Could not reach home-basis.com. Check the box's internet connection."

- [ ] **Step 6: Store which client a calendar was connected with**

The stored `sync_credentials` blob must record `useBasisClient`, because a refresh needs the same client that issued the token. Add it to the JSON that is `encrypt()`ed, and have the refresh path in `google-sync.service.ts` fetch the Basis client when the flag is set instead of reading `config`.

This is the step most likely to be missed, and it fails a week later rather than immediately — a token minted with the Basis client and refreshed with a household's own credentials gets `invalid_client`.

- [ ] **Step 7: Frontend — offer the choice**

In `frontend/src/pages/settings/CalendarSettingsPage.tsx`, query the new options endpoint. When `optionB` is true, show the Basis-client path as the primary action — a single Connect button with no fields — and keep Option A available behind a "Use my own Google project" disclosure. When `optionB` is false and `optionBReason` is present, show the reason where the button would be.

Match the existing card markup and use theme tokens; do not introduce a new visual pattern.

- [ ] **Step 8: Verify**

Run: `cd backend && npm run typecheck && npx vitest run test/calendars/` then `cd frontend && npm run lint && npx tsc --noEmit`
Expected: clean, PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/calendars/sync.routes.ts backend/src/modules/calendars/google-sync.service.ts frontend/src/pages/settings/CalendarSettingsPage.tsx frontend/src/api/calendars.ts backend/test/calendars/option-b.test.ts
git commit -m "feat(calendars): connect Google without a Google Cloud project

Paid boxes with a live tunnel can use the Basis-owned OAuth client: one
Connect button, no fields. Option A stays available to everyone as an
override.

Which client a calendar was connected with is recorded in its stored
credentials — a refresh must use the client that issued the token."
```

---

### Task 5: Push notifications

The tunnel gives a paid box a public HTTPS address with a Let's Encrypt certificate, which is exactly what `events.watch` requires: a valid CA certificate, self-signed rejected. That is why push is paid-tier and not a general capability — a LAN-only box cannot receive a webhook from anything.

Notifications carry no body. They are a signal to re-fetch, nothing more.

**Files:**
- Create: `backend/drizzle/0020_calendar_watch_channels.sql`
- Modify: `backend/drizzle/meta/_journal.json`
- Create: `backend/drizzle/meta/0020_snapshot.json`
- Modify: `backend/src/db/schema/calendars.ts`
- Create: `backend/src/modules/calendars/watch.service.ts`
- Modify: `backend/src/modules/calendars/sync.routes.ts` (the notify route)
- Create: `backend/src/jobs/calendar-watch-renewal.worker.ts`
- Test: `backend/test/calendars/watch.test.ts`
- Test: `backend/test/calendars/notify-tenancy.test.ts`

**Interfaces:**
- Consumes: `calendarSyncQueue` from `jobs/index.ts` — a notification is a signal to *pull*, not to push. The outbound sweep already runs after each pull (phase 2, Task 4 Step 6), so a push-triggered pull picks up outbound work for free.
- Produces:
  - `calendarWatchChannels` table: `id`, `calendarId`, `channelId` (uuid we generate), `resourceId` (Google's), `token` (our secret), `expiration`, `createdAt`.
  - `startWatch(calendarId): Promise<void>`, `stopWatch(calendarId): Promise<void>`, `renewExpiringWatches(): Promise<number>`
  - `POST /calendars/sync/google/notify` — unauthenticated, scoped by channel token.

- [ ] **Step 1: Write the migration**

**Hand-author. Do not run `npm run db:generate`.**

Create `backend/drizzle/0020_calendar_watch_channels.sql`:

```sql
-- Google Calendar push channels, one per watched calendar.
--
-- Channels expire and there is no automatic renewal, so `expiration` is what
-- the renewal job reads. `token` is a secret we mint and Google echoes back
-- on every notification — it is the only thing authenticating the notify
-- endpoint, which is unauthenticated by nature.

CREATE TABLE IF NOT EXISTS calendar_watch_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id uuid NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL UNIQUE,
  resource_id varchar(255) NOT NULL,
  token varchar(128) NOT NULL,
  expiration timestamp NOT NULL,
  created_at timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS calendar_watch_channels_calendar_idx
  ON calendar_watch_channels (calendar_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS calendar_watch_channels_expiration_idx
  ON calendar_watch_channels (expiration);
--> statement-breakpoint

-- Household-scoped table, so it needs a policy like every other one. Scoped
-- through its calendar, following the pattern in 0008_rls_all_tables.sql.
ALTER TABLE calendar_watch_channels ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY calendar_watch_channels_household ON calendar_watch_channels
  USING (
    calendar_id IN (
      SELECT id FROM calendars
      WHERE household_id = current_setting('app.household_id', true)::uuid
    )
  );
```

Read `0008_rls_all_tables.sql` and copy the exact policy idiom used for other calendar-scoped tables — the `USING` clause above is the shape, but match the file's own conventions for `WITH CHECK` and role grants.

Journal entry `idx: 20`, tag `0020_calendar_watch_channels`, `when: 1787113200000`. Snapshot copied from `0019_snapshot.json` with the new table added, a fresh `id`, and `prevId` pointing at 0019's.

- [ ] **Step 2: Add the RLS check**

Add a case to `backend/test/rls/` following the existing files there: a household A connection must not see household B's watch channel rows.

- [ ] **Step 3: Write the notify tenancy test first**

Create `backend/test/calendars/notify-tenancy.test.ts`. This route is unauthenticated, so the channel token is the *only* thing standing between a caller and someone else's calendar. It has to be scoped to exactly one calendar and nothing else.

```typescript
import { describe, expect, it } from 'vitest';

/**
 * The notify endpoint takes no session. Google authenticates itself only by
 * echoing back the channel token we minted, so that token is the entire
 * boundary — and it must resolve to exactly one calendar.
 */

describe('POST /calendars/sync/google/notify', () => {
  it('enqueues a sync for the calendar whose token was presented', async () => {
    // headers: x-goog-channel-id, x-goog-channel-token, x-goog-resource-id
    // asserts: the pull queue received a job for calendar A and no other
  });

  it('ignores a notification whose token does not match the channel', async () => {
    // channel id from calendar A, token from calendar B → 200, no job enqueued
  });

  it('ignores an unknown channel id', async () => {
    // → 200, no job enqueued. Never 404: an error status tells a prober the
    // channel exists.
  });

  it('never enqueues for a calendar other than the channel\'s own', async () => {
    // calendar A's valid channel must not be able to trigger a sync of
    // calendar B, whatever the resource id header says
  });

  it('returns 200 to Google even when it ignores the notification', async () => {
    // Google retries non-2xx and eventually stops the channel
  });
});
```

Fill in each case against the route-harness the other calendar tests use. The comments state the assertion; write the code that makes it.

- [ ] **Step 4: Implement the watch service and notify route**

`startWatch` calls `events.watch` with `address = https://<sub>.home-basis.com/api/v1/calendars/sync/google/notify`, a freshly generated `channelId` (uuid) and `token` (random, ≥32 chars), and stores what Google returns — `resourceId` and `expiration`.

The notify route:
- reads `x-goog-channel-id` and `x-goog-channel-token`,
- looks up the channel by id, compares the token in constant time,
- on any mismatch or miss, returns 200 and does nothing,
- on a match, enqueues a pull for that channel's calendar and nothing else,
- always returns 200 — Google retries non-2xx and eventually stops the channel.

`stopWatch` calls `channels.stop` and deletes the row. Wire it into the existing disconnect path, which per the spec drops the tokens and leaves local events in place, unsynced.

- [ ] **Step 5: The renewal job**

Channels expire and Google will not renew them. Add a worker, scheduled hourly in `jobs/index.ts` following the existing patterns there, that re-watches every channel expiring within the next 24 hours: start a new channel first, then stop the old one, so there is no gap.

If the tunnel is down the `watch` call fails; log it and leave the row alone. The five-minute polling floor from phase 2 Task 7 is what covers that window, which is why push is an accelerator rather than a dependency.

- [ ] **Step 6: Verify**

Run: `cd backend && npm run db:migrate && npm run typecheck && npx vitest run test/calendars/ test/rls/`
Expected: clean, PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/drizzle/0020_calendar_watch_channels.sql backend/drizzle/meta/_journal.json backend/drizzle/meta/0020_snapshot.json backend/src/db/schema/calendars.ts backend/src/modules/calendars/watch.service.ts backend/src/modules/calendars/sync.routes.ts backend/src/jobs/calendar-watch-renewal.worker.ts backend/test/calendars/watch.test.ts backend/test/calendars/notify-tenancy.test.ts backend/test/rls/
git commit -m "feat(calendars): Google push notifications on the paid tier

The tunnel's Let's Encrypt certificate is what events.watch requires, so
push is a Basis Remote capability. Notifications carry no body — they are
a signal to pull.

The notify route is unauthenticated by nature, so the channel token is the
whole boundary: it resolves to exactly one calendar, mismatches are
ignored silently, and everything answers 200 so Google does not retry."
```

---

## Done when

- A Basis Remote subscriber connects Google Calendar by clicking one button, with no Google Cloud project of their own.
- A change made in Google appears in Basis within seconds rather than minutes.
- A household on the free tier is unaffected: Option A works exactly as it did after phase 1.
- A suspended or canceled tenant cannot obtain the client config, and one that already had it cannot refresh a token with it once the entitlement check next runs.
- The Basis Google client is verified, and the 100-user lifetime cap was never touched.
