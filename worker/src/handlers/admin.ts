import { Hono } from 'hono';
import type { Env } from '../types';
import {
  createDomain,
  deleteDomain,
  getSetting,
  getStats,
  listAllDomains,
  setDomainActive,
  setSetting,
} from '../db/queries';
import { hashPassword, isValidDomain, randomToken, verifyPassword } from '../utils/auth';
import { fail, ok } from '../utils/response';
import {
  authDelay,
  checkAuthRateLimit,
  clearAuthRateLimit,
  getClientIp,
  isAllowedAdminOrigin,
  recordAuthFailure,
} from '../utils/rate-limit';

type AppEnv = { Bindings: Env };

const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

// Brute-force protection defaults
const RL_MAX = 5; // failures
const RL_WINDOW = 15 * 60; // seconds
const RL_LOCK = 30 * 60; // seconds lockout

function parseSessions(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw) as Record<string, number>;
    const now = Date.now();
    const cleaned: Record<string, number> = {};
    for (const [k, exp] of Object.entries(obj)) {
      if (typeof exp === 'number' && exp > now) cleaned[k] = exp;
    }
    return cleaned;
  } catch {
    return {};
  }
}

async function loadSessions(db: D1Database) {
  const raw = await getSetting(db, 'admin_sessions', '{}');
  return parseSessions(raw);
}

async function saveSessions(db: D1Database, sessions: Record<string, number>) {
  await setSetting(db, 'admin_sessions', JSON.stringify(sessions));
}

function rejectOrigin(c: any): Response | null {
  const origin = c.req.header('Origin');
  // Allow non-browser tools without Origin only for status health-ish; still block login abuse via rate limit.
  // For mutating auth endpoints we require allowed admin origin when Origin header is present.
  if (origin && !isAllowedAdminOrigin(origin, c.env)) {
    return fail(c, 'Origin not allowed for admin', 403, 'FORBIDDEN_ORIGIN');
  }
  return null;
}

async function requireAdmin(c: any): Promise<Response | null> {
  const originErr = rejectOrigin(c);
  if (originErr) return originErr;

  const header = c.req.header('Authorization') || '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7).trim()
    : c.req.header('X-Admin-Token') || '';
  if (!token) return fail(c, 'Admin auth required', 401, 'UNAUTHORIZED');

  const sessions = await loadSessions(c.env.DB);
  if (!sessions[token] || sessions[token] < Date.now()) {
    return fail(c, 'Invalid or expired admin session', 401, 'UNAUTHORIZED');
  }
  return null;
}

function rateLimitResponse(c: any, retryAfterSec: number, locked: boolean) {
  const res = fail(
    c,
    locked
      ? `Too many failed attempts. Try again in ${retryAfterSec}s.`
      : `Rate limited. Retry in ${retryAfterSec}s.`,
    429,
    locked ? 'LOCKED' : 'RATE_LIMITED'
  );
  res.headers.set('Retry-After', String(Math.max(1, retryAfterSec)));
  return res;
}

export const adminApi = new Hono<AppEnv>();

adminApi.get('/status', async (c) => {
  // status is public-ish (needed by admin UI) but does not leak secrets
  const setup = await getSetting(c.env.DB, 'setup_completed', '0');
  const hasPassword = !!(await getSetting(c.env.DB, 'admin_password_hash', ''));
  return ok(c, {
    setup_completed: setup === '1' && hasPassword,
    site_name: await getSetting(c.env.DB, 'site_name', 'Tempmail'),
    ttl_hours: Number(await getSetting(c.env.DB, 'ttl_hours', '24')) || 24,
  });
});

adminApi.post('/setup', async (c) => {
  try {
    const originErr = rejectOrigin(c);
    if (originErr) return originErr;

    await authDelay();

    const ip = getClientIp(c);
    const rl = await checkAuthRateLimit(c.env.DB, 'admin-setup', ip, {
      maxAttempts: RL_MAX,
      windowSec: RL_WINDOW,
      lockSec: RL_LOCK,
    });
    if (!rl.allowed) return rateLimitResponse(c, rl.retryAfterSec, rl.locked);

    const setup = await getSetting(c.env.DB, 'setup_completed', '0');
    const existingHash = await getSetting(c.env.DB, 'admin_password_hash', '');
    if (setup === '1' && existingHash) {
      await recordAuthFailure(c.env.DB, 'admin-setup', ip, {
        maxAttempts: RL_MAX,
        windowSec: RL_WINDOW,
        lockSec: RL_LOCK,
      });
      return fail(c, 'Setup already completed', 409, 'ALREADY_SETUP');
    }

    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const password = typeof body.password === 'string' ? body.password : '';
    const bootstrap = typeof body.bootstrap_secret === 'string' ? body.bootstrap_secret : '';

    if (c.env.ADMIN_BOOTSTRAP_SECRET && bootstrap !== c.env.ADMIN_BOOTSTRAP_SECRET) {
      const after = await recordAuthFailure(c.env.DB, 'admin-setup', ip, {
        maxAttempts: RL_MAX,
        windowSec: RL_WINDOW,
        lockSec: RL_LOCK,
      });
      if (!after.allowed) return rateLimitResponse(c, after.retryAfterSec, after.locked);
      return fail(c, 'Invalid bootstrap secret', 403, 'FORBIDDEN');
    }
    if (password.length < 8) {
      return fail(c, 'Password must be at least 8 characters', 400, 'WEAK_PASSWORD');
    }

    const hash = await hashPassword(password);
    await setSetting(c.env.DB, 'admin_password_hash', hash);
    await setSetting(c.env.DB, 'setup_completed', '1');

    if (typeof body.site_name === 'string' && body.site_name.trim()) {
      await setSetting(c.env.DB, 'site_name', body.site_name.trim().slice(0, 64));
    }
    if (body.ttl_hours != null) {
      const ttl = Math.max(1, Math.min(720, Number(body.ttl_hours) || 24));
      await setSetting(c.env.DB, 'ttl_hours', String(ttl));
    }

    await clearAuthRateLimit(c.env.DB, 'admin-setup', ip);

    const token = randomToken(32);
    const sessions = await loadSessions(c.env.DB);
    sessions[token] = Date.now() + SESSION_TTL_MS;
    await saveSessions(c.env.DB, sessions);

    return ok(c, { token, expires_in: SESSION_TTL_MS / 1000 }, 201);
  } catch (e) {
    console.error(e);
    return fail(c, 'Setup failed', 500);
  }
});

adminApi.post('/login', async (c) => {
  try {
    const originErr = rejectOrigin(c);
    if (originErr) return originErr;

    // Slow down automated guessing
    await authDelay();

    const ip = getClientIp(c);
    const rl = await checkAuthRateLimit(c.env.DB, 'admin-login', ip, {
      maxAttempts: RL_MAX,
      windowSec: RL_WINDOW,
      lockSec: RL_LOCK,
    });
    if (!rl.allowed) return rateLimitResponse(c, rl.retryAfterSec, rl.locked);

    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const password = typeof body.password === 'string' ? body.password : '';
    const hash = await getSetting(c.env.DB, 'admin_password_hash', '');
    if (!hash) return fail(c, 'Admin not configured. Run setup first.', 400, 'NOT_SETUP');

    const valid = await verifyPassword(password, hash);
    if (!valid) {
      const after = await recordAuthFailure(c.env.DB, 'admin-login', ip, {
        maxAttempts: RL_MAX,
        windowSec: RL_WINDOW,
        lockSec: RL_LOCK,
      });
      if (!after.allowed) return rateLimitResponse(c, after.retryAfterSec, after.locked);
      // Generic message; include remaining only lightly
      return fail(
        c,
        after.remaining > 0
          ? `Invalid password (${after.remaining} attempts left)`
          : 'Invalid password',
        401,
        'INVALID_CREDENTIALS'
      );
    }

    await clearAuthRateLimit(c.env.DB, 'admin-login', ip);

    const token = randomToken(32);
    const sessions = await loadSessions(c.env.DB);
    sessions[token] = Date.now() + SESSION_TTL_MS;
    await saveSessions(c.env.DB, sessions);

    return ok(c, { token, expires_in: SESSION_TTL_MS / 1000 });
  } catch (e) {
    console.error(e);
    return fail(c, 'Login failed', 500);
  }
});

adminApi.post('/logout', async (c) => {
  const authErr = await requireAdmin(c);
  if (authErr) return authErr;
  const header = c.req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (token) {
    const sessions = await loadSessions(c.env.DB);
    delete sessions[token];
    await saveSessions(c.env.DB, sessions);
  }
  return ok(c, { logged_out: true });
});

adminApi.get('/stats', async (c) => {
  const authErr = await requireAdmin(c);
  if (authErr) return authErr;
  const stats = await getStats(c.env.DB);
  const ttl = Number(await getSetting(c.env.DB, 'ttl_hours', '24')) || 24;
  const siteName = await getSetting(c.env.DB, 'site_name', 'Tempmail');
  return ok(c, { ...stats, ttl_hours: ttl, site_name: siteName });
});

adminApi.get('/settings', async (c) => {
  const authErr = await requireAdmin(c);
  if (authErr) return authErr;
  return ok(c, {
    site_name: await getSetting(c.env.DB, 'site_name', 'Tempmail'),
    ttl_hours: Number(await getSetting(c.env.DB, 'ttl_hours', '24')) || 24,
    max_attachment_bytes: Number(await getSetting(c.env.DB, 'max_attachment_bytes', '2097152')) || 2097152,
  });
});

adminApi.put('/settings', async (c) => {
  const authErr = await requireAdmin(c);
  if (authErr) return authErr;
  try {
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    if (typeof body.site_name === 'string' && body.site_name.trim()) {
      await setSetting(c.env.DB, 'site_name', body.site_name.trim().slice(0, 64));
    }
    if (body.ttl_hours != null) {
      const ttl = Math.max(1, Math.min(720, Number(body.ttl_hours) || 24));
      await setSetting(c.env.DB, 'ttl_hours', String(ttl));
    }
    if (body.max_attachment_bytes != null) {
      const max = Math.max(64 * 1024, Math.min(5 * 1024 * 1024, Number(body.max_attachment_bytes) || 2097152));
      await setSetting(c.env.DB, 'max_attachment_bytes', String(max));
    }
    if (typeof body.new_password === 'string' && body.new_password.length >= 8) {
      await setSetting(c.env.DB, 'admin_password_hash', await hashPassword(body.new_password));
    }
    return ok(c, {
      site_name: await getSetting(c.env.DB, 'site_name', 'Tempmail'),
      ttl_hours: Number(await getSetting(c.env.DB, 'ttl_hours', '24')) || 24,
      max_attachment_bytes: Number(await getSetting(c.env.DB, 'max_attachment_bytes', '2097152')) || 2097152,
    });
  } catch (e) {
    console.error(e);
    return fail(c, 'Failed to update settings', 500);
  }
});

adminApi.get('/domains', async (c) => {
  const authErr = await requireAdmin(c);
  if (authErr) return authErr;
  const domains = await listAllDomains(c.env.DB);
  return ok(c, domains);
});

adminApi.post('/domains', async (c) => {
  const authErr = await requireAdmin(c);
  if (authErr) return authErr;
  try {
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const domainName = typeof body.domain_name === 'string' ? body.domain_name.trim().toLowerCase() : '';
    if (!isValidDomain(domainName)) {
      return fail(c, 'Invalid domain name', 400, 'INVALID_DOMAIN');
    }
    const created = await createDomain(c.env.DB, domainName);
    return ok(c, created, 201);
  } catch (e) {
    const msg = String(e);
    if (msg.includes('UNIQUE') || msg.toLowerCase().includes('unique')) {
      return fail(c, 'Domain already exists', 409, 'DUPLICATE');
    }
    console.error(e);
    return fail(c, 'Failed to create domain', 500);
  }
});

adminApi.patch('/domains/:id', async (c) => {
  const authErr = await requireAdmin(c);
  if (authErr) return authErr;
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return fail(c, 'Invalid id', 400);
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  if (typeof body.is_active === 'boolean') {
    const okUpdate = await setDomainActive(c.env.DB, id, body.is_active);
    if (!okUpdate) return fail(c, 'Domain not found', 404);
  }
  const domains = await listAllDomains(c.env.DB);
  const row = domains.find((d) => d.id === id);
  if (!row) return fail(c, 'Domain not found', 404);
  return ok(c, row);
});

adminApi.delete('/domains/:id', async (c) => {
  const authErr = await requireAdmin(c);
  if (authErr) return authErr;
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return fail(c, 'Invalid id', 400);
  const deleted = await deleteDomain(c.env.DB, id);
  if (!deleted) return fail(c, 'Domain not found', 404);
  return ok(c, { deleted: true });
});
