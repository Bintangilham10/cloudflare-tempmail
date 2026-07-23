import PostalMime from 'postal-mime';

export const MAX_RAW_EMAIL_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENT_COUNT = 10;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_BODY_BYTES = 256 * 1024;

export class EmailLimitError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'EmailLimitError';
  }
}

export interface ParsedAttachment {
  filename: string;
  contentType: string;
  size: number;
  content: Uint8Array;
}

export interface ParsedInbound {
  messageId: string | null;
  fromAddress: string;
  fromName: string | null;
  toAddress: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  attachments: ParsedAttachment[];
}

function attachmentBytes(content: unknown): Uint8Array {
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  if (content instanceof Uint8Array) return content;
  return content == null ? new Uint8Array() : new TextEncoder().encode(String(content));
}

export function truncateUtf8(value: string, maxBytes: number): string {
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= maxBytes) return value;
  return new TextDecoder('utf-8', { fatal: false, ignoreBOM: false }).decode(
    encoded.subarray(0, maxBytes)
  );
}

export async function parseRawEmail(
  raw: ArrayBuffer,
  fallbackTo: string,
  configuredAttachmentLimit: number
): Promise<ParsedInbound> {
  if (raw.byteLength > MAX_RAW_EMAIL_BYTES) throw new EmailLimitError('RAW_TOO_LARGE');
  const parser = new PostalMime();
  const email = await parser.parse(raw);
  const sourceAttachments = email.attachments || [];
  if (sourceAttachments.length > MAX_ATTACHMENT_COUNT) {
    throw new EmailLimitError('TOO_MANY_ATTACHMENTS');
  }

  const perAttachmentLimit = Math.min(
    MAX_ATTACHMENT_BYTES,
    Math.max(64 * 1024, configuredAttachmentLimit)
  );
  const attachments: ParsedAttachment[] = [];
  let totalAttachmentBytes = 0;
  for (const attachment of sourceAttachments) {
    const content = attachmentBytes(attachment.content);
    if (content.byteLength > perAttachmentLimit) {
      throw new EmailLimitError('ATTACHMENT_TOO_LARGE');
    }
    totalAttachmentBytes += content.byteLength;
    if (totalAttachmentBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new EmailLimitError('ATTACHMENTS_TOO_LARGE');
    }
    attachments.push({
      filename: truncateUtf8(attachment.filename || 'attachment.bin', 255),
      contentType: truncateUtf8(attachment.mimeType || 'application/octet-stream', 127),
      size: content.byteLength,
      content,
    });
  }

  return {
    messageId: email.messageId ? truncateUtf8(email.messageId, 998) : null,
    fromAddress: truncateUtf8(email.from?.address || 'unknown@invalid', 320),
    fromName: email.from?.name ? truncateUtf8(email.from.name, 256) : null,
    toAddress: truncateUtf8(
      email.to?.[0]?.address || email.cc?.[0]?.address || email.bcc?.[0]?.address || fallbackTo,
      320
    ),
    subject: truncateUtf8(email.subject || '(no subject)', 998),
    bodyText: truncateUtf8(email.text || '', MAX_BODY_BYTES),
    bodyHtml: truncateUtf8(email.html || '', MAX_BODY_BYTES),
    attachments,
  };
}

export function makeSnippet(
  text: string | null | undefined,
  html: string | null | undefined,
  max = 140
): string {
  let source = (text || '').trim();
  if (!source && html) {
    source = html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return source.length <= max ? source : `${source.slice(0, max - 1)}…`;
}
