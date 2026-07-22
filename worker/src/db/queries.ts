import type {
  AttachmentMeta,
  DomainRow,
  EmailListRow,
  EmailRow,
  Env,
  MailboxRow,
  SettingsMap,
} from '../types';
import { normalizeAddress, randomLocalPart, randomToken } from '../utils/auth';

const DOMAIN_COLUMNS = 'id, domain_name, is_active, created_at';
const MAILBOX_COLUMNS =
  'id, address, local_part, domain_id, token, created_at, last_access_at';
const EMAIL_COLUMNS = `id, mailbox_id, message_id, from_address, from_name, to_address,
  subject, body_text, body_html, snippet, attachments_json, storage_prefix,
  raw_object_key, is_read, created_at`;

export async function getSettings(db: D1Database): Promise<SettingsMap> {
  const { results } = await db
    .prepare('SELECT key, value FROM admin_settings')
    .all<{ key: string; value: string }>();
  return Object.fromEntries((results || []).map((row) => [row.key, row.value]));
}

export async function getSetting(db: D1Database, key: string, fallback = ''): Promise<string> {
  const row = await db
    .prepare('SELECT value FROM admin_settings WHERE key = ?')
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? fallback;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO admin_settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    )
    .bind(key, value)
    .run();
}

export async function listActiveDomains(db: D1Database): Promise<DomainRow[]> {
  const { results } = await db
    .prepare(`SELECT ${DOMAIN_COLUMNS} FROM domains WHERE is_active = 1 ORDER BY domain_name ASC`)
    .all<DomainRow>();
  return results || [];
}

export async function listAllDomains(db: D1Database): Promise<DomainRow[]> {
  const { results } = await db
    .prepare(`SELECT ${DOMAIN_COLUMNS} FROM domains ORDER BY created_at DESC`)
    .all<DomainRow>();
  return results || [];
}

export async function getDomainByName(db: D1Database, domainName: string): Promise<DomainRow | null> {
  return db
    .prepare(`SELECT ${DOMAIN_COLUMNS} FROM domains WHERE domain_name = ? COLLATE NOCASE`)
    .bind(domainName.toLowerCase())
    .first<DomainRow>();
}

export async function createDomain(db: D1Database, domainName: string): Promise<DomainRow> {
  const result = await db
    .prepare('INSERT INTO domains (domain_name, is_active) VALUES (?, 1)')
    .bind(domainName.trim().toLowerCase())
    .run();
  const row = await db
    .prepare(`SELECT ${DOMAIN_COLUMNS} FROM domains WHERE id = ?`)
    .bind(result.meta.last_row_id)
    .first<DomainRow>();
  if (!row) throw new Error('Failed to create domain');
  return row;
}

export async function deleteDomain(db: D1Database, id: number): Promise<boolean> {
  const result = await db
    .prepare(
      `DELETE FROM domains
       WHERE id = ? AND NOT EXISTS (SELECT 1 FROM mailboxes WHERE domain_id = domains.id)`
    )
    .bind(id)
    .run();
  return (result.meta.changes || 0) > 0;
}

export async function setDomainActive(db: D1Database, id: number, active: boolean): Promise<boolean> {
  const result = await db
    .prepare('UPDATE domains SET is_active = ? WHERE id = ?')
    .bind(active ? 1 : 0, id)
    .run();
  return (result.meta.changes || 0) > 0;
}

export async function getMailboxByAddress(db: D1Database, address: string): Promise<MailboxRow | null> {
  return db
    .prepare(`SELECT ${MAILBOX_COLUMNS} FROM mailboxes WHERE address = ? COLLATE NOCASE`)
    .bind(address.toLowerCase())
    .first<MailboxRow>();
}

export async function getActiveMailboxByAddress(
  db: D1Database,
  address: string
): Promise<MailboxRow | null> {
  return db
    .prepare(
      `SELECT ${MAILBOX_COLUMNS.split(', ').map((column) => `m.${column}`).join(', ')}
       FROM mailboxes m JOIN domains d ON d.id = m.domain_id
       WHERE m.address = ? COLLATE NOCASE AND d.is_active = 1`
    )
    .bind(address.toLowerCase())
    .first<MailboxRow>();
}

export async function touchMailboxIfStale(db: D1Database, mailbox: MailboxRow): Promise<void> {
  const lastAccess = Date.parse(`${mailbox.last_access_at.replace(' ', 'T')}Z`);
  if (Number.isFinite(lastAccess) && Date.now() - lastAccess < 60 * 60 * 1000) return;
  await db
    .prepare("UPDATE mailboxes SET last_access_at = datetime('now') WHERE id = ?")
    .bind(mailbox.id)
    .run();
}

export async function createMailbox(
  db: D1Database,
  opts: { localPart?: string; domainName?: string }
): Promise<MailboxRow> {
  const domains = await listActiveDomains(db);
  if (!domains.length) throw new Error('NO_DOMAINS');
  const domain = opts.domainName
    ? domains.find((row) => row.domain_name.toLowerCase() === opts.domainName!.toLowerCase())
    : domains[Math.floor(Math.random() * domains.length)];
  if (!domain) throw new Error('DOMAIN_NOT_FOUND');

  let localPart = (opts.localPart || randomLocalPart(10)).trim().toLowerCase();
  for (let attempt = 0; attempt < 5; attempt++) {
    const address = normalizeAddress(localPart, domain.domain_name);
    if (!(await getMailboxByAddress(db, address))) {
      try {
        const result = await db
          .prepare('INSERT INTO mailboxes (address, local_part, domain_id, token) VALUES (?, ?, ?, ?)')
          .bind(address, localPart, domain.id, randomToken(24))
          .run();
        const row = await db
          .prepare(`SELECT ${MAILBOX_COLUMNS} FROM mailboxes WHERE id = ?`)
          .bind(result.meta.last_row_id)
          .first<MailboxRow>();
        if (row) return row;
      } catch (error) {
        if (opts.localPart || !String(error).toLowerCase().includes('unique')) throw error;
      }
    }
    if (opts.localPart) throw new Error('ADDRESS_TAKEN');
    localPart = randomLocalPart(10);
  }
  throw new Error('ADDRESS_TAKEN');
}

interface EmailStorageRow {
  id: number;
  raw_object_key: string;
  attachments_json: string;
}

function parseAttachments(raw: string): AttachmentMeta[] {
  try {
    const value = JSON.parse(raw) as AttachmentMeta[];
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function storageKeys(row: EmailStorageRow): string[] {
  return [
    row.raw_object_key,
    ...parseAttachments(row.attachments_json).map((attachment) => attachment.objectKey),
  ].filter(Boolean);
}

async function deleteStorageRows(env: Env, rows: EmailStorageRow[]): Promise<void> {
  const keys = [...new Set(rows.flatMap(storageKeys))];
  if (keys.length) await env.MESSAGE_BUCKET.delete(keys);
  if (rows.length) {
    const placeholders = rows.map(() => '?').join(', ');
    await env.DB
      .prepare(`DELETE FROM emails WHERE id IN (${placeholders})`)
      .bind(...rows.map((row) => row.id))
      .run();
  }
}

export async function deleteMailbox(env: Env, address: string): Promise<boolean> {
  const mailbox = await getMailboxByAddress(env.DB, address);
  if (!mailbox) return false;
  while (true) {
    const { results } = await env.DB
      .prepare(
        'SELECT id, raw_object_key, attachments_json FROM emails WHERE mailbox_id = ? LIMIT 50'
      )
      .bind(mailbox.id)
      .all<EmailStorageRow>();
    const rows = results || [];
    if (!rows.length) break;
    await deleteStorageRows(env, rows);
  }
  const result = await env.DB.prepare('DELETE FROM mailboxes WHERE id = ?').bind(mailbox.id).run();
  return (result.meta.changes || 0) > 0;
}

export async function insertEmail(
  db: D1Database,
  mailboxId: number,
  data: {
    messageId: string | null;
    fromAddress: string;
    fromName: string | null;
    toAddress: string;
    subject: string;
    bodyText: string;
    bodyHtml: string;
    snippet: string;
    storagePrefix: string;
    rawObjectKey: string;
    attachments: AttachmentMeta[];
  }
): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO emails (
        mailbox_id, message_id, from_address, from_name, to_address, subject,
        body_text, body_html, snippet, attachments_json, storage_prefix, raw_object_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      mailboxId,
      data.messageId,
      data.fromAddress,
      data.fromName,
      data.toAddress,
      data.subject,
      data.bodyText,
      data.bodyHtml,
      data.snippet,
      JSON.stringify(data.attachments),
      data.storagePrefix,
      data.rawObjectKey
    )
    .run();
  return Number(result.meta.last_row_id);
}

export async function listEmails(
  db: D1Database,
  mailboxId: number,
  options: { limit?: number; cursor?: number; since?: string } = {}
): Promise<EmailListRow[]> {
  const limit = Math.max(1, Math.min(50, options.limit || 25));
  const clauses = ['mailbox_id = ?'];
  const bindings: Array<string | number> = [mailboxId];
  if (options.cursor) {
    clauses.push('id < ?');
    bindings.push(options.cursor);
  }
  if (options.since) {
    clauses.push('created_at > ?');
    bindings.push(options.since);
  }
  bindings.push(limit);
  const { results } = await db
    .prepare(
      `SELECT id, from_address, from_name, subject, snippet,
        json_array_length(attachments_json) AS attachment_count, is_read, created_at
       FROM emails WHERE ${clauses.join(' AND ')}
       ORDER BY id DESC LIMIT ?`
    )
    .bind(...bindings)
    .all<EmailListRow>();
  return results || [];
}

export async function getEmail(
  db: D1Database,
  mailboxId: number,
  emailId: number
): Promise<EmailRow | null> {
  return db
    .prepare(`SELECT ${EMAIL_COLUMNS} FROM emails WHERE id = ? AND mailbox_id = ?`)
    .bind(emailId, mailboxId)
    .first<EmailRow>();
}

export async function markEmailRead(db: D1Database, emailId: number): Promise<void> {
  await db.prepare('UPDATE emails SET is_read = 1 WHERE id = ? AND is_read = 0').bind(emailId).run();
}

export async function getStats(db: D1Database) {
  const [domains, mailboxes, emails] = await db.batch<{ c: number }>([
    db.prepare('SELECT COUNT(*) AS c FROM domains'),
    db.prepare('SELECT COUNT(*) AS c FROM mailboxes'),
    db.prepare('SELECT COUNT(*) AS c FROM emails'),
  ]);
  return {
    domains: domains.results?.[0]?.c ?? 0,
    mailboxes: mailboxes.results?.[0]?.c ?? 0,
    emails: emails.results?.[0]?.c ?? 0,
  };
}

export async function cleanupExpired(
  env: Env,
  ttlHours: number,
  batchSize = 50
): Promise<{ emails: number; mailboxes: number }> {
  const hours = Math.max(1, Math.min(ttlHours, 720));
  const limit = Math.max(1, Math.min(batchSize, 50));
  const { results } = await env.DB
    .prepare(
      `SELECT id, raw_object_key, attachments_json FROM emails
       WHERE created_at < datetime('now', ?) ORDER BY id ASC LIMIT ?`
    )
    .bind(`-${hours} hours`, limit)
    .all<EmailStorageRow>();
  const expiredEmails = results || [];
  await deleteStorageRows(env, expiredEmails);
  const mailboxResult = await env.DB
    .prepare(
      `DELETE FROM mailboxes WHERE id IN (
        SELECT m.id FROM mailboxes m
        WHERE m.created_at < datetime('now', ?)
          AND NOT EXISTS (SELECT 1 FROM emails e WHERE e.mailbox_id = m.id)
        ORDER BY m.id ASC LIMIT ?
      )`
    )
    .bind(`-${hours} hours`, limit)
    .run();
  await env.DB
    .prepare("DELETE FROM admin_sessions WHERE expires_at <= unixepoch('now')")
    .run();
  return {
    emails: expiredEmails.length,
    mailboxes: mailboxResult.meta.changes || 0,
  };
}

export function publicMailbox(mailbox: MailboxRow) {
  return {
    id: mailbox.id,
    address: mailbox.address,
    token: mailbox.token,
    created_at: mailbox.created_at,
  };
}

export function publicEmailListItem(row: EmailListRow) {
  return {
    id: row.id,
    from_address: row.from_address,
    from_name: row.from_name,
    subject: row.subject,
    snippet: row.snippet,
    has_attachments: row.attachment_count > 0,
    attachment_count: row.attachment_count,
    is_read: Boolean(row.is_read),
    created_at: row.created_at,
  };
}

export function publicEmailDetail(row: EmailRow) {
  const attachments = parseAttachments(row.attachments_json);
  return {
    id: row.id,
    from_address: row.from_address,
    from_name: row.from_name,
    to_address: row.to_address,
    subject: row.subject,
    body_text: row.body_text,
    body_html: row.body_html,
    is_read: Boolean(row.is_read),
    created_at: row.created_at,
    attachments: attachments.map((attachment, index) => ({
      index,
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: attachment.size,
      has_content: Boolean(attachment.objectKey),
    })),
  };
}

export type { Env };
