// The address guard is global (config reads SSRF_ALLOW_PRIVATE once at load),
// so it has to be set before anything imports it. These tests exercise the
// other guards — timeout, size cap, redirect handling — against local servers.
process.env.SSRF_ALLOW_PRIVATE = 'true';

import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';

const { safeFetch } = await import('../../src/lib/ssrf.js');

let servers: http.Server[] = [];

async function serve(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

afterAll(() => {
  for (const server of servers) {
    server.closeAllConnections?.();
    server.close();
  }
  servers = [];
});

describe('safeFetch', () => {
  it('gives up on a server that never responds', async () => {
    // The recipe URL importer had no timeout: this held the request open
    // indefinitely, and in testing was still hanging after 8 seconds.
    const base = await serve(() => { /* accept the connection, never reply */ });
    const started = Date.now();
    await expect(safeFetch(`${base}/slow`, { timeoutMs: 1000 })).rejects.toThrow(/too long/i);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('refuses a body over the cap', async () => {
    const base = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('x'.repeat(50_000));
    });
    await expect(safeFetch(`${base}/big`, { maxBytes: 1000 })).rejects.toThrow(/too large/i);
  });

  it('follows a redirect and reports where it ended up', async () => {
    // finalUrl matters because each hop is re-validated: knowing where a
    // request actually landed is the whole point of following manually.
    const target = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>arrived</html>');
    });
    const base = await serve((_req, res) => {
      res.writeHead(302, { location: `${target}/final` });
      res.end();
    });

    const result = await safeFetch(`${base}/start`);
    expect(result.body.toString()).toContain('arrived');
    expect(result.finalUrl).toBe(`${target}/final`);
  });

  it('resolves a relative redirect against the current URL', async () => {
    const base = await serve((req, res) => {
      if (req.url === '/start') {
        res.writeHead(302, { location: '/moved' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>relative</html>');
    });

    const result = await safeFetch(`${base}/start`);
    expect(result.body.toString()).toContain('relative');
  });

  it('stops following an endless redirect chain', async () => {
    let base = '';
    base = await serve((_req, res) => {
      res.writeHead(302, { location: `${base}/again` });
      res.end();
    });
    await expect(safeFetch(`${base}/start`, { maxRedirects: 3 })).rejects.toThrow(/redirect/i);
  });
});
