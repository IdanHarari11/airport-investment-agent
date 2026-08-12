import { describe, expect, it } from "vitest";
import {
  NEW_ENGLAND_STATES,
  isNewEnglandState,
  normalizeRegionName,
} from "@/lib/aviation/regions";
import { createAviationDataProvider } from "@/lib/aviation/provider";

describe("regions", () => {
  it("defines New England as CT ME MA NH RI VT", () => {
    expect([...NEW_ENGLAND_STATES].sort()).toEqual(
      ["CT", "MA", "ME", "NH", "RI", "VT"].sort(),
    );
    expect(isNewEnglandState("ma")).toBe(true);
    expect(isNewEnglandState("CA")).toBe(false);
  });

  it("resolves New England airports from data, not from the LLM", () => {
    const provider = createAviationDataProvider();
    const airports = provider.getAirportsByRegion("New England");
    expect(airports.length).toBeGreaterThan(5);
    expect(airports.every((a) => a.region === "New England")).toBe(true);
    expect(airports.some((a) => a.iata === "BOS")).toBe(true);
    expect(normalizeRegionName("new england")).toBe("New England");
  });
});
