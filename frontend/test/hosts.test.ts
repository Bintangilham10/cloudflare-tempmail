import { describe, expect, it } from 'vitest';
import { resolveFrontendConfig } from '../src/lib/hosts';

describe('frontend host configuration', () => {
  it('fails closed when production variables are missing', () => {
    expect(() => resolveFrontendConfig({ DEV: false })).toThrow('VITE_PUBLIC_HOST');
  });

  it('accepts explicit HTTPS production hosts', () => {
    expect(
      resolveFrontendConfig({
        DEV: false,
        VITE_PUBLIC_HOST: 'mail.example.com',
        VITE_ADMIN_HOST: 'admin.example.com',
        VITE_PUBLIC_INBOX_URL: 'https://mail.example.com',
        VITE_API_BASE: 'https://api.example.com',
      })
    ).toEqual({
      publicHost: 'mail.example.com',
      adminHost: 'admin.example.com',
      publicInboxUrl: 'https://mail.example.com',
      apiBase: 'https://api.example.com',
      development: false,
    });
  });

  it('rejects insecure production API URLs', () => {
    expect(() =>
      resolveFrontendConfig({
        DEV: false,
        VITE_PUBLIC_HOST: 'mail.example.com',
        VITE_ADMIN_HOST: 'admin.example.com',
        VITE_PUBLIC_INBOX_URL: 'https://mail.example.com',
        VITE_API_BASE: 'http://api.example.com',
      })
    ).toThrow('HTTPS');
  });
});
