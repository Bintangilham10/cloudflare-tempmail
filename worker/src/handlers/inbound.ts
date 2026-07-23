import type { AttachmentMeta, Env } from '../types';
import { getActiveMailboxByAddress, getSetting, insertEmail } from '../db/queries';
import { parseEmailAddress, randomToken } from '../utils/auth';
import {
  EmailLimitError,
  MAX_ATTACHMENT_BYTES,
  MAX_RAW_EMAIL_BYTES,
  makeSnippet,
  parseRawEmail,
} from '../utils/parse-email';

export async function handleInboundEmail(
  message: ForwardableEmailMessage,
  env: Env
): Promise<void> {
  const recipient = parseEmailAddress(message.to || '');
  const mailbox = recipient ? await getActiveMailboxByAddress(env.DB, recipient.address) : null;
  if (!recipient || !mailbox) {
    message.setReject('Recipient unavailable');
    return;
  }
  if (message.rawSize > MAX_RAW_EMAIL_BYTES) {
    message.setReject('Message exceeds receiving limits');
    return;
  }

  const configuredAttachmentLimit = Math.min(
    MAX_ATTACHMENT_BYTES,
    Math.max(
      64 * 1024,
      Number(await getSetting(env.DB, 'max_attachment_bytes', String(MAX_ATTACHMENT_BYTES))) ||
        MAX_ATTACHMENT_BYTES
    )
  );
  const raw = await new Response(message.raw).arrayBuffer();

  let parsed;
  try {
    parsed = await parseRawEmail(raw, recipient.address, configuredAttachmentLimit);
  } catch (error) {
    message.setReject(
      error instanceof EmailLimitError
        ? 'Message exceeds receiving limits'
        : 'Message could not be processed'
    );
    return;
  }

  const now = new Date();
  const storagePrefix = `messages/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomToken(16)}`;
  const rawObjectKey = `${storagePrefix}/raw.eml`;
  const storedKeys: string[] = [];
  const attachments: AttachmentMeta[] = [];

  try {
    await env.MESSAGE_BUCKET.put(rawObjectKey, raw, {
      httpMetadata: { contentType: 'message/rfc822' },
    });
    storedKeys.push(rawObjectKey);

    for (let index = 0; index < parsed.attachments.length; index++) {
      const attachment = parsed.attachments[index];
      const objectKey = `${storagePrefix}/attachments/${index}`;
      await env.MESSAGE_BUCKET.put(objectKey, attachment.content, {
        httpMetadata: { contentType: 'application/octet-stream' },
      });
      storedKeys.push(objectKey);
      attachments.push({
        filename: attachment.filename,
        contentType: attachment.contentType,
        size: attachment.size,
        objectKey,
      });
    }

    await insertEmail(env.DB, mailbox.id, {
      messageId: parsed.messageId,
      fromAddress: parsed.fromAddress,
      fromName: parsed.fromName,
      toAddress: recipient.address,
      subject: parsed.subject,
      bodyText: parsed.bodyText,
      bodyHtml: parsed.bodyHtml,
      snippet: makeSnippet(parsed.bodyText, parsed.bodyHtml),
      storagePrefix,
      rawObjectKey,
      attachments,
    });
  } catch (error) {
    if (storedKeys.length) await env.MESSAGE_BUCKET.delete(storedKeys);
    throw error;
  }
}
