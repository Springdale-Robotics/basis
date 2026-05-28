/**
 * Bug-report relay. Receives reports from homemanager deployments and creates
 * a GitHub issue on the configured repo. Lives between user installs and the
 * GitHub API so the PAT never leaves Cloudflare.
 *
 * Deploy with `wrangler deploy`; set GITHUB_TOKEN and SHARED_SECRET via
 * `wrangler secret put`.
 */

export interface Env {
  /** Fine-grained PAT with Issues: read+write on the target repo. */
  GITHUB_TOKEN: string;
  /** `owner/repo` to file issues against. Set in wrangler.toml [vars]. */
  GITHUB_REPO: string;
  /**
   * Shared secret required in the `x-bug-report-secret` header. Not a real
   * auth boundary — anyone who exfiltrates a deployment's .env can spoof
   * reports. Just keeps casual crawlers out. Rotate by re-deploying.
   */
  SHARED_SECRET?: string;
}

interface ConsoleEntry {
  level: string;
  ts: number;
  message: string;
}

interface ReportPayload {
  description: string;
  url: string;
  userAgent?: string | null;
  appVersion?: string | null;
  viewport?: { w: number; h: number } | null;
  consoleLog?: ConsoleEntry[];
  /** Base64 data URL. Not embedded in the issue — see formatBody(). */
  screenshot?: string | null;
  householdName: string;
  householdId: string;
  userName?: string | null;
  userEmail?: string | null;
  createdAt: string;
}

const MAX_PAYLOAD_BYTES = 5_000_000; // 5 MB hard cap

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'GET') {
      return json({ ok: true, service: 'bug-report-relay' });
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    if (env.SHARED_SECRET) {
      const provided = request.headers.get('x-bug-report-secret');
      if (provided !== env.SHARED_SECRET) {
        return json({ error: 'invalid secret' }, 403);
      }
    }

    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > MAX_PAYLOAD_BYTES) {
      return json({ error: 'payload too large' }, 413);
    }

    let payload: ReportPayload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'invalid json' }, 400);
    }

    if (!payload.description || !payload.url || !payload.householdName) {
      return json({ error: 'missing required fields' }, 400);
    }

    const title = buildTitle(payload);
    const body = formatBody(payload);

    const ghRes = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/issues`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'homemanager-bug-relay',
      },
      body: JSON.stringify({
        title,
        body,
        labels: ['bug-report', `app:${payload.appVersion ?? 'unknown'}`],
      }),
    });

    if (!ghRes.ok) {
      const errText = await ghRes.text().catch(() => '<no body>');
      return json(
        { error: `github ${ghRes.status}: ${errText.slice(0, 500)}` },
        502
      );
    }

    const issue = (await ghRes.json()) as { number: number; html_url: string };
    return json({ issueNumber: issue.number, issueUrl: issue.html_url });
  },
};

function buildTitle(p: ReportPayload): string {
  const summary = p.description.slice(0, 80).replace(/\s+/g, ' ').trim();
  return `[${p.householdName}] ${summary}`;
}

function formatConsoleLog(entries: ConsoleEntry[]): string {
  if (!entries?.length) return '_(no console output captured)_';
  return entries
    .map((e) => `[${new Date(e.ts).toISOString()}] [${e.level.toUpperCase()}] ${e.message}`)
    .join('\n');
}

function formatBody(p: ReportPayload): string {
  const lines: string[] = [];
  lines.push('## Description');
  lines.push(p.description);
  lines.push('');
  lines.push('## Context');
  lines.push(`- **Household:** ${p.householdName} (\`${p.householdId}\`)`);
  if (p.userName) {
    lines.push(`- **User:** ${p.userName}${p.userEmail ? ` <${p.userEmail}>` : ''}`);
  }
  lines.push(`- **Page:** \`${p.url}\``);
  lines.push(`- **App version:** \`${p.appVersion ?? 'unknown'}\``);
  if (p.viewport) lines.push(`- **Viewport:** ${p.viewport.w}×${p.viewport.h}`);
  if (p.userAgent) lines.push(`- **User agent:** \`${p.userAgent}\``);
  lines.push(`- **Submitted:** ${p.createdAt}`);
  lines.push('');

  if (p.screenshot) {
    // GitHub issue bodies max out around 65 KB; a realistic JPEG screenshot
    // is several hundred KB once base64-encoded and will be rejected outright.
    // The image stays in the deployment's local DB (admin can view it from
    // /settings/bug-reports). If we ever want screenshots in issues, the
    // worker would need to upload to R2/Imgur and link.
    const sizeKb = Math.round((p.screenshot.length * 0.75) / 1024);
    lines.push(`## Screenshot`);
    lines.push(`_Screenshot captured (~${sizeKb} KB) but not transferred — view on the deployment at \`/settings/bug-reports\`._`);
    lines.push('');
  }

  const entries = p.consoleLog ?? [];
  lines.push(`<details><summary>Console log (${entries.length} entries)</summary>`);
  lines.push('');
  lines.push('```');
  lines.push(formatConsoleLog(entries));
  lines.push('```');
  lines.push('');
  lines.push('</details>');
  return lines.join('\n');
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
