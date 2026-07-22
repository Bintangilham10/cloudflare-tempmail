import { Hono, type Context } from 'hono';
import type { AttachmentMeta, Env } from '../types';
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
  touchMailboxIfStale,
} from '../db/queries';
import {
  isReservedLocalPart,
  isValidDomain,
  isValidLocalPart,
} from '../utils/auth';
import { secretsEqual, sha256Hex } from '../utils/admin-session';
import { getClientIp } from '../utils/rate-limit';
import { fail, ok } from '../utils/response';

type AppEnv = { Bindings: Env };
type AppContext = Context<AppEnv>;

function mailboxToken(c: AppContext): string {
  return c.req.header('X-Mailbox-Token') || '';
}

function rateLimited(c: AppContext, retryAfter = 60): Response {
  const response = fail(c, 'Too many requests', 429, 'RATE_LIMITED');
  response.headers.set('Retry-After', String(retryAfter));
  return response;
}

async function checkRateLimit(
  c: AppContext,
  binding: RateLimit,
  key: string
): Promise<Response | null> {
  try {
    return (await binding.limit({ key })).success ? null : rateLimited(c);
  } catch {
    return fail(c, 'Rate limiter unavailable', 503, 'DEPENDENCY_UNAVAILABLE');
  }
}

async function requireMailbox(c: AppContext, encodedAddress: string, countRead = true) {
  let address: string;
  try {
    address = decodeURIComponent(encodedAddress).toLowerCase();
  } catch {
    return { error: fail(c, 'Invalid mailbox address', 400, 'INVALID_ADDRESS') as Response };
  }
  const mailbox = await getMailboxByAddress(c.env.DB, address);
  if (!mailbox) return { error: fail(c, 'Mailbox not found', 404, 'MAILBOX_NOT_FOUND') as Response };
  const token = mailboxToken(c);
  if (!token || !(await secretsEqual(token, mailbox.token))) {
    return { error: fail(c, 'Invalid or missing mailbox token', 401, 'UNAUTHORIZED') as Response };
  }
  if (countRead) {
    const rateLimitError = await checkRateLimit(
      c,
      c.env.INBOX_RATE_LIMITER,
      `mailbox:${await sha256Hex(token)}`
    );
    if (rateLimitError) return { error: rateLimitError };
  }
  await touchMailboxIfStale(c.env.DB, mailbox);
  return { mailbox };
}

function parseAttachments(value: string): AttachmentMeta[] {
  try {
    const parsed = JSON.parse(value) as AttachmentMeta[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeFilename(value: string, fallback: string): string {
  const normalized = value.replace(/[\r\n"\\/]/g, '_').trim().slice(0, 180);
  return normalized || fallback;
}

function safeDownloadContentType(value: string): string {
  const normalized = value.toLowerCase().split(';', 1)[0].trim();
  const allowed = new Set([
    'application/octet-stream',
    'application/pdf',
    'application/zip',
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/webp',
    'text/csv',
    'text/plain',
  ]);
  return allowed.has(normalized) ? normalized : 'application/octet-stream';
}

export const publicApi = new Hono<AppEnv>();

publicApi.get('/domains', async (c) => {
  const domains = await listActiveDomains(c.env.DB);
  return ok(
    c,
    domains.map(({ id, domain_name }) => ({ id, domain_name }))
  );
});

publicApi.post('/mailbox', async (c) => {
  const rateLimitError = await checkRateLimit(
    c,
    c.env.MAILBOX_RATE_LIMITER,
    `create:${getClientIp(c)}`
  );
  if (rateLimitError) return rateLimitError;

  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
  const domain = typeof body.domain === 'string' ? body.domain.trim().toLowerCase() : '';
  if (username && !isValidLocalPart(username)) {
    return fail(c, 'Invalid username format', 400, 'INVALID_USERNAME');
  }
  if (username && isReservedLocalPart(username)) {
    return fail(c, 'Address is reserved', 400, 'RESERVED_ADDRESS');
  }
  if (domain && !isValidDomain(domain)) {
    return fail(c, 'Invalid domain format', 400, 'INVALID_DOMAIN');
  }

  try {
    return ok(
      c,
      publicMailbox(
        await createMailbox(c.env.DB, {
          localPart: username || undefined,
          domainName: domain || undefined,
        })
      ),
      201
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : 'ERROR';
    if (code === 'NO_DOMAINS') return fail(c, 'No active domains configured', 503, code);
    if (code === 'DOMAIN_NOT_FOUND') return fail(c, 'Domain not available', 400, code);
    if (code === 'ADDRESS_TAKEN') return fail(c, 'Address already in use', 409, code);
    return fail(c, 'Failed to create mailbox', 500);
  }
});

publicApi.get('/mailbox/:address', async (c) => {
  const result = await requireMailbox(c, c.req.param('address'));
  if ('error' in result) return result.error;
  return ok(c, {
    id: result.mailbox.id,
    address: result.mailbox.address,
    created_at: result.mailbox.created_at,
  });
});

publicApi.delete('/mailbox/:address', async (c) => {
  const result = await requireMailbox(c, c.req.param('address'), false);
  if ('error' in result) return result.error;
  await deleteMailbox(c.env, result.mailbox.address);
  return ok(c, { deleted: true });
});

publicApi.get('/mailbox/:address/emails', async (c) => {
  const result = await requireMailbox(c, c.req.param('address'));
  if ('error' in result) return result.error;
  const cursor = c.req.query('cursor') ? Number(c.req.query('cursor')) : undefined;
  const requestedLimit = c.req.query('limit') ? Number(c.req.query('limit')) : 25;
  const since = c.req.query('since');
  if (cursor != null && (!Number.isSafeInteger(cursor) || cursor < 1)) {
    return fail(c, 'Invalid cursor', 400, 'INVALID_CURSOR');
  }
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
    return fail(c, 'Invalid limit', 400, 'INVALID_LIMIT');
  }
  if (since && (since.length > 64 || Number.isNaN(Date.parse(since)))) {
    return fail(c, 'Invalid since timestamp', 400, 'INVALID_SINCE');
  }
  const limit = Math.min(requestedLimit, 50);
  const emails = await listEmails(c.env.DB, result.mailbox.id, { limit, cursor, since });
  return ok(c, {
    address: result.mailbox.address,
    emails: emails.map(publicEmailListItem),
    count: emails.length,
    next_cursor: emails.length === limit ? emails.at(-1)?.id ?? null : null,
  });
});

publicApi.get('/mailbox/:address/emails/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id < 1) return fail(c, 'Invalid email id', 400);
  const result = await requireMailbox(c, c.req.param('address'));
  if ('error' in result) return result.error;
  const email = await getEmail(c.env.DB, result.mailbox.id, id);
  if (!email) return fail(c, 'Email not found', 404, 'EMAIL_NOT_FOUND');
  await markEmailRead(c.env.DB, email.id);
  return ok(c, publicEmailDetail(email));
});

publicApi.get('/mailbox/:address/emails/:id/raw', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id < 1) return fail(c, 'Invalid email id', 400);
  const result = await requireMailbox(c, c.req.param('address'));
  if ('error' in result) return result.error;
  const email = await getEmail(c.env.DB, result.mailbox.id, id);
  if (!email) return fail(c, 'Email not found', 404, 'EMAIL_NOT_FOUND');
  const object = await c.env.MESSAGE_BUCKET.get(email.raw_object_key);
  if (!object) return fail(c, 'Raw email is unavailable', 410, 'CONTENT_UNAVAILABLE');
  return new Response(object.body, {
    headers: {
      'Content-Type': 'message/rfc822',
      'Content-Disposition': `attachment; filename="email-${email.id}.eml"`,
      'Content-Length': String(object.size),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
});

publicApi.get('/mailbox/:address/emails/:id/attachments/:idx', async (c) => {
  const id = Number(c.req.param('id'));
  const index = Number(c.req.param('idx'));
  if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(index) || index < 0) {
    return fail(c, 'Invalid params', 400);
  }
  const result = await requireMailbox(c, c.req.param('address'));
  if ('error' in result) return result.error;
  const email = await getEmail(c.env.DB, result.mailbox.id, id);
  if (!email) return fail(c, 'Email not found', 404, 'EMAIL_NOT_FOUND');
  const attachment = parseAttachments(email.attachments_json)[index];
  if (!attachment?.objectKey) {
    return fail(c, 'Attachment not found', 404, 'ATTACHMENT_NOT_FOUND');
  }
  const object = await c.env.MESSAGE_BUCKET.get(attachment.objectKey);
  if (!object) return fail(c, 'Attachment is unavailable', 410, 'CONTENT_UNAVAILABLE');
  const filename = safeFilename(attachment.filename, 'attachment.bin');
  return new Response(object.body, {
    headers: {
      'Content-Type': safeDownloadContentType(attachment.contentType),
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(object.size),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
});
