import { z } from "zod";

const CongestionInsightSchema = z.object({
  airport: z.string(),
  congestionScore: z.number().nullable(),
  depDelay15Rate: z.number().nullable(),
  cancellationRate: z.number().nullable(),
  avgDepDelayMinutes: z.number().nullable(),
  period: z.string().nullable(),
  unavailable: z.boolean(),
});

const LongHaulInsightSchema = z.object({
  airport: z.string(),
  longHaulShare: z.number().nullable(),
  thresholdMiles: z.number().nullable(),
  definition: z.string().nullable(),
  source: z.string().nullable(),
  period: z.string().nullable(),
});

const UnmetDemandInsightSchema = z.object({
  airport: z.string(),
  label: z.string(),
  proxyScore: z.number().nullable(),
  classification: z.string().nullable(),
  loadFactor: z.number().nullable(),
  passengerGrowthPct: z.number().nullable(),
  congestionScore: z.number().nullable(),
  caveats: z.array(z.string()).nullable(),
});

export const AgentResponseSchema = z.object({
  answer: z
    .string()
    .describe(
      "Short analyst prose only (typically 3–6 sentences). Do not dump raw tables; UI cards show numbers.",
    ),
  airports: z
    .array(
      z.object({
        iata: z.string(),
        name: z.string().nullable(),
        rank: z.number().nullable(),
        score: z.number().nullable(),
        cohortLabel: z
          .string()
          .nullable()
          .describe("Comparison cohort label for this score"),
        cohortSize: z
          .number()
          .nullable()
          .describe("Number of airports in the comparison cohort"),
        components: z
          .object({
            capacityPressure: z.number().nullable(),
            passengerGrowth: z.number().nullable(),
            congestionPressure: z.number().nullable(),
            marketScale: z.number().nullable(),
            routeOpportunity: z.number().nullable(),
          })
          .nullable(),
        metrics: z
          .object({
            enplanementsCy2024: z.number().nullable(),
            enplanementGrowthPct: z.number().nullable(),
            loadFactor: z.number().nullable(),
            depDelay15Rate: z.number().nullable(),
            cancellationRate: z.number().nullable(),
            longHaulDepartureShare: z.number().nullable(),
            avgDepDelayMinutes: z.number().nullable(),
          })
          .nullable(),
      }),
    )
    .nullable()
    .describe("ALWAYS null — server overwrites from tool JSON"),
  congestion: z
    .array(CongestionInsightSchema)
    .nullable()
    .describe("ALWAYS null — server overwrites from tool JSON"),
  longHaul: z
    .array(LongHaulInsightSchema)
    .nullable()
    .describe("ALWAYS null — server overwrites from tool JSON"),
  unmetDemand: z
    .array(UnmetDemandInsightSchema)
    .nullable()
    .describe("ALWAYS null — server overwrites from tool JSON"),
  assumptions: z
    .array(z.string())
    .describe("2–5 short assumption lines; server may append data-period notes"),
  confidence: z.enum(["high", "medium", "low"]),
  sources: z
    .array(
      z.object({
        name: z.string(),
        url: z.string().nullable(),
        period: z.string().nullable(),
        notes: z.string().nullable(),
      }),
    )
    .describe("Prefer [] — server injects sources from the data provider"),
});

export type AgentResponse = z.infer<typeof AgentResponseSchema>;

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  structured?: AgentResponse;
};
