const encoder = new TextEncoder();

export const ADMIN_COOKIE_NAME = '__Host-tempmail_admin';
export const ADMIN_SESSION_TTL_SECONDS = 12 * 60 * 60;
export const ADMIN_PASSWORD_MIN_LENGTH = 12;
export const ADMIN_PASSWORD_MAX_LENGTH = 128;

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return toHex(new Uint8Array(digest));
}

export async function secretsEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([sha256Hex(left), sha256Hex(right)]);
  let difference = 0;
  for (let index = 0; index < leftHash.length; index++) {
    difference |= leftHash.charCodeAt(index) ^ rightHash.charCodeAt(index);
  }
  return difference === 0;
}

export function validateAdminPassword(password: string): string | null {
  if (password.length < ADMIN_PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${ADMIN_PASSWORD_MIN_LENGTH} characters`;
  }
  if (password.length > ADMIN_PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${ADMIN_PASSWORD_MAX_LENGTH} characters`;
  }
  return null;
}

export async function createAdminSession(
  db: D1Database,
  token: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<void> {
  const tokenHash = await sha256Hex(token);
  await db.batch([
    db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').bind(nowSeconds),
    db
      .prepare('INSERT INTO admin_sessions (token_hash, expires_at) VALUES (?, ?)')
      .bind(tokenHash, nowSeconds + ADMIN_SESSION_TTL_SECONDS),
  ]);
}

export async function isAdminSessionValid(
  db: D1Database,
  token: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<boolean> {
  if (!token) return false;
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare('SELECT 1 AS valid FROM admin_sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(tokenHash, nowSeconds)
    .first<{ valid: number }>();
  return row?.valid === 1;
}

export async function revokeAdminSession(db: D1Database, token: string): Promise<void> {
  if (!token) return;
  await db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
}

export async function revokeAllAdminSessions(db: D1Database): Promise<void> {
  await db.prepare('DELETE FROM admin_sessions').run();
}
