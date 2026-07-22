const KEYS = {
  theme: 'tempmail_theme',
  lang: 'tempmail_lang',
  mailbox: 'tempmail_mailbox',
} as const;

export type Theme = 'light' | 'dark';

export interface StoredMailbox {
  address: string;
  token: string;
  created_at?: string;
}

export function getTheme(): Theme | null {
  try {
    const v = localStorage.getItem(KEYS.theme);
    return v === 'dark' || v === 'light' ? v : null;
  } catch {
    return null;
  }
}

export function setTheme(theme: Theme) {
  localStorage.setItem(KEYS.theme, theme);
}

export function getLang(): 'id' | 'en' | null {
  try {
    const v = localStorage.getItem(KEYS.lang);
    return v === 'id' || v === 'en' ? v : null;
  } catch {
    return null;
  }
}

export function setLang(lang: 'id' | 'en') {
  localStorage.setItem(KEYS.lang, lang);
}

export function getMailbox(): StoredMailbox | null {
  try {
    const raw = localStorage.getItem(KEYS.mailbox);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredMailbox;
    if (!parsed?.address || !parsed?.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setMailbox(box: StoredMailbox | null) {
  if (!box) localStorage.removeItem(KEYS.mailbox);
  else localStorage.setItem(KEYS.mailbox, JSON.stringify(box));
}

export function clearLegacyAdminToken() {
  try {
    localStorage.removeItem('tempmail_admin_token');
  } catch {
    // Storage can be unavailable in privacy-restricted browsers.
  }
}
