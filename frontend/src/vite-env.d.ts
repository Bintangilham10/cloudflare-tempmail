/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly VITE_PUBLIC_HOST?: string;
  readonly VITE_ADMIN_HOST?: string;
  readonly VITE_PUBLIC_INBOX_URL?: string;
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
