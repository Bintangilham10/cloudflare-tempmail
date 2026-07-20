import { useState } from 'react';
import {
  Check,
  Copy,
  Loader2,
  Plus,
  RefreshCw,
  Shuffle,
  Trash2,
  Wand2,
} from 'lucide-react';

export function AddressBar({
  address,
  domains,
  busy,
  fetching,
  t,
  onCopy,
  onRefresh,
  onRandom,
  onCustom,
  onDelete,
}: {
  address: string | null;
  domains: Array<{ id: number; domain_name: string }>;
  busy: boolean;
  fetching: boolean;
  t: (k: any) => string;
  onCopy: () => void;
  onRefresh: () => void;
  onRandom: () => void;
  onCustom: (username: string, domain: string) => void;
  onDelete: () => void;
}) {
  const [mode, setMode] = useState<'idle' | 'custom'>('idle');
  const [username, setUsername] = useState('');
  const [domain, setDomain] = useState(domains[0]?.domain_name || '');
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    onCopy();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="label">{t('inbox')}</p>
            <div className="truncate rounded-xl border border-dashed border-brand-300/70 bg-brand-50/60 px-3 py-2.5 font-mono text-sm font-medium text-brand-900 dark:border-brand-700/50 dark:bg-brand-950/40 dark:text-brand-100 sm:text-base">
              {address || '—'}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:pt-5">
            <button type="button" className="btn-secondary" onClick={handleCopy} disabled={!address || busy}>
              {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              {copied ? t('copied') : t('copy')}
            </button>
            <button type="button" className="btn-secondary" onClick={onRefresh} disabled={!address || busy}>
              {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {t('refresh')}
            </button>
            <button type="button" className="btn-primary" onClick={onRandom} disabled={busy || !domains.length}>
              <Shuffle className="h-4 w-4" />
              {t('newAddress')}
            </button>
            <button
              type="button"
              className="btn-ghost text-rose-600 dark:text-rose-400"
              onClick={onDelete}
              disabled={!address || busy}
            >
              <Trash2 className="h-4 w-4" />
              {t('delete')}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <button
            type="button"
            className={`btn ${mode === 'idle' ? 'btn-secondary bg-slate-100 dark:bg-slate-800' : 'btn-ghost'}`}
            onClick={() => {
              setMode('idle');
              onRandom();
            }}
            disabled={busy || !domains.length}
          >
            <Shuffle className="h-4 w-4" />
            {t('random')}
          </button>
          <button
            type="button"
            className={`btn ${mode === 'custom' ? 'btn-secondary bg-slate-100 dark:bg-slate-800' : 'btn-ghost'}`}
            onClick={() => {
              setMode('custom');
              if (!domain && domains[0]) setDomain(domains[0].domain_name);
            }}
            disabled={busy || !domains.length}
          >
            <Wand2 className="h-4 w-4" />
            {t('custom')}
          </button>
        </div>

        {mode === 'custom' && (
          <form
            className="grid gap-2 animate-fade-in sm:grid-cols-[1fr_auto_1fr_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              if (!username.trim() || !domain) return;
              onCustom(username.trim(), domain);
              setMode('idle');
              setUsername('');
            }}
          >
            <div>
              <label className="label" htmlFor="username">
                {t('username')}
              </label>
              <input
                id="username"
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="john.doe"
                autoComplete="off"
                required
              />
            </div>
            <div className="hidden items-end pb-2 text-slate-400 sm:flex">@</div>
            <div>
              <label className="label" htmlFor="domain">
                {t('domain')}
              </label>
              <select
                id="domain"
                className="input"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                required
              >
                {domains.map((d) => (
                  <option key={d.id} value={d.domain_name}>
                    {d.domain_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button type="submit" className="btn-primary w-full sm:w-auto" disabled={busy}>
                <Plus className="h-4 w-4" />
                {t('create')}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setMode('idle')}>
                {t('cancel')}
              </button>
            </div>
          </form>
        )}

        {fetching && (
          <p className="flex items-center gap-2 text-xs text-slate-500 animate-pulse-soft dark:text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t('fetching')}
          </p>
        )}
      </div>
    </div>
  );
}
