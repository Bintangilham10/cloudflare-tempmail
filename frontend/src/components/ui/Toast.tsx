import { useEffect } from 'react';
import { X } from 'lucide-react';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

export function ToastStack({
  items,
  onDismiss,
}: {
  items: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(100%-2rem,22rem)] flex-col gap-2">
      {items.map((t) => (
        <ToastCard key={t.id} item={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const id = window.setTimeout(() => onDismiss(item.id), 3200);
    return () => window.clearTimeout(id);
  }, [item.id, onDismiss]);

  const colors =
    item.kind === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100'
      : item.kind === 'error'
        ? 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-100'
        : 'border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';

  return (
    <div
      className={`pointer-events-auto animate-fade-in rounded-xl border px-3 py-2.5 shadow-lg ${colors} flex items-start gap-2`}
      role="status"
    >
      <p className="flex-1 text-sm">{item.message}</p>
      <button
        type="button"
        className="rounded-lg p-1 opacity-70 hover:opacity-100"
        onClick={() => onDismiss(item.id)}
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
