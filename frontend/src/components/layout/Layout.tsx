import type { ReactNode } from 'react';
import { Header } from './Header';
import type { Theme } from '../../lib/storage';
import type { Lang } from '../../lib/i18n';
import { ToastStack, type ToastItem } from '../ui/Toast';

export function Layout({
  children,
  theme,
  onToggleTheme,
  lang,
  onToggleLang,
  t,
  toasts,
  onDismissToast,
  showBrandLink = true,
}: {
  children: ReactNode;
  theme: Theme;
  onToggleTheme: () => void;
  lang: Lang;
  onToggleLang: () => void;
  t: (k: any) => string;
  toasts: ToastItem[];
  onDismissToast: (id: number) => void;
  showBrandLink?: boolean;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <Header
        theme={theme}
        onToggleTheme={onToggleTheme}
        lang={lang}
        onToggleLang={onToggleLang}
        t={t}
        showBrandLink={showBrandLink}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 sm:py-8">{children}</main>
      <footer className="border-t border-slate-200/80 py-4 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        {t('tagline')}
      </footer>
      <ToastStack items={toasts} onDismiss={onDismissToast} />
    </div>
  );
}
