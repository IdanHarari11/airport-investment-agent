import { describe, expect, it } from "vitest";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { buildStructuredFromToolMessages } from "../src/lib/agent/agent";

describe("buildStructuredFromToolMessages", () => {
  it("merges ranking tool cards before the answer streams", () => {
    const messages = [
      new HumanMessage("Rank New England airports"),
      new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "call-1",
            name: "rankAirports",
            args: { region: "New England" },
          },
        ],
      }),
      new ToolMessage({
        tool_call_id: "call-1",
        name: "rankAirports",
        content: JSON.stringify({
          ranked: [
            {
              airport: "BOS",
              name: "Boston Logan",
              rank: 1,
              score: 78.5,
              cohortLabel: "New England",
              cohortSize: 6,
              components: {
                capacityPressure: 70,
                passengerGrowth: 60,
                congestionPressure: 80,
                marketScale: 90,
                routeOpportunity: 50,
              },
              metrics: null,
            },
          ],
          sources: [
            {
              name: "FAA T-100",
              url: "https://example.com",
              period: "2024",
              notes: null,
            },
          ],
          assumptions: ["Scores are cohort percentiles."],
        }),
      }),
    ];

    const structured = buildStructuredFromToolMessages(messages);

    expect(structured.answer).toBe("");
    expect(structured.airports).toHaveLength(1);
    expect(structured.airports?.[0]?.iata).toBe("BOS");
    expect(structured.airports?.[0]?.score).toBe(78.5);
    expect(structured.confidence).toBe("high");
    expect(structured.sources.length).toBeGreaterThan(0);
  });

  it("attaches streamed prose on final reconciliation", () => {
    const messages = [
      new HumanMessage("hi"),
      new ToolMessage({
        tool_call_id: "call-2",
        name: "listDatasetCoverage",
        content: JSON.stringify({
          airportCount: 10,
          sources: [],
          assumptions: [],
        }),
      }),
    ];

    const final = buildStructuredFromToolMessages(
      messages,
      "Here is the analyst narrative.",
    );

    expect(final.answer).toBe("Here is the analyst narrative.");
  });
});
