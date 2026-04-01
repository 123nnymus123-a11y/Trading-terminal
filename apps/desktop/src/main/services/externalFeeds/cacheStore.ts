import fs from "node:fs";
import path from "node:path";

export type CacheEntry<T> = {
  value: T;
  expiresAt?: number;
};

export class CacheStore {
  private memory = new Map<string, CacheEntry<unknown>>();
  private filePath: string;

  constructor(cacheDir: string, fileName = "external-feeds-cache.json") {
    this.filePath = path.join(cacheDir, fileName);
    this.loadFromDisk();
  }

  get<T>(key: string): T | null {
    const entry = this.memory.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.memory.delete(key);
      return null;
    }
    return entry.value;
  }

  set<T>(key: string, value: T, ttlMs?: number) {
    const entry: CacheEntry<T> = {
      value,
      expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
    };
    this.memory.set(key, entry as CacheEntry<unknown>);
    this.saveToDisk();
  }

  delete(key: string) {
    this.memory.delete(key);
    this.saveToDisk();
  }

  private loadFromDisk() {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, CacheEntry<unknown>>;
      Object.entries(parsed).forEach(([key, entry]) => {
        if (entry.expiresAt && Date.now() > entry.expiresAt) return;
        this.memory.set(key, entry);
      });
    } catch {
      // ignore cache loading failures
    }
  }

  private saveToDisk() {
    try {
      const obj = Object.fromEntries(this.memory.entries());
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(obj), "utf8");
    } catch {
      // ignore cache write failures
    }
  }
}
