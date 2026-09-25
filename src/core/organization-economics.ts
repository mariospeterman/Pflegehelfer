import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { activeRuntimeSitePackPath } from "./runtime-instructions.js";

const moneySchema = z.number().int().nonnegative();
const periodSchema = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/);

export const usageUnitSchema = z.enum([
  "input-token",
  "cached-input-token",
  "output-token",
  "speech-second",
  "speech-character",
]);
export type UsageUnit = z.infer<typeof usageUnitSchema>;

export const organizationCommercialConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    organizationId: z.string().min(1).max(120),
    version: z.number().int().positive(),
    effectiveFrom: z.iso.date(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    chargingEnabled: z.literal(false),
    pilot: z
      .object({
        status: z.enum(["not-agreed", "proposed", "agreed", "completed"]),
        amountMinor: moneySchema.nullable(),
        scope: z.array(z.string().min(1).max(160)).max(30),
      })
      .strict(),
    deployment: z
      .object({
        status: z.enum(["not-agreed", "proposed", "agreed", "completed"]),
        hosting: z.enum(["managed-cloud", "on-premises", "air-gapped"]),
        amountMinor: moneySchema.nullable(),
        separatelyQuoted: z
          .array(z.enum(["integration", "migration", "training", "hardware"]))
          .max(4),
      })
      .strict(),
    subscription: z
      .object({
        status: z.enum(["not-agreed", "proposed", "agreed", "active"]),
        monthlyAmountMinor: moneySchema.nullable(),
        siteIds: z.array(z.string().min(1).max(120)).max(100),
        workflowIds: z.array(z.string().min(1).max(120)).max(200),
        integrationIds: z.array(z.string().min(1).max(120)).max(100),
        supportDescription: z.string().min(1).max(500),
      })
      .strict(),
    usage: z
      .object({
        supplyMode: z.enum([
          "hosted-provider",
          "customer-owned-key",
          "local-inference",
        ]),
        includedAllowanceMinor: moneySchema,
        warningThresholdPercent: z
          .array(z.number().int().min(1).max(100))
          .min(1)
          .max(5),
        spendingLimitMinor: moneySchema.nullable(),
        rateCards: z
          .array(
            z
              .object({
                id: z.string().min(1).max(120),
                provider: z.string().min(1).max(120),
                service: z.enum(["inference", "speech"]),
                unit: usageUnitSchema,
                unitsPerPrice: z.number().int().positive(),
                providerPriceMinor: moneySchema,
                serviceMarginBasisPoints: z.number().int().min(0).max(10_000),
                currency: z.string().regex(/^[A-Z]{3}$/),
                effectiveFrom: z.iso.datetime(),
                effectiveTo: z.iso.datetime().nullable(),
              })
              .strict(),
          )
          .max(100),
      })
      .strict(),
  })
  .strict()
  .superRefine((configuration, context) => {
    const thresholds = configuration.usage.warningThresholdPercent;
    if (
      new Set(thresholds).size !== thresholds.length ||
      thresholds.some(
        (value, index) => index > 0 && value <= thresholds[index - 1]!,
      )
    )
      context.addIssue({
        code: "custom",
        path: ["usage", "warningThresholdPercent"],
        message: "Warning thresholds must be unique and strictly increasing.",
      });
    const rateIds = new Set<string>();
    for (const [index, rate] of configuration.usage.rateCards.entries()) {
      if (rateIds.has(rate.id))
        context.addIssue({
          code: "custom",
          path: ["usage", "rateCards", index, "id"],
          message: "Rate card ids must be unique.",
        });
      rateIds.add(rate.id);
      const unitMatchesService =
        rate.service === "speech"
          ? rate.unit === "speech-second" || rate.unit === "speech-character"
          : rate.unit === "input-token" ||
            rate.unit === "cached-input-token" ||
            rate.unit === "output-token";
      if (!unitMatchesService)
        context.addIssue({
          code: "custom",
          path: ["usage", "rateCards", index, "unit"],
          message: "Rate unit must match its provider service.",
        });
      if (
        rate.effectiveTo !== null &&
        Date.parse(rate.effectiveTo) <= Date.parse(rate.effectiveFrom)
      )
        context.addIssue({
          code: "custom",
          path: ["usage", "rateCards", index, "effectiveTo"],
          message: "Rate end must be after its start.",
        });
    }
    const rateGroups = new Map<
      string,
      Array<(typeof configuration.usage.rateCards)[number]>
    >();
    for (const rate of configuration.usage.rateCards) {
      const key = `${rate.provider}:${rate.service}:${rate.unit}:${rate.currency}`;
      const rates = rateGroups.get(key);
      if (rates) rates.push(rate);
      else rateGroups.set(key, [rate]);
    }
    for (const rates of rateGroups.values()) {
      const sorted = [...rates].sort(
        (left, right) =>
          Date.parse(left.effectiveFrom) - Date.parse(right.effectiveFrom),
      );
      for (let index = 1; index < sorted.length; index += 1) {
        const previous = sorted[index - 1]!;
        const current = sorted[index]!;
        if (
          previous.effectiveTo === null ||
          Date.parse(previous.effectiveTo) > Date.parse(current.effectiveFrom)
        )
          context.addIssue({
            code: "custom",
            path: ["usage", "rateCards"],
            message: `Rate cards overlap for ${current.provider}/${current.service}/${current.unit}.`,
          });
      }
    }
  });
export type OrganizationCommercialConfig = z.infer<
  typeof organizationCommercialConfigSchema
>;

export const organizationUsageReceiptSchema = z
  .object({
    receiptId: z.string().min(1).max(200),
    organizationId: z.string().min(1).max(120),
    provider: z.string().min(1).max(120),
    service: z.enum(["inference", "speech"]),
    model: z.string().min(1).max(160),
    occurredAt: z.iso.datetime(),
    source: z.enum(["provider-reported", "estimated", "unavailable"]),
    quantities: z
      .array(
        z.object({ unit: usageUnitSchema, quantity: moneySchema }).strict(),
      )
      .max(12),
    providerOutcome: z.enum(["completed", "cancelled", "failed", "uncertain"]),
  })
  .strict()
  .superRefine((receipt, context) => {
    const units = new Set<UsageUnit>();
    for (const [index, quantity] of receipt.quantities.entries()) {
      if (units.has(quantity.unit))
        context.addIssue({
          code: "custom",
          path: ["quantities", index, "unit"],
          message: "A provider receipt may contain each usage unit only once.",
        });
      units.add(quantity.unit);
      const unitMatchesService =
        receipt.service === "speech"
          ? quantity.unit === "speech-second" ||
            quantity.unit === "speech-character"
          : quantity.unit === "input-token" ||
            quantity.unit === "cached-input-token" ||
            quantity.unit === "output-token";
      if (!unitMatchesService)
        context.addIssue({
          code: "custom",
          path: ["quantities", index, "unit"],
          message: "Usage unit must match its provider service.",
        });
    }
  });
export type OrganizationUsageReceipt = z.infer<
  typeof organizationUsageReceiptSchema
>;

export interface OrganizationStatement {
  organizationId: string;
  period: string;
  currency: string;
  status: "review-draft";
  chargingEnabled: false;
  subscription: {
    status: OrganizationCommercialConfig["subscription"]["status"];
    amountMinor: number | null;
    definedScope: {
      siteIds: string[];
      workflowIds: string[];
      integrationIds: string[];
      supportDescription: string;
    };
  };
  usage: {
    sourceCoverage: {
      providerReported: number;
      estimated: number;
      unavailable: number;
    };
    quantities: Partial<Record<UsageUnit, number>>;
    providerCostMinor: number | null;
    marginMinor: number | null;
    allowanceMinor: number;
    additionalUsageMinor: number | null;
    chargeReason:
      | "hosted-metered"
      | "customer-owned-key-not-double-charged"
      | "local-inference-no-cloud-fee"
      | "usage-or-rate-unavailable";
  };
  preparedAmountMinor: number | null;
  budget: {
    spendingLimitMinor: number | null;
    measuredUsageMinor: number | null;
    percentUsed: number | null;
    alerts: number[];
    newInference: "allowed" | "paused" | "unavailable";
    manualWork: "unaffected";
    approvedDelivery: "unaffected";
  };
  limitations: string[];
}

function csvCell(value: string | number | null): string {
  const text = value === null ? "unavailable" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function organizationStatementCsv(
  statementInput: OrganizationStatement,
): string {
  const statement = statementInput;
  const rows: Array<[string, string | number | null, string]> = [
    ["organization_id", statement.organizationId, "identifier"],
    ["period", statement.period, "month"],
    ["statement_status", statement.status, "status"],
    ["charging_enabled", String(statement.chargingEnabled), "boolean"],
    [
      "subscription_amount_minor",
      statement.subscription.amountMinor,
      statement.currency,
    ],
    [
      "provider_cost_minor",
      statement.usage.providerCostMinor,
      statement.currency,
    ],
    ["service_margin_minor", statement.usage.marginMinor, statement.currency],
    [
      "included_allowance_minor",
      statement.usage.allowanceMinor,
      statement.currency,
    ],
    [
      "additional_usage_minor",
      statement.usage.additionalUsageMinor,
      statement.currency,
    ],
    [
      "prepared_amount_minor",
      statement.preparedAmountMinor,
      statement.currency,
    ],
    [
      "provider_reported_receipts",
      statement.usage.sourceCoverage.providerReported,
      "count",
    ],
    ["estimated_receipts", statement.usage.sourceCoverage.estimated, "count"],
    [
      "unavailable_receipts",
      statement.usage.sourceCoverage.unavailable,
      "count",
    ],
    ["usage_charge_reason", statement.usage.chargeReason, "status"],
    [
      "spending_limit_minor",
      statement.budget.spendingLimitMinor,
      statement.currency,
    ],
    [
      "measured_usage_minor",
      statement.budget.measuredUsageMinor,
      statement.currency,
    ],
    ["new_inference", statement.budget.newInference, "status"],
    ["manual_work", statement.budget.manualWork, "status"],
    ["approved_delivery", statement.budget.approvedDelivery, "status"],
  ];
  return [
    "metric,value,unit",
    ...rows.map((row) => row.map(csvCell).join(",")),
  ].join("\n");
}

function inPeriod(timestamp: string, period: string): boolean {
  return timestamp.slice(0, 7) === period;
}

function applicableRate(
  config: OrganizationCommercialConfig,
  receipt: OrganizationUsageReceipt,
  unit: UsageUnit,
) {
  const at = Date.parse(receipt.occurredAt);
  return config.usage.rateCards
    .filter(
      (rate) =>
        rate.provider === receipt.provider &&
        rate.service === receipt.service &&
        rate.unit === unit &&
        rate.currency === config.currency &&
        Date.parse(rate.effectiveFrom) <= at &&
        (rate.effectiveTo === null || at < Date.parse(rate.effectiveTo)),
    )
    .sort(
      (left, right) =>
        Date.parse(right.effectiveFrom) - Date.parse(left.effectiveFrom),
    )[0];
}

export function buildOrganizationStatement(
  configuration: OrganizationCommercialConfig,
  receipts: readonly OrganizationUsageReceipt[],
  periodInput: string,
): OrganizationStatement {
  const config = organizationCommercialConfigSchema.parse(configuration);
  const period = periodSchema.parse(periodInput);
  const scoped = receipts
    .map((receipt) => organizationUsageReceiptSchema.parse(receipt))
    .filter(
      (receipt) =>
        receipt.organizationId === config.organizationId &&
        inPeriod(receipt.occurredAt, period),
    );
  const quantities: Partial<Record<UsageUnit, number>> = {};
  const sourceCoverage = {
    providerReported: 0,
    estimated: 0,
    unavailable: 0,
  };
  let providerCostMinor = 0;
  let marginMinor = 0;
  let usageCostComplete = true;
  const rateBuckets = new Map<
    string,
    {
      quantity: number;
      providerPriceMinor: number;
      unitsPerPrice: number;
      serviceMarginBasisPoints: number;
    }
  >();
  for (const receipt of scoped) {
    if (receipt.source === "provider-reported")
      sourceCoverage.providerReported += 1;
    else if (receipt.source === "estimated") sourceCoverage.estimated += 1;
    else sourceCoverage.unavailable += 1;
    for (const quantity of receipt.quantities)
      quantities[quantity.unit] =
        (quantities[quantity.unit] ?? 0) + quantity.quantity;
    if (
      receipt.source !== "provider-reported" ||
      receipt.providerOutcome !== "completed"
    ) {
      usageCostComplete = false;
      continue;
    }
    for (const quantity of receipt.quantities) {
      const rate = applicableRate(config, receipt, quantity.unit);
      if (!rate) {
        usageCostComplete = false;
        continue;
      }
      const bucket = rateBuckets.get(rate.id);
      rateBuckets.set(rate.id, {
        quantity: (bucket?.quantity ?? 0) + quantity.quantity,
        providerPriceMinor: rate.providerPriceMinor,
        unitsPerPrice: rate.unitsPerPrice,
        serviceMarginBasisPoints: rate.serviceMarginBasisPoints,
      });
    }
  }
  for (const bucket of rateBuckets.values()) {
    const cost = Math.ceil(
      (bucket.quantity * bucket.providerPriceMinor) / bucket.unitsPerPrice,
    );
    providerCostMinor += cost;
    marginMinor += Math.ceil((cost * bucket.serviceMarginBasisPoints) / 10_000);
  }
  if (scoped.length === 0) usageCostComplete = false;
  const supplyMode = config.usage.supplyMode;
  const chargeReason =
    supplyMode === "customer-owned-key"
      ? ("customer-owned-key-not-double-charged" as const)
      : supplyMode === "local-inference"
        ? ("local-inference-no-cloud-fee" as const)
        : usageCostComplete
          ? ("hosted-metered" as const)
          : ("usage-or-rate-unavailable" as const);
  const meteredMinor = usageCostComplete
    ? providerCostMinor + marginMinor
    : null;
  const additionalUsageMinor =
    supplyMode === "hosted-provider"
      ? meteredMinor === null
        ? null
        : Math.max(0, meteredMinor - config.usage.includedAllowanceMinor)
      : 0;
  const subscriptionMinor =
    config.subscription.status === "active"
      ? config.subscription.monthlyAmountMinor
      : 0;
  const preparedAmountMinor =
    subscriptionMinor === null || additionalUsageMinor === null
      ? null
      : subscriptionMinor + additionalUsageMinor;
  const budgetMeasured = supplyMode === "hosted-provider" ? meteredMinor : 0;
  const spendingLimit = config.usage.spendingLimitMinor;
  const percentUsed =
    spendingLimit === 0 && budgetMeasured !== null
      ? 100
      : spendingLimit !== null && budgetMeasured !== null
        ? Math.floor((budgetMeasured * 100) / spendingLimit)
        : null;
  const alerts =
    percentUsed === null
      ? []
      : config.usage.warningThresholdPercent.filter(
          (threshold) => percentUsed >= threshold,
        );
  return {
    organizationId: config.organizationId,
    period,
    currency: config.currency,
    status: "review-draft",
    chargingEnabled: false,
    subscription: {
      status: config.subscription.status,
      amountMinor: subscriptionMinor,
      definedScope: {
        siteIds: config.subscription.siteIds,
        workflowIds: config.subscription.workflowIds,
        integrationIds: config.subscription.integrationIds,
        supportDescription: config.subscription.supportDescription,
      },
    },
    usage: {
      sourceCoverage,
      quantities,
      providerCostMinor: usageCostComplete ? providerCostMinor : null,
      marginMinor: usageCostComplete ? marginMinor : null,
      allowanceMinor: config.usage.includedAllowanceMinor,
      additionalUsageMinor,
      chargeReason,
    },
    preparedAmountMinor,
    budget: {
      spendingLimitMinor: spendingLimit,
      measuredUsageMinor: budgetMeasured,
      percentUsed,
      alerts,
      newInference:
        spendingLimit === null || budgetMeasured === null
          ? "unavailable"
          : budgetMeasured >= spendingLimit
            ? "paused"
            : "allowed",
      manualWork: "unaffected",
      approvedDelivery: "unaffected",
    },
    limitations: [
      "This is a reviewable statement draft; payment collection is disabled.",
      "No employee, account, device, role, login, presence, or private-chat charge is calculated.",
      "Unknown usage or an unavailable rate remains unavailable rather than zero.",
      "Pilot, deployment, training, migration, integration, hardware, local compute and support require their separately agreed terms.",
    ],
  };
}

export const organizationStatementPeriodSchema = periodSchema;

export function loadOrganizationCommercialConfig(
  path = process.env.PFH_COMMERCIAL_CONFIG_PATH ??
    resolve(activeRuntimeSitePackPath, "commercial.json"),
): OrganizationCommercialConfig {
  return organizationCommercialConfigSchema.parse(
    JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8")),
  );
}
