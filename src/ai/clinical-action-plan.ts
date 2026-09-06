import { z } from "zod";

const sourceSpanSchema = z
  .object({
    start: z.number().int().min(0).max(1200),
    end: z.number().int().min(1).max(1200),
    quote: z.string().trim().min(1).max(500),
  })
  .strict();

const common = {
  id: z.string().regex(/^action-[1-6]$/),
  sourceSpan: sourceSpanSchema,
};

export const clinicalActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...common,
      type: z.literal("note-proposal"),
      structuredText: z.string().trim().min(10).max(1200),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal("observation-proposal"),
      code: z.literal("blood-pressure"),
      systolic: z.number().int().min(40).max(300),
      diastolic: z.number().int().min(20).max(200),
      unit: z.literal("mmHg"),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal("communication-proposal"),
      recipientRole: z.literal("physician"),
      request: z.string().trim().min(3).max(500),
      reason: z.string().trim().min(3).max(1000),
      priority: z.enum(["routine", "elevated", "urgent"]),
      dueInMinutes: z.number().int().min(5).max(240),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal("task-proposal"),
      ownerRole: z.literal("registered-nurse"),
      title: z.string().trim().min(3).max(120),
      reason: z.string().trim().min(3).max(500),
      priority: z.enum(["routine", "elevated", "urgent"]),
      dueInMinutes: z.number().int().min(5).max(240),
    })
    .strict(),
]);

export const clinicalActionPlanSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    summary: z.string().trim().min(3).max(500),
    actions: z.array(clinicalActionSchema).min(1).max(6),
    ambiguities: z.array(z.string().trim().min(1).max(240)).max(6),
  })
  .strict()
  .superRefine((plan, context) => {
    const ids = new Set<string>();
    const types = new Set<string>();
    for (const action of plan.actions) {
      if (ids.has(action.id))
        context.addIssue({
          code: "custom",
          path: ["actions"],
          message: "Action identifiers must be unique.",
        });
      ids.add(action.id);
      if (types.has(action.type))
        context.addIssue({
          code: "custom",
          path: ["actions"],
          message: "Each permitted action type may occur at most once.",
        });
      types.add(action.type);
    }
  });

export type ClinicalAction = z.infer<typeof clinicalActionSchema>;
export type ClinicalActionPlan = z.infer<typeof clinicalActionPlanSchema>;

export function verifyPlanSourceSpans(
  prompt: string,
  input: unknown,
): ClinicalActionPlan {
  const plan = clinicalActionPlanSchema.parse(input);
  for (const action of plan.actions) {
    const { start, end, quote } = action.sourceSpan;
    if (end <= start || prompt.slice(start, end) !== quote)
      throw new Error("CLINICAL_PLAN_SOURCE_SPAN_MISMATCH");
  }
  return plan;
}

export function deterministicCareUpdatePlan(
  prompt: string,
): ClinicalActionPlan | null {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  // Medication and dose instructions require a dedicated medication workflow
  // and must never be compiled from free text into this general care bundle.
  if (
    /(?:insulin|medikament|tablette|kapsel|tropfen|injektion|infusion|antibiotik)|\b\d+(?:[,.]\d+)?\s*(?:mg|µg|mcg|g|ml|ie|einheiten?)\b|\b(?:geben|verabreichen|verabreicht|absetzen|abgesetzt|dosieren|dosiert)\b/i.test(
      normalized,
    )
  )
    return null;
  const bloodPressure =
    /(?:blutdruck|\brr\b)[^0-9]{0,16}(\d{2,3})\s*(?:zu|\/|auf)\s*(\d{2,3})/i.exec(
      normalized,
    );
  if (!bloodPressure || bloodPressure.index === undefined) return null;
  const systolic = Number(bloodPressure[1]);
  const diastolic = Number(bloodPressure[2]);
  if (systolic < 40 || systolic > 300 || diastolic < 20 || diastolic > 200)
    return null;
  const minutes = Math.min(
    240,
    Math.max(
      5,
      Number(/(?:in|nach)\s+(\d{1,3})\s*min/i.exec(normalized)?.[1] ?? 30),
    ),
  );
  const fullSpan = { start: 0, end: normalized.length, quote: normalized };
  const bpSpan = {
    start: bloodPressure.index,
    end: bloodPressure.index + bloodPressure[0].length,
    quote: bloodPressure[0],
  };
  return clinicalActionPlanSchema.parse({
    schemaVersion: "1.0",
    summary: "Pflegeereignis mit Messwert, Rückfrage und Folgekontrolle",
    ambiguities: [],
    actions: [
      {
        id: "action-1",
        type: "note-proposal",
        structuredText: normalized,
        sourceSpan: fullSpan,
      },
      {
        id: "action-2",
        type: "observation-proposal",
        code: "blood-pressure",
        systolic,
        diastolic,
        unit: "mmHg",
        sourceSpan: bpSpan,
      },
      {
        id: "action-3",
        type: "communication-proposal",
        recipientRole: "physician",
        request: "Aktuellen Pflegezustand und Blutdruck beurteilen",
        reason: normalized,
        priority: "elevated",
        dueInMinutes: minutes,
        sourceSpan: fullSpan,
      },
      {
        id: "action-4",
        type: "task-proposal",
        ownerRole: "registered-nurse",
        title: "Blutdruck erneut kontrollieren",
        reason: `Kontrolle nach ${minutes} Minuten gemäss geprüftem Pflegeeintrag`,
        priority: "elevated",
        dueInMinutes: minutes,
        sourceSpan: fullSpan,
      },
    ],
  });
}

export function actionReviewLabel(action: ClinicalAction): string {
  const priority = (value: "routine" | "elevated" | "urgent") =>
    ({ routine: "normal", elevated: "erhöht", urgent: "dringend" })[value];
  switch (action.type) {
    case "note-proposal":
      return `Pflegedokumentation: ${action.structuredText}`;
    case "observation-proposal":
      return `Blutdruck: ${action.systolic}/${action.diastolic} ${action.unit}`;
    case "communication-proposal":
      return `Teamnachricht an Ärztlicher Dienst · Priorität ${priority(action.priority)} · fällig in ${action.dueInMinutes} Minuten: ${action.request}. Begründung: ${action.reason}`;
    case "task-proposal":
      return `Folgeaufgabe für Dipl. Pflege · Priorität ${priority(action.priority)} · fällig in ${action.dueInMinutes} Minuten: ${action.title}. Begründung: ${action.reason}`;
  }
}

export function verifyModelPlanAgainstDeterministicCompiler(
  prompt: string,
  input: unknown,
  compiled: ClinicalActionPlan,
): ClinicalActionPlan {
  const candidate = verifyPlanSourceSpans(prompt, input);
  // The model may summarize or flag ambiguity, but it may not author fields
  // that become clinical objects. Every executable field is owned by the
  // deterministic compiler and compared exactly before use.
  if (JSON.stringify(candidate.actions) !== JSON.stringify(compiled.actions))
    throw new Error("CLINICAL_PLAN_NOT_SEMANTICALLY_GROUNDED");
  return candidate;
}
