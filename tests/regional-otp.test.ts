import { describe, expect, it } from "vitest";
import { excludeMissingOtpCoverage } from "@/lib/scoring/regionalFilter";
import { makeAirport } from "./fixtures";

describe("excludeMissingOtpCoverage", () => {
  it("keeps airports with OTP and reports excluded count", () => {
    const withOtp = makeAirport({ iata: "BOS" });
    const withoutOtp = makeAirport({ iata: "HVN", onTime: null });
    const { kept, excludedCount } = excludeMissingOtpCoverage([
      withOtp,
      withoutOtp,
    ]);
    expect(kept.map((a) => a.iata)).toEqual(["BOS"]);
    expect(excludedCount).toBe(1);
  });
});
