import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function toBase32(input: Buffer): string {
  let bits = '';
  for (const byte of input.values()) {
    bits += byte.toString(2).padStart(8, '0');
  }

  let output = '';
  for (let index = 0; index < bits.length; index += 5) {
    const chunk = bits.slice(index, index + 5).padEnd(5, '0');
    output += BASE32_ALPHABET[Number.parseInt(chunk, 2)] ?? '';
  }

  return output;
}

function fromBase32(input: string): Buffer {
  const normalized = input
    .toUpperCase()
    .replace(/=+$/g, '')
    .replace(/[^A-Z2-7]/g, '');
  let bits = '';

  for (const char of normalized) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value < 0) {
      continue;
    }
    bits += value.toString(2).padStart(5, '0');
  }

  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }

  return Buffer.from(bytes);
}

function normalizeDigits(code: string): string {
  return code.replace(/\s|-/g, '');
}

function computeTotpCode(
  secretBase32: string,
  atMs: number,
  periodSeconds = 30,
  digits = 6,
): string {
  const secret = fromBase32(secretBase32);
  const counter = Math.floor(atMs / 1000 / periodSeconds);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac('sha1', secret).update(counterBuffer).digest();
  const lastByte = hmac[hmac.length - 1] ?? 0;
  const offset = lastByte & 0x0f;
  const b0 = hmac[offset] ?? 0;
  const b1 = hmac[offset + 1] ?? 0;
  const b2 = hmac[offset + 2] ?? 0;
  const b3 = hmac[offset + 3] ?? 0;
  const binary = ((b0 & 0x7f) << 24) | ((b1 & 0xff) << 16) | ((b2 & 0xff) << 8) | (b3 & 0xff);

  const otp = binary % 10 ** digits;
  return otp.toString().padStart(digits, '0');
}

export function generateTotpSecret(size = 20): string {
  return toBase32(randomBytes(size));
}

export function verifyTotpCode(
  secretBase32: string,
  code: string,
  options?: { periodSeconds?: number; digits?: number; window?: number; nowMs?: number },
): boolean {
  const normalizedCode = normalizeDigits(code);
  const periodSeconds = options?.periodSeconds ?? 30;
  const digits = options?.digits ?? 6;
  const window = options?.window ?? 1;
  const nowMs = options?.nowMs ?? Date.now();

  for (let delta = -window; delta <= window; delta += 1) {
    const candidate = computeTotpCode(
      secretBase32,
      nowMs + delta * periodSeconds * 1000,
      periodSeconds,
      digits,
    );
    if (candidate === normalizedCode) {
      return true;
    }
  }

  return false;
}

export function buildOtpAuthUrl(input: {
  issuer: string;
  accountName: string;
  secret: string;
  digits?: number;
  periodSeconds?: number;
}): string {
  const issuer = encodeURIComponent(input.issuer);
  const accountName = encodeURIComponent(input.accountName);
  const digits = input.digits ?? 6;
  const period = input.periodSeconds ?? 30;
  return `otpauth://totp/${issuer}:${accountName}?secret=${input.secret}&issuer=${issuer}&algorithm=SHA1&digits=${digits}&period=${period}`;
}

function deriveKey(keyMaterial: string): Buffer {
  return createHash('sha256').update(keyMaterial, 'utf8').digest();
}

export function encryptTotpSecret(
  secret: string,
  keyMaterial: string,
): { encryptedSecret: string; iv: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(keyMaterial), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encryptedSecret: `${tag.toString('base64url')}.${encrypted.toString('base64url')}`,
    iv: iv.toString('base64url'),
  };
}

export function decryptTotpSecret(
  encryptedSecret: string,
  iv: string,
  keyMaterial: string,
): string {
  const [tagPart, cipherPart] = encryptedSecret.split('.');
  if (!tagPart || !cipherPart) {
    throw new Error('invalid_encrypted_totp_secret');
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveKey(keyMaterial),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(cipherPart, 'base64url')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function generateRecoveryCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const raw = randomBytes(5).toString('hex').toUpperCase();
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`);
  }
  return codes;
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeDigits(code).toUpperCase(), 'utf8').digest('hex');
}
