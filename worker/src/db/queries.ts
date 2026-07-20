import type {
  AttachmentMeta,
  DomainRow,
  EmailRow,
  Env,
  MailboxRow,
  SettingsMap,
} from '../types';
import { normalizeAddress, randomLocalPart, randomToken } from '../utils/auth';

export async function getSettings(db: D1Database): Promise<SettingsMap> {
  const { results } = await db.prepare('SELECT key, value FROM admin_settings').all<{
    key: string;
    value: string;
  }>();
  const map: SettingsMap = {};
  for (const row of results || []) map[row.key] = row.value;
  return map;
}

export async function getSetting(db: D1Database, key: string, fallback = ''): Promise<string> {
  const row = await db.prepare('SELECT value FROM admin_settings WHERE key = ?').bind(key).first<{ value: string }>();
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
    .prepare('SELECT * FROM domains WHERE is_active = 1 ORDER BY domain_name ASC')
    .all<DomainRow>();
  return results || [];
}

export async function listAllDomains(db: D1Database): Promise<DomainRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM domains ORDER BY created_at DESC')
    .all<DomainRow>();
  return results || [];
}

export async function getDomainByName(db: D1Database, domainName: string): Promise<DomainRow | null> {
  return db
    .prepare('SELECT * FROM domains WHERE domain_name = ? COLLATE NOCASE')
    .bind(domainName.toLowerCase())
    .first<DomainRow>();
}

export async function createDomain(db: D1Database, domainName: string): Promise<DomainRow> {
  const name = domainName.trim().toLowerCase();
  const result = await db
    .prepare('INSERT INTO domains (domain_name, is_active) VALUES (?, 1)')
    .bind(name)
    .run();
  const id = result.meta.last_row_id;
  const row = await db.prepare('SELECT * FROM domains WHERE id = ?').bind(id).first<DomainRow>();
  if (!row) throw new Error('Failed to create domain');
  return row;
}

export async function deleteDomain(db: D1Database, id: number): Promise<boolean> {
  const result = await db.prepare('DELETE FROM domains WHERE id = ?').bind(id).run();
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
    .prepare('SELECT * FROM mailboxes WHERE address = ? COLLATE NOCASE')
    .bind(address.toLowerCase())
    .first<MailboxRow>();
}

export async function touchMailbox(db: D1Database, id: number): Promise<void> {
  await db
    .prepare(`UPDATE mailboxes SET last_access_at = datetime('now') WHERE id = ?`)
    .bind(id)
    .run();
}

export async function createMailbox(
  db: D1Database,
  opts: { localPart?: string; domainName?: string }
): Promise<MailboxRow> {
  const domains = await listActiveDomains(db);
  if (!domains.length) {
    throw new Error('NO_DOMAINS');
  }

  let domain: DomainRow | undefined;
  if (opts.domainName) {
    domain = domains.find((d) => d.domain_name.toLowerCase() === opts.domainName!.toLowerCase());
    if (!domain) throw new Error('DOMAIN_NOT_FOUND');
  } else {
    domain = domains[Math.floor(Math.random() * domains.length)];
  }

  let local = (opts.localPart || randomLocalPart(10)).trim().toLowerCase();
  // Ensure uniqueness with a few retries
  for (let i = 0; i < 5; i++) {
    const address = normalizeAddress(local, domain.domain_name);
    const existing = await getMailboxByAddress(db, address);
    if (!existing) {
      const token = randomToken(24);
      const result = await db
        .prepare(
          `INSERT INTO mailboxes (address, local_part, domain_id, token)
           VALUES (?, ?, ?, ?)`
        )
        .bind(address, local, domain.id, token)
        .run();
      const row = await db
        .prepare('SELECT * FROM mailboxes WHERE id = ?')
        .bind(result.meta.last_row_id)
        .first<MailboxRow>();
      if (!row) throw new Error('Failed to create mailbox');
      return row;
    }
    if (opts.localPart) throw new Error('ADDRESS_TAKEN');
    local = randomLocalPart(10);
  }
  throw new Error('ADDRESS_TAKEN');
}

export async function getOrCreateMailbox(
  db: D1Database,
  localPart: string,
  domainName: string
): Promise<MailboxRow | null> {
  const domain = await getDomainByName(db, domainName);
  if (!domain || !domain.is_active) return null;

  const address = normalizeAddress(localPart, domain.domain_name);
  const existing = await getMailboxByAddress(db, address);
  if (existing) return existing;

  const token = randomToken(24);
  const result = await db
    .prepare(
      `INSERT INTO mailboxes (address, local_part, domain_id, token)
       VALUES (?, ?, ?, ?)`
    )
    .bind(address, localPart.toLowerCase(), domain.id, token)
    .run();

  return db
    .prepare('SELECT * FROM mailboxes WHERE id = ?')
    .bind(result.meta.last_row_id)
    .first<MailboxRow>();
}

export async function deleteMailbox(db: D1Database, address: string): Promise<boolean> {
  const box = await getMailboxByAddress(db, address);
  if (!box) return false;
  await db.prepare('DELETE FROM emails WHERE mailbox_id = ?').bind(box.id).run();
  const result = await db.prepare('DELETE FROM mailboxes WHERE id = ?').bind(box.id).run();
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
    rawEml: string;
    attachments: AttachmentMeta[];
  }
): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO emails (
        mailbox_id, message_id, from_address, from_name, to_address,
        subject, body_text, body_html, raw_eml, attachments_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      data.rawEml,
      JSON.stringify(data.attachments)
    )
    .run();
  return Number(result.meta.last_row_id);
}

export async function listEmails(db: D1Database, mailboxId: number, limit = 50): Promise<EmailRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM emails WHERE mailbox_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .bind(mailboxId, limit)
    .all<EmailRow>();
  return results || [];
}

export async function getEmail(db: D1Database, mailboxId: number, emailId: number): Promise<EmailRow | null> {
  return db
    .prepare('SELECT * FROM emails WHERE id = ? AND mailbox_id = ?')
    .bind(emailId, mailboxId)
    .first<EmailRow>();
}

export async function markEmailRead(db: D1Database, emailId: number): Promise<void> {
  await db.prepare('UPDATE emails SET is_read = 1 WHERE id = ?').bind(emailId).run();
}

export async function getStats(db: D1Database) {
  const domains = await db.prepare('SELECT COUNT(*) as c FROM domains').first<{ c: number }>();
  const mailboxes = await db.prepare('SELECT COUNT(*) as c FROM mailboxes').first<{ c: number }>();
  const emails = await db.prepare('SELECT COUNT(*) as c FROM emails').first<{ c: number }>();
  return {
    domains: domains?.c ?? 0,
    mailboxes: mailboxes?.c ?? 0,
    emails: emails?.c ?? 0,
  };
}

export async function cleanupExpired(db: D1Database, ttlHours: number): Promise<{ emails: number; mailboxes: number }> {
  const hours = Math.max(1, Math.min(ttlHours, 720));
  const emailRes = await db
    .prepare(`DELETE FROM emails WHERE created_at < datetime('now', ?)`)
    .bind(`-${hours} hours`)
    .run();
  const boxRes = await db
    .prepare(`DELETE FROM mailboxes WHERE created_at < datetime('now', ?)`)
    .bind(`-${hours} hours`)
    .run();
  return {
    emails: emailRes.meta.changes || 0,
    mailboxes: boxRes.meta.changes || 0,
  };
}

export function publicMailbox(box: MailboxRow) {
  return {
    id: box.id,
    address: box.address,
    token: box.token,
    created_at: box.created_at,
  };
}

export function publicEmailListItem(row: EmailRow) {
  let attachments: AttachmentMeta[] = [];
  try {
    attachments = JSON.parse(row.attachments_json || '[]');
  } catch {
    attachments = [];
  }
  const snippetSource = row.body_text || row.body_html || '';
  const plain = snippetSource
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    id: row.id,
    from_address: row.from_address,
    from_name: row.from_name,
    subject: row.subject,
    snippet: plain.slice(0, 140),
    has_attachments: attachments.length > 0,
    attachment_count: attachments.length,
    is_read: !!row.is_read,
    created_at: row.created_at,
  };
}

export function publicEmailDetail(row: EmailRow) {
  let attachments: AttachmentMeta[] = [];
  try {
    attachments = JSON.parse(row.attachments_json || '[]');
  } catch {
    attachments = [];
  }
  return {
    id: row.id,
    from_address: row.from_address,
    from_name: row.from_name,
    to_address: row.to_address,
    subject: row.subject,
    body_text: row.body_text,
    body_html: row.body_html,
    is_read: !!row.is_read,
    created_at: row.created_at,
    attachments: attachments.map((a, index) => ({
      index,
      filename: a.filename,
      contentType: a.contentType,
      size: a.size,
      // content only via download endpoint
      has_content: !!a.contentBase64,
    })),
  };
}

export type { Env };