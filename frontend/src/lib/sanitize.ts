import DOMPurify from 'dompurify';

const PURIFY_CONFIG = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'style'],
  ALLOW_DATA_ATTR: false,
  ADD_ATTR: ['target', 'rel'],
};

export function sanitizeHtml(dirty: string): string {
  if (!dirty) return '';
  const clean = String(DOMPurify.sanitize(dirty, PURIFY_CONFIG as any));
  // Force safe links
  return clean.replace(/<a /gi, '<a target="_blank" rel="noopener noreferrer nofollow" ');
}

export function buildEmailSrcDoc(html: string): string {
  const safe = sanitizeHtml(html);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<base target="_blank" />
<style>
  body {
    margin: 0;
    padding: 16px;
    font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.55;
    color: #0f172a;
    word-break: break-word;
  }
  img { max-width: 100%; height: auto; }
  a { color: #1a7ff5; }
  pre, code { white-space: pre-wrap; word-break: break-word; }
  table { max-width: 100%; }
</style>
</head>
<body>${safe}</body>
</html>`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatRelative(iso: string, lang: 'id' | 'en' = 'en'): string {
  const date = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(date.getTime())) return iso;
  const diff = Date.now() - date.getTime();
  const sec = Math.round(diff / 1000);
  const rtf = new Intl.RelativeTimeFormat(lang === 'id' ? 'id' : 'en', { numeric: 'auto' });
  if (Math.abs(sec) < 60) return rtf.format(-sec, 'second');
  const min = Math.round(sec / 60);
  if (Math.abs(min) < 60) return rtf.format(-min, 'minute');
  const hr = Math.round(min / 60);
  if (Math.abs(hr) < 48) return rtf.format(-hr, 'hour');
  const day = Math.round(hr / 24);
  return rtf.format(-day, 'day');
}
