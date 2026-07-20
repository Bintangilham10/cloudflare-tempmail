export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS?: string;
  /** Comma-separated origins allowed to call admin auth APIs (login/setup). */
  ALLOWED_ADMIN_ORIGINS?: string;
  ADMIN_BOOTSTRAP_SECRET?: string;
}

export interface DomainRow {
  id: number;
  domain_name: string;
  is_active: number;
  created_at: string;
}

export interface MailboxRow {
  id: number;
  address: string;
  local_part: string;
  domain_id: number;
  token: string;
  created_at: string;
  last_access_at: string;
}

export interface EmailRow {
  id: number;
  mailbox_id: number;
  message_id: string | null;
  from_address: string;
  from_name: string | null;
  to_address: string;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  raw_eml: string | null;
  attachments_json: string;
  is_read: number;
  created_at: string;
}

export interface AttachmentMeta {
  filename: string;
  contentType: string;
  size: number;
  contentBase64: string;
}

export interface AdminSession {
  token: string;
  expiresAt: number;
}

export type SettingsMap = Record<string, string>;