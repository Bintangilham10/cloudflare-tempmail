/** Public inbox host(s) */
const PUBLIC_HOSTS = new Set([
  'tempmail.boslay.works',
  'localhost',
  '127.0.0.1',
]);

/** Admin panel host(s) */
const ADMIN_HOSTS = new Set([
  'admin.boslay.works',
]);

/** Canonical public inbox URL (production) */
export const PUBLIC_INBOX_URL = 'https://tempmail.boslay.works';

export function getHostname(): string {
  if (typeof window === 'undefined') return '';
  return window.location.hostname.toLowerCase();
}

export function isAdminHost(hostname = getHostname()): boolean {
  if (ADMIN_HOSTS.has(hostname)) return true;
  // Local dev: /admin path still works on localhost
  if (hostname === 'localhost' || hostname === '127.0.0.1') return false;
  return false;
}

export function isLocalHost(hostname = getHostname()): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

export function isPublicHost(hostname = getHostname()): boolean {
  return PUBLIC_HOSTS.has(hostname) || isLocalHost(hostname);
}

/** Query ?admin=1 on localhost enables admin UI during development */
export function wantLocalAdmin(): boolean {
  if (!isLocalHost()) return false;
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

/** URL for opening the public inbox from admin UI */
export function getPublicInboxUrl(): string {
  if (isLocalHost()) {
    return `${window.location.protocol}//${window.location.host}/`;
  }
  return PUBLIC_INBOX_URL;
}
