const encoder = new TextEncoder();
export const PASSWORD_HASH_ITERATIONS = 600_000;
const MAX_ACCEPTED_HASH_ITERATIONS = 1_000_000;

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (!clean || clean.length % 2 !== 0 || /[^0-9a-f]/.test(clean)) {
    throw new Error('Invalid hex');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function randomToken(bytes = 24): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return toHex(arr);
}

export function randomLocalPart(length = 10): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[arr[i] % alphabet.length];
  }
  return out;
}

async function deriveKey(password: string, salt: Uint8Array, iterations = 100_000): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return new Uint8Array(bits);
}

/**
 * Format: pbkdf2$iterations$saltHex$hashHex
 * salt = 16 bytes (32 hex chars), hash = 32 bytes (64 hex chars)
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveKey(password, salt, PASSWORD_HASH_ITERATIONS);
  return `pbkdf2$${PASSWORD_HASH_ITERATIONS}$${toHex(salt)}$${toHex(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$');
    if (parts.length !== 4) return false;
    const [algo, iterStr, saltHex, hashHex] = parts;
    if (algo !== 'pbkdf2') return false;
    if (saltHex.length !== 32 || hashHex.length !== 64) return false;

    const iterations = Number(iterStr);
    if (
      !Number.isSafeInteger(iterations) ||
      iterations < 1 ||
      iterations > MAX_ACCEPTED_HASH_ITERATIONS
    ) {
      return false;
    }

    const salt = fromHex(saltHex);
    const expected = fromHex(hashHex);
    const actual = await deriveKey(password, salt, iterations);

    if (actual.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
    return diff === 0;
  } catch {
    return false;
  }
}

export function passwordHashNeedsUpgrade(stored: string): boolean {
  const [algo, iterStr] = stored.split('$');
  return algo !== 'pbkdf2' || Number(iterStr) < PASSWORD_HASH_ITERATIONS;
}

export function isValidLocalPart(local: string): boolean {
  if (!local || local.length < 1 || local.length > 64) return false;
  return /^[a-zA-Z0-9](?:[a-zA-Z0-9._+-]{0,62}[a-zA-Z0-9])?$/.test(local);
}

const RESERVED_LOCAL_PARTS = new Set([
  'admin',
  'support',
  'billing',
  'security',
  'abuse',
  'postmaster',
  'webmaster',
  'hostmaster',
  'noreply',
]);

export function isReservedLocalPart(local: string): boolean {
  return RESERVED_LOCAL_PARTS.has(local.trim().toLowerCase());
}

export function isValidDomain(domain: string): boolean {
  if (!domain || domain.length > 253) return false;
  const d = domain.trim().toLowerCase();
  if (d.includes('://') || d.includes('/') || d.includes(' ')) return false;
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(d);
}

export function normalizeAddress(local: string, domain: string): string {
  return `${local.trim().toLowerCase()}@${domain.trim().toLowerCase()}`;
}

export function parseEmailAddress(raw: string): { local: string; domain: string; address: string } | null {
  const match = raw.match(/<?([a-zA-Z0-9._+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?/);
  if (!match) return null;
  const local = match[1].toLowerCase();
  const domain = match[2].toLowerCase();
  return { local, domain, address: `${local}@${domain}` };
}
