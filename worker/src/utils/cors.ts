import type { Env } from '../types';

const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
];

export function getAllowedOrigins(env: Env): string[] {
  const publicOrigins = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const adminOrigins = (env.ALLOWED_ADMIN_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const merged = [...publicOrigins, ...adminOrigins];
  // de-dupe
  const unique = [...new Set(merged)];
  return unique.length ? unique : DEFAULT_ORIGINS;
}

export function resolveCorsOrigin(requestOrigin: string | undefined, env: Env): string | null {
  if (!requestOrigin) return null;
  const allowed = getAllowedOrigins(env);
  if (allowed.includes('*')) return requestOrigin;
  if (allowed.includes(requestOrigin)) return requestOrigin;
  return null;
}