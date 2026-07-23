import { describe, expect, it } from 'vitest';
import { hashPassword, isReservedLocalPart, verifyPassword } from '../src/utils/auth';
import { getAllowedOrigins, resolveCorsOrigin } from '../src/utils/cors';
import { isAllowedAdminOrigin } from '../src/utils/rate-limit';
import type { Env } from '../src/types';
import { secretsEqual, validateAdminPassword } from '../src/utils/admin-session';

describe('password hashing', () => {
  it('creates PBKDF2-SHA256 hashes with 600,000 iterations', async () => {
    const hash = await hashPassword('a sufficiently long password');

    expect(hash).toMatch(/^pbkdf2\$600000\$/);
    await expect(verifyPassword('a sufficiently long password', hash)).resolves.toBe(true);
  });
});

describe('admin credential boundaries', () => {
  it('requires passwords between 12 and 128 characters', () => {
    expect(validateAdminPassword('x'.repeat(11))).toContain('at least');
    expect(validateAdminPassword('x'.repeat(12))).toBeNull();
    expect(validateAdminPassword('x'.repeat(128))).toBeNull();
    expect(validateAdminPassword('x'.repeat(129))).toContain('at most');
  });

  it('compares bootstrap secrets without comparing raw values', async () => {
    await expect(secretsEqual('correct secret', 'correct secret')).resolves.toBe(true);
    await expect(secretsEqual('incorrect secret', 'correct secret')).resolves.toBe(false);
  });
});

describe('mailbox address policy', () => {
  it.each(['admin', 'support', 'billing', 'security', 'abuse', 'postmaster', 'webmaster', 'hostmaster', 'noreply'])(
    'reserves %s',
    (localPart) => expect(isReservedLocalPart(localPart)).toBe(true)
  );

  it('allows ordinary local parts', () => {
    expect(isReservedLocalPart('random-user')).toBe(false);
  });
});

describe('admin origin policy', () => {
  it('does not trust seller or localhost origins by default', () => {
    expect(isAllowedAdminOrigin('https://admin.seller.invalid', {})).toBe(false);
    expect(isAllowedAdminOrigin('http://localhost:5173', {})).toBe(false);
  });

  it('accepts only an explicitly configured admin origin', () => {
    const env = { ALLOWED_ADMIN_ORIGINS: 'https://admin.example.com' };

    expect(isAllowedAdminOrigin('https://admin.example.com', env)).toBe(true);
    expect(isAllowedAdminOrigin('https://mail.example.com', env)).toBe(false);
  });
});

describe('CORS policy', () => {
  it('has no implicit production or localhost origins', () => {
    const env = {} as Env;

    expect(getAllowedOrigins(env)).toEqual([]);
    expect(resolveCorsOrigin('http://localhost:5173', env)).toBeNull();
  });

  it('matches explicit origins exactly', () => {
    const env = {
      ALLOWED_ORIGINS: 'https://mail.example.com',
      ALLOWED_ADMIN_ORIGINS: 'https://admin.example.com',
    } as Env;

    expect(resolveCorsOrigin('https://mail.example.com', env)).toBe('https://mail.example.com');
    expect(resolveCorsOrigin('https://evil.example.com', env)).toBeNull();
  });
});
