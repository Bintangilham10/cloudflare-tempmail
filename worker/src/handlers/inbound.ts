import type { Env } from '../types';
import { getOrCreateMailbox, getSetting, insertEmail } from '../db/queries';
import { parseEmailAddress } from '../utils/auth';
import { parseRawEmail } from '../utils/parse-email';

/**
 * Cloudflare Email Routing handler.
 * Policy: auto-create mailbox if domain is active in D1.
 */
export async function handleInboundEmail(message: ForwardableEmailMessage, env: Env): Promise<void> {
  try {
    const toRaw = message.to || '';
    const parsedTo = parseEmailAddress(toRaw);
    if (!parsedTo) {
      console.log('Drop: cannot parse recipient', toRaw);
      message.setReject('Invalid recipient');
      return;
    }

    const mailbox = await getOrCreateMailbox(env.DB, parsedTo.local, parsedTo.domain);
    if (!mailbox) {
      console.log('Drop: domain not active', parsedTo.domain);
      message.setReject('Domain not accepted');
      return;
    }

    const maxAtt = Number(await getSetting(env.DB, 'max_attachment_bytes', '2097152')) || 2097152;
    const raw = await new Response(message.raw).arrayBuffer();
    const parsed = await parseRawEmail(raw, parsedTo.address, maxAtt);

    // Prefer envelope recipient as to_address
    parsed.toAddress = parsedTo.address;

    await insertEmail(env.DB, mailbox.id, {
      messageId: parsed.messageId,
      fromAddress: parsed.fromAddress,
      fromName: parsed.fromName,
      toAddress: parsed.toAddress,
      subject: parsed.subject,
      bodyText: parsed.bodyText,
      bodyHtml: parsed.bodyHtml,
      rawEml: parsed.rawEml.slice(0, 1_500_000), // hard cap raw storage
      attachments: parsed.attachments,
    });

    console.log('Stored email for', mailbox.address, 'subject=', parsed.subject);
  } catch (err) {
    console.error('Inbound email error', err);
    // Do not reject after partial processing failures hard — reject to signal CF
    try {
      message.setReject('Temporary processing error');
    } catch {
      /* ignore */
    }
  }
}
