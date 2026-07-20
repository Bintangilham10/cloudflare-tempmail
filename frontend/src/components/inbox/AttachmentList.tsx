import { Download, Paperclip } from 'lucide-react';
import { formatBytes } from '../../lib/sanitize';

export function AttachmentList({
  attachments,
  t,
  onDownload,
}: {
  attachments: Array<{
    index: number;
    filename: string;
    contentType: string;
    size: number;
    has_content: boolean;
  }>;
  t: (k: any) => string;
  onDownload: (index: number, filename: string) => void;
}) {
  if (!attachments.length) return null;

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/60">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <Paperclip className="h-3.5 w-3.5" />
        {t('attachments')}
      </p>
      <ul className="space-y-2">
        {attachments.map((a) => (
          <li
            key={a.index}
            className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-sm dark:bg-slate-950"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{a.filename}</p>
              <p className="text-xs text-slate-500">
                {a.contentType} · {formatBytes(a.size)}
              </p>
            </div>
            <button
              type="button"
              className="btn-secondary shrink-0"
              disabled={!a.has_content}
              title={!a.has_content ? t('attachmentUnavailable') : t('download')}
              onClick={() => onDownload(a.index, a.filename)}
            >
              <Download className="h-4 w-4" />
              {t('download')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
