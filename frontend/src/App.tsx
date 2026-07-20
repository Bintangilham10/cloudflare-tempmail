import { useCallback, useMemo, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { HomePage } from './pages/HomePage';
import { AdminPage } from './pages/admin/AdminPage';
import { useTheme } from './hooks/useTheme';
import { useLang } from './hooks/useLang';
import type { ToastItem, ToastKind } from './components/ui/Toast';
import { shouldShowAdminApp } from './lib/hosts';

export default function App() {
  const { theme, toggle } = useTheme();
  const { lang, toggleLang, t } = useLang();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const adminMode = useMemo(() => shouldShowAdminApp(), []);

  const toast = useCallback((message: string, kind: ToastKind = 'info') => {
    setToasts((prev) => [...prev, { id: Date.now() + Math.random(), message, kind }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  return (
    <Layout
      theme={theme}
      onToggleTheme={toggle}
      lang={lang}
      onToggleLang={toggleLang}
      t={t}
      toasts={toasts}
      onDismissToast={dismiss}
      showBrandLink={!adminMode}
    >
      {adminMode ? (
        <Routes>
          <Route path="/" element={<AdminPage t={t} toast={toast} />} />
          <Route path="/admin" element={<AdminPage t={t} toast={toast} />} />
          <Route path="/admin/*" element={<AdminPage t={t} toast={toast} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      ) : (
        <Routes>
          <Route path="/" element={<HomePage lang={lang} t={t} toast={toast} />} />
          {/* Hide admin on public host — no link, no route */}
          <Route path="/admin" element={<Navigate to="/" replace />} />
          <Route path="/admin/*" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </Layout>
  );
}
