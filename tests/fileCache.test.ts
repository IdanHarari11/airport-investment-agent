import { describe, expect, it } from "vitest";
import {
  isCacheFresh,
  readCache,
  writeCache,
  type CacheEnvelope,
} from "@/lib/aviation/cache/fileCache";
import { existsSync, unlinkSync, writeFileSync } from "fs";
import path from "path";

describe("fileCache TTL", () => {
  it("treats envelopes within ttlMs as fresh", () => {
    const envelope: CacheEnvelope<{ ok: boolean }> = {
      fetchedAt: new Date().toISOString(),
      source: {
        name: "test",
        url: "https://example.com",
        period: "test",
        notes: null,
      },
      ttlMs: 60_000,
      data: { ok: true },
    };
    expect(isCacheFresh(envelope)).toBe(true);
  });

  it("treats envelopes past ttlMs as stale", () => {
    const envelope: CacheEnvelope<{ ok: boolean }> = {
      fetchedAt: new Date(Date.now() - 120_000).toISOString(),
      source: {
        name: "test",
        url: "https://example.com",
        period: "test",
        notes: null,
      },
      ttlMs: 60_000,
      data: { ok: true },
    };
    expect(isCacheFresh(envelope)).toBe(false);
  });

  it("returns null for missing or corrupt cache files", () => {
    expect(readCache("definitely-missing-cache-file.json")).toBeNull();

    const name = `__audit_corrupt_${Date.now()}.json`;
    const file = path.join(process.cwd(), "data", "cache", name);
    writeCache(name, {
      fetchedAt: new Date().toISOString(),
      source: {
        name: "test",
        url: "https://example.com",
        period: null,
        notes: null,
      },
      ttlMs: 1000,
      data: { value: 1 },
    });
    writeFileSync(file, "{not-json", "utf-8");
    expect(readCache(name)).toBeNull();
    if (existsSync(file)) unlinkSync(file);
  });
});
