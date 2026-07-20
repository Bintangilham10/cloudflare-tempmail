import { Paperclip } from 'lucide-react';
import type { EmailListItem as Item } from '../../lib/api';
import { formatRelative } from '../../lib/sanitize';
import type { Lang } from '../../lib/i18n';

export function EmailListItem({
  item,
  active,
  lang,
  noSubject,
  onClick,
}: {
  item: Item;
  active: boolean;
  lang: Lang;
  noSubject: string;
  onClick: () => void;
}) {
  const from = item.from_name ? `${item.from_name}` : item.from_address;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full border-b border-slate-100 px-3 py-3 text-left transition animate-fade-in last:border-b-0 dark:border-slate-800
        ${active ? 'bg-brand-50/80 dark:bg-brand-950/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'}
        ${!item.is_read ? 'font-medium' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {!item.is_read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />}
            <p className="truncate text-sm text-slate-900 dark:text-slate-100">{from}</p>
          </div>
          <p className="mt-0.5 truncate text-sm text-slate-700 dark:text-slate-200">
            {item.subject || noSubject}
          </p>
          <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{item.snippet}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <time className="text-[11px] text-slate-400">{formatRelative(item.created_at, lang)}</time>
          {item.has_attachments && <Paperclip className="h-3.5 w-3.5 text-slate-400" />}
        </div>
      </div>
    </button>
  );
}
