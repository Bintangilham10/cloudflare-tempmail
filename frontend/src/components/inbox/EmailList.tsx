import type { EmailListItem as Item } from '../../lib/api';
import { EmailListItem } from './EmailListItem';
import { EmptyState } from './EmptyState';
import type { Lang } from '../../lib/i18n';

export function EmailList({
  emails,
  selectedId,
  lang,
  t,
  onSelect,
}: {
  emails: Item[];
  selectedId: number | null;
  lang: Lang;
  t: (k: any) => string;
  onSelect: (id: number) => void;
}) {
  if (!emails.length) {
    return <EmptyState title={t('emptyTitle')} description={t('emptyDesc')} />;
  }

  return (
    <div className="max-h-[min(70vh,640px)] overflow-y-auto">
      {emails.map((e) => (
        <EmailListItem
          key={e.id}
          item={e}
          active={selectedId === e.id}
          lang={lang}
          noSubject={t('noSubject')}
          onClick={() => onSelect(e.id)}
        />
      ))}
    </div>
  );
}
