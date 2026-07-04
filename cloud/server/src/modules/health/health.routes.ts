import type { FastifyInstance } from 'fastify';
import { sql } from '../../db/index.js';
import { listHttpProxies } from '../../services/frps-admin.client.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => {
    let dbOk = false;
    let frpsOk = false;
    try {
      await sql`select 1`;
      dbOk = true;
    } catch {
      /* reported below */
    }
    try {
      await listHttpProxies();
      frpsOk = true;
    } catch {
      /* reported below */
    }
    return { ok: dbOk, db: dbOk, frpsAdmin: frpsOk };
  });
}
