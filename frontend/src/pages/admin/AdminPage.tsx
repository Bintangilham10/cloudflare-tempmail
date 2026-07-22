import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { clearLegacyAdminToken } from '../../lib/storage';
import { AdminLogin } from './AdminLogin';
import { AdminDashboard } from './AdminDashboard';
import type { ToastKind } from '../../components/ui/Toast';

type AuthState = 'loading' | 'authenticated' | 'anonymous';

export function AdminPage({
  t,
  toast,
}: {
  t: (k: any) => string;
  toast: (message: string, kind?: ToastKind) => void;
}) {
  const [authState, setAuthState] = useState<AuthState>('loading');

  useEffect(() => {
    clearLegacyAdminToken();
    api
      .adminSession()
      .then(() => setAuthState('authenticated'))
      .catch(() => setAuthState('anonymous'));
  }, []);

  if (authState === 'loading') {
    return <div className="card p-8 text-center text-sm text-slate-500">{t('loading')}</div>;
  }
  if (authState === 'anonymous') {
    return (
      <AdminLogin
        t={t}
        toast={toast}
        onAuthed={() => setAuthState('authenticated')}
      />
    );
  }
  return (
    <AdminDashboard
      t={t}
      toast={toast}
      onLogout={() => setAuthState('anonymous')}
    />
  );
}
