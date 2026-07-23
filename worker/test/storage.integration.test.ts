import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import {
  cleanupExpired,
  createDomain,
  createMailbox,
  listEmails,
} from '../src/db/queries';
import { handleInboundEmail } from '../src/handlers/inbound';
import type { AttachmentMeta, EmailRow } from '../src/types';

const publicOrigin = 'https://mail.example.test';

function inboundMessage(rawSource: string, recipient: string) {
  const bytes = new TextEncoder().encode(rawSource);
  let rejection: string | null = null;
  const message = {
    from: 'sender@example.net',
    to: recipient,
    rawSize: bytes.byteLength,
    headers: new Headers(),
    raw: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    setReject(reason: string) {
      rejection = reason;
    },
    forward: async () => undefined,
    reply: async () => undefined,
  } as unknown as ForwardableEmailMessage;
  return { message, rejection: () => rejection };
}

function sampleEmail(recipient: string): string {
  return [
    'From: Sender <sender@example.net>',
    `To: ${recipient}`,
    'Subject: R2 storage smoke test',
    'Message-ID: <storage-test@example.net>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="test-boundary"',
    '',
    '--test-boundary',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Hello from the plain text body.',
    '--test-boundary',
    'Content-Type: text/plain; name="hello.txt"',
    'Content-Disposition: attachment; filename="hello.txt"',
    'Content-Transfer-Encoding: base64',
    '',
    'aGVsbG8gZnJvbSBSMg==',
    '--test-boundary--',
    '',
  ].join('\r\n');
}

async function createTestMailbox(localPart = 'smoke') {
  await createDomain(env.DB, 'example.test');
  return createMailbox(env.DB, { localPart, domainName: 'example.test' });
}

describe('R2 message storage', () => {
  it('stores raw EML and attachments in R2 while D1 keeps metadata only', async () => {
    const mailbox = await createTestMailbox();
    const inbound = inboundMessage(sampleEmail(mailbox.address), mailbox.address);
    await handleInboundEmail(inbound.message, env);

    expect(inbound.rejection()).toBeNull();
    const row = await env.DB.prepare(
      'SELECT id, raw_object_key, attachments_json FROM emails WHERE mailbox_id = ?'
    )
      .bind(mailbox.id)
      .first<Pick<EmailRow, 'id' | 'raw_object_key' | 'attachments_json'>>();
    expect(row).not.toBeNull();
    expect(row?.raw_object_key).toMatch(/\/raw\.eml$/);

    const columns = await env.DB.prepare('PRAGMA table_info(emails)').all<{ name: string }>();
    expect(columns.results.map((column) => column.name)).not.toContain('raw_eml');

    const attachments = JSON.parse(row?.attachments_json || '[]') as AttachmentMeta[];
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).not.toHaveProperty('contentBase64');
    expect(await (await env.MESSAGE_BUCKET.get(row!.raw_object_key))?.text()).toContain(
      'R2 storage smoke test'
    );
    expect(await (await env.MESSAGE_BUCKET.get(attachments[0].objectKey))?.text()).toBe(
      'hello from R2'
    );

    const listed = await listEmails(env.DB, mailbox.id);
    expect(listed[0]).not.toHaveProperty('body_text');
    expect(listed[0]).not.toHaveProperty('body_html');
    expect(listed[0]).not.toHaveProperty('attachments_json');

    const attachmentResponse = await exports.default.fetch(
      `https://api.example.test/api/mailbox/${encodeURIComponent(mailbox.address)}/emails/${row!.id}/attachments/0`,
      {
        headers: {
          Origin: publicOrigin,
          'X-Mailbox-Token': mailbox.token,
        },
      }
    );
    expect(attachmentResponse.status).toBe(200);
    expect(attachmentResponse.headers.get('Content-Disposition')).toContain('attachment;');
    expect(attachmentResponse.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await attachmentResponse.text()).toBe('hello from R2');
  });

  it('rejects unknown recipients without auto-creating a mailbox', async () => {
    await createDomain(env.DB, 'example.test');
    const inbound = inboundMessage(sampleEmail('unknown@example.test'), 'unknown@example.test');
    await handleInboundEmail(inbound.message, env);

    expect(inbound.rejection()).toBe('Recipient unavailable');
    const mailboxes = await env.DB.prepare('SELECT COUNT(*) AS count FROM mailboxes').first<{
      count: number;
    }>();
    expect(mailboxes?.count).toBe(0);
  });

  it('deletes R2 objects before expired D1 rows', async () => {
    const mailbox = await createTestMailbox('cleanup');
    await handleInboundEmail(inboundMessage(sampleEmail(mailbox.address), mailbox.address).message, env);
    const row = await env.DB.prepare(
      'SELECT id, raw_object_key, attachments_json FROM emails WHERE mailbox_id = ?'
    )
      .bind(mailbox.id)
      .first<Pick<EmailRow, 'id' | 'raw_object_key' | 'attachments_json'>>();
    const attachments = JSON.parse(row!.attachments_json) as AttachmentMeta[];
    await env.DB.prepare("UPDATE emails SET created_at = datetime('now', '-48 hours') WHERE id = ?")
      .bind(row!.id)
      .run();
    await env.DB.prepare("UPDATE mailboxes SET created_at = datetime('now', '-48 hours') WHERE id = ?")
      .bind(mailbox.id)
      .run();

    const result = await cleanupExpired(env, 24, 50);
    expect(result).toEqual({ emails: 1, mailboxes: 1 });
    expect(await env.MESSAGE_BUCKET.get(row!.raw_object_key)).toBeNull();
    expect(await env.MESSAGE_BUCKET.get(attachments[0].objectKey)).toBeNull();
    expect(await env.DB.prepare('SELECT id FROM emails WHERE id = ?').bind(row!.id).first()).toBeNull();
  });
});

describe('public API limits', () => {
  it('rejects reserved mailbox names', async () => {
    await createDomain(env.DB, 'example.test');
    const response = await exports.default.fetch('https://api.example.test/api/mailbox', {
      method: 'POST',
      headers: {
        Origin: publicOrigin,
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '192.0.2.10',
      },
      body: JSON.stringify({ username: 'admin', domain: 'example.test' }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'RESERVED_ADDRESS' },
    });
  });

  it('returns 429 after five mailbox creations per minute', async () => {
    await createDomain(env.DB, 'example.test');
    const statuses: number[] = [];
    for (let index = 0; index < 6; index++) {
      const response = await exports.default.fetch('https://api.example.test/api/mailbox', {
        method: 'POST',
        headers: {
          Origin: publicOrigin,
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '192.0.2.20',
        },
        body: JSON.stringify({ domain: 'example.test' }),
      });
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
    expect(statuses[5]).toBe(429);
  });
});
