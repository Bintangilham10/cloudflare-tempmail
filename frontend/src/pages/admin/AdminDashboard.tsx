import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { setAdminToken } from '../../lib/storage';
import { getPublicInboxUrl } from '../../lib/hosts';
import { DomainManager } from './DomainManager';
import type { ToastKind } from '../../components/ui/Toast';

export function AdminDashboard({
  t,
  toast,
  onLogout,
}: {
  t: (k: any) => string;
  toast: (message: string, kind?: ToastKind) => void;
  onLogout: () => void;
}) {
  const [stats, setStats] = useState({
    domains: 0,
    mailboxes: 0,
    emails: 0,
    ttl_hours: 24,
    site_name: 'Tempmail',
  });
  const [siteName, setSiteName] = useState('Tempmail');
  const [ttl, setTtl] = useState(24);
  const [maxAtt, setMaxAtt] = useState(2097152);
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const s = await api.adminStats();
      setStats(s);
      const settings = await api.adminSettings();
      setSiteName(settings.site_name);
      setTtl(settings.ttl_hours);
      setMaxAtt(settings.max_attachment_bytes);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setAdminToken(null);
        onLogout();
        return;
      }
      toast(e instanceof ApiError ? e.message : t('errorGeneric'), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const updated = await api.adminUpdateSettings({
        site_name: siteName,
        ttl_hours: ttl,
        max_attachment_bytes: maxAtt,
        new_password: newPassword.length >= 8 ? newPassword : undefined,
      });
      setSiteName(updated.site_name);
      setTtl(updated.ttl_hours);
      setMaxAtt(updated.max_attachment_bytes);
      setNewPassword('');
      toast(t('saved'), 'success');
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('errorGeneric'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    try {
      await api.adminLogout();
    } catch {
      /* ignore */
    }
    setAdminToken(null);
    onLogout();
  };

  if (loading) {
    return <div className="card p-8 text-center text-sm text-slate-500">{t('loading')}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('dashboard')}</h1>
          <p className="text-sm text-slate-500">{stats.site_name}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={getPublicInboxUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary"
            title={getPublicInboxUrl()}
          >
            <ExternalLink className="h-4 w-4" />
            {t('openInbox')}
          </a>
          <button type="button" className="btn-secondary" onClick={() => void logout()}>
            {t('logout')}
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: t('domains'), value: stats.domains },
          { label: t('mailboxes'), value: stats.mailboxes },
          { label: t('emails'), value: stats.emails },
        ].map((card) => (
          <div key={card.label} className="card p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{card.label}</p>
            <p className="mt-1 text-3xl font-bold tabular-nums">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-4 text-lg font-semibold">{t('domains')}</h2>
          <DomainManager t={t} toast={toast} />
        </section>

        <section className="card p-5">
          <h2 className="mb-4 text-lg font-semibold">{t('settings')}</h2>
          <form className="space-y-4" onSubmit={saveSettings}>
            <div>
              <label className="label" htmlFor="siteName">
                {t('siteName')}
              </label>
              <input
                id="siteName"
                className="input"
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="ttlHours">
                {t('ttlHours')}
              </label>
              <input
                id="ttlHours"
                type="number"
                min={1}
                max={720}
                className="input"
                value={ttl}
                onChange={(e) => setTtl(Number(e.target.value))}
              />
              <p className="mt-1 text-xs text-slate-400">
                Cron membersihkan email & mailbox lebih tua dari nilai ini.
              </p>
            </div>
            <div>
              <label className="label" htmlFor="maxAtt">
                {t('maxAttachment')}
              </label>
              <input
                id="maxAtt"
                type="number"
                min={65536}
                max={5242880}
                className="input"
                value={maxAtt}
                onChange={(e) => setMaxAtt(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label" htmlFor="newPass">
                {t('newPassword')}
              </label>
              <input
                id="newPass"
                type="password"
                className="input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </div>
            <button type="submit" className="btn-primary" disabled={busy}>
              {t('save')}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
