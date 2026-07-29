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

/** Payload shape sent by backend/src/lib/error-reporter.ts. */
interface ServerErrorPayload {
  kind: 'uncaughtException' | 'unhandledRejection' | 'http_5xx';
  message: string;
  stack?: string;
  version?: string | null;
  host?: string;
  timestamp?: string;
  requestId?: string;
  method?: string;
  route?: string;
}

const SERVER_ERROR_KINDS = new Set(['uncaughtException', 'unhandledRejection', 'http_5xx']);

function isServerError(p: unknown): p is ServerErrorPayload {
  return (
    typeof p === 'object' &&
    p !== null &&
    SERVER_ERROR_KINDS.has((p as ServerErrorPayload).kind) &&
    typeof (p as ServerErrorPayload).message === 'string'
  );
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

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'invalid json' }, 400);
    }

    if (isServerError(payload)) {
      return handleServerError(payload, env);
    }

    const report = payload as ReportPayload;
    if (!report.description || !report.url || !report.householdName) {
      return json({ error: 'missing required fields' }, 400);
    }

    return createIssue(env, {
      title: buildTitle(report),
      body: formatBody(report),
      labels: ['bug-report', `app:${report.appVersion ?? 'unknown'}`],
    });
  },
};

/**
 * Server errors can arrive in bursts (systemd restarts a crash-looping backend
 * every 10s and the in-process dedup map dies with each process), so repeats
 * are consolidated: if an open `server-error` issue with the same title
 * exists, add an occurrence comment instead of filing a new issue.
 */
/**
 * GitHub's issue-list endpoint lags issue creation by a second or two, so a
 * burst of identical errors could each see "no existing issue" and fan out.
 * Remember issues this isolate created to bridge that gap (best-effort — a
 * cold isolate falls back to the list lookup, which is consistent by then).
 */
const recentlyCreated = new Map<string, { number: number; html_url: string }>();

async function handleServerError(p: ServerErrorPayload, env: Env): Promise<Response> {
  const summary = p.message.slice(0, 80).replace(/\s+/g, ' ').trim();
  const title = `[${p.host ?? 'unknown-host'}] ${p.kind}: ${summary}`;

  const existing =
    recentlyCreated.get(title) ?? (await findOpenIssueByTitle(env, title, 'server-error'));
  if (existing) {
    const ghRes = await gh(env, `/issues/${existing.number}/comments`, {
      body: formatServerErrorOccurrence(p),
    });
    if (!ghRes.ok) {
      const errText = await ghRes.text().catch(() => '<no body>');
      return json({ error: `github ${ghRes.status}: ${errText.slice(0, 500)}` }, 502);
    }
    return json({ issueNumber: existing.number, issueUrl: existing.html_url });
  }

  const res = await createIssue(env, {
    title,
    body: formatServerErrorBody(p),
    labels: ['server-error', `app:${p.version ?? 'unknown'}`],
  });
  if (res.status === 200) {
    const created = (await res.clone().json()) as { issueNumber: number; issueUrl: string };
    recentlyCreated.set(title, { number: created.issueNumber, html_url: created.issueUrl });
    if (recentlyCreated.size > 200) {
      recentlyCreated.delete(recentlyCreated.keys().next().value!);
    }
  }
  return res;
}

async function findOpenIssueByTitle(
  env: Env,
  title: string,
  label: string
): Promise<{ number: number; html_url: string } | null> {
  const res = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/issues?state=open&labels=${label}&per_page=100`,
    { headers: ghHeaders(env) }
  );
  if (!res.ok) return null; // fall through to creating a fresh issue
  const issues = (await res.json()) as Array<{ number: number; html_url: string; title: string }>;
  return issues.find((i) => i.title === title) ?? null;
}

async function createIssue(
  env: Env,
  issue: { title: string; body: string; labels: string[] }
): Promise<Response> {
  const ghRes = await gh(env, '/issues', issue);
  if (!ghRes.ok) {
    const errText = await ghRes.text().catch(() => '<no body>');
    return json({ error: `github ${ghRes.status}: ${errText.slice(0, 500)}` }, 502);
  }
  const created = (await ghRes.json()) as { number: number; html_url: string };
  return json({ issueNumber: created.number, issueUrl: created.html_url });
}

function ghHeaders(env: Env): Record<string, string> {
  return {
    'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'homemanager-bug-relay',
  };
}

function gh(env: Env, path: string, body: unknown): Promise<Response> {
  return fetch(`https://api.github.com/repos/${env.GITHUB_REPO}${path}`, {
    method: 'POST',
    headers: ghHeaders(env),
    body: JSON.stringify(body),
  });
}

function formatServerErrorContext(p: ServerErrorPayload): string[] {
  const lines: string[] = [];
  lines.push(`- **Kind:** \`${p.kind}\``);
  if (p.host) lines.push(`- **Host:** \`${p.host}\``);
  lines.push(`- **App version:** \`${p.version ?? 'unknown'}\``);
  if (p.timestamp) lines.push(`- **When:** ${p.timestamp}`);
  if (p.requestId) lines.push(`- **Request ID:** \`${p.requestId}\` (grep journald for it)`);
  if (p.method || p.route) lines.push(`- **Route:** \`${p.method ?? '?'} ${p.route ?? '?'}\``);
  return lines;
}

function formatStack(stack?: string): string[] {
  if (!stack) return ['_(no stack captured)_'];
  return ['```', stack.slice(0, 8_000), '```'];
}

function formatServerErrorBody(p: ServerErrorPayload): string {
  return [
    '## Error',
    '```',
    p.message.slice(0, 2_000),
    '```',
    '',
    '## Context',
    ...formatServerErrorContext(p),
    '',
    '## Stack',
    ...formatStack(p.stack),
  ].join('\n');
}

function formatServerErrorOccurrence(p: ServerErrorPayload): string {
  return [
    '**Recurred**',
    ...formatServerErrorContext(p),
    '',
    '<details><summary>Stack</summary>',
    '',
    ...formatStack(p.stack),
    '',
    '</details>',
  ].join('\n');
}

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
    // GitHub issue bodies max out around 65 KB, so the image can't be embedded
    // and the worker sends only a '[present]' flag instead of the data — no
    // size is known here. The image stays in the deployment's local DB (admin
    // can view it from /settings/bug-reports). If we ever want screenshots in
    // issues, the worker would need to upload to R2/Imgur and link.
    lines.push(`## Screenshot`);
    lines.push(`_Screenshot captured but not transferred — view it on the deployment at \`/settings/bug-reports\`._`);
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
