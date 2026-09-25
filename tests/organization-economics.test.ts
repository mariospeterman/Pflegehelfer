import { afterEach, describe, expect, it } from "vitest";
import {
  buildOrganizationStatement,
  loadOrganizationCommercialConfig,
  type OrganizationCommercialConfig,
  type OrganizationUsageReceipt,
} from "../src/core/organization-economics.js";
import { InMemoryCommercialStore } from "../src/infrastructure/commercial-store.js";
import { buildApp } from "../src/server/app.js";

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

function config(
  supplyMode: OrganizationCommercialConfig["usage"]["supplyMode"] = "hosted-provider",
): OrganizationCommercialConfig {
  return {
    schemaVersion: 1,
    organizationId: "org-demo",
    version: 1,
    effectiveFrom: "2026-09-01",
    currency: "CHF",
    chargingEnabled: false,
    pilot: {
      status: "proposed",
      amountMinor: 25_000,
      scope: ["Measured workflow pilot"],
    },
    deployment: {
      status: "not-agreed",
      hosting: "managed-cloud",
      amountMinor: null,
      separatelyQuoted: ["integration", "migration", "training", "hardware"],
    },
    subscription: {
      status: "active",
      monthlyAmountMinor: 100_000,
      siteIds: ["rehab-2", "rehab-3"],
      workflowIds: ["nursing-day"],
      integrationIds: ["provider-a"],
      supportDescription: "Defined organization support scope.",
    },
    usage: {
      supplyMode,
      includedAllowanceMinor: 100,
      warningThresholdPercent: [50, 80, 100],
      spendingLimitMinor: 1_000,
      rateCards: [
        {
          id: "provider-a-input-2026-09",
          provider: "provider-a",
          service: "inference",
          unit: "input-token",
          unitsPerPrice: 1_000,
          providerPriceMinor: 100,
          serviceMarginBasisPoints: 1_000,
          currency: "CHF",
          effectiveFrom: "2026-09-01T00:00:00.000Z",
          effectiveTo: null,
        },
        {
          id: "provider-a-output-2026-09",
          provider: "provider-a",
          service: "inference",
          unit: "output-token",
          unitsPerPrice: 1_000,
          providerPriceMinor: 200,
          serviceMarginBasisPoints: 1_000,
          currency: "CHF",
          effectiveFrom: "2026-09-01T00:00:00.000Z",
          effectiveTo: null,
        },
      ],
    },
  };
}

const receipt: OrganizationUsageReceipt = {
  receiptId: "provider-receipt-1",
  organizationId: "org-demo",
  provider: "provider-a",
  service: "inference",
  model: "synthetic-model",
  occurredAt: "2026-09-21T09:00:00.000Z",
  source: "provider-reported",
  quantities: [
    { unit: "input-token", quantity: 5_000 },
    { unit: "output-token", quantity: 2_000 },
  ],
  providerOutcome: "completed",
};

describe("organization-based commercial model", () => {
  it("prepares an organization statement from provider-reported pooled usage", () => {
    const statement = buildOrganizationStatement(
      config(),
      [receipt],
      "2026-09",
    );
    expect(statement).toMatchObject({
      chargingEnabled: false,
      subscription: { amountMinor: 100_000 },
      usage: {
        providerCostMinor: 900,
        marginMinor: 90,
        allowanceMinor: 100,
        additionalUsageMinor: 890,
        chargeReason: "hosted-metered",
        sourceCoverage: {
          providerReported: 1,
          estimated: 0,
          unavailable: 0,
        },
      },
      preparedAmountMinor: 100_890,
      budget: {
        measuredUsageMinor: 990,
        percentUsed: 99,
        alerts: [50, 80],
        newInference: "allowed",
        manualWork: "unaffected",
        approvedDelivery: "unaffected",
      },
    });
    expect(JSON.stringify(statement)).not.toMatch(
      /seat|user charge|device charge/i,
    );
  });

  it("rounds effective-rate usage after pooling receipts instead of per request", () => {
    const small = config();
    small.usage.includedAllowanceMinor = 0;
    small.usage.rateCards = [
      {
        id: "provider-a-input-2026-09",
        provider: "provider-a",
        service: "inference",
        unit: "input-token",
        unitsPerPrice: 1_000,
        providerPriceMinor: 1,
        serviceMarginBasisPoints: 0,
        currency: "CHF",
        effectiveFrom: "2026-09-01T00:00:00.000Z",
        effectiveTo: null,
      },
    ];
    const first = structuredClone(receipt);
    first.receiptId = "small-1";
    first.quantities = [{ unit: "input-token", quantity: 100 }];
    const second = structuredClone(first);
    second.receiptId = "small-2";
    const statement = buildOrganizationStatement(
      small,
      [first, second],
      "2026-09",
    );
    expect(statement.usage.providerCostMinor).toBe(1);
  });

  it("shows BYO-key usage without charging provider consumption twice", () => {
    const statement = buildOrganizationStatement(
      config("customer-owned-key"),
      [receipt],
      "2026-09",
    );
    expect(statement.usage).toMatchObject({
      providerCostMinor: 900,
      additionalUsageMinor: 0,
      chargeReason: "customer-owned-key-not-double-charged",
    });
    expect(statement.preparedAmountMinor).toBe(100_000);
  });

  it("does not invent cloud fees for local inference or unknown usage", () => {
    const local = buildOrganizationStatement(
      config("local-inference"),
      [receipt],
      "2026-09",
    );
    expect(local.usage).toMatchObject({
      additionalUsageMinor: 0,
      chargeReason: "local-inference-no-cloud-fee",
    });
    const unknown = structuredClone(receipt);
    unknown.source = "unavailable";
    unknown.quantities = [];
    const unavailable = buildOrganizationStatement(
      config(),
      [unknown],
      "2026-09",
    );
    expect(unavailable.usage).toMatchObject({
      providerCostMinor: null,
      additionalUsageMinor: null,
      chargeReason: "usage-or-rate-unavailable",
    });
    expect(unavailable.preparedAmountMinor).toBeNull();
    expect(unavailable.budget.newInference).toBe("unavailable");
  });

  it("treats a configured zero spending limit as an immediate inference pause", () => {
    const limited = config();
    limited.usage.spendingLimitMinor = 0;
    const statement = buildOrganizationStatement(limited, [receipt], "2026-09");
    expect(statement.budget).toMatchObject({
      percentUsed: 100,
      alerts: [50, 80, 100],
      newInference: "paused",
      manualWork: "unaffected",
      approvedDelivery: "unaffected",
    });
  });

  it("deduplicates provider receipts and version-checks configuration", async () => {
    const store = new InMemoryCommercialStore();
    await store.initialize(config());
    expect(await store.recordUsage(receipt)).toBe(true);
    expect(await store.recordUsage(receipt)).toBe(false);
    expect(await store.listUsage("org-demo", "2026-09")).toHaveLength(1);
    const next = await store.updateConfiguration(config(), 1);
    expect(next.version).toBe(2);
    await expect(store.updateConfiguration(next, 1)).rejects.toThrow(
      "COMMERCIAL_CONFIGURATION_VERSION_CONFLICT",
    );
  });

  it("loads commercial scope from an explicitly selected second-site pack", () => {
    const loaded = loadOrganizationCommercialConfig(
      "config/sites/packs/alpenblick-demo/commercial.json",
    );
    expect(loaded).toMatchObject({
      organizationId: "org-alpenblick-demo",
      chargingEnabled: false,
      subscription: { siteIds: ["alpenblick-wohnbereich-a"] },
    });
    expect(loaded.subscription.monthlyAmountMinor).toBeNull();
  });

  it("exposes a role-scoped admin statement and preserves permissions", async () => {
    const commercialStore = new InMemoryCommercialStore();
    await commercialStore.initialize(config());
    const app = buildApp(undefined, { demoMode: true, commercialStore });
    apps.push(app);
    const imported = await app.inject({
      method: "POST",
      url: "/api/v1/admin/organization-economics/usage-receipts",
      headers: {
        "x-demo-user": "u-it",
        "x-command-id": "4bb74ab1-81ed-4e48-873f-e466bd478832",
      },
      payload: receipt,
    });
    expect(imported.statusCode).toBe(201);
    const report = await app.inject({
      method: "GET",
      url: "/api/v1/admin/organization-economics?period=2026-09",
      headers: { "x-demo-user": "u-manager" },
    });
    expect(report.statusCode).toBe(200);
    expect(report.json()).toMatchObject({
      configuration: {
        organizationId: "org-demo",
        chargingEnabled: false,
      },
      statement: {
        preparedAmountMinor: 100_890,
        chargingEnabled: false,
      },
    });
    const statementCsv = await app.inject({
      method: "GET",
      url: "/api/v1/admin/organization-economics/statement.csv?period=2026-09",
      headers: { "x-demo-user": "u-quality" },
    });
    expect(statementCsv.statusCode).toBe(200);
    expect(statementCsv.headers["content-type"]).toContain("text/csv");
    expect(statementCsv.body).toContain("provider_reported_receipts,1,count");
    expect(statementCsv.body).toContain("charging_enabled,false,boolean");
    expect(statementCsv.body).not.toMatch(/seat|employee|private.chat/i);
    const denied = await app.inject({
      method: "GET",
      url: "/api/v1/admin/organization-economics?period=2026-09",
      headers: { "x-demo-user": "u-nurse" },
    });
    expect(denied.statusCode).toBe(403);
  });
});
