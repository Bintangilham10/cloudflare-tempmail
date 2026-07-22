export interface Env {
  DB: D1Database;
  MESSAGE_BUCKET: R2Bucket;
  MAILBOX_RATE_LIMITER: RateLimit;
  INBOX_RATE_LIMITER: RateLimit;
  LOGIN_RATE_LIMITER: RateLimit;
  ALLOWED_ORIGINS?: string;
  ALLOWED_ADMIN_ORIGINS?: string;
  ADMIN_BOOTSTRAP_SECRET?: string;
  PUBLIC_HOST?: string;
  ADMIN_HOST?: string;
  PUBLIC_INBOX_URL?: string;
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
  snippet: string;
  attachments_json: string;
  storage_prefix: string;
  raw_object_key: string;
  is_read: number;
  created_at: string;
}

export interface EmailListRow {
  id: number;
  from_address: string;
  from_name: string | null;
  subject: string | null;
  snippet: string;
  attachment_count: number;
  is_read: number;
  created_at: string;
}

export interface AttachmentMeta {
  filename: string;
  contentType: string;
  size: number;
  objectKey: string;
}

export type SettingsMap = Record<string, string>;
