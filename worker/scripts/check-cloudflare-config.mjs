import { readFile } from 'node:fs/promises';

const configUrl = new URL('../wrangler.toml', import.meta.url);
const config = await readFile(configUrl, 'utf8');

if (/__[A-Z0-9_]+__/.test(config)) {
  throw new Error('Cloudflare config still contains template placeholders');
}

const requiredPatterns = [
  ['D1 binding DB', /\[\[d1_databases\]\][\s\S]*?binding\s*=\s*"DB"/],
  ['R2 binding MESSAGE_BUCKET', /\[\[r2_buckets\]\][\s\S]*?binding\s*=\s*"MESSAGE_BUCKET"/],
  ['mailbox rate limiter', /name\s*=\s*"MAILBOX_RATE_LIMITER"/],
  ['inbox rate limiter', /name\s*=\s*"INBOX_RATE_LIMITER"/],
  ['login rate limiter', /name\s*=\s*"LOGIN_RATE_LIMITER"/],
  ['ALLOWED_ORIGINS', /ALLOWED_ORIGINS\s*=\s*"https:\/\//],
  ['ALLOWED_ADMIN_ORIGINS', /ALLOWED_ADMIN_ORIGINS\s*=\s*"https:\/\//],
  ['PUBLIC_HOST', /PUBLIC_HOST\s*=\s*"[^"\s]+"/],
  ['ADMIN_HOST', /ADMIN_HOST\s*=\s*"[^"\s]+"/],
  ['PUBLIC_INBOX_URL', /PUBLIC_INBOX_URL\s*=\s*"https:\/\//],
  ['custom domain route', /custom_domain\s*=\s*true/],
];

const missing = requiredPatterns.filter(([, pattern]) => !pattern.test(config)).map(([name]) => name);
if (/ADMIN_BOOTSTRAP_SECRET\s*=/.test(config)) {
  throw new Error('ADMIN_BOOTSTRAP_SECRET must be a Wrangler secret, never a wrangler.toml var');
}
if ((config.match(/binding\s*=\s*"DB"/g) || []).length < 2) {
  missing.push('separate production and staging D1 bindings');
}
if ((config.match(/binding\s*=\s*"MESSAGE_BUCKET"/g) || []).length < 2) {
  missing.push('separate production and staging R2 bindings');
}
if (missing.length) {
  throw new Error(`Cloudflare config is incomplete: ${missing.join(', ')}`);
}
