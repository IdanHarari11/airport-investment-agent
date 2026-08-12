/**
 * Deterministic region membership. The LLM must not invent regional airport lists.
 */

export const NEW_ENGLAND_STATES = ["CT", "ME", "MA", "NH", "RI", "VT"] as const;

export const REGION_ALIASES: Record<string, string> = {
  "new england": "New England",
  northeast: "Northeast",
  midwest: "Midwest",
  south: "South",
  west: "West",
  mountain: "Mountain",
  alaska: "Alaska",
  other: "Other",
};

export function normalizeRegionName(input: string): string | null {
  const key = input.trim().toLowerCase();
  return REGION_ALIASES[key] ?? null;
}

export function isNewEnglandState(state: string | null | undefined): boolean {
  if (!state) return false;
  return (NEW_ENGLAND_STATES as readonly string[]).includes(state.toUpperCase());
}

/** Deterministic US-state → analysis region mapping (not invented by the LLM). */
const STATE_TO_REGION: Record<string, string> = {
  CT: "New England",
  ME: "New England",
  MA: "New England",
  NH: "New England",
  RI: "New England",
  VT: "New England",
  NY: "Northeast",
  NJ: "Northeast",
  PA: "Northeast",
  MD: "Northeast",
  DE: "Northeast",
  DC: "Northeast",
  IL: "Midwest",
  IN: "Midwest",
  MI: "Midwest",
  OH: "Midwest",
  WI: "Midwest",
  MN: "Midwest",
  IA: "Midwest",
  MO: "Midwest",
  ND: "Midwest",
  SD: "Midwest",
  NE: "Midwest",
  KS: "Midwest",
  TX: "South",
  FL: "South",
  GA: "South",
  NC: "South",
  SC: "South",
  VA: "South",
  TN: "South",
  AL: "South",
  MS: "South",
  LA: "South",
  AR: "South",
  KY: "South",
  OK: "South",
  WV: "South",
  CA: "West",
  WA: "West",
  OR: "West",
  NV: "West",
  AZ: "West",
  HI: "West",
  CO: "Mountain",
  UT: "Mountain",
  NM: "Mountain",
  ID: "Mountain",
  MT: "Mountain",
  WY: "Mountain",
  AK: "Alaska",
  PR: "Other",
  VI: "Other",
  GU: "Other",
};

export function regionFromState(state: string | null | undefined): string | null {
  if (!state) return null;
  return STATE_TO_REGION[state.trim().toUpperCase()] ?? null;
}
