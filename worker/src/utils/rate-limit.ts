/**
 * Simple persistent rate limit / lockout for admin auth endpoints.
 * Stored in D1 so it survives isolate restarts.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
  locked: boolean;
}

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_WINDOW_SEC = 15 * 60; // 15 minutes rolling window
const DEFAULT_LOCK_SEC = 30 * 60; // 30 minutes lockout after max failures

export function getClientIp(c: {
  req: { header: (name: string) => string | undefined };
}): string {
  const cf = c.req.header('CF-Connecting-IP');
  if (cf) return cf.trim();
  const xff = c.req.header('X-Forwarded-For');
  if (xff) return xff.split(',')[0].trim();
  return 'unknown';
}

function bucketKey(scope: string, ip: string): string {
  return `rl:${scope}:${ip}`;
}

interface Bucket {
  fails: number[];
  lockedUntil: number; // epoch ms
}

async function loadBucket(db: D1Database, key: string): Promise<Bucket> {
  const row = await db
    .prepare('SELECT value FROM admin_settings WHERE key = ?')
    .bind(key)
    .first<{ value: string }>();
  if (!row?.value) return { fails: [], lockedUntil: 0 };
  try {
    const parsed = JSON.parse(row.value) as Bucket;
    return {
      fails: Array.isArray(parsed.fails) ? parsed.fails.filter((n) => typeof n === 'number') : [],
      lockedUntil: typeof parsed.lockedUntil === 'number' ? parsed.lockedUntil : 0,
    };
  } catch {
    return { fails: [], lockedUntil: 0 };
  }
}

async function saveBucket(db: D1Database, key: string, bucket: Bucket): Promise<void> {
  await db
    .prepare(
      `INSERT INTO admin_settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    )
    .bind(key, JSON.stringify(bucket))
    .run();
}

export async function checkAuthRateLimit(
  db: D1Database,
  scope: string,
  ip: string,
  opts?: { maxAttempts?: number; windowSec?: number; lockSec?: number }
): Promise<RateLimitResult> {
  const maxAttempts = opts?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const windowSec = opts?.windowSec ?? DEFAULT_WINDOW_SEC;
  const lockSec = opts?.lockSec ?? DEFAULT_LOCK_SEC;
  const key = bucketKey(scope, ip);
  const now = Date.now();
  const bucket = await loadBucket(db, key);

  if (bucket.lockedUntil > now) {
    const retryAfterSec = Math.ceil((bucket.lockedUntil - now) / 1000);
    return { allowed: false, remaining: 0, retryAfterSec, locked: true };
  }

  // prune old fails
  const windowMs = windowSec * 1000;
  bucket.fails = bucket.fails.filter((t) => now - t < windowMs);

  if (bucket.fails.length >= maxAttempts) {
    bucket.lockedUntil = now + lockSec * 1000;
    bucket.fails = [];
    await saveBucket(db, key, bucket);
    return { allowed: false, remaining: 0, retryAfterSec: lockSec, locked: true };
  }

  return {
    allowed: true,
    remaining: Math.max(0, maxAttempts - bucket.fails.length),
    retryAfterSec: 0,
    locked: false,
  };
}

export async function recordAuthFailure(
  db: D1Database,
  scope: string,
  ip: string,
  opts?: { maxAttempts?: number; windowSec?: number; lockSec?: number }
): Promise<RateLimitResult> {
  const maxAttempts = opts?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const windowSec = opts?.windowSec ?? DEFAULT_WINDOW_SEC;
  const lockSec = opts?.lockSec ?? DEFAULT_LOCK_SEC;
  const key = bucketKey(scope, ip);
  const now = Date.now();
  const bucket = await loadBucket(db, key);
  const windowMs = windowSec * 1000;
  bucket.fails = bucket.fails.filter((t) => now - t < windowMs);
  bucket.fails.push(now);

  if (bucket.fails.length >= maxAttempts) {
    bucket.lockedUntil = now + lockSec * 1000;
    bucket.fails = [];
    await saveBucket(db, key, bucket);
    return { allowed: false, remaining: 0, retryAfterSec: lockSec, locked: true };
  }

  await saveBucket(db, key, bucket);
  return {
    allowed: true,
    remaining: Math.max(0, maxAttempts - bucket.fails.length),
    retryAfterSec: 0,
    locked: false,
  };
}

export async function clearAuthRateLimit(db: D1Database, scope: string, ip: string): Promise<void> {
  const key = bucketKey(scope, ip);
  await db.prepare('DELETE FROM admin_settings WHERE key = ?').bind(key).run();
}

/** Constant-ish delay to slow brute force (200–450ms). */
export async function authDelay(): Promise<void> {
  const ms = 200 + Math.floor(Math.random() * 250);
  await new Promise((r) => setTimeout(r, ms));
}

export function isAllowedAdminOrigin(origin: string | undefined, env: { ALLOWED_ADMIN_ORIGINS?: string; ALLOWED_ORIGINS?: string }): boolean {
  if (!origin) return false;
  const adminList = (env.ALLOWED_ADMIN_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return adminList.includes(origin);
}
