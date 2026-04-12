import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { app } from "electron";

let keytar: typeof import("keytar") | null = null;
try {
  // Dynamically import to avoid bundling issues
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  keytar = require("keytar");
} catch {
  keytar = null;
}

const SERVICE = "trading-terminal";

type FallbackSecretsFile = {
  version: 2;
  accounts: Record<string, string>;
};

function deriveFallbackKey(passphrase: string): Buffer {
  const salt = Buffer.from("trading-terminal-secrets-v2", "utf8");
  return crypto.scryptSync(passphrase, salt, 32);
}

function getFallbackSecretsPath(): string {
  return path.join(app.getPath("userData"), "secrets.enc");
}

function encryptFallbackData(plainText: string, passphrase: string): Buffer {
  const iv = crypto.randomBytes(12);
  const key = deriveFallbackKey(passphrase);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from("v2"), iv, authTag, encrypted]);
}

function decryptFallbackData(raw: Buffer, passphrase: string): string {
  const hasV2Prefix = raw.subarray(0, 2).toString("utf8") === "v2";
  if (!hasV2Prefix || raw.length < 30) {
    throw new Error("invalid_fallback_secret_format");
  }

  const iv = raw.subarray(2, 14);
  const authTag = raw.subarray(14, 30);
  const encrypted = raw.subarray(30);
  const key = deriveFallbackKey(passphrase);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function readFallbackStore(passphrase: string): FallbackSecretsFile {
  const file = getFallbackSecretsPath();
  if (!fs.existsSync(file)) {
    return { version: 2, accounts: {} };
  }

  const raw = fs.readFileSync(file);
  const decrypted = decryptFallbackData(raw, passphrase);
  const parsed = JSON.parse(decrypted) as Partial<FallbackSecretsFile>;
  if (parsed.version !== 2 || !parsed.accounts || typeof parsed.accounts !== "object") {
    throw new Error("invalid_fallback_secret_payload");
  }
  return { version: 2, accounts: parsed.accounts };
}

function writeFallbackStore(store: FallbackSecretsFile, passphrase: string): void {
  const file = getFallbackSecretsPath();
  const payload = JSON.stringify(store);
  fs.writeFileSync(file, encryptFallbackData(payload, passphrase));
}

export async function setSecret(account: string, secret: string, passphrase?: string) {
  if (keytar) {
    await keytar.setPassword(SERVICE, account, secret);
    return true;
  }
  if (!passphrase) throw new Error("Passphrase required when keytar is unavailable");
  const store = readFallbackStore(passphrase);
  store.accounts[account] = secret;
  writeFallbackStore(store, passphrase);
  return true;
}

export async function getSecret(account: string, passphrase?: string): Promise<string | null> {
  if (keytar) {
    return keytar.getPassword(SERVICE, account);
  }
  if (!passphrase) throw new Error("Passphrase required when keytar is unavailable");
  const store = readFallbackStore(passphrase);
  return store.accounts[account] ?? null;
}

export async function deleteSecret(account: string, passphrase?: string): Promise<boolean> {
  if (keytar) {
    return keytar.deletePassword(SERVICE, account);
  }
  const fallbackPassphrase = passphrase ?? process.env.AUTH_SESSION_FALLBACK_PASSPHRASE;
  if (!fallbackPassphrase) {
    return false;
  }
  const store = readFallbackStore(fallbackPassphrase);
  delete store.accounts[account];
  if (Object.keys(store.accounts).length === 0) {
    const file = getFallbackSecretsPath();
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
    return true;
  }
  writeFallbackStore(store, fallbackPassphrase);
  return true;
}
