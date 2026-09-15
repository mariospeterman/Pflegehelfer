import { describe, expect, it } from "vitest";
import { notes, observations, patients } from "../src/core/seed.js";

describe("longitudinal synthetic clinical fixture", () => {
  it("contains the named scenarios without using real patient data", () => {
    const ids = new Set(patients.map((patient) => patient.id));
    expect(patients.length).toBeGreaterThanOrEqual(12);
    for (const id of [
      "p-anna",
      "p-luca",
      "p-mei",
      "p-jonas",
      "p-eva",
      "p-samir",
      "p-ruth",
      "p-paul",
      "p-aline",
      "p-theo",
      "p-mila",
      "p-noah",
    ])
      expect(ids.has(id), id).toBe(true);
    expect(new Set(patients.map((patient) => patient.mrn)).size).toBe(
      patients.length,
    );
    expect(
      patients.every((patient) => patient.source.externalId.length > 0),
    ).toBe(true);
  });

  it("includes multi-day resource-native history and a repeat-encounter case", () => {
    const dates = [...observations, ...notes].map((item) =>
      item.source.effectiveAt.slice(0, 10),
    );
    expect(new Set(dates).size).toBeGreaterThanOrEqual(5);
    expect(notes.some((note) => note.patientId === "p-paul")).toBe(true);
    expect(
      patients.find((patient) => patient.id === "p-paul")?.encounterId,
    ).toBe("enc-paul-2026-b");
  });
});
