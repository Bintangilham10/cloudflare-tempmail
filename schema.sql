-- Tempmail D1 Schema
-- Run: wrangler d1 execute tempmail --file=./schema.sql

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS admin_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS domains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mailboxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT NOT NULL UNIQUE COLLATE NOCASE,
  local_part TEXT NOT NULL,
  domain_id INTEGER NOT NULL,
  token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_access_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mailbox_id INTEGER NOT NULL,
  message_id TEXT,
  from_address TEXT NOT NULL,
  from_name TEXT,
  to_address TEXT NOT NULL,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  raw_eml TEXT,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_domains_name ON domains(domain_name);
CREATE INDEX IF NOT EXISTS idx_domains_active ON domains(is_active);
CREATE INDEX IF NOT EXISTS idx_mailboxes_address ON mailboxes(address);
CREATE INDEX IF NOT EXISTS idx_mailboxes_created ON mailboxes(created_at);
CREATE INDEX IF NOT EXISTS idx_emails_mailbox_created ON emails(mailbox_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_created ON emails(created_at);

-- Default settings
INSERT OR IGNORE INTO admin_settings (key, value) VALUES
  ('ttl_hours', '24'),
  ('site_name', 'Tempmail'),
  ('max_attachment_bytes', '2097152'),
  ('setup_completed', '0');