import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { setAdminToken } from '../../lib/storage';
import type { ToastKind } from '../../components/ui/Toast';

export function AdminLogin({
  t,
  toast,
  onAuthed,
}: {
  t: (k: any) => string;
  toast: (message: string, kind?: ToastKind) => void;
  onAuthed: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [setupMode, setSetupMode] = useState(false);
  const [password, setPassword] = useState('');
  const [bootstrap, setBootstrap] = useState('');
  const [siteName, setSiteName] = useState('Tempmail');
  const [ttl, setTtl] = useState(24);
  const [busy, setBusy] = useState(false);
  const [lockHint, setLockHint] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const status = await api.adminStatus();
        setSetupMode(!status.setup_completed);
        setSiteName(status.site_name || 'Tempmail');
        setTtl(status.ttl_hours || 24);
      } catch {
        setSetupMode(false);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setLockHint(null);
    try {
      if (setupMode) {
        const res = await api.adminSetup({
          password,
          bootstrap_secret: bootstrap || undefined,
          site_name: siteName,
          ttl_hours: ttl,
        });
        setAdminToken(res.token);
      } else {
        const res = await api.adminLogin(password);
        setAdminToken(res.token);
      }
      onAuthed();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429 || err.code === 'LOCKED' || err.code === 'RATE_LIMITED') {
          setLockHint(err.message);
        }
        toast(err.message, 'error');
      } else {
        toast(t('errorGeneric'), 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="card p-8 text-center text-sm text-slate-500">{t('loading')}</div>;
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="card p-6 sm:p-8">
        <h1 className="text-xl font-bold">{setupMode ? t('setup') : t('admin')}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {setupMode ? t('setupDesc') : t('login')}
        </p>

        {lockHint && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            {lockHint}
          </div>
        )}

        <form className="mt-6 space-y-4" onSubmit={submit}>
          {setupMode && (
            <>
              <div>
                <label className="label" htmlFor="site">
                  {t('siteName')}
                </label>
                <input
                  id="site"
                  className="input"
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="ttl">
                  {t('ttlHours')}
                </label>
                <input
                  id="ttl"
                  type="number"
                  min={1}
                  max={720}
                  className="input"
                  value={ttl}
                  onChange={(e) => setTtl(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="label" htmlFor="boot">
                  {t('bootstrapSecret')}
                </label>
                <input
                  id="boot"
                  className="input"
                  value={bootstrap}
                  onChange={(e) => setBootstrap(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </>
          )}
          <div>
            <label className="label" htmlFor="password">
              {t('password')}
            </label>
            <input
              id="password"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
              autoComplete={setupMode ? 'new-password' : 'current-password'}
            />
          </div>
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {setupMode ? t('setup') : t('login')}
          </button>
        </form>
      </div>
    </div>
  );
}
