# homemanager-bug-relay

Cloudflare Worker that proxies bug reports from homemanager deployments to the
GitHub Issues API. Lives between user installs and GitHub so the PAT never
ships to someone else's box.

## One-time deploy

```bash
cd worker/bug-report-relay
npm install

# Authenticate with your Cloudflare account.
npx wrangler login

# Set the GitHub PAT (fine-grained, Issues: read+write on the bugs repo).
npx wrangler secret put GITHUB_TOKEN

# Set a shared secret to keep casual crawlers out. Generate one with:
#   openssl rand -hex 32
npx wrangler secret put SHARED_SECRET

# Deploy.
npx wrangler deploy
```

Wrangler prints the deployed URL, e.g. `https://homemanager-bug-relay.<account>.workers.dev`.

## Configure deployments

In each homemanager deployment's `backend/.env`:

```
BUG_REPORT_WEBHOOK_URL=https://homemanager-bug-relay.<account>.workers.dev
BUG_REPORT_WEBHOOK_SECRET=<same value as SHARED_SECRET above>
```

The deployment's backend will POST reports here; the Worker creates the GitHub
issue and returns `{issueNumber, issueUrl}` which the backend stores on the
local `bug_reports` row.

## Notes

- **Screenshots are not transferred to GitHub.** Issue bodies max out around
  65 KB and a realistic JPEG screenshot blows past that. The screenshot stays
  in the deployment's local DB; admins can view it via the deployment's
  `/settings/bug-reports` page. If you want screenshots in issues, add
  R2/Imgur upload to `src/index.ts`.
- **The shared secret is not real auth** — anyone who exfiltrates a
  deployment's `.env` can spoof reports. It just blocks unattributed traffic.
  Rotate by re-running `wrangler secret put SHARED_SECRET` and updating
  deployments.
- **Repo override:** change `GITHUB_REPO` in `wrangler.toml` if you want a
  different bugs repo. Per-env overrides (`[env.staging] vars`) work as
  expected.

## Local dev

```bash
npx wrangler dev
# POST http://localhost:8787 with x-bug-report-secret + JSON body
```
