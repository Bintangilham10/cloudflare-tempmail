import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(
        fileURLToPath(new URL('./migrations', import.meta.url))
      );
      return {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          d1Databases: ['DB'],
          r2Buckets: ['MESSAGE_BUCKET'],
          ratelimits: {
            MAILBOX_RATE_LIMITER: { namespace_id: '1', simple: { limit: 100, period: 60 } },
            INBOX_RATE_LIMITER: { namespace_id: '2', simple: { limit: 100, period: 60 } },
            LOGIN_RATE_LIMITER: { namespace_id: '3', simple: { limit: 100, period: 60 } },
          },
          bindings: {
            TEST_MIGRATIONS: migrations,
            ADMIN_BOOTSTRAP_SECRET: 'test-bootstrap-secret-that-is-long-enough',
            ALLOWED_ORIGINS: 'https://mail.example.test',
            ALLOWED_ADMIN_ORIGINS: 'https://admin.example.test',
            PUBLIC_HOST: 'mail.example.test',
            ADMIN_HOST: 'admin.example.test',
            PUBLIC_INBOX_URL: 'https://mail.example.test',
          },
        },
      };
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/apply-migrations.ts'],
  },
});
