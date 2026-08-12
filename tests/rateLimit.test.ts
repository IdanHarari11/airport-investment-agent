import { describe, expect, it } from "vitest";
import { takeRateLimitToken } from "@/lib/security/rateLimit";

describe("takeRateLimitToken", () => {
  it("allows up to the limit then blocks", () => {
    const key = `test-${Date.now()}-${Math.random()}`;
    const windowMs = 60_000;
    const limit = 3;

    expect(takeRateLimitToken({ key, limit, windowMs }).allowed).toBe(true);
    expect(takeRateLimitToken({ key, limit, windowMs }).allowed).toBe(true);
    expect(takeRateLimitToken({ key, limit, windowMs }).allowed).toBe(true);
    const blocked = takeRateLimitToken({ key, limit, windowMs });
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });
});
