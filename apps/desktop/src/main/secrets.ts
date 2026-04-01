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

export async function setSecret(account: string, secret: string, passphrase?: string) {
  if (keytar) {
    await keytar.setPassword(SERVICE, account, secret);
    return true;
  }
  if (!passphrase) throw new Error("Passphrase required when keytar is unavailable");
  const userData = app.getPath("userData");
  const file = path.join(userData, "secrets.enc");
  const iv = crypto.randomBytes(16);
  const key = crypto.createHash("sha256").update(passphrase).digest();
  const cipher = crypto.createCipheriv("aes-256-ctr", key, iv);
  const payload = JSON.stringify({ account, secret });
  const enc = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  fs.writeFileSync(file, Buffer.concat([iv, enc]));
  return true;
}

export async function getSecret(account: string, passphrase?: string): Promise<string | null> {
  if (keytar) {
    return keytar.getPassword(SERVICE, account);
  }
  if (!passphrase) throw new Error("Passphrase required when keytar is unavailable");
  const userData = app.getPath("userData");
  const file = path.join(userData, "secrets.enc");
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file);
  const iv = raw.subarray(0, 16);
  const data = raw.subarray(16);
  const key = crypto.createHash("sha256").update(passphrase).digest();
  const decipher = crypto.createDecipheriv("aes-256-ctr", key, iv);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  const obj = JSON.parse(dec);
  return obj.account === account ? obj.secret : null;
}

export async function deleteSecret(account: string): Promise<boolean> {
  if (keytar) {
    return keytar.deletePassword(SERVICE, account);
  }
  const userData = app.getPath("userData");
  const file = path.join(userData, "secrets.enc");
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
  return true;
}
