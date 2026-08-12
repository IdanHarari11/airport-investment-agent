export type HubSize = "L" | "M" | "S" | "N" | string;

export type DataSourceReference = {
  name?: string;
  source?: string;
  url?: string;
  period?: string;
  notes?: string;
  fields?: string[];
  longHaulDefinition?: string;
};

export type TrafficMetrics = {
  period: string;
  passengers: number;
  seats: number;
  loadFactor: number | null;
  departuresPerformed: number;
  departuresScheduled: number;
  performanceRatio: number | null;
  longHaulDepartures: number;
  longHaulDepartureShare: number | null;
  avgDistanceMiles: number | null;
  longHaulThresholdMiles: number;
};

export type OnTimeMetrics = {
  period: string;
  flightCount: number;
  cancellationRate: number | null;
  depDelay15Rate: number | null;
  arrDelay15Rate: number | null;
  avgDepDelayMinutes: number | null;
  avgArrDelayMinutes: number | null;
  longHaulDepartures: number;
  longHaulDepartureShare: number | null;
  avgDistanceMiles: number | null;
  longHaulThresholdMiles: number;
};

export type AirportRecord = {
  iata: string;
  name: string;
  city: string | null;
  state: string | null;
  region: string;
  hub: HubSize | null;
  serviceLevel: string | null;
  enplanementsCy2024: number | null;
  enplanementsCy2023: number | null;
  enplanementGrowthPct: number | null;
  faaRankCy2024: number | null;
  traffic: TrafficMetrics | null;
  onTime: OnTimeMetrics | null;
};

export type ScoringWeights = {
  capacityPressure: number;
  passengerGrowth: number;
  congestionPressure: number;
  marketScale: number;
  routeOpportunity: number;
};

export type ScoreComponents = {
  capacityPressure: number | null;
  passengerGrowth: number | null;
  congestionPressure: number | null;
  marketScale: number | null;
  routeOpportunity: number | null;
};

export type AirportScore = {
  airport: string;
  name: string;
  city: string | null;
  state: string | null;
  region: string;
  /** Scope of the percentile cohort used for this score. */
  cohortLabel: string;
  cohortSize: number;
  score: number | null;
  components: ScoreComponents;
  unavailableComponents: string[];
  metrics: {
    enplanementsCy2024: number | null;
    enplanementGrowthPct: number | null;
    loadFactor: number | null;
    depDelay15Rate: number | null;
    cancellationRate: number | null;
    longHaulDepartureShare: number | null;
    avgDepDelayMinutes: number | null;
  };
  assumptions: string[];
};

export type CongestionResult = {
  airport: string;
  congestionScore: number | null;
  signals: {
    depDelay15Rate: number | null;
    arrDelay15Rate: number | null;
    avgDepDelayMinutes: number | null;
    cancellationRate: number | null;
    performanceRatio: number | null;
  };
  period: string | null;
  unavailable: boolean;
  notes: string[];
};

export type LongHaulResult = {
  airport: string;
  thresholdMiles: number;
  definition: string;
  longHaulDepartures: number | null;
  totalDepartures: number | null;
  longHaulShare: number | null;
  source: "t100" | "otp" | "none";
  period: string | null;
};

export type UnmetDemandResult = {
  airport: string;
  label: "Estimated Unmet Demand Proxy";
  proxyScore: number | null;
  classification: "elevated" | "moderate" | "limited" | "unavailable";
  signals: {
    loadFactor: number | null;
    passengerGrowthPct: number | null;
    congestionScore: number | null;
    capacityGrowthLag: number | null;
  };
  formula: string;
  caveats: string[];
};

export type AviationDataset = {
  meta: {
    sources: DataSourceReference[];
    generatedAt: string;
    coverageNotes?: string;
  };
  config: {
    longHaulThresholdMiles: number;
    scoringWeights: ScoringWeights;
  };
  airports: AirportRecord[];
};
