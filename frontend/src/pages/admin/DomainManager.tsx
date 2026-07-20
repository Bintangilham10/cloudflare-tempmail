import { useEffect, useState } from 'react';
import { Plus, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import { api, ApiError, type Domain } from '../../lib/api';
import type { ToastKind } from '../../components/ui/Toast';

export function DomainManager({
  t,
  toast,
}: {
  t: (k: any) => string;
  toast: (message: string, kind?: ToastKind) => void;
}) {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const list = await api.adminDomains();
      setDomains(list);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('errorGeneric'), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.adminAddDomain(name.trim());
      setName('');
      toast(t('saved'), 'success');
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('errorGeneric'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (d: Domain) => {
    setBusy(true);
    try {
      await api.adminToggleDomain(d.id, !(d.is_active === 1));
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('errorGeneric'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (d: Domain) => {
    if (!window.confirm(t('confirmDeleteDomain'))) return;
    setBusy(true);
    try {
      await api.adminDeleteDomain(d.id);
      toast(t('saved'), 'success');
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('errorGeneric'), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-slate-500">{t('loading')}</div>;
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="flex flex-col gap-2 sm:flex-row">
        <input
          className="input"
          placeholder="example.com"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <button type="submit" className="btn-primary shrink-0" disabled={busy}>
          <Plus className="h-4 w-4" />
          {t('addDomain')}
        </button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2">{t('domainName')}</th>
              <th className="px-3 py-2">{t('active')}</th>
              <th className="px-3 py-2">{t('actions')}</th>
            </tr>
          </thead>
          <tbody>
            {domains.map((d) => (
              <tr key={d.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2 font-mono">{d.domain_name}</td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      d.is_active
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {d.is_active ? t('active') : t('inactive')}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={busy}
                      onClick={() => void toggle(d)}
                      title={t('toggle')}
                    >
                      {d.is_active ? (
                        <ToggleRight className="h-4 w-4 text-brand-600" />
                      ) : (
                        <ToggleLeft className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost text-rose-600"
                      disabled={busy}
                      onClick={() => void remove(d)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!domains.length && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-slate-500">
                  —
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
