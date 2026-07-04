# Basis Remote (cloud/)

The paid tunnel service at **home-basis.com**: a family claims
`lastname.home-basis.com`, their Basis box opens an outbound frp tunnel to our
relay, and their install is reachable from anywhere — no port forwarding. This
directory holds the control plane (`server/`), the marketing site + account
dashboard (`frontend/`), and all deployment artifacts (`deploy/`).

Independent npm projects, same conventions as `backend/`/`frontend/` — no
cross-package imports.

## Architecture

```
Internet ──443──> Caddy ──(apex + www)──────> 127.0.0.1:4000  cloud control plane (Fastify)
                    │  └──(*.home-basis.com)─> 127.0.0.1:8080  frps vhostHTTP
Internet ──7000──> frps bindPort (frpc control connections from customer boxes)
loopback:7500      frps admin API (usage metering polls /api/proxy/http)
loopback:4000      <── frps httpPlugin POSTs /frp-plugin/<secret>/handler
localhost          Postgres 16 (cloud DB)
Customer box:      backend spawns `frpc -c run/frpc.toml` (supervised child, like cloudflared today)
```

One Ubuntu 24.04 VPS runs everything as systemd units: `basis-cloud` (control
plane), `frps` (relay), `caddy` (TLS + routing), `basis-cloud-backup.timer`
(nightly pg_dump). frps *Wants* (not *Requires*) basis-cloud, so the relay and
established tunnels stay up while the control plane restarts during updates;
it fails safe because new logins can't be authorized while the plugin is down.

## Local development

```bash
cd cloud
./dev.sh start      # Postgres (:5433) + control plane (:4000) + frontend (:5174)
./dev.sh frps       # local relay in another terminal — tunnels at *.lvh.me:8080
./dev.sh stripe     # forward Stripe test webhooks (paste whsec_ into server/.env.local)
./dev.sh db         # psql into the dev database
./dev.sh stop
```

Real Stripe test-mode keys go in `cloud/server/.env.local` (gitignored);
`dev.sh` folds them into the generated `server/.env`. After editing
`.env.local`: `rm server/.env && ./dev.sh start`.

End-to-end without a VPS (`lvh.me` and all its subdomains resolve to
127.0.0.1, so frps does real vhost routing):

```bash
# 1. sign up + claim "smith" via http://localhost:5174, comp the account
#    (server/scripts/comp.ts), generate a claim code — or exercise the boxes
#    API directly. You end up with a tenantId + tunnelToken.
# 2. run a stand-in for the customer box:
./dev.sh frpc-demo --token <tunnelToken> --tenant <tenantId> --subdomain smith --local-port 3000
# 3. request through the tunnel:
curl http://smith.lvh.me:8080/
```

To point a local main-app checkout at this control plane, run it with
`BASIS_CLOUD_URL=http://localhost:4000`.

## Provisioning a VPS (start to finish)

1. **DNS (Cloudflare)** — both records **DNS only / grey cloud**. Orange-cloud
   proxying breaks the relay and violates Cloudflare's proxy ToS for streamed
   media (Basis serves movies/music):
   - `A  home-basis.com    → <VPS IP>`
   - `A  *.home-basis.com  → <VPS IP>`

   Create a scoped API token for ACME DNS-01: **Zone → DNS → Edit**, this zone
   only.

2. **Provision** (fresh Ubuntu 24.04, as root):

   ```bash
   git clone --depth 1 https://github.com/Springdale-Robotics/basis
   sudo bash basis/cloud/deploy/provision.sh --cloudflare-token <token>
   ```

   Installs Node 20, Postgres, Caddy (+ cloudflare DNS plugin), a pinned and
   checksum-verified frps, creates the `basis-cloud`/`frps` users, generates
   `/opt/basis-cloud/.env` (once — never overwritten), renders
   `/etc/frp/frps.toml` + `/etc/caddy/Caddyfile`, installs units + sudoers +
   backup timer, and enables ufw (22/80/443/7000). Re-run any time to refresh
   units/templates.

3. **Deploy the first version**:

   ```bash
   sudo bash basis/cloud/deploy/update.sh --version cloud-vX.Y.Z
   ```

4. **Stripe dashboard** (until this is done, `.env` holds `CHANGEME`
   placeholders and payments are down):
   - Create two **annual** recurring prices: Basic $20/yr, Streaming $36/yr.
     Put their ids in `STRIPE_PRICE_BASIC_ANNUAL` / `STRIPE_PRICE_STREAMING_ANNUAL`.
   - Add a webhook endpoint `https://home-basis.com/api/stripe/webhook` with
     events: `checkout.session.completed`, `customer.subscription.updated`,
     `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.
     Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
   - Set `STRIPE_SECRET_KEY`, then `sudo systemctl restart basis-cloud`.

5. Watch the wildcard cert issue (`journalctl -u caddy -f`), then set
   `BACKUP_REMOTE_CMD` in `/opt/basis-cloud/.env` for offsite backups (below).

## Release & update

Releases are cut by tagging: push an annotated `cloud-v*` tag and
`.github/workflows/cloud-release.yml` verifies (lint, typecheck, unit tests,
build for both packages) and publishes `basis-cloud-<version>.tar.gz` + its
`.sha256` — containing `VERSION`, `server/{dist,package.json,package-lock.json,drizzle}/`,
`frontend/dist/`, and `deploy/`.

```bash
git tag -a cloud-v0.2.0 -m "what changed"
git push origin cloud-v0.2.0
# then on the VPS:
sudo bash /opt/basis-cloud/current/deploy/update.sh --version cloud-v0.2.0
```

`update.sh` refuses unverified downloads (mandatory `.sha256` check), stages
under `/opt/basis-cloud/versions/<v>`, runs `npm ci --omit=dev` (the build is
a tsc emit, not a bundle), migrates, smoke-tests, atomically swaps the
`current` symlink, restarts, and polls `/health` for ~60 s — **auto-rolling
back** the symlink to the previous version on failure (code only; migrations
are not reverted). The last 3 versions are kept. `--source <dir>` deploys a
locally staged build with the same layout.

## Backup & restore

`basis-cloud-backup.timer` runs a nightly `pg_dump -Fc` into
`/var/backups/basis-cloud/`, keeping the newest 14. **This database is the
business** (accounts, subscriptions, hashed tunnel tokens) and the dumps sit
on the same disk as the DB — configure the off-host hook in
`/opt/basis-cloud/.env`; the finished dump path is exposed as
`$BASIS_BACKUP_FILE`:

```bash
BACKUP_REMOTE_CMD=rclone copy "$BASIS_BACKUP_FILE" remote:basis-cloud-backups/
```

Restore:

```bash
sudo systemctl stop basis-cloud
sudo -u basis-cloud pg_restore --clean --if-exists \
  --dbname="$(sudo grep '^DATABASE_URL=' /opt/basis-cloud/.env | cut -d= -f2-)" \
  /var/backups/basis-cloud/basis-cloud-<stamp>.dump
sudo systemctl start basis-cloud
```

Run one manually: `sudo systemctl start basis-cloud-backup.service`.

## Security notes

- **Plugin endpoint is layered**: frps authorizes every `Login`/`NewProxy`/
  `Ping` against `POST /frp-plugin/<secret>/handler`. The secret path is
  checked constant-time by the handler, which also requires a loopback source
  address, and Caddy answers 404 for `/frp-plugin/*` on the public origin.
  There is deliberately no global frp `auth.token` — the plugin *is* the auth,
  per-tenant.
- **Tokens are hashed**: tunnel tokens and claim codes are stored as sha256
  hashes only (plaintext shown once at issuance); claims rotate tokens, and
  revocation takes effect within one frpc heartbeat (Ping rejection is the
  kick — frps has no kick API).
- **Tombstones**: canceled subdomains are blocked from strangers for 90 days
  (same account may reclaim), so a lapsed family's URL can't be squatted while
  bookmarks/calendar links still point at it.
- **Least privilege**: `basis-cloud` and `frps` are nologin system users;
  units run with `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`,
  `PrivateTmp`. The sudoers grant (`deploy/sudoers-basis-cloud`) allows
  exactly `systemctl restart/reset-failed` of the three service units, nothing
  else. Secrets live in `/opt/basis-cloud/.env` and `/etc/caddy/env`, both
  0600 and outside the version dirs.
- **frp is pinned + verified** (`FRP_VERSION` in `deploy/provision.sh`,
  checked against the release's `frp_sha256_checksums.txt`); keep the pin in
  sync with the box-side installer (`backend/src/modules/install/
  installer-commands.ts`) and `cloud/dev.sh`.
