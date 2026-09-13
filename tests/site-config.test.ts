import { describe, expect, it } from "vitest";
import {
  activeSitePackPath,
  configuredRoleProfile,
  parseSiteConfiguration,
  runtimeSitePack,
  siteConfiguration,
} from "../src/core/site-config.js";
import {
  loadRuntimeSitePack,
  validateRuntimeSitePackBindings,
} from "../src/core/runtime-instructions.js";

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
  it("accepts an explicitly assigned shift with no patients", () => {
    const pack = structuredClone(siteConfiguration);
    pack.staffAssignments[0]!.patientIds = [];
    expect(
      parseSiteConfiguration(pack).staffAssignments[0]!.patientIds,
    ).toEqual([]);
  });

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

  it("loads the active immutable directory pack", () => {
    expect(activeSitePackPath).toMatch(/sites\/packs\/tertianum-kronenhof$/);
    expect(runtimeSitePack).toMatchObject({
      sourceFormat: "directory-v2",
      status: "published",
      siteId: siteConfiguration.siteId,
    });
    expect(runtimeSitePack.packDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(runtimeSitePack.instructions)).toBe(true);
  });

  it("ships a second institution pack that validates independently", () => {
    const pack = loadRuntimeSitePack(
      new URL("../config/sites/packs/alpenblick-demo", import.meta.url)
        .pathname,
    );
    const parsed = parseSiteConfiguration(pack.siteConfigurationInput);
    validateRuntimeSitePackBindings(
      pack,
      parsed,
      new Set(Object.keys(parsed.roleProfiles)),
    );
    expect(parsed.institutionId).toBe("org-alpenblick-demo");
    expect(parsed.displayName).toContain("Alpenblick");
    expect(parsed.shifts.early?.startsAt).toBe("07:00");
    expect(parsed.providerRoutes).toMatchObject({
      careDocumentation: "wicare",
      observations: "sap-vitals",
    });
    expect(
      parsed.staffAssignments.find(
        (assignment) => assignment.actorId === "u-assistant",
      )?.patientIds,
    ).toHaveLength(3);
    expect(parsed.workflows["nursing-day"]?.version).toBe(3);
  });

  it("binds configurable Swiss role labels to an existing narrow policy", () => {
    const fage = configuredRoleProfile("fage-efz");
    const hf = configuredRoleProfile("pflege-hf");
    expect(fage.role).toBe("registered-nurse");
    expect(hf.role).toBe("registered-nurse");
    expect(hf.actions).toEqual(fage.actions);
    expect(hf.label).toBe("Dipl. Pflegefachperson HF");
  });

  it("prevents a site pack from expanding the centrally reviewed role ceiling", () => {
    const pack = structuredClone(siteConfiguration);
    pack.roleProfiles.management.actions.push("patient:read");
    expect(() => parseSiteConfiguration(pack)).toThrow(
      /cannot grant patient:read to management/i,
    );
  });
});
