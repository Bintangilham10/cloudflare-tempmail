import { useMemo, useState } from 'react';
import { ArrowLeft, Download, FileText, Code2 } from 'lucide-react';
import type { EmailDetail as Detail } from '../../lib/api';
import { buildEmailSrcDoc, formatRelative } from '../../lib/sanitize';
import { AttachmentList } from './AttachmentList';
import { EmptyState } from './EmptyState';
import type { Lang } from '../../lib/i18n';

export function EmailDetail({
  email,
  lang,
  t,
  onBack,
  onDownloadRaw,
  onDownloadAttachment,
}: {
  email: Detail | null;
  lang: Lang;
  t: (k: any) => string;
  onBack?: () => void;
  onDownloadRaw: () => void;
  onDownloadAttachment: (index: number, filename: string) => void;
}) {
  const [tab, setTab] = useState<'html' | 'text'>('html');

  const srcDoc = useMemo(() => {
    if (!email?.body_html) return '';
    return buildEmailSrcDoc(email.body_html);
  }, [email?.body_html, email?.id]);

  if (!email) {
    return (
      <div className="hidden h-full md:block">
        <EmptyState title={t('selectEmail')} description={t('emptyDesc')} />
      </div>
    );
  }

  const from = email.from_name
    ? `${email.from_name} <${email.from_address}>`
    : email.from_address;

  const hasHtml = !!(email.body_html && email.body_html.trim());
  const activeTab = hasHtml ? tab : 'text';

  return (
    <div className="flex h-full min-h-[280px] flex-col animate-slide-in">
      <div className="border-b border-slate-100 p-4 dark:border-slate-800">
        <div className="mb-2 flex items-start gap-2">
          {onBack && (
            <button type="button" className="btn-ghost md:hidden" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" />
              {t('back')}
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold leading-snug text-slate-900 dark:text-white">
              {email.subject || t('noSubject')}
            </h2>
            <p className="mt-1 truncate text-sm text-slate-600 dark:text-slate-300">
              <span className="text-slate-400">{t('from')}: </span>
              {from}
            </p>
            <p className="text-xs text-slate-400">
              {t('received')}: {formatRelative(email.created_at, lang)} · {email.created_at}
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {hasHtml && (
            <button
              type="button"
              className={`btn ${activeTab === 'html' ? 'btn-secondary bg-slate-100 dark:bg-slate-800' : 'btn-ghost'}`}
              onClick={() => setTab('html')}
            >
              <Code2 className="h-4 w-4" />
              {t('html')}
            </button>
          )}
          <button
            type="button"
            className={`btn ${activeTab === 'text' ? 'btn-secondary bg-slate-100 dark:bg-slate-800' : 'btn-ghost'}`}
            onClick={() => setTab('text')}
          >
            <FileText className="h-4 w-4" />
            {t('plainText')}
          </button>
          <button type="button" className="btn-secondary" onClick={onDownloadRaw}>
            <Download className="h-4 w-4" />
            {t('rawEml')}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'html' && hasHtml ? (
          <iframe
            title="email-body"
            className="email-html-frame min-h-[320px]"
            sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
            srcDoc={srcDoc}
          />
        ) : (
          <pre className="whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4 text-sm text-slate-800 dark:bg-slate-950 dark:text-slate-200">
            {email.body_text || '(empty)'}
          </pre>
        )}

        <AttachmentList
          attachments={email.attachments}
          t={t}
          onDownload={onDownloadAttachment}
        />
      </div>
    </div>
  );
}
