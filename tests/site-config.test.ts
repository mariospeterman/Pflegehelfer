import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  activeSitePackPath,
  parseSiteConfiguration,
  siteConfiguration,
} from "../src/core/site-config.js";

function resizedAssignmentPack(count: number) {
  const pack = structuredClone(siteConfiguration);
  const patientIds = Array.from({ length: count }, (_, index) =>
    index < pack.nursingAssignments.length
      ? pack.nursingAssignments[index]!.patientId
      : `p-config-${index + 1}`,
  );
  pack.nursingAssignments = patientIds.map((patientId, index) => ({
    patientId,
    title: `Geplanter Pflegeauftrag ${index + 1}`,
    reason: "Freigegebener synthetischer Konfigurationstest",
    window: "07:00–12:00",
  }));
  pack.staffAssignments = pack.staffAssignments.map((assignment) => ({
    ...assignment,
    patientIds,
  }));
  return pack;
}

describe("versioned site-pack configuration", () => {
  it.each([2, 12])(
    "accepts %i assigned patients without code constants",
    (count) => {
      const parsed = parseSiteConfiguration(resizedAssignmentPack(count));
      expect(parsed.nursingAssignments).toHaveLength(count);
      expect(
        parsed.nursingAssignments.every(
          (assignment) => assignment.patientId.length > 0,
        ),
      ).toBe(true);
    },
  );

  it("loads the active pack from a validated runtime file", () => {
    const parsed = parseSiteConfiguration(
      JSON.parse(readFileSync(activeSitePackPath, "utf8")) as unknown,
    );
    expect(parsed.siteId).toBe(siteConfiguration.siteId);
  });

  it("ships a second institution pack that validates independently", () => {
    const parsed = parseSiteConfiguration(
      JSON.parse(
        readFileSync(
          new URL("../config/sites/alpenblick-demo.json", import.meta.url),
          "utf8",
        ),
      ) as unknown,
    );
    expect(parsed.institutionId).toBe("org-alpenblick-demo");
    expect(parsed.displayName).toContain("Alpenblick");
  });

  it("prevents a site pack from expanding the centrally reviewed role ceiling", () => {
    const pack = structuredClone(siteConfiguration);
    pack.roleProfiles.management.actions.push("patient:read");
    expect(() => parseSiteConfiguration(pack)).toThrow(
      /cannot grant patient:read to management/i,
    );
  });
});
