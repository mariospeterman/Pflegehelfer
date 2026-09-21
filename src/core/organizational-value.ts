import { z } from "zod";

export const valueDataClassSchema = z.enum([
  "observed",
  "customer-reported",
  "estimated",
  "synthetic",
]);
export type ValueDataClass = z.infer<typeof valueDataClassSchema>;

const alternativeSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{2,80}$/),
    label: z.string().trim().min(2).max(160),
    kind: z.enum([
      "current-process",
      "improved-incumbent",
      "approved-general-assistant",
      "pflegehelfer",
    ]),
    availability: z.enum(["measured", "available-not-measured", "unavailable"]),
    basis: z.string().trim().min(2).max(500),
  })
  .strict();

const responsibilityTransferBlock = z
  .object({
    eligible: z.number().int().nonnegative(),
    acceptedInWindow: z.number().int().nonnegative(),
    unresolved: z.number().int().nonnegative(),
    missingOwner: z.number().int().nonnegative(),
    missingWindow: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.acceptedInWindow + value.unresolved > value.eligible)
      context.addIssue({
        code: "custom",
        message: "Outcome counts cannot exceed eligible work.",
      });
    if (
      value.missingOwner > value.unresolved ||
      value.missingWindow > value.unresolved
    )
      context.addIssue({
        code: "custom",
        message: "Missing owner/window counts must be unresolved transfers.",
      });
  });

const deliveryBlock = z
  .object({
    eligible: z.number().int().nonnegative(),
    verified: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    uncertain: z.number().int().nonnegative(),
    oldestPendingMinutes: z.number().nonnegative().nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.verified + value.rejected + value.pending + value.uncertain >
      value.eligible
    )
      context.addIssue({
        code: "custom",
        message: "Delivery outcomes cannot exceed eligible destinations.",
      });
  });

const observationSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9:_-]{2,120}$/),
    alternativeId: z.string().regex(/^[a-z0-9-]{2,80}$/),
    dataClass: valueDataClassSchema,
    observedAt: z.iso.datetime(),
    eligibleActivities: z.number().int().positive(),
    administrativeMinutes: z
      .object({
        capture: z.number().nonnegative(),
        review: z.number().nonnegative(),
        correction: z.number().nonnegative(),
        failedAttempts: z.number().nonnegative(),
        downstreamReconciliation: z.number().nonnegative(),
      })
      .strict()
      .optional(),
    repeatedEntries: z.number().int().nonnegative().optional(),
    responsibilityTransfers: responsibilityTransferBlock.optional(),
    deliveries: deliveryBlock.optional(),
    faithfulnessReview: z
      .object({
        reviewedRecords: z.number().int().nonnegative(),
        unsupportedAdditions: z.number().int().nonnegative(),
        omissions: z.number().int().nonnegative(),
        wrongSubjectTimeOrStatus: z.number().int().nonnegative(),
        factualCorrections: z.number().int().nonnegative(),
        stylisticEdits: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    usefulness: z
      .object({
        invited: z.number().int().nonnegative(),
        responses: z.number().int().nonnegative(),
        scoreTotal: z.number().nonnegative(),
        scoreMaximum: z.number().positive(),
      })
      .strict()
      .superRefine((value, context) => {
        if (value.responses > value.invited)
          context.addIssue({
            code: "custom",
            message: "Responses cannot exceed invited participants.",
          });
        if (value.scoreTotal > value.responses * value.scoreMaximum)
          context.addIssue({
            code: "custom",
            message: "Usefulness score exceeds the declared scale.",
          });
      })
      .optional(),
    serviceCost: z
      .object({
        amount: z.number().nonnegative(),
        currency: z.string().regex(/^[A-Z]{3}$/),
      })
      .strict()
      .optional(),
  })
  .strict();

export const organizationalValueInputSchema = z
  .object({
    definition: z
      .object({
        id: z.string().regex(/^[a-z0-9-]{2,100}$/),
        version: z.number().int().positive(),
        organizationId: z.string().min(2).max(100),
        wardId: z.string().min(2).max(100),
        workflowId: z.string().min(2).max(100),
        periodStart: z.iso.datetime(),
        periodEnd: z.iso.datetime(),
        ownerRole: z.string().min(2).max(100),
        reviewDecisionAt: z.iso.datetime(),
        baselineAlternativeId: z.string().regex(/^[a-z0-9-]{2,80}$/),
        targetAlternativeId: z.string().regex(/^[a-z0-9-]{2,80}$/),
        comparisonDataClass: valueDataClassSchema,
        exclusions: z.array(z.string().trim().min(2).max(300)).max(20),
        targets: z
          .object({
            minimumEligibleActivities: z.number().int().positive(),
            minimumReleasedMinutesPerActivity: z.number(),
            maximumDeliveryFailureRate: z.number().min(0).max(1),
            maximumFaithfulnessErrorRate: z.number().min(0).max(1),
          })
          .strict(),
      })
      .strict(),
    alternatives: z.array(alternativeSchema).min(2).max(8),
    observations: z.array(observationSchema).max(5_000),
    economicInput: z
      .object({
        loadedHourlyRate: z.number().positive(),
        currency: z.string().regex(/^[A-Z]{3}$/),
        dataClass: z.enum(["customer-reported", "estimated"]),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const ids = new Set(input.alternatives.map(({ id }) => id));
    if (ids.size !== input.alternatives.length)
      context.addIssue({
        code: "custom",
        path: ["alternatives"],
        message: "Alternative identifiers must be unique.",
      });
    for (const field of [
      "baselineAlternativeId",
      "targetAlternativeId",
    ] as const)
      if (!ids.has(input.definition[field]))
        context.addIssue({
          code: "custom",
          path: ["definition", field],
          message: "Configured comparison alternative is missing.",
        });
    if (
      input.definition.baselineAlternativeId ===
      input.definition.targetAlternativeId
    )
      context.addIssue({
        code: "custom",
        path: ["definition", "targetAlternativeId"],
        message: "Baseline and target alternatives must differ.",
      });
    const observedIds = new Map<string, string>();
    const periodStart = Date.parse(input.definition.periodStart);
    const periodEnd = Date.parse(input.definition.periodEnd);
    input.observations.forEach((observation, index) => {
      if (!ids.has(observation.alternativeId))
        context.addIssue({
          code: "custom",
          path: ["observations", index, "alternativeId"],
          message: "Observation references an unknown alternative.",
        });
      const serialized = canonical(observation);
      const previous = observedIds.get(observation.id);
      if (previous !== undefined && previous !== serialized)
        context.addIssue({
          code: "custom",
          path: ["observations", index, "id"],
          message: `Observation ${observation.id} was retried with different content.`,
        });
      observedIds.set(observation.id, serialized);
      const observedAt = Date.parse(observation.observedAt);
      if (observedAt < periodStart || observedAt > periodEnd)
        context.addIssue({
          code: "custom",
          path: ["observations", index, "observedAt"],
          message: "Observation falls outside the declared evaluation period.",
        });
    });
    if (
      Date.parse(input.definition.periodStart) >=
      Date.parse(input.definition.periodEnd)
    )
      context.addIssue({
        code: "custom",
        path: ["definition", "periodEnd"],
        message: "Evaluation period must end after it starts.",
      });
  });

export type OrganizationalValueInput = z.infer<
  typeof organizationalValueInputSchema
>;

type Metric<T> =
  { status: "measured"; value: T } | { status: "not-measured"; reason: string };

interface AggregatedAlternative {
  alternativeId: string;
  dataClass: ValueDataClass;
  observationCount: number;
  eligibleActivities: number;
  administrativeEffort: Metric<{
    totalMinutes: number;
    minutesPerEligibleActivity: number;
    captureMinutes: number;
    reviewMinutes: number;
    correctionMinutes: number;
    failedAttemptMinutes: number;
    downstreamReconciliationMinutes: number;
  }>;
  repeatedEntries: Metric<{ total: number; perEligibleActivity: number }>;
  responsibilityTransfer: Metric<{
    eligible: number;
    acceptedInWindow: number;
    unresolved: number;
    missingOwner: number;
    missingWindow: number;
    unclassified: number;
    acceptanceRate: number | null;
  }>;
  deliveryCompleteness: Metric<{
    eligible: number;
    verified: number;
    rejected: number;
    pending: number;
    uncertain: number;
    unclassified: number;
    oldestPendingMinutes: number | null;
    verifiedRate: number | null;
  }>;
  faithfulness: Metric<{
    reviewedRecords: number;
    factualErrors: number;
    factualErrorRate: number | null;
    factualCorrections: number;
    stylisticEdits: number;
  }>;
  usefulness: Metric<{
    invited: number;
    responses: number;
    responseRate: number | null;
    meanScore: number | null;
    scoreMaximum: number;
  }>;
  serviceCost: Metric<{ amount: number; currency: string }>;
}

export interface OrganizationalValueReport {
  definition: OrganizationalValueInput["definition"];
  alternatives: OrganizationalValueInput["alternatives"];
  measurements: AggregatedAlternative[];
  comparison: {
    status: "measured" | "not-measured";
    dataClass: ValueDataClass;
    baselineAlternativeId: string;
    targetAlternativeId: string;
    baselineMinutesPerActivity: number | null;
    targetMinutesPerActivity: number | null;
    releasedAdministrativeMinutesPerActivity: number | null;
    direction: "improvement" | "no-change" | "negative" | "unknown";
    opportunityValue: {
      amountPerEligibleActivity: number;
      currency: string;
      dataClass: "customer-reported" | "estimated";
      label: "modeled-opportunity-value-not-cash-saving";
    } | null;
    reason: string | null;
  };
  decision:
    | "continue-measuring"
    | "change-workflow"
    | "do-not-roll-out"
    | "consider-limited-pilot";
  limitations: string[];
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : round(numerator / denominator);
}

function aggregate(
  alternativeId: string,
  dataClass: ValueDataClass,
  observations: OrganizationalValueInput["observations"],
): AggregatedAlternative {
  const selected = observations.filter(
    (observation) =>
      observation.alternativeId === alternativeId &&
      observation.dataClass === dataClass,
  );
  const eligibleActivities = selected.reduce(
    (sum, observation) => sum + observation.eligibleActivities,
    0,
  );
  const administrative = selected.filter(
    (observation) => observation.administrativeMinutes !== undefined,
  );
  const effort = administrative.reduce(
    (totals, observation) => {
      const value = observation.administrativeMinutes!;
      totals.capture += value.capture;
      totals.review += value.review;
      totals.correction += value.correction;
      totals.failedAttempts += value.failedAttempts;
      totals.downstreamReconciliation += value.downstreamReconciliation;
      totals.eligible += observation.eligibleActivities;
      return totals;
    },
    {
      capture: 0,
      review: 0,
      correction: 0,
      failedAttempts: 0,
      downstreamReconciliation: 0,
      eligible: 0,
    },
  );
  const totalMinutes =
    effort.capture +
    effort.review +
    effort.correction +
    effort.failedAttempts +
    effort.downstreamReconciliation;
  const repeated = selected.filter(
    (observation) => observation.repeatedEntries !== undefined,
  );
  const transfer = selected.flatMap((observation) =>
    observation.responsibilityTransfers
      ? [observation.responsibilityTransfers]
      : [],
  );
  const delivery = selected.flatMap((observation) =>
    observation.deliveries ? [observation.deliveries] : [],
  );
  const faithfulness = selected.flatMap((observation) =>
    observation.faithfulnessReview ? [observation.faithfulnessReview] : [],
  );
  const usefulness = selected.flatMap((observation) =>
    observation.usefulness ? [observation.usefulness] : [],
  );
  const costs = selected.flatMap((observation) =>
    observation.serviceCost ? [observation.serviceCost] : [],
  );
  const transferTotals = transfer.reduce(
    (sum, item) => ({
      eligible: sum.eligible + item.eligible,
      acceptedInWindow: sum.acceptedInWindow + item.acceptedInWindow,
      unresolved: sum.unresolved + item.unresolved,
      missingOwner: sum.missingOwner + item.missingOwner,
      missingWindow: sum.missingWindow + item.missingWindow,
    }),
    {
      eligible: 0,
      acceptedInWindow: 0,
      unresolved: 0,
      missingOwner: 0,
      missingWindow: 0,
    },
  );
  const deliveryTotals = delivery.reduce(
    (sum, item) => ({
      eligible: sum.eligible + item.eligible,
      verified: sum.verified + item.verified,
      rejected: sum.rejected + item.rejected,
      pending: sum.pending + item.pending,
      uncertain: sum.uncertain + item.uncertain,
      oldestPendingMinutes:
        item.oldestPendingMinutes === null
          ? sum.oldestPendingMinutes
          : Math.max(sum.oldestPendingMinutes ?? 0, item.oldestPendingMinutes),
    }),
    {
      eligible: 0,
      verified: 0,
      rejected: 0,
      pending: 0,
      uncertain: 0,
      oldestPendingMinutes: null as number | null,
    },
  );
  const faithfulnessTotals = faithfulness.reduce(
    (sum, item) => ({
      reviewedRecords: sum.reviewedRecords + item.reviewedRecords,
      factualErrors:
        sum.factualErrors +
        item.unsupportedAdditions +
        item.omissions +
        item.wrongSubjectTimeOrStatus,
      factualCorrections: sum.factualCorrections + item.factualCorrections,
      stylisticEdits: sum.stylisticEdits + item.stylisticEdits,
    }),
    {
      reviewedRecords: 0,
      factualErrors: 0,
      factualCorrections: 0,
      stylisticEdits: 0,
    },
  );
  const usefulnessTotals = usefulness.reduce(
    (sum, item) => ({
      invited: sum.invited + item.invited,
      responses: sum.responses + item.responses,
      scoreTotal: sum.scoreTotal + item.scoreTotal,
      maximums: [...sum.maximums, item.scoreMaximum],
    }),
    { invited: 0, responses: 0, scoreTotal: 0, maximums: [] as number[] },
  );
  const currencies = new Set(costs.map(({ currency }) => currency));
  return {
    alternativeId,
    dataClass,
    observationCount: selected.length,
    eligibleActivities,
    administrativeEffort:
      administrative.length === 0
        ? {
            status: "not-measured",
            reason: "No administrative effort observation.",
          }
        : {
            status: "measured",
            value: {
              totalMinutes: round(totalMinutes),
              minutesPerEligibleActivity: round(totalMinutes / effort.eligible),
              captureMinutes: round(effort.capture),
              reviewMinutes: round(effort.review),
              correctionMinutes: round(effort.correction),
              failedAttemptMinutes: round(effort.failedAttempts),
              downstreamReconciliationMinutes: round(
                effort.downstreamReconciliation,
              ),
            },
          },
    repeatedEntries:
      repeated.length === 0
        ? { status: "not-measured", reason: "No repeated-entry observation." }
        : {
            status: "measured",
            value: {
              total: repeated.reduce(
                (sum, observation) => sum + observation.repeatedEntries!,
                0,
              ),
              perEligibleActivity: round(
                repeated.reduce(
                  (sum, observation) => sum + observation.repeatedEntries!,
                  0,
                ) /
                  repeated.reduce(
                    (sum, observation) => sum + observation.eligibleActivities,
                    0,
                  ),
              ),
            },
          },
    responsibilityTransfer:
      transfer.length === 0
        ? { status: "not-measured", reason: "No transfer observation." }
        : {
            status: "measured",
            value: {
              eligible: transferTotals.eligible,
              acceptedInWindow: transferTotals.acceptedInWindow,
              unresolved: transferTotals.unresolved,
              missingOwner: transferTotals.missingOwner,
              missingWindow: transferTotals.missingWindow,
              unclassified:
                transferTotals.eligible -
                transferTotals.acceptedInWindow -
                transferTotals.unresolved,
              acceptanceRate: ratio(
                transferTotals.acceptedInWindow,
                transferTotals.eligible,
              ),
            },
          },
    deliveryCompleteness:
      delivery.length === 0
        ? { status: "not-measured", reason: "No delivery observation." }
        : {
            status: "measured",
            value: {
              eligible: deliveryTotals.eligible,
              verified: deliveryTotals.verified,
              rejected: deliveryTotals.rejected,
              pending: deliveryTotals.pending,
              uncertain: deliveryTotals.uncertain,
              unclassified:
                deliveryTotals.eligible -
                deliveryTotals.verified -
                deliveryTotals.rejected -
                deliveryTotals.pending -
                deliveryTotals.uncertain,
              oldestPendingMinutes: deliveryTotals.oldestPendingMinutes,
              verifiedRate: ratio(
                deliveryTotals.verified,
                deliveryTotals.eligible,
              ),
            },
          },
    faithfulness:
      faithfulness.length === 0
        ? {
            status: "not-measured",
            reason: "No adjudicated faithfulness sample.",
          }
        : {
            status: "measured",
            value: {
              ...faithfulnessTotals,
              factualErrorRate: ratio(
                faithfulnessTotals.factualErrors,
                faithfulnessTotals.reviewedRecords,
              ),
            },
          },
    usefulness:
      usefulness.length === 0
        ? { status: "not-measured", reason: "No voluntary usefulness sample." }
        : {
            status: "measured",
            value: {
              invited: usefulnessTotals.invited,
              responses: usefulnessTotals.responses,
              responseRate: ratio(
                usefulnessTotals.responses,
                usefulnessTotals.invited,
              ),
              meanScore:
                usefulnessTotals.responses === 0
                  ? null
                  : round(
                      usefulnessTotals.scoreTotal / usefulnessTotals.responses,
                    ),
              scoreMaximum:
                new Set(usefulnessTotals.maximums).size === 1
                  ? usefulnessTotals.maximums[0]!
                  : Math.max(0, ...usefulnessTotals.maximums),
            },
          },
    serviceCost:
      costs.length === 0
        ? { status: "not-measured", reason: "No service-cost observation." }
        : currencies.size !== 1
          ? {
              status: "not-measured",
              reason: "Cost currencies are not comparable.",
            }
          : {
              status: "measured",
              value: {
                amount: round(
                  costs.reduce((sum, item) => sum + item.amount, 0),
                ),
                currency: costs[0]!.currency,
              },
            },
  };
}

export function buildOrganizationalValueReport(
  rawInput: OrganizationalValueInput,
): OrganizationalValueReport {
  const input = organizationalValueInputSchema.parse(rawInput);
  const uniqueObservations = new Map<
    string,
    OrganizationalValueInput["observations"][number]
  >();
  for (const observation of input.observations) {
    uniqueObservations.set(observation.id, observation);
  }
  const observations = [...uniqueObservations.values()];
  const dataClasses = valueDataClassSchema.options;
  const measurements = input.alternatives.flatMap(({ id }) =>
    dataClasses
      .map((dataClass) => aggregate(id, dataClass, observations))
      .filter(({ observationCount }) => observationCount > 0),
  );
  const selected = (alternativeId: string) =>
    measurements.find(
      (measurement) =>
        measurement.alternativeId === alternativeId &&
        measurement.dataClass === input.definition.comparisonDataClass,
    );
  const baseline = selected(input.definition.baselineAlternativeId);
  const target = selected(input.definition.targetAlternativeId);
  const baselineEffort = baseline?.administrativeEffort;
  const targetEffort = target?.administrativeEffort;
  const comparisonReady =
    baselineEffort?.status === "measured" &&
    targetEffort?.status === "measured";
  const baselineMinutes = comparisonReady
    ? baselineEffort.value.minutesPerEligibleActivity
    : null;
  const targetMinutes = comparisonReady
    ? targetEffort.value.minutesPerEligibleActivity
    : null;
  const released =
    baselineMinutes !== null && targetMinutes !== null
      ? round(baselineMinutes - targetMinutes)
      : null;
  const direction =
    released === null
      ? "unknown"
      : released > 0
        ? "improvement"
        : released < 0
          ? "negative"
          : "no-change";
  const opportunityValue =
    released !== null && input.economicInput
      ? {
          amountPerEligibleActivity: round(
            (released / 60) * input.economicInput.loadedHourlyRate,
          ),
          currency: input.economicInput.currency,
          dataClass: input.economicInput.dataClass,
          label: "modeled-opportunity-value-not-cash-saving" as const,
        }
      : null;
  const targetDelivery = target?.deliveryCompleteness;
  const targetFaithfulness = target?.faithfulness;
  const deliveryFailureRate =
    targetDelivery?.status === "measured" && targetDelivery.value.eligible > 0
      ? targetDelivery.value.rejected / targetDelivery.value.eligible
      : null;
  const faithfulnessErrorRate =
    targetFaithfulness?.status === "measured"
      ? targetFaithfulness.value.factualErrorRate
      : null;
  const enoughActivities =
    (target?.eligibleActivities ?? 0) >=
    input.definition.targets.minimumEligibleActivities;
  const breachedQuality =
    (deliveryFailureRate !== null &&
      deliveryFailureRate >
        input.definition.targets.maximumDeliveryFailureRate) ||
    (faithfulnessErrorRate !== null &&
      faithfulnessErrorRate >
        input.definition.targets.maximumFaithfulnessErrorRate);
  const decision =
    !comparisonReady || !enoughActivities
      ? "continue-measuring"
      : direction === "negative"
        ? "do-not-roll-out"
        : breachedQuality ||
            released! <
              input.definition.targets.minimumReleasedMinutesPerActivity
          ? "change-workflow"
          : "consider-limited-pilot";
  const limitations = [
    "This report does not infer causality from an uncontrolled comparison.",
    "Released time is not payroll savings, revenue, billing eligibility, or customer benefit.",
    "Private conversations, presence, care timers, keystrokes, and staff rankings are not inputs.",
  ];
  if (!comparisonReady)
    limitations.push(
      "The configured baseline and target were not both measured in the same evidence class.",
    );
  if (input.definition.comparisonDataClass === "synthetic")
    limitations.push(
      "All headline comparison results are synthetic simulation evidence.",
    );
  return {
    definition: input.definition,
    alternatives: input.alternatives,
    measurements,
    comparison: {
      status: comparisonReady ? "measured" : "not-measured",
      dataClass: input.definition.comparisonDataClass,
      baselineAlternativeId: input.definition.baselineAlternativeId,
      targetAlternativeId: input.definition.targetAlternativeId,
      baselineMinutesPerActivity: baselineMinutes,
      targetMinutesPerActivity: targetMinutes,
      releasedAdministrativeMinutesPerActivity: released,
      direction,
      opportunityValue,
      reason: comparisonReady
        ? null
        : "Comparable baseline and target administrative effort are not measured.",
    },
    decision,
    limitations,
  };
}
