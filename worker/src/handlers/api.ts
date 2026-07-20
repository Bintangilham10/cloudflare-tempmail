import { Hono } from 'hono';
import type { Env } from '../types';
import {
  createMailbox,
  deleteMailbox,
  getEmail,
  getMailboxByAddress,
  listActiveDomains,
  listEmails,
  markEmailRead,
  publicEmailDetail,
  publicEmailListItem,
  publicMailbox,
  touchMailbox,
} from '../db/queries';
import { isValidDomain, isValidLocalPart } from '../utils/auth';
import { fail, ok } from '../utils/response';
import type { AttachmentMeta } from '../types';

type AppEnv = { Bindings: Env };

function getMailboxToken(c: { req: { header: (n: string) => string | undefined } }): string | null {
  return c.req.header('X-Mailbox-Token') || c.req.header('x-mailbox-token') || null;
}

async function requireMailbox(c: any, address: string) {
  const box = await getMailboxByAddress(c.env.DB, decodeURIComponent(address));
  if (!box) return { error: fail(c, 'Mailbox not found', 404, 'MAILBOX_NOT_FOUND') as Response };
  const token = getMailboxToken(c);
  if (!token || token !== box.token) {
    return { error: fail(c, 'Invalid or missing mailbox token', 401, 'UNAUTHORIZED') as Response };
  }
  await touchMailbox(c.env.DB, box.id);
  return { box };
}

export const publicApi = new Hono<AppEnv>();

publicApi.get('/domains', async (c) => {
  try {
    const domains = await listActiveDomains(c.env.DB);
    return ok(
      c,
      domains.map((d) => ({
        id: d.id,
        domain_name: d.domain_name,
      }))
    );
  } catch (e) {
    console.error(e);
    return fail(c, 'Failed to list domains', 500);
  }
});

publicApi.post('/mailbox', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const domain = typeof body.domain === 'string' ? body.domain.trim() : '';

    if (username && !isValidLocalPart(username)) {
      return fail(c, 'Invalid username format', 400, 'INVALID_USERNAME');
    }
    if (domain && !isValidDomain(domain)) {
      return fail(c, 'Invalid domain format', 400, 'INVALID_DOMAIN');
    }

    const box = await createMailbox(c.env.DB, {
      localPart: username || undefined,
      domainName: domain || undefined,
    });
    return ok(c, publicMailbox(box), 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'ERROR';
    if (msg === 'NO_DOMAINS') return fail(c, 'No active domains configured', 503, 'NO_DOMAINS');
    if (msg === 'DOMAIN_NOT_FOUND') return fail(c, 'Domain not available', 400, 'DOMAIN_NOT_FOUND');
    if (msg === 'ADDRESS_TAKEN') return fail(c, 'Address already in use', 409, 'ADDRESS_TAKEN');
    console.error(e);
    return fail(c, 'Failed to create mailbox', 500);
  }
});

publicApi.get('/mailbox/:address', async (c) => {
  const address = c.req.param('address');
  const result = await requireMailbox(c, address);
  if ('error' in result && result.error) return result.error;
  return ok(c, {
    id: result.box!.id,
    address: result.box!.address,
    created_at: result.box!.created_at,
  });
});

publicApi.delete('/mailbox/:address', async (c) => {
  const address = c.req.param('address');
  const result = await requireMailbox(c, address);
  if ('error' in result && result.error) return result.error;
  await deleteMailbox(c.env.DB, result.box!.address);
  return ok(c, { deleted: true });
});

publicApi.get('/mailbox/:address/emails', async (c) => {
  const address = c.req.param('address');
  const result = await requireMailbox(c, address);
  if ('error' in result && result.error) return result.error;
  const since = c.req.query('since');
  const emails = await listEmails(c.env.DB, result.box!.id, 100);
  let filtered = emails;
  if (since) {
    filtered = emails.filter((e) => e.created_at > since);
  }
  return ok(c, {
    address: result.box!.address,
    emails: filtered.map(publicEmailListItem),
    count: filtered.length,
  });
});

publicApi.get('/mailbox/:address/emails/:id', async (c) => {
  const address = c.req.param('address');
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return fail(c, 'Invalid email id', 400);
  const result = await requireMailbox(c, address);
  if ('error' in result && result.error) return result.error;
  const email = await getEmail(c.env.DB, result.box!.id, id);
  if (!email) return fail(c, 'Email not found', 404, 'EMAIL_NOT_FOUND');
  await markEmailRead(c.env.DB, email.id);
  return ok(c, publicEmailDetail(email));
});

publicApi.get('/mailbox/:address/emails/:id/raw', async (c) => {
  const address = c.req.param('address');
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return fail(c, 'Invalid email id', 400);
  const result = await requireMailbox(c, address);
  if ('error' in result && result.error) return result.error;
  const email = await getEmail(c.env.DB, result.box!.id, id);
  if (!email) return fail(c, 'Email not found', 404, 'EMAIL_NOT_FOUND');
  const raw = email.raw_eml || buildMinimalEml(email);
  return new Response(raw, {
    status: 200,
    headers: {
      'Content-Type': 'message/rfc822',
      'Content-Disposition': `attachment; filename="email-${email.id}.eml"`,
      'Cache-Control': 'no-store',
    },
  });
});

publicApi.get('/mailbox/:address/emails/:id/attachments/:idx', async (c) => {
  const address = c.req.param('address');
  const id = Number(c.req.param('id'));
  const idx = Number(c.req.param('idx'));
  if (!Number.isFinite(id) || !Number.isFinite(idx)) return fail(c, 'Invalid params', 400);
  const result = await requireMailbox(c, address);
  if ('error' in result && result.error) return result.error;
  const email = await getEmail(c.env.DB, result.box!.id, id);
  if (!email) return fail(c, 'Email not found', 404, 'EMAIL_NOT_FOUND');

  let attachments: AttachmentMeta[] = [];
  try {
    attachments = JSON.parse(email.attachments_json || '[]');
  } catch {
    attachments = [];
  }
  const att = attachments[idx];
  if (!att) return fail(c, 'Attachment not found', 404, 'ATTACHMENT_NOT_FOUND');
  if (!att.contentBase64) {
    return fail(c, 'Attachment content unavailable (oversized or stripped)', 410, 'NO_CONTENT');
  }

  const binary = Uint8Array.from(atob(att.contentBase64), (ch) => ch.charCodeAt(0));
  const filename = att.filename.replace(/[^\w.\- ()[\]]+/g, '_') || 'attachment.bin';
  return new Response(binary, {
    status: 200,
    headers: {
      'Content-Type': att.contentType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(binary.byteLength),
      'Cache-Control': 'no-store',
    },
  });
});

function buildMinimalEml(email: {
  from_address: string;
  from_name: string | null;
  to_address: string;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  created_at: string;
}): string {
  const from = email.from_name
    ? `"${email.from_name.replace(/"/g, '')}" <${email.from_address}>`
    : email.from_address;
  const lines = [
    `From: ${from}`,
    `To: ${email.to_address}`,
    `Subject: ${email.subject || ''}`,
    `Date: ${email.created_at}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    email.body_text || stripHtml(email.body_html || '') || '',
  ];
  return lines.join('\r\n');
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
