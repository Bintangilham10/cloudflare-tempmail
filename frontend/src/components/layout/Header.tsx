import { Link } from 'react-router-dom';
import { ExternalLink, Languages, Mail } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import type { Theme } from '../../lib/storage';
import type { Lang } from '../../lib/i18n';
import { getPublicInboxUrl, shouldShowAdminApp } from '../../lib/hosts';

export function Header({
  theme,
  onToggleTheme,
  lang,
  onToggleLang,
  t,
  showBrandLink = true,
}: {
  theme: Theme;
  onToggleTheme: () => void;
  lang: Lang;
  onToggleLang: () => void;
  t: (k: any) => string;
  showBrandLink?: boolean;
}) {
  const adminMode = shouldShowAdminApp();
  const inboxUrl = getPublicInboxUrl();

  const brand = (
    <span className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
        <Mail className="h-4 w-4" />
      </span>
      <span>{t('appName')}</span>
    </span>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/80 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/80">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
        {showBrandLink ? (
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            {brand}
          </Link>
        ) : (
          brand
        )}

        <div className="flex items-center gap-1">
          {adminMode && (
            <a
              href={inboxUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary"
              title={inboxUrl}
            >
              <ExternalLink className="h-4 w-4" />
              <span className="hidden sm:inline">{t('openInbox')}</span>
            </a>
          )}
          <button type="button" className="btn-ghost" onClick={onToggleLang} title={t('language')}>
            <Languages className="h-4 w-4" />
            <span className="hidden text-xs font-semibold uppercase sm:inline">{lang}</span>
          </button>
          <ThemeToggle
            theme={theme}
            onToggle={onToggleTheme}
            labelLight={t('light')}
            labelDark={t('dark')}
          />
        </div>
      </div>
    </header>
  );
}
