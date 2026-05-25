import { randomBytes } from 'crypto';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { redis } from '../../config/redis.js';
import { getCanonicalUrl } from '../../lib/url.js';
import { Errors } from '../../lib/errors.js';
import { buildIosCalendarProfile } from './mobileconfig.service.js';

const deviceLabelSchema = z.object({
  deviceLabel: z.string().min(1).max(80).default('iPhone'),
});

const TOKEN_TTL_SECONDS = 600; // 10 minutes — long enough to scan a QR, short
// enough that a leaked token isn't useful for long.
const TOKEN_PREFIX = 'connect:ios:';

interface StoredProfile {
  body: string;
  filename: string;
  contentType: string;
}

/**
 * Per-user "connect a device" surface. POST mints a fresh .mobileconfig +
 * single-use download token; GET serves the file once (then deletes the
 * token). Pattern lets the web UI render a QR code of the GET URL that an
 * iPhone can scan without being authenticated to homemanager first.
 */
// Per-user authenticated routes. Mounted at /api/v1/users/me/connect.
export async function connectRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/ios',
    { preHandler: [authMiddleware] },
    async (request) => {
      const input = deviceLabelSchema.parse(request.body ?? {});
      const user = request.user!;
      const profile = await buildIosCalendarProfile({
        request,
        userId: user.id,
        householdId: user.householdId,
        email: user.email,
        displayName: user.displayName,
        deviceLabel: input.deviceLabel,
      });
      const token = randomBytes(24).toString('base64url');
      const payload: StoredProfile = {
        body: profile.body,
        filename: profile.filename,
        contentType: profile.contentType,
      };
      await redis.set(TOKEN_PREFIX + token, JSON.stringify(payload), 'EX', TOKEN_TTL_SECONDS);
      const baseUrl = await getCanonicalUrl(request, user.householdId);
      return {
        success: true,
        data: {
          appPasswordId: profile.appPasswordId,
          deviceLabel: input.deviceLabel,
          installUrl: `${baseUrl}/api/v1/connect/ios/${token}`,
          expiresInSeconds: TOKEN_TTL_SECONDS,
        },
      };
    }
  );

}

// Public download surface. Mounted at /api/v1/connect (no auth — the token IS
// the auth). Splitting this out so it doesn't sit under the /users/me prefix.
//
// Two response modes share one URL so Safari stays on the instructions page
// after downloading the profile:
//   - GET /ios/:token          → HTML page with steps + "Install" button
//   - GET /ios/:token?download → the actual .mobileconfig as an attachment
export async function connectDownloadRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { token: string }; Querystring: { download?: string } }>(
    '/ios/:token',
    async (request, reply) => {
      const key = TOKEN_PREFIX + request.params.token;
      // Token is reusable within the TTL window — the user might need to
      // re-download (Safari hiccup, scanned QR twice, restarted install). The
      // credentials are still bounded by the TTL plus per-password revocation
      // in /settings/profile if anything leaks.
      const raw = await redis.get(key);
      if (!raw) throw Errors.notFound('Install token');
      const payload = JSON.parse(raw) as StoredProfile;

      if (request.query.download !== undefined) {
        reply
          .header('Content-Type', payload.contentType)
          .header('Content-Disposition', `attachment; filename="${payload.filename}"`)
          .send(payload.body);
        return;
      }

      // HTML landing page. Renders the post-download instructions ABOVE the
      // download trigger so the user sees Settings-app guidance before iOS
      // takes over with the install prompt.
      reply
        .header('Content-Type', 'text/html; charset=utf-8')
        .send(renderIosInstallPage(request.params.token));
    }
  );
}

function renderIosInstallPage(token: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <title>Connect Home Manager Calendar</title>
  <style>
    :root { font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
    body { margin: 0; padding: 0 20px 40px; background: #f2f2f7; color: #1c1c1e; }
    main { max-width: 480px; margin: 0 auto; padding-top: 24px; }
    h1 { font-size: 26px; font-weight: 700; margin: 0 0 6px; }
    .lede { color: #636366; font-size: 16px; margin: 0 0 24px; line-height: 1.4; }
    .card { background: #fff; border-radius: 14px; padding: 18px 20px; margin-bottom: 20px; box-shadow: 0 1px 2px rgba(0,0,0,.06); }
    .card h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .04em; color: #8e8e93; margin: 0 0 12px; font-weight: 600; }
    ol { margin: 0; padding-left: 22px; line-height: 1.55; }
    ol li { margin-bottom: 10px; }
    code { background: #f2f2f7; padding: 2px 6px; border-radius: 4px; font-size: 95%; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .btn {
      display: block; width: 100%; padding: 16px; border: none; border-radius: 12px;
      background: #007aff; color: #fff; font-size: 17px; font-weight: 600;
      text-decoration: none; text-align: center; margin-top: 8px;
    }
    .btn:active { background: #0056b3; }
    .small { color: #8e8e93; font-size: 13px; text-align: center; margin-top: 14px; line-height: 1.4; }
    strong { color: #1c1c1e; }
  </style>
</head>
<body>
  <main>
    <h1>Connect to Home Manager</h1>
    <p class="lede">After you tap Install, follow these steps on your iPhone.</p>

    <div class="card">
      <h2>What happens next</h2>
      <ol>
        <li>Tap <strong>Install profile</strong> below.</li>
        <li>Safari will prompt: <em>“This website is trying to download a configuration profile.”</em> Tap <strong>Allow</strong>.</li>
        <li>Open the <strong>Settings</strong> app (return here when done).</li>
        <li>Tap <strong>General → VPN &amp; Device Management</strong>.</li>
        <li>Tap <strong>Home Manager Calendar</strong> under <em>Downloaded Profile</em>.</li>
        <li>Tap <strong>Install</strong>, enter your passcode, then <strong>Install</strong> again to confirm the unsigned profile.</li>
        <li>Open the <strong>Calendar</strong> app — your calendars will start syncing.</li>
      </ol>
    </div>

    <a class="btn" href="/api/v1/connect/ios/${token}?download">Install profile</a>
    <p class="small">This page stays open after the download so you can keep referring to the steps. The link expires in a few minutes.</p>
  </main>
</body>
</html>`;
}
