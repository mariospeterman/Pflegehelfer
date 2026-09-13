import { createParser } from "@openuidev/react-lang";
import { describe, expect, it } from "vitest";
import { toOpenUi } from "../src/core/assistant-service.js";
import { clinicalAssistantLibrary } from "../src/pwa/assistant/clinical-library.js";

// Regression: ISSUE-003 — scalar observations produced invalid OpenUI
// Found by /qa on 2026-09-13
// Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-09-13.md

describe("scalar vital OpenUI serialization", () => {
  it("omits the absent secondary value and parses the trend card", () => {
    const openUi = toOpenUi([
      {
        type: "VitalTrend",
        patientId: "p-luca",
        label: "Temperatur",
        value: "37.4 °C",
        points: [
          {
            id: "o-temp-luca-1",
            value: 37.4,
            secondaryValue: null,
            unit: "°C",
            effectiveAt: "2026-09-05T06:40:00.000Z",
            status: "approved",
          },
        ],
        sourceLabel: "carecoach · letzter bestätigter Stand",
      },
    ]);

    expect(openUi).not.toContain('"secondaryValue":null');
    const parsed = createParser(
      clinicalAssistantLibrary.toJSONSchema(),
    ).parse(openUi);
    expect(parsed.meta.errors).toEqual([]);
    expect(parsed.meta.unresolved).toEqual([]);
    expect(parsed.root?.typeName).toBe("ClinicalStack");
  });
});
