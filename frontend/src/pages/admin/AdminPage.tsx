import { useState } from 'react';
import { getAdminToken } from '../../lib/storage';
import { AdminLogin } from './AdminLogin';
import { AdminDashboard } from './AdminDashboard';
import type { ToastKind } from '../../components/ui/Toast';

export function AdminPage({
  t,
  toast,
}: {
  t: (k: any) => string;
  toast: (message: string, kind?: ToastKind) => void;
}) {
  const [authed, setAuthed] = useState(() => !!getAdminToken());

  if (!authed) {
    return <AdminLogin t={t} toast={toast} onAuthed={() => setAuthed(true)} />;
  }

  return <AdminDashboard t={t} toast={toast} onLogout={() => setAuthed(false)} />;
}
