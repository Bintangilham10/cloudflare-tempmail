import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/utils/auth';
import { isAllowedAdminOrigin } from '../src/utils/rate-limit';

describe('password hashing', () => {
  it('creates PBKDF2-SHA256 hashes with 600,000 iterations', async () => {
    const hash = await hashPassword('a sufficiently long password');

    expect(hash).toMatch(/^pbkdf2\$600000\$/);
    await expect(verifyPassword('a sufficiently long password', hash)).resolves.toBe(true);
  });
});

describe('admin origin policy', () => {
  it('does not trust seller or localhost origins by default', () => {
    expect(isAllowedAdminOrigin('https://admin.boslay.works', {})).toBe(false);
    expect(isAllowedAdminOrigin('http://localhost:5173', {})).toBe(false);
  });

  it('accepts only an explicitly configured admin origin', () => {
    const env = { ALLOWED_ADMIN_ORIGINS: 'https://admin.example.com' };

    expect(isAllowedAdminOrigin('https://admin.example.com', env)).toBe(true);
    expect(isAllowedAdminOrigin('https://mail.example.com', env)).toBe(false);
  });
});
