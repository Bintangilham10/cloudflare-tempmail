interface FrontendEnv {
  DEV?: boolean;
  VITE_PUBLIC_HOST?: string;
  VITE_ADMIN_HOST?: string;
  VITE_PUBLIC_INBOX_URL?: string;
  VITE_API_BASE?: string;
}

export interface FrontendConfig {
  publicHost: string;
  adminHost: string;
  publicInboxUrl: string;
  apiBase: string;
  development: boolean;
}

function required(name: keyof FrontendEnv, value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} must be configured`);
  return normalized;
}

function hostname(name: keyof FrontendEnv, value: string): string {
  if (
    value !== value.toLowerCase() ||
    value.includes('://') ||
    value.includes('/') ||
    !/^(?:localhost|127\.0\.0\.1|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,})$/.test(
      value
    )
  ) {
    throw new Error(`${name} must be a lowercase hostname without a scheme or path`);
  }
  return value;
}

function absoluteUrl(name: keyof FrontendEnv, value: string, development: boolean): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (!development && parsed.protocol !== 'https:') {
    throw new Error(`${name} must use HTTPS in production`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`${name} is not a supported public URL`);
  }
  return parsed.href.replace(/\/$/, '');
}

export function resolveFrontendConfig(env: FrontendEnv): FrontendConfig {
  const development = env.DEV === true;
  const publicHost = hostname(
    'VITE_PUBLIC_HOST',
    required('VITE_PUBLIC_HOST', env.VITE_PUBLIC_HOST ?? (development ? 'localhost' : undefined))
  );
  const adminHost = hostname(
    'VITE_ADMIN_HOST',
    required('VITE_ADMIN_HOST', env.VITE_ADMIN_HOST ?? (development ? 'localhost' : undefined))
  );
  const publicInboxUrl = absoluteUrl(
    'VITE_PUBLIC_INBOX_URL',
    required(
      'VITE_PUBLIC_INBOX_URL',
      env.VITE_PUBLIC_INBOX_URL ?? (development ? 'http://localhost:5173' : undefined)
    ),
    development
  );
  const apiBase = absoluteUrl(
    'VITE_API_BASE',
    required('VITE_API_BASE', env.VITE_API_BASE ?? (development ? 'http://localhost:8787' : undefined)),
    development
  );

  return { publicHost, adminHost, publicInboxUrl, apiBase, development };
}

export const frontendConfig = resolveFrontendConfig(import.meta.env);

export function getHostname(): string {
  if (typeof window === 'undefined') return '';
  return window.location.hostname.toLowerCase();
}

export function isAdminHost(hostnameValue = getHostname()): boolean {
  return hostnameValue === frontendConfig.adminHost;
}

export function isLocalHost(hostnameValue = getHostname()): boolean {
  return hostnameValue === 'localhost' || hostnameValue === '127.0.0.1';
}

export function isPublicHost(hostnameValue = getHostname()): boolean {
  return hostnameValue === frontendConfig.publicHost;
}

/** Query ?admin=1 or /admin enables the admin UI only in local development. */
export function wantLocalAdmin(): boolean {
  if (!frontendConfig.development || !isLocalHost()) return false;
  try {
    return (
      new URLSearchParams(window.location.search).get('admin') === '1' ||
      window.location.pathname.startsWith('/admin')
    );
  } catch {
    return false;
  }
}

export function shouldShowAdminApp(): boolean {
  return isAdminHost() || wantLocalAdmin();
}

export function getPublicInboxUrl(): string {
  return frontendConfig.publicInboxUrl;
}
