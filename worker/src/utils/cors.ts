import type { Env } from '../types';

function parseOrigins(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => Boolean(origin) && origin !== '*');
}

export function getPublicAllowedOrigins(env: Env): string[] {
  return [...new Set(parseOrigins(env.ALLOWED_ORIGINS))];
}

export function getAdminAllowedOrigins(env: Env): string[] {
  return [...new Set(parseOrigins(env.ALLOWED_ADMIN_ORIGINS))];
}

export function getAllowedOrigins(env: Env): string[] {
  return [...new Set([...getPublicAllowedOrigins(env), ...getAdminAllowedOrigins(env)])];
}

export function resolveCorsOrigin(requestOrigin: string | undefined, env: Env): string | null {
  if (!requestOrigin) return null;
  return getAllowedOrigins(env).includes(requestOrigin) ? requestOrigin : null;
}

export function resolvePublicCorsOrigin(requestOrigin: string | undefined, env: Env): string | null {
  if (!requestOrigin) return null;
  return getPublicAllowedOrigins(env).includes(requestOrigin) ? requestOrigin : null;
}

export function resolveAdminCorsOrigin(requestOrigin: string | undefined, env: Env): string | null {
  if (!requestOrigin) return null;
  return getAdminAllowedOrigins(env).includes(requestOrigin) ? requestOrigin : null;
}
