import PostalMime from 'postal-mime';
import type { AttachmentMeta } from '../types';

export interface ParsedInbound {
  messageId: string | null;
  fromAddress: string;
  fromName: string | null;
  toAddress: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  attachments: AttachmentMeta[];
  rawEml: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function parseRawEmail(
  raw: ArrayBuffer | string,
  fallbackTo: string,
  maxAttachmentBytes: number
): Promise<ParsedInbound> {
  const rawEml =
    typeof raw === 'string' ? raw : new TextDecoder('utf-8', { fatal: false }).decode(raw);

  const parser = new PostalMime();
  const email = await parser.parse(typeof raw === 'string' ? new TextEncoder().encode(raw) : raw);

  const fromAddress = email.from?.address || 'unknown@unknown';
  const fromName = email.from?.name || null;
  const toCandidate =
    email.to?.[0]?.address ||
    email.cc?.[0]?.address ||
    email.bcc?.[0]?.address ||
    fallbackTo;

  const attachments: AttachmentMeta[] = [];
  for (const att of email.attachments || []) {
    const content = att.content
      ? att.content instanceof ArrayBuffer
        ? new Uint8Array(att.content)
        : att.content instanceof Uint8Array
          ? att.content
          : new TextEncoder().encode(String(att.content))
      : new Uint8Array();

    if (content.byteLength > maxAttachmentBytes) {
      attachments.push({
        filename: att.filename || 'attachment.bin',
        contentType: att.mimeType || 'application/octet-stream',
        size: content.byteLength,
        contentBase64: '',
      });
      continue;
    }

    attachments.push({
      filename: att.filename || 'attachment.bin',
      contentType: att.mimeType || 'application/octet-stream',
      size: content.byteLength,
      contentBase64: bytesToBase64(content),
    });
  }

  return {
    messageId: email.messageId || null,
    fromAddress,
    fromName,
    toAddress: toCandidate,
    subject: email.subject || '(no subject)',
    bodyText: email.text || '',
    bodyHtml: email.html || '',
    attachments,
    rawEml,
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
  if (source.length <= max) return source;
  return `${source.slice(0, max - 1)}…`;
}
