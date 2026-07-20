import { getAdminToken, getMailbox } from './storage';
import { frontendConfig } from './hosts';

const API_BASE = frontendConfig.apiBase;

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code = 'ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface ApiSuccess<T> {
  success: true;
  data: T;
}

interface ApiFail {
  success: false;
  error: { message: string; code?: string };
}

async function request<T>(
  path: string,
  options: RequestInit & { mailboxToken?: string; admin?: boolean } = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  const mailboxToken = options.mailboxToken ?? getMailbox()?.token;
  if (mailboxToken) headers.set('X-Mailbox-Token', mailboxToken);

  if (options.admin) {
    const token = getAdminToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: options.admin ? 'include' : options.credentials,
  });

  const contentType = res.headers.get('Content-Type') || '';
  if (contentType.includes('application/json')) {
    const json = (await res.json()) as ApiSuccess<T> | ApiFail;
    if (!json.success) {
      throw new ApiError(json.error?.message || 'Request failed', res.status, json.error?.code);
    }
    return json.data;
  }

  if (!res.ok) {
    throw new ApiError(res.statusText || 'Request failed', res.status);
  }
  // non-json success (raw download handled separately)
  return undefined as T;
}

export interface Domain {
  id: number;
  domain_name: string;
  is_active?: number;
  created_at?: string;
}

export interface Mailbox {
  id: number;
  address: string;
  token: string;
  created_at: string;
}

export interface EmailListItem {
  id: number;
  from_address: string;
  from_name: string | null;
  subject: string | null;
  snippet: string;
  has_attachments: boolean;
  attachment_count: number;
  is_read: boolean;
  created_at: string;
}

export interface EmailDetail {
  id: number;
  from_address: string;
  from_name: string | null;
  to_address: string;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  is_read: boolean;
  created_at: string;
  attachments: Array<{
    index: number;
    filename: string;
    contentType: string;
    size: number;
    has_content: boolean;
  }>;
}

export const api = {
  health: () => request<{ status: string }>('/api/health'),

  listDomains: () => request<Array<{ id: number; domain_name: string }>>('/api/domains'),

  createMailbox: (payload?: { username?: string; domain?: string }) =>
    request<Mailbox>('/api/mailbox', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),

  getMailbox: (address: string, token: string) =>
    request<{ id: number; address: string; created_at: string }>(
      `/api/mailbox/${encodeURIComponent(address)}`,
      { mailboxToken: token }
    ),

  deleteMailbox: (address: string, token: string) =>
    request<{ deleted: boolean }>(`/api/mailbox/${encodeURIComponent(address)}`, {
      method: 'DELETE',
      mailboxToken: token,
    }),

  listEmails: (address: string, token: string, since?: string) =>
    request<{ address: string; emails: EmailListItem[]; count: number }>(
      `/api/mailbox/${encodeURIComponent(address)}/emails${since ? `?since=${encodeURIComponent(since)}` : ''}`,
      { mailboxToken: token }
    ),

  getEmail: (address: string, token: string, id: number) =>
    request<EmailDetail>(`/api/mailbox/${encodeURIComponent(address)}/emails/${id}`, {
      mailboxToken: token,
    }),

  rawEmailUrl: (address: string, id: number) =>
    `${API_BASE}/api/mailbox/${encodeURIComponent(address)}/emails/${id}/raw`,

  attachmentUrl: (address: string, id: number, idx: number) =>
    `${API_BASE}/api/mailbox/${encodeURIComponent(address)}/emails/${id}/attachments/${idx}`,

  // Admin
  adminStatus: () =>
    request<{ setup_completed: boolean; site_name: string; ttl_hours: number }>('/api/admin/status'),

  adminSetup: (body: {
    password: string;
    bootstrap_secret?: string;
    site_name?: string;
    ttl_hours?: number;
  }) =>
    request<{ token: string; expires_in: number }>('/api/admin/setup', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  adminLogin: (password: string) =>
    request<{ token: string; expires_in: number }>('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  adminLogout: () =>
    request<{ logged_out: boolean }>('/api/admin/logout', { method: 'POST', admin: true }),

  adminStats: () =>
    request<{
      domains: number;
      mailboxes: number;
      emails: number;
      ttl_hours: number;
      site_name: string;
    }>('/api/admin/stats', { admin: true }),

  adminSettings: () =>
    request<{ site_name: string; ttl_hours: number; max_attachment_bytes: number }>(
      '/api/admin/settings',
      { admin: true }
    ),

  adminUpdateSettings: (body: {
    site_name?: string;
    ttl_hours?: number;
    max_attachment_bytes?: number;
    new_password?: string;
  }) =>
    request<{ site_name: string; ttl_hours: number; max_attachment_bytes: number }>(
      '/api/admin/settings',
      { method: 'PUT', body: JSON.stringify(body), admin: true }
    ),

  adminDomains: () => request<Domain[]>('/api/admin/domains', { admin: true }),

  adminAddDomain: (domain_name: string) =>
    request<Domain>('/api/admin/domains', {
      method: 'POST',
      body: JSON.stringify({ domain_name }),
      admin: true,
    }),

  adminToggleDomain: (id: number, is_active: boolean) =>
    request<Domain>(`/api/admin/domains/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active }),
      admin: true,
    }),

  adminDeleteDomain: (id: number) =>
    request<{ deleted: boolean }>(`/api/admin/domains/${id}`, {
      method: 'DELETE',
      admin: true,
    }),
};

export async function downloadWithToken(url: string, filename: string, token: string) {
  const res = await fetch(url, {
    headers: { 'X-Mailbox-Token': token },
  });
  if (!res.ok) throw new ApiError('Download failed', res.status);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}
