export const TOOL_LABELS: Record<string, string> = {
  getAirportMetrics: "Fetch airport metrics",
  compareAirports: "Compare airports",
  rankAirports: "Rank airports",
  getCongestionMetrics: "Calculate congestion",
  getLongHaulStats: "Compute long-haul share",
  estimateUnmetDemand: "Estimate unmet-demand proxy",
  listDatasetCoverage: "Load dataset coverage",
};

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name;
}
