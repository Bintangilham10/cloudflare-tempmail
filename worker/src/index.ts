import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { resolveCorsOrigin } from './utils/cors';
import { publicApi } from './handlers/api';
import { adminApi } from './handlers/admin';
import { handleInboundEmail } from './handlers/inbound';
import { handleScheduled } from './handlers/cron';
import { fail, ok } from './utils/response';

const app = new Hono<{ Bindings: Env }>();

app.use('*', async (c, next) => {
  const origin = c.req.header('Origin');
  const allowed = resolveCorsOrigin(origin, c.env);

  // Dynamic CORS based on env allowlist
  const corsMiddleware = cors({
    origin: (reqOrigin) => resolveCorsOrigin(reqOrigin, c.env) || '',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Mailbox-Token', 'X-Admin-Token'],
    exposeHeaders: ['Content-Disposition'],
    maxAge: 86400,
    credentials: false,
  });

  // Always run CORS; if origin not allowed, browser will block — API still works server-side
  void allowed;
  return corsMiddleware(c, next);
});

app.get('/', (c) =>
  ok(c, {
    name: 'tempmail-api',
    version: '1.0.0',
    docs: 'See README.md',
  })
);

app.get('/api/health', (c) => ok(c, { status: 'ok', time: new Date().toISOString() }));

app.route('/api', publicApi);
app.route('/api/admin', adminApi);

app.notFound((c) => fail(c, 'Not found', 404, 'NOT_FOUND'));
app.onError((err, c) => {
  console.error('Unhandled error', err);
  return fail(c, 'Internal server error', 500, 'INTERNAL');
});

export default {
  fetch: app.fetch,

  async email(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext) {
    await handleInboundEmail(message, env);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleScheduled(event, env));
  },
};
