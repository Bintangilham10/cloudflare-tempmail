import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
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
import {
  hashPassword,
  isValidDomain,
  passwordHashNeedsUpgrade,
  randomToken,
  verifyPassword,
} from '../utils/auth';
import {
  ADMIN_COOKIE_NAME,
  ADMIN_SESSION_TTL_SECONDS,
  createAdminSession,
  isAdminSessionValid,
  revokeAdminSession,
  revokeAllAdminSessions,
  secretsEqual,
  validateAdminPassword,
} from '../utils/admin-session';
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
type AppContext = Context<AppEnv>;

const RL_MAX = 5;
const RL_WINDOW = 60;
const RL_LOCK = 30 * 60;

function rejectOrigin(c: AppContext): Response | null {
  const origin = c.req.header('Origin');
  if (!origin || !isAllowedAdminOrigin(origin, c.env)) {
    return fail(c, 'Origin not allowed for admin', 403, 'FORBIDDEN_ORIGIN');
  }
  return null;
}

function setSessionCookie(c: AppContext, token: string): void {
  setCookie(c, ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  });
}

function clearSessionCookie(c: AppContext): void {
  deleteCookie(c, ADMIN_COOKIE_NAME, { path: '/', secure: true });
}

async function requireAdmin(c: AppContext): Promise<Response | null> {
  const originError = rejectOrigin(c);
  if (originError) return originError;
  const token = getCookie(c, ADMIN_COOKIE_NAME) || '';
  if (!(await isAdminSessionValid(c.env.DB, token))) {
    clearSessionCookie(c);
    return fail(c, 'Invalid or expired admin session', 401, 'UNAUTHORIZED');
  }
  return null;
}

function rateLimitResponse(c: AppContext, retryAfterSeconds: number, locked: boolean): Response {
  const response = fail(
    c,
    locked ? 'Too many failed attempts' : 'Too many requests',
    429,
    locked ? 'LOCKED' : 'RATE_LIMITED'
  );
  response.headers.set('Retry-After', String(Math.max(1, retryAfterSeconds)));
  return response;
}

async function enforceLoginRateLimit(c: AppContext, scope: string, ip: string): Promise<Response | null> {
  try {
    const edgeResult = await c.env.LOGIN_RATE_LIMITER.limit({ key: `${scope}:${ip}` });
    if (!edgeResult.success) return rateLimitResponse(c, 60, false);
  } catch {
    return fail(c, 'Authentication rate limiter unavailable', 503, 'DEPENDENCY_UNAVAILABLE');
  }

  const persistentResult = await checkAuthRateLimit(c.env.DB, scope, ip, {
    maxAttempts: RL_MAX,
    windowSec: RL_WINDOW,
    lockSec: RL_LOCK,
  });
  return persistentResult.allowed
    ? null
    : rateLimitResponse(c, persistentResult.retryAfterSec, persistentResult.locked);
}

async function issueSession(c: AppContext): Promise<void> {
  const token = randomToken(32);
  await createAdminSession(c.env.DB, token);
  setSessionCookie(c, token);
}

export const adminApi = new Hono<AppEnv>();

adminApi.get('/status', async (c) => {
  const originError = rejectOrigin(c);
  if (originError) return originError;
  const setup = await getSetting(c.env.DB, 'setup_completed', '0');
  const hasPassword = Boolean(await getSetting(c.env.DB, 'admin_password_hash', ''));
  return ok(c, {
    setup_completed: setup === '1' && hasPassword,
    site_name: await getSetting(c.env.DB, 'site_name', 'Tempmail'),
    ttl_hours: Number(await getSetting(c.env.DB, 'ttl_hours', '24')) || 24,
  });
});

adminApi.get('/session', async (c) => {
  const authError = await requireAdmin(c);
  if (authError) return authError;
  return ok(c, { authenticated: true });
});

adminApi.post('/setup', async (c) => {
  const originError = rejectOrigin(c);
  if (originError) return originError;
  if (!c.env.ADMIN_BOOTSTRAP_SECRET) {
    return fail(c, 'Admin bootstrap secret is not configured', 503, 'BOOTSTRAP_NOT_CONFIGURED');
  }

  await authDelay();
  const ip = getClientIp(c);
  const rateLimitError = await enforceLoginRateLimit(c, 'admin-setup', ip);
  if (rateLimitError) return rateLimitError;

  const setup = await getSetting(c.env.DB, 'setup_completed', '0');
  const existingHash = await getSetting(c.env.DB, 'admin_password_hash', '');
  if (setup === '1' && existingHash) return fail(c, 'Setup already completed', 409, 'ALREADY_SETUP');

  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const password = typeof body.password === 'string' ? body.password : '';
  const bootstrap = typeof body.bootstrap_secret === 'string' ? body.bootstrap_secret : '';
  if (!(await secretsEqual(bootstrap, c.env.ADMIN_BOOTSTRAP_SECRET))) {
    const result = await recordAuthFailure(c.env.DB, 'admin-setup', ip, {
      maxAttempts: RL_MAX,
      windowSec: RL_WINDOW,
      lockSec: RL_LOCK,
    });
    return result.allowed
      ? fail(c, 'Invalid bootstrap secret', 403, 'FORBIDDEN')
      : rateLimitResponse(c, result.retryAfterSec, result.locked);
  }
  const passwordError = validateAdminPassword(password);
  if (passwordError) return fail(c, passwordError, 400, 'WEAK_PASSWORD');

  await setSetting(c.env.DB, 'admin_password_hash', await hashPassword(password));
  await setSetting(c.env.DB, 'setup_completed', '1');
  if (typeof body.site_name === 'string' && body.site_name.trim()) {
    await setSetting(c.env.DB, 'site_name', body.site_name.trim().slice(0, 64));
  }
  if (body.ttl_hours != null) {
    const ttl = Math.max(1, Math.min(720, Number(body.ttl_hours) || 24));
    await setSetting(c.env.DB, 'ttl_hours', String(ttl));
  }
  await clearAuthRateLimit(c.env.DB, 'admin-setup', ip);
  await revokeAllAdminSessions(c.env.DB);
  await issueSession(c);
  return ok(c, { expires_in: ADMIN_SESSION_TTL_SECONDS }, 201);
});

adminApi.post('/login', async (c) => {
  const originError = rejectOrigin(c);
  if (originError) return originError;
  await authDelay();
  const ip = getClientIp(c);
  const rateLimitError = await enforceLoginRateLimit(c, 'admin-login', ip);
  if (rateLimitError) return rateLimitError;

  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length > 128) return fail(c, 'Invalid credentials', 401, 'INVALID_CREDENTIALS');
  const hash = await getSetting(c.env.DB, 'admin_password_hash', '');
  if (!hash) return fail(c, 'Admin is not configured', 400, 'NOT_SETUP');
  if (!(await verifyPassword(password, hash))) {
    const result = await recordAuthFailure(c.env.DB, 'admin-login', ip, {
      maxAttempts: RL_MAX,
      windowSec: RL_WINDOW,
      lockSec: RL_LOCK,
    });
    return result.allowed
      ? fail(c, 'Invalid credentials', 401, 'INVALID_CREDENTIALS')
      : rateLimitResponse(c, result.retryAfterSec, result.locked);
  }

  if (passwordHashNeedsUpgrade(hash)) {
    await setSetting(c.env.DB, 'admin_password_hash', await hashPassword(password));
  }
  await clearAuthRateLimit(c.env.DB, 'admin-login', ip);
  await issueSession(c);
  return ok(c, { expires_in: ADMIN_SESSION_TTL_SECONDS });
});

adminApi.post('/logout', async (c) => {
  const originError = rejectOrigin(c);
  if (originError) return originError;
  await revokeAdminSession(c.env.DB, getCookie(c, ADMIN_COOKIE_NAME) || '');
  clearSessionCookie(c);
  return ok(c, { logged_out: true });
});

adminApi.get('/stats', async (c) => {
  const authError = await requireAdmin(c);
  if (authError) return authError;
  const stats = await getStats(c.env.DB);
  const ttl = Number(await getSetting(c.env.DB, 'ttl_hours', '24')) || 24;
  const siteName = await getSetting(c.env.DB, 'site_name', 'Tempmail');
  return ok(c, { ...stats, ttl_hours: ttl, site_name: siteName });
});

adminApi.get('/settings', async (c) => {
  const authError = await requireAdmin(c);
  if (authError) return authError;
  return ok(c, {
    site_name: await getSetting(c.env.DB, 'site_name', 'Tempmail'),
    ttl_hours: Number(await getSetting(c.env.DB, 'ttl_hours', '24')) || 24,
    max_attachment_bytes:
      Number(await getSetting(c.env.DB, 'max_attachment_bytes', '5242880')) || 5242880,
  });
});

adminApi.put('/settings', async (c) => {
  const authError = await requireAdmin(c);
  if (authError) return authError;
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  if (typeof body.site_name === 'string' && body.site_name.trim()) {
    await setSetting(c.env.DB, 'site_name', body.site_name.trim().slice(0, 64));
  }
  if (body.ttl_hours != null) {
    const ttl = Math.max(1, Math.min(720, Number(body.ttl_hours) || 24));
    await setSetting(c.env.DB, 'ttl_hours', String(ttl));
  }
  if (body.max_attachment_bytes != null) {
    const max = Math.max(64 * 1024, Math.min(5 * 1024 * 1024, Number(body.max_attachment_bytes) || 5242880));
    await setSetting(c.env.DB, 'max_attachment_bytes', String(max));
  }
  let sessionsRevoked = false;
  if (typeof body.new_password === 'string' && body.new_password) {
    const passwordError = validateAdminPassword(body.new_password);
    if (passwordError) return fail(c, passwordError, 400, 'WEAK_PASSWORD');
    await setSetting(c.env.DB, 'admin_password_hash', await hashPassword(body.new_password));
    await revokeAllAdminSessions(c.env.DB);
    clearSessionCookie(c);
    sessionsRevoked = true;
  }
  return ok(c, {
    site_name: await getSetting(c.env.DB, 'site_name', 'Tempmail'),
    ttl_hours: Number(await getSetting(c.env.DB, 'ttl_hours', '24')) || 24,
    max_attachment_bytes:
      Number(await getSetting(c.env.DB, 'max_attachment_bytes', '5242880')) || 5242880,
    sessions_revoked: sessionsRevoked,
  });
});

adminApi.get('/domains', async (c) => {
  const authError = await requireAdmin(c);
  if (authError) return authError;
  return ok(c, await listAllDomains(c.env.DB));
});

adminApi.post('/domains', async (c) => {
  const authError = await requireAdmin(c);
  if (authError) return authError;
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const domainName = typeof body.domain_name === 'string' ? body.domain_name.trim().toLowerCase() : '';
  if (!isValidDomain(domainName)) return fail(c, 'Invalid domain name', 400, 'INVALID_DOMAIN');
  try {
    return ok(c, await createDomain(c.env.DB, domainName), 201);
  } catch (error) {
    if (String(error).toLowerCase().includes('unique')) {
      return fail(c, 'Domain already exists', 409, 'DUPLICATE');
    }
    return fail(c, 'Failed to create domain', 500);
  }
});

adminApi.patch('/domains/:id', async (c) => {
  const authError = await requireAdmin(c);
  if (authError) return authError;
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id < 1) return fail(c, 'Invalid id', 400);
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  if (typeof body.is_active === 'boolean' && !(await setDomainActive(c.env.DB, id, body.is_active))) {
    return fail(c, 'Domain not found', 404);
  }
  const row = (await listAllDomains(c.env.DB)).find((domain) => domain.id === id);
  return row ? ok(c, row) : fail(c, 'Domain not found', 404);
});

adminApi.delete('/domains/:id', async (c) => {
  const authError = await requireAdmin(c);
  if (authError) return authError;
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id < 1) return fail(c, 'Invalid id', 400);
  return (await deleteDomain(c.env.DB, id))
    ? ok(c, { deleted: true })
    : fail(c, 'Domain not found', 404);
});
