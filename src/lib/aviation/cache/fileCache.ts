import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

export type CacheEnvelope<T> = {
  fetchedAt: string;
  source: {
    name: string;
    url: string;
    period: string | null;
    notes: string | null;
  };
  ttlMs: number;
  data: T;
};

function cacheDir(): string {
  return path.join(process.cwd(), "data", "cache");
}

export function cacheFilePath(name: string): string {
  return path.join(cacheDir(), name);
}

export function readCache<T>(name: string): CacheEnvelope<T> | null {
  const file = cacheFilePath(name);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as CacheEnvelope<T>;
  } catch {
    return null;
  }
}

export function writeCache<T>(name: string, envelope: CacheEnvelope<T>): void {
  const dir = cacheDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(cacheFilePath(name), JSON.stringify(envelope, null, 2), "utf-8");
}

export function isCacheFresh<T>(envelope: CacheEnvelope<T> | null): boolean {
  if (!envelope?.fetchedAt) return false;
  const age = Date.now() - Date.parse(envelope.fetchedAt);
  if (!Number.isFinite(age) || age < 0) return false;
  return age < envelope.ttlMs;
}
