import { createHash } from "node:crypto";
import { z } from "zod";

const sourceSpanSchema = z
  .object({
    start: z.number().int().min(0).max(8000),
    end: z.number().int().min(1).max(8000),
    quote: z.string().min(1).max(1200),
  })
  .strict();

const reportingStatusSchema = z.enum([
  "current",
  "historical",
  "reported",
  "uncertain",
]);

const common = {
  id: z.string().regex(/^action-(?:[1-9]|1[0-2])$/),
  sourceSpan: sourceSpanSchema,
  requestedByUser: z.boolean(),
  dependencies: z.array(z.string()).max(12),
};

export const clinicalActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...common,
      type: z.literal("note-proposal"),
      structuredText: z.string().trim().min(3).max(1200),
      reportingStatus: reportingStatusSchema,
      completionStatus: z.enum([
        "completed",
        "partial",
        "not-performed",
        "reported",
      ]),
      occurrenceText: z.string().max(120).nullable(),
      billable: z.literal(false),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal("observation-proposal"),
      code: z.enum([
        "blood-pressure",
        "temperature",
        "oxygen-saturation",
        "pulse",
        "weight",
      ]),
      value: z.number(),
      secondaryValue: z.number().nullable(),
      unit: z.enum(["mmHg", "°C", "%", "/min", "kg"]),
      certainty: z.literal("certain"),
      reportingStatus: reportingStatusSchema,
      occurrenceText: z.string().max(120).nullable(),
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
      dueInMinutes: z
        .number()
        .int()
        .min(1)
        .max(24 * 60)
        .nullable(),
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
      dueInMinutes: z
        .number()
        .int()
        .min(1)
        .max(24 * 60)
        .nullable(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal("workflow-proposal"),
      operation: z.literal("pause-current-and-start-room"),
      targetRoom: z.string().regex(/^\d{1,4}[A-Za-z]?$/),
      reason: z.string().trim().min(3).max(500),
    })
    .strict(),
]);

const proposedFactSchema = z
  .object({
    id: z.string().regex(/^fact-(?:[1-9]|1[0-9]|20)$/),
    kind: z.enum([
      "care-activity",
      "measurement",
      "fluid-intake",
      "symptom",
      "medication-report",
      "action",
      "time",
      "patient-correction",
      "other",
    ]),
    label: z.string().trim().min(1).max(160),
    polarity: z.enum(["affirmed", "negated"]),
    certainty: z.enum(["certain", "uncertain"]),
    reportingStatus: reportingStatusSchema,
    value: z.number().optional(),
    unit: z.string().max(20).optional(),
    sourceSpan: sourceSpanSchema,
  })
  .strict();

const correctionSchema = z
  .object({
    replacedText: z.string().trim().min(1).max(120),
    replacementText: z.string().trim().min(1).max(120),
    sourceSpan: sourceSpanSchema,
  })
  .strict();

const workPerformedSchema = z
  .object({
    id: z.string().regex(/^work-(?:[1-9]|1[0-2])$/),
    activity: z.string().trim().min(1).max(160),
    status: z.enum([
      "performed",
      "partial",
      "not-performed",
      "planned-later",
      "uncertain",
    ]),
    reportingStatus: reportingStatusSchema,
    certainty: z.enum(["certain", "uncertain"]),
    sourceSpan: sourceSpanSchema,
  })
  .strict();

const understoodObservationSchema = z
  .object({
    actionId: z
      .string()
      .regex(/^action-(?:[1-9]|1[0-2])$/)
      .nullable(),
    code: z.enum([
      "blood-pressure",
      "temperature",
      "oxygen-saturation",
      "pulse",
      "weight",
    ]),
    value: z.number(),
    secondaryValue: z.number().nullable(),
    unit: z.enum(["mmHg", "°C", "%", "/min", "kg"]),
    reportingStatus: reportingStatusSchema,
    certainty: z.enum(["certain", "uncertain"]),
    sourceSpan: sourceSpanSchema,
  })
  .strict();

const taskChangeSchema = z
  .object({
    id: z.string().regex(/^task-change-(?:[1-9]|1[0-2])$/),
    change: z.enum(["complete", "partial", "defer", "delegate"]),
    taskLabel: z.string().trim().min(1).max(160),
    targetLabel: z.string().trim().min(1).max(160).nullable(),
    executable: z.boolean(),
    sourceSpan: sourceSpanSchema,
  })
  .strict();

const understoodCommunicationSchema = z
  .object({
    id: z.string().regex(/^communication-(?:[1-9]|1[0-2])$/),
    recipientLabel: z.string().trim().min(1).max(120),
    requested: z.boolean(),
    message: z.string().trim().min(1).max(500),
    sourceSpan: sourceSpanSchema,
  })
  .strict();

const workflowActionSchema = z
  .object({
    id: z.string().regex(/^workflow-(?:[1-9]|1[0-9]|20)$/),
    operation: z.enum([
      "pause-current",
      "resume-current",
      "start-unplanned-room",
    ]),
    targetLabel: z.string().trim().min(1).max(120).nullable(),
    executableActionId: z
      .string()
      .regex(/^action-(?:[1-9]|1[0-2])$/)
      .nullable(),
    sourceSpan: sourceSpanSchema,
  })
  .strict();

const proposalEvidenceSchema = z
  .object({
    id: z.string().regex(/^evidence-(?:[1-9]|1[0-9]|20)$/),
    kind: z.enum(["user-statement", "session-context"]),
    label: z.string().trim().min(1).max(200),
    sourceSpan: sourceSpanSchema.nullable(),
  })
  .strict();

export const assistantProposalSchema = z
  .object({
    schemaVersion: z.literal("3.0"),
    requestId: z.string().regex(/^request-[a-f0-9]{16}$/),
    inputModality: z.enum(["typed", "voice"]),
    inputTimestamp: z.string().datetime(),
    summary: z.string().trim().min(3).max(500),
    understoodFacts: z.array(proposedFactSchema).max(20),
    workPerformed: z.array(workPerformedSchema).max(12),
    observations: z.array(understoodObservationSchema).max(12),
    taskChanges: z.array(taskChangeSchema).max(12),
    communications: z.array(understoodCommunicationSchema).max(12),
    workflowActions: z.array(workflowActionSchema).max(20),
    evidence: z.array(proposalEvidenceSchema).max(20),
    actions: z.array(clinicalActionSchema).max(12),
    corrections: z.array(correctionSchema).max(6),
    temporal: z
      .object({
        occurrenceText: z.string().max(120).nullable(),
        dueInMinutes: z
          .number()
          .int()
          .min(1)
          .max(24 * 60)
          .nullable(),
      })
      .strict(),
    clarificationQuestions: z.array(z.string().trim().min(1).max(240)).max(6),
    ambiguities: z.array(z.string().trim().min(1).max(240)).max(6),
  })
  .strict()
  .superRefine((plan, context) => {
    const ids = new Set<string>();
    for (const action of plan.actions) {
      if (ids.has(action.id))
        context.addIssue({
          code: "custom",
          path: ["actions"],
          message: "Action identifiers must be unique.",
        });
      ids.add(action.id);
    }
    for (const observation of plan.observations) {
      if (observation.actionId === null) continue;
      const action = plan.actions.find(
        (candidate) => candidate.id === observation.actionId,
      );
      if (!action || action.type !== "observation-proposal")
        context.addIssue({
          code: "custom",
          path: ["observations"],
          message: "Every observation must reference its executable action.",
        });
    }
  });

export type ExecutableAssistantAction = z.infer<typeof clinicalActionSchema>;
export type AssistantProposal = z.infer<typeof assistantProposalSchema>;
type NewClinicalAction = ExecutableAssistantAction extends infer Action
  ? Action extends ExecutableAssistantAction
    ? Omit<Action, "id" | "dependencies" | "requestedByUser">
    : never
  : never;

export interface ClinicalCompilerOptions {
  inputModality?: "typed" | "voice";
  inputTimestamp?: string;
}

function span(source: string, start: number, end: number) {
  return { start, end, quote: source.slice(start, end) };
}

function firstSpan(source: string, expression: RegExp) {
  const match = expression.exec(source);
  return match?.index === undefined
    ? null
    : span(source, match.index, match.index + match[0].length);
}

function reportingStatus(
  source: string,
): z.infer<typeof reportingStatusSchema> {
  if (/\b(?:gestern|vorgestern|früher|damals|letzte[nsr]?)\b/i.test(source))
    return "historical";
  if (/\b(?:laut|berichtet|gab an|habe|sei)\b/i.test(source)) return "reported";
  if (/\b(?:vielleicht|unklar|möglicherweise|eventuell)\b/i.test(source))
    return "uncertain";
  return "current";
}

function clauseAt(source: string, index: number) {
  const softBoundaries = [...source.matchAll(/,(?!\d)\s*|\b(?:und|aber)\b/gi)];
  const softLeft = softBoundaries
    .filter((match) => match.index !== undefined && match.index < index)
    .map((match) => match.index + match[0].length - 1);
  const left = Math.max(
    source.lastIndexOf(".", index - 1),
    source.lastIndexOf(";", index - 1),
    source.lastIndexOf("!", index - 1),
    source.lastIndexOf("?", index - 1),
    source.lastIndexOf("\n", index - 1),
    ...softLeft,
  );
  const candidates = [".", ";", "!", "?", "\n"]
    .map((delimiter) => source.indexOf(delimiter, index))
    .filter((position) => position >= 0)
    .concat(
      softBoundaries
        .filter((match) => match.index !== undefined && match.index >= index)
        .map((match) => match.index),
    );
  const right = candidates.length > 0 ? Math.min(...candidates) : source.length;
  const start = left + 1;
  return { start, end: right, text: source.slice(start, right) };
}

function semanticContextAt(source: string, index: number) {
  // Temporal qualifiers commonly apply to a coordinated series of
  // observations ("Gestern ... Blutdruck ..., Puls ...").  Keep soft
  // comma/conjunction boundaries for negation and action binding, but carry
  // time across them until a hard sentence boundary.
  const hardLeft = Math.max(
    source.lastIndexOf(".", index - 1),
    source.lastIndexOf(";", index - 1),
    source.lastIndexOf("!", index - 1),
    source.lastIndexOf("?", index - 1),
    source.lastIndexOf("\n", index - 1),
  );
  const hardCandidates = [".", ";", "!", "?", "\n"]
    .map((delimiter) => source.indexOf(delimiter, index))
    .filter((position) => position >= 0);
  const hardStart = hardLeft + 1;
  const hardEnd =
    hardCandidates.length > 0 ? Math.min(...hardCandidates) : source.length;
  const prefix = source.slice(hardStart, index + 1);
  const markers = [
    ...prefix.matchAll(
      /\b(?:gestern|vorgestern)(?:\s+um\s+\d{1,2}(?::\d{2})?\s*uhr)?\b|\bheute\b/gi,
    ),
  ];
  const last = markers.at(-1);
  const start = last?.index === undefined ? hardStart : hardStart + last.index;
  return source.slice(start, hardEnd);
}

function hasLocalNegation(source: string, index: number, matchText: string) {
  const clause = clauseAt(source, index);
  const prefix = source.slice(clause.start, index + matchText.length);
  // In "kein Schwindel bei Blutdruck 128/76" the negation belongs to the
  // symptom, while "bei" introduces the measured context. Only inspect the
  // segment after the final contextual boundary for the measurement/action.
  const contextualBoundary = prefix
    .toLocaleLowerCase("de-CH")
    .lastIndexOf(" bei ");
  const relevantPrefix =
    contextualBoundary >= 0
      ? prefix.slice(contextualBoundary + " bei ".length)
      : prefix;
  const immediateSuffix = source.slice(
    index + matchText.length,
    index + matchText.length + 24,
  );
  return (
    /\b(?:nicht|nichts|nie|keinesfalls|kein(?:e|en|er|es)?|ohne)\b|\bauf\s+keinen\s+fall\b/i.test(
      relevantPrefix,
    ) || /\?\s*nein\b/i.test(immediateSuffix)
  );
}

function hasLocalUncertainty(source: string, index: number, matchText: string) {
  const clause = clauseAt(source, index);
  const relevant = source.slice(
    Math.max(clause.start, index - 24),
    index + matchText.length,
  );
  return /\b(?:ca\.?|circa|etwa|ungefähr|vielleicht|unklar|möglicherweise|eventuell)\b/i.test(
    relevant,
  );
}

function hasAffirmedUrgency(source: string) {
  return [...source.matchAll(/\b(?:sofort|dringend|notfall)\b/gi)].some(
    (match) =>
      match.index !== undefined &&
      !hasLocalNegation(source, match.index, match[0]),
  );
}

function dueMinutes(source: string): number | null {
  const positiveHalf = /(?:in|nach)\s+einer\s+halben\s+stunde/i.exec(source);
  if (
    positiveHalf &&
    !hasLocalNegation(source, positiveHalf.index, positiveHalf[0])
  )
    return 30;
  const numeric = /(?:in|nach)\s+(\d{1,3})\s*(?:min(?:uten?)?)/i.exec(source);
  if (numeric && !hasLocalNegation(source, numeric.index, numeric[0]))
    return Math.min(24 * 60, Math.max(1, Number(numeric[1])));
  const hours = /(?:in|nach)\s+(?:(einer)|([1-9]\d?))\s+stunden?/i.exec(source);
  if (hours && !hasLocalNegation(source, hours.index, hours[0]))
    return hours[1] ? 60 : Math.min(24 * 60, Number(hours[2]) * 60);
  return null;
}

function occurrenceText(source: string): string | null {
  return (
    /\b(?:(?:gestern|vorgestern|heute)\s+um\s+\d{1,2}(?::\d{2})?\s*uhr|(?:gestern|vorgestern)|um\s+\d{1,2}(?::\d{2})?\s*uhr)\b/i.exec(
      source,
    )?.[0] ?? null
  );
}

function isFutureSameDayOccurrence(
  occurrence: string | null,
  inputTimestamp: string,
): boolean {
  if (!occurrence || /\b(?:gestern|vorgestern)\b/i.test(occurrence))
    return false;
  const clock = /\bum\s+(\d{1,2})(?::(\d{2}))?\s*uhr\b/i.exec(occurrence);
  if (!clock) return false;
  const input = new Date(inputTimestamp);
  if (Number.isNaN(input.getTime())) return true;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Zurich",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(input)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const statedMinutes = Number(clock[1]) * 60 + Number(clock[2] ?? "0");
  const inputMinutes = Number(parts.hour) * 60 + Number(parts.minute);
  return statedMinutes > inputMinutes + 5;
}

function hasNegatedAction(source: string, action: "physician" | "control") {
  const negation =
    "(?:nicht|nie|keinesfalls|auf\\s+keinen\\s+fall|kein(?:e|en)?)";
  return action === "physician"
    ? new RegExp(
        `(?:arzt|ärztin|ärztlich)[^.;]{0,35}\\b${negation}\\b[^.;]{0,35}\\b(?:informieren|benachrichtigen|fragen|nachricht|senden)\\b|\\b${negation}\\b[^.;]{0,35}\\b(?:arzt|ärztin)\\b|\\bkeine\\s+nachricht\\b[^.;]{0,35}\\b(?:arzt|ärztin)\\b`,
        "i",
      ).test(source)
    : new RegExp(
        `\\b${negation}\\b[^.;]{0,30}\\b(?:folgekontrolle|kontrolle|nachmessen|kontrollieren)\\b`,
        "i",
      ).test(source);
}

export function verifyPlanSourceSpans(
  prompt: string,
  input: unknown,
): AssistantProposal {
  const plan = assistantProposalSchema.parse(input);
  const spans = [
    ...plan.understoodFacts.map((fact) => fact.sourceSpan),
    ...plan.workPerformed.map((item) => item.sourceSpan),
    ...plan.observations.map((item) => item.sourceSpan),
    ...plan.taskChanges.map((item) => item.sourceSpan),
    ...plan.communications.map((item) => item.sourceSpan),
    ...plan.workflowActions.map((item) => item.sourceSpan),
    ...plan.evidence.flatMap((item) =>
      item.sourceSpan ? [item.sourceSpan] : [],
    ),
    ...plan.actions.map((action) => action.sourceSpan),
    ...plan.corrections.map((correction) => correction.sourceSpan),
  ];
  for (const item of spans) {
    if (
      item.end <= item.start ||
      prompt.slice(item.start, item.end) !== item.quote
    )
      throw new Error("CLINICAL_PLAN_SOURCE_SPAN_MISMATCH");
  }
  return plan;
}

export function requiresDedicatedClinicalWorkflow(source: string): boolean {
  const wholeSource = source.trim();
  if (
    /^\s*(?:zeige|öffne|wähle)\p{L}*\s+[^.;]{0,50}(?:profil|übergabe|vitalwerte|aufgaben|teamfragen|synchronisation|patientenkontext)[.!?]?\s*$/iu.test(
      wholeSource,
    )
  )
    return false;
  return source.split(/[.;\n]/).some((clause) => {
    const completed =
      /\b(?:wurde|war|ist|hat|habe)\b[^.;]{0,80}\b(?:gegeben|verabreicht|abgesetzt|entfernt|gewechselt|gelegt|appliziert|angeordnet|verordnet|verschrieben|behandelt|therapiert|gestoppt|geändert|angepasst|reduziert|erhöht|durchgeführt|gezogen|verbunden|gespült|erneuert|kontrolliert)\b/i.test(
        clause,
      ) ||
      /\b(?:durchgeführt|erledigt|eingenommen|kontrolliert|verabreicht|gegeben|gewechselt|gespült|erneuert)\b/i.test(
        clause,
      );
    const modalCommand =
      /\b(?:soll|muss|darf|sollen|müssen|dürfen)\b[^.;]{0,80}\b(?:gegeben|verabreicht|abgesetzt|entfernt|gewechselt|gelegt|appliziert|angeordnet|verordnet|verschrieben|behandelt|therapiert|gestoppt|geändert|angepasst|reduziert|erhöht|durchgeführt)\b/i.test(
        clause,
      );
    const clearlyDescriptive =
      /\b(?:liegt|läuft|zeigt|wirkt|beträgt|befindet\s+sich|ist|kann|konnte|klagt|berichtet)\b/i.test(
        clause,
      ) && !/\b(?:soll|muss|darf|sollen|müssen|dürfen|bitte)\b/i.test(clause);
    const safetySensitiveSubject =
      /\b(?:medikament\w*|tablette\w*|kapsel\w*|tropfen\w*|tropf|insulin|marcumar|morphin|heparin|antibiotik\w*|spritze\w*|injektion\w*|infusion\w*|\w*katheter\w*|sonde(?:n)?|drainage\w*|\w*kanül\w*|leitung\w*|sauerstoff|o2|beatmung|wund(?:e|en|versorgung)?|verband\w*|therapie\w*|behandlung\w*|diagnos\w*)\b/i.test(
        clause,
      );
    const normalizedClause = clause.replace(
      /^\s*(?:bitte\s+)?(?:notiz|pflegebericht|dokumentiere)\s*[:,-]?\s*/i,
      "",
    );
    const hasDocumentationPrefix =
      /^\s*(?:bitte\s+)?(?:notiz|pflegebericht|dokumentiere)\b/i.test(clause);
    const allowedNonClinicalCommand =
      !hasDocumentationPrefix &&
      (/^\s*(?:zeige|öffne|wähle)\p{L}*\s+[^.;]{0,50}(?:profil|übergabe|vitalwerte|aufgaben|teamfragen|synchronisation|patientenkontext)/iu.test(
        normalizedClause,
      ) ||
        /^\s*(?:erstelle|eröffne|lege)\p{L}*\b[^.;]{0,50}\b(?:aufgabe|task)\b/iu.test(
          normalizedClause,
        ) ||
        /^\s*(?:informiere|benachrichtige|frage)\p{L}*\b[^.;]{0,60}\b(?:arzt|ärztin|ärztlichen?\s+dienst)\b/iu.test(
          normalizedClause,
        ));
    const imperativeSentenceShape =
      /^\s*\p{L}+\s+(?:den|die|das|einen|eine)\b/iu.test(normalizedClause) ||
      /^\s*\p{L}+(?:en|ern)\s+Sie\s+(?:den|die|das|einen|eine|Herrn|Frau)\b/u.test(
        normalizedClause,
      ) ||
      /^\s*(?:den|die|das|einen|eine)\s+(?:patient(?:en|in)?|bewohner(?:in|n)?)\s+\p{L}+(?:en|ern)\b/iu.test(
        normalizedClause,
      ) ||
      /^\s*(?:patient(?:in)?|bewohner(?:in)?)\s+\p{L}+(?:en|ern)\b/iu.test(
        normalizedClause,
      );
    const targetedInfinitiveInstruction =
      hasDocumentationPrefix &&
      /\b(?:patient(?:en|in)?|bewohner(?:in|n)?|Herrn|Frau|Bett|Stuhl)\b[^.;]{0,80}\b\p{L}+(?:en|ern|eln)\s*$/iu.test(
        normalizedClause,
      );
    const imperative =
      /\b(?:geben|gib|verabreichen|verabreiche|injizieren|injiziere|verteilen|verteile|absetzen|entfernen|entferne|wechseln|wechsle|legen|lege|applizieren|appliziere|anordnen|ordne|verordnen|verordne|verschreiben|verschreibe|behandeln|behandle|therapieren|therapiere|stoppen|stoppe|ändern|ändere|anpassen|passe|reduzieren|reduziere|erhöhen|erhöhe|titrieren|titriere|senken|senke|ersetzen|ersetze|ziehen|zieh|verbinden|spülen|spüle|erneuern|absaugen|leeren|leere|versorgen|versorge|umlagern|lagere|durchführen|führe|messen|miss|anziehen|lassen|lass|inhalieren)\b/i.test(
        clause,
      ) ||
      /\bsetz(?:e|en\s+sie)\b[^.;]{0,50}\bab\b/i.test(clause) ||
      /\b(?:saug(?:e|en\s+sie)|zieh(?:e|en\s+sie)?|führ(?:e|en\s+sie)|lager(?:e|n\s+sie))\b[^.;]{0,80}\b(?:ab|an|durch|um)\b/i.test(
        clause,
      ) ||
      /(?:^|[^\p{L}])(?:ändern|ändere)(?:$|[^\p{L}])/iu.test(clause) ||
      /\b(?:soll|muss|darf|sollen|müssen|dürfen)\b[^.;]{0,80}\b(?:gegeben|verabreicht|abgesetzt|entfernt|gewechselt|gelegt|appliziert|angeordnet|verordnet|verschrieben|behandelt|therapiert|gestoppt|geändert|angepasst|reduziert|erhöht|durchgeführt)\b/i.test(
        clause,
      ) ||
      (/\bstarten\b/i.test(clause) &&
        /\b(?:wund|therapie|behandlung|diagnos)\w*\b/i.test(clause));
    // These domains are fail-closed unless the utterance is unmistakably a
    // completed report or descriptive state. This also catches terse orders
    // and unseen verbs without relying on an endless imperative denylist.
    return (
      (imperative && !completed) ||
      modalCommand ||
      (imperativeSentenceShape && !allowedNonClinicalCommand && !completed) ||
      (targetedInfinitiveInstruction && !completed && !clearlyDescriptive) ||
      (safetySensitiveSubject && !completed && !clearlyDescriptive)
    );
  });
}

export function explicitlyRefusesDocumentation(source: string): boolean {
  const documentationVerb =
    "(?:dokumentier\\p{L}*|schreib\\p{L}*(?:\\s+auf)?|notier\\p{L}*|halt\\p{L}*\\s+fest|festhalt\\p{L}*|zeichne\\p{L}*\\s+auf|aufzeichn\\p{L}*)";
  return (
    new RegExp(
      `\\b${documentationVerb}\\b[^.;!?]{0,60}\\b(?:nichts|auf\\s+keinen\\s+fall|(?:das|dies|es)\\s+nicht)\\b`,
      "iu",
    ).test(source) ||
    new RegExp(
      `\\b(?:nicht|nichts)\\s+(?:weiter\\s+|davon\\s+|hierzu\\s+|darüber\\s+|aus\\s+dem\\s+gespräch\\s+)?${documentationVerb}\\b`,
      "iu",
    ).test(source) ||
    new RegExp(
      `\\b(?:auf\\s+keinen\\s+fall|keinesfalls|keine?\\s+(?:angaben?|information(?:en)?))\\b[^.;!?]{0,50}\\b${documentationVerb}\\b`,
      "iu",
    ).test(source) ||
    /\bkeine?\s+(?:notiz|dokumentation|aufzeichnung|eintrag)\b/i.test(source) ||
    /\bkeine\s+nachricht\b[^.;!?]{0,60}\b(?:senden|schicken|erstellen)\b/i.test(
      source,
    )
  );
}

function controlTaskTitle(source: string, controlIndex: number): string {
  const controlClause = clauseAt(source, controlIndex);
  if (/\b(?:blutdruck|rr)\b/i.test(controlClause.text))
    return "Blutdruck erneut kontrollieren";

  // A bare "Kontrolle" may refer back to the immediately preceding measured
  // blood pressure.  An explicitly named control (for example
  // "Blutzucker-Kontrolle") must never inherit an unrelated measurement.
  const explicitNamedControl = /\b[\p{L}]+[- ]kontrolle\b/iu.test(
    controlClause.text,
  );
  if (!explicitNamedControl) {
    const priorContext = source.slice(
      Math.max(0, controlClause.start - 300),
      controlClause.start,
    );
    const lastBloodPressure = Math.max(
      priorContext.toLocaleLowerCase("de-CH").lastIndexOf("blutdruck"),
      priorContext.toLocaleLowerCase("de-CH").lastIndexOf("rr "),
    );
    const lastOtherMeasurement = Math.max(
      ...[
        "blutzucker",
        "puls",
        "temperatur",
        "sättigung",
        "spo2",
        "gewicht",
      ].map((marker) =>
        priorContext.toLocaleLowerCase("de-CH").lastIndexOf(marker),
      ),
    );
    if (lastBloodPressure >= 0 && lastBloodPressure > lastOtherMeasurement)
      return "Blutdruck erneut kontrollieren";
  }
  return "Vereinbarte Folgekontrolle durchführen";
}

export function deterministicAssistantProposal(
  prompt: string,
  options: ClinicalCompilerOptions = {},
): AssistantProposal | null {
  const source = prompt.slice(0, 1200).trim();
  if (!source) return null;

  // Imperative medication changes are outside this compiler. Historical or
  // completed medication statements remain documentable reports.
  if (
    requiresDedicatedClinicalWorkflow(source) ||
    (/\b(?:geben|verabreichen|absetzen|dosieren|starten|anordnen|verordnen|diagnostizieren|behandeln|therapieren)\b/i.test(
      source,
    ) &&
      /\b(?:dosis|medikament|tablette|kapsel|tropfen|injektion|insulin|marcumar|morphin|heparin|infusion|therapie|behandlung|diagnose|\d+(?:[,.]\d+)?\s*(?:mg|µg|mcg|ie|einheiten?))\b/i.test(
        source,
      ))
  )
    return null;

  const status =
    /\b(?:gestern|vorgestern|früher|damals)\b/i.test(source) &&
    /\bheute\b/i.test(source)
      ? ("reported" as const)
      : reportingStatus(source);
  const occurrence = occurrenceText(source);
  const due = dueMinutes(source);
  const facts: z.infer<typeof proposedFactSchema>[] = [];
  const workPerformed: z.infer<typeof workPerformedSchema>[] = [];
  const observations: z.infer<typeof understoodObservationSchema>[] = [];
  const taskChanges: z.infer<typeof taskChangeSchema>[] = [];
  const communications: z.infer<typeof understoodCommunicationSchema>[] = [];
  const workflowActions: z.infer<typeof workflowActionSchema>[] = [];
  const evidence: z.infer<typeof proposalEvidenceSchema>[] = [];
  const actions: ExecutableAssistantAction[] = [];
  const corrections: z.infer<typeof correctionSchema>[] = [];
  const clarificationQuestions: string[] = [];
  let hasFutureOccurrenceAmbiguity = false;
  let factIndex = 1;
  let workIndex = 1;
  let taskChangeIndex = 1;
  let communicationIndex = 1;
  let workflowIndex = 1;
  let evidenceIndex = 1;
  let actionIndex = 1;
  const addFact = (fact: Omit<z.infer<typeof proposedFactSchema>, "id">) =>
    facts.push({ id: `fact-${factIndex++}`, ...fact });
  const addAction = (action: NewClinicalAction): ExecutableAssistantAction => {
    const added = {
      id: `action-${actionIndex++}`,
      dependencies: [],
      requestedByUser: true,
      ...action,
    } as unknown as ExecutableAssistantAction;
    actions.push(added);
    return added;
  };
  const addEvidence = (label: string, sourceSpan: ReturnType<typeof span>) =>
    evidence.push({
      id: `evidence-${evidenceIndex++}`,
      kind: "user-statement",
      label,
      sourceSpan,
    });

  const explicitNoWrite = explicitlyRefusesDocumentation(source)
    ? span(source, 0, source.length)
    : null;
  if (explicitNoWrite) {
    addFact({
      kind: "action",
      label: "Dokumentation ausdrücklich verneint",
      polarity: "negated",
      certainty: "certain",
      reportingStatus: "current",
      sourceSpan: explicitNoWrite,
    });
    return assistantProposalSchema.parse({
      schemaVersion: "3.0",
      requestId: `request-${createHash("sha256").update(source).digest("hex").slice(0, 16)}`,
      inputModality: options.inputModality ?? "typed",
      inputTimestamp: options.inputTimestamp ?? new Date().toISOString(),
      summary: "Verstanden; keine Änderung angefordert",
      understoodFacts: facts,
      workPerformed,
      observations,
      taskChanges,
      communications,
      workflowActions,
      evidence,
      actions,
      corrections,
      temporal: { occurrenceText: null, dueInMinutes: null },
      clarificationQuestions,
      ambiguities: [],
    });
  }

  const identityCorrection =
    /\b([A-ZÄÖÜ][\p{L}-]+)\?\s*(?:nein|nein,)\s*([A-ZÄÖÜ][\p{L}-]+)/iu.exec(
      source,
    );
  if (identityCorrection?.index !== undefined) {
    const correctionSpan = span(
      source,
      identityCorrection.index,
      identityCorrection.index + identityCorrection[0].length,
    );
    corrections.push({
      replacedText: identityCorrection[1]!,
      replacementText: identityCorrection[2]!,
      sourceSpan: correctionSpan,
    });
    addFact({
      kind: "patient-correction",
      label: `${identityCorrection[1]} → ${identityCorrection[2]}`,
      polarity: "affirmed",
      certainty: "certain",
      reportingStatus: "current",
      sourceSpan: correctionSpan,
    });
    clarificationQuestions.push(
      `${identityCorrection[2]} als Patientenkontext bestätigen, bevor ein patientengebundener Entwurf entsteht.`,
    );
  }

  const workSpecs = [
    {
      activity: "Mobilisation",
      expression:
        /\b(?:mobilisation\s+(?:(?:teilweise|zum\s+teil)\s+)?(?:durchgeführt|erledigt)|(?:(?:teilweise|zum\s+teil)\s+)?mobilisiert)\b/i,
    },
    {
      activity: "Morgenpflege",
      expression:
        /\bmorgenpflege\s+(?:(?:teilweise|zum\s+teil)\s+)?(?:durchgeführt|erledigt|gemacht)\b/i,
    },
  ];
  for (const spec of workSpecs) {
    const match = spec.expression.exec(source);
    if (match?.index === undefined) continue;
    const sourceSpan = span(source, match.index, match.index + match[0].length);
    const negated = hasLocalNegation(source, match.index, match[0]);
    const localStatus = reportingStatus(clauseAt(source, match.index).text);
    const explicitlyPartial = /\b(?:teilweise|zum\s+teil)\b/i.test(match[0]);
    workPerformed.push({
      id: `work-${workIndex++}`,
      activity: spec.activity,
      status: negated
        ? "not-performed"
        : explicitlyPartial
          ? "partial"
          : "performed",
      reportingStatus: localStatus,
      certainty: "certain",
      sourceSpan,
    });
    addFact({
      kind: "care-activity",
      label: spec.activity,
      polarity: negated ? "negated" : "affirmed",
      certainty: "certain",
      reportingStatus: localStatus,
      sourceSpan,
    });
    if (!negated)
      taskChanges.push({
        id: `task-change-${taskChangeIndex++}`,
        change: explicitlyPartial ? "partial" : "complete",
        taskLabel: spec.activity,
        targetLabel: null,
        // A natural phrase alone is not enough to bind a specific FHIR Task.
        executable: false,
        sourceSpan,
      });
    addEvidence(
      negated
        ? `Vom Mitarbeitenden verneinte Arbeit: ${spec.activity}`
        : `Vom Mitarbeitenden berichtete Arbeit: ${spec.activity}`,
      sourceSpan,
    );
  }

  const laterWork =
    /\b(mobilisation|morgenpflege)\s+(?:später|nachher)\b/i.exec(source);
  if (laterWork?.index !== undefined) {
    const sourceSpan = span(
      source,
      laterWork.index,
      laterWork.index + laterWork[0].length,
    );
    const activity = /^mobilisation/i.test(laterWork[1]!)
      ? "Mobilisation"
      : "Morgenpflege";
    workPerformed.push({
      id: `work-${workIndex++}`,
      activity,
      status: "planned-later",
      reportingStatus: "current",
      certainty: "certain",
      sourceSpan,
    });
    taskChanges.push({
      id: `task-change-${taskChangeIndex++}`,
      change: "defer",
      taskLabel: activity,
      targetLabel: "später",
      executable: false,
      sourceSpan,
    });
    addFact({
      kind: "care-activity",
      label: `${activity} später`,
      polarity: "affirmed",
      certainty: "certain",
      reportingStatus: "current",
      sourceSpan,
    });
    addEvidence(
      `Vom Mitarbeitenden verschobener Arbeitsschritt: ${activity}`,
      sourceSpan,
    );
  }

  const pauseAndRoom =
    /\b([A-ZÄÖÜ][\p{L}-]+)?\s*(?:pausieren|pause)\b[^.;]{0,80}\bzimmer\s+(\d{1,4}[A-Za-z]?)\b/iu.exec(
      source,
    );
  if (pauseAndRoom?.index !== undefined) {
    const sourceSpan = span(
      source,
      pauseAndRoom.index,
      pauseAndRoom.index + pauseAndRoom[0].length,
    );
    const pauseClause = clauseAt(source, pauseAndRoom.index).text;
    const pauseNegated = hasLocalNegation(
      source,
      pauseAndRoom.index,
      pauseAndRoom[0],
    );
    const pauseStatus = reportingStatus(pauseClause);
    if (pauseNegated || pauseStatus !== "current") {
      addFact({
        kind: "action",
        label: "Ablaufwechsel nicht als aktuelle Anweisung bestätigt",
        polarity: pauseNegated ? "negated" : "affirmed",
        certainty: "certain",
        reportingStatus: pauseStatus,
        sourceSpan,
      });
      addEvidence("Nicht ausführbarer Ablaufhinweis", sourceSpan);
    } else {
      const targetRoom = pauseAndRoom[2]!;
      const executable = addAction({
        type: "workflow-proposal",
        operation: "pause-current-and-start-room",
        targetRoom,
        reason: source,
        sourceSpan,
      });
      workflowActions.push(
        {
          id: `workflow-${workflowIndex++}`,
          operation: "pause-current",
          targetLabel: pauseAndRoom[1] ?? null,
          executableActionId: executable.id,
          sourceSpan,
        },
        {
          id: `workflow-${workflowIndex++}`,
          operation: "start-unplanned-room",
          targetLabel: `Zimmer ${targetRoom}`,
          executableActionId: executable.id,
          sourceSpan,
        },
      );
      addEvidence("Vom Mitarbeitenden gewünschter Kontextwechsel", sourceSpan);
    }
  }

  const correctedBloodPressure =
    /(?:blutdruck|\brr\b)[^0-9.;]{0,16}\bnicht\s*(\d{2,3})\s*(?:zu|\/|auf)\s*(\d{2,3})\s*,?\s*sondern\s*(\d{2,3})\s*(?:zu|\/|auf)\s*(\d{2,3})/i.exec(
      source,
    );
  const correctedMeasurementSpans: ReturnType<typeof span>[] = [];
  let correctedBloodPressureSpan: ReturnType<typeof span> | null = null;
  if (correctedBloodPressure?.index !== undefined) {
    correctedBloodPressureSpan = span(
      source,
      correctedBloodPressure.index,
      correctedBloodPressure.index + correctedBloodPressure[0].length,
    );
    correctedMeasurementSpans.push(correctedBloodPressureSpan);
    const oldValue = `${correctedBloodPressure[1]}/${correctedBloodPressure[2]}`;
    const newValue = `${correctedBloodPressure[3]}/${correctedBloodPressure[4]}`;
    const correctionContext = semanticContextAt(
      source,
      correctedBloodPressure.index,
    );
    const correctionStatus = reportingStatus(correctionContext);
    const correctionOccurrence = occurrenceText(correctionContext);
    corrections.push({
      replacedText: oldValue,
      replacementText: newValue,
      sourceSpan: correctedBloodPressureSpan,
    });
    addFact({
      kind: "measurement",
      label: `${oldValue} ausdrücklich korrigiert`,
      polarity: "negated",
      certainty: "certain",
      reportingStatus: correctionStatus,
      value: Number(correctedBloodPressure[1]),
      unit: "mmHg",
      sourceSpan: correctedBloodPressureSpan,
    });
    const correctedAction = addAction({
      type: "observation-proposal",
      code: "blood-pressure",
      value: Number(correctedBloodPressure[3]),
      secondaryValue: Number(correctedBloodPressure[4]),
      unit: "mmHg",
      certainty: "certain",
      reportingStatus: correctionStatus,
      occurrenceText: correctionOccurrence,
      sourceSpan: correctedBloodPressureSpan,
    });
    observations.push({
      actionId: correctedAction.id,
      code: "blood-pressure",
      value: Number(correctedBloodPressure[3]),
      secondaryValue: Number(correctedBloodPressure[4]),
      unit: "mmHg",
      reportingStatus: correctionStatus,
      certainty: "certain",
      sourceSpan: correctedBloodPressureSpan,
    });
    addEvidence(
      `Vom Mitarbeitenden korrigierter Messwert: ${newValue}`,
      correctedBloodPressureSpan,
    );
  }

  const shortBloodPressureCorrection =
    /(?:blutdruck|\brr\b)[^0-9.;]{0,16}(\d{2,3})\s*(?:zu|\/|auf)\s*(\d{2,3})\s*,?\s*nein\s*(\d{2,3})\s*(?:zu|\/|auf)\s*(\d{2,3})/i.exec(
      source,
    );
  if (shortBloodPressureCorrection?.index !== undefined) {
    const correctionSpan = span(
      source,
      shortBloodPressureCorrection.index,
      shortBloodPressureCorrection.index +
        shortBloodPressureCorrection[0].length,
    );
    const oldValue = `${shortBloodPressureCorrection[1]}/${shortBloodPressureCorrection[2]}`;
    const newValue = `${shortBloodPressureCorrection[3]}/${shortBloodPressureCorrection[4]}`;
    const systolic = Number(shortBloodPressureCorrection[3]);
    const diastolic = Number(shortBloodPressureCorrection[4]);
    const correctionContext = semanticContextAt(
      source,
      shortBloodPressureCorrection.index,
    );
    const correctionStatus = reportingStatus(correctionContext);
    const correctionOccurrence = occurrenceText(correctionContext);
    if (
      systolic >= 40 &&
      systolic <= 300 &&
      diastolic >= 20 &&
      diastolic <= 200
    ) {
      correctedMeasurementSpans.push(correctionSpan);
      corrections.push({
        replacedText: oldValue,
        replacementText: newValue,
        sourceSpan: correctionSpan,
      });
      addFact({
        kind: "measurement",
        label: `${oldValue} ausdrücklich korrigiert`,
        polarity: "negated",
        certainty: "certain",
        reportingStatus: correctionStatus,
        value: Number(shortBloodPressureCorrection[1]),
        unit: "mmHg",
        sourceSpan: correctionSpan,
      });
      const correctedAction = addAction({
        type: "observation-proposal",
        code: "blood-pressure",
        value: systolic,
        secondaryValue: diastolic,
        unit: "mmHg",
        certainty: "certain",
        reportingStatus: correctionStatus,
        occurrenceText: correctionOccurrence,
        sourceSpan: correctionSpan,
      });
      observations.push({
        actionId: correctedAction.id,
        code: "blood-pressure",
        value: systolic,
        secondaryValue: diastolic,
        unit: "mmHg",
        reportingStatus: correctionStatus,
        certainty: "certain",
        sourceSpan: correctionSpan,
      });
      addEvidence(
        `Vom Mitarbeitenden korrigierter Messwert: ${newValue}`,
        correctionSpan,
      );
    } else {
      clarificationQuestions.push(
        `Korrigierten Blutdruck „${newValue}“ prüfen.`,
      );
      correctedMeasurementSpans.push(correctionSpan);
    }
  }

  const scalarCorrections = source.matchAll(
    /\b(temperatur|temp\.?|puls|sättigung|spo2|gewicht)\b[^0-9]{0,24}(\d{1,3}(?:[,.]\d)?)\s*(?:°c|prozent|%|\/min|kg)?\s*,?\s*(?:nein|sondern)\s*(\d{1,3}(?:[,.]\d)?)\s*(?:°c|prozent|%|\/min|kg)?/gi,
  );
  for (const scalarCorrection of scalarCorrections) {
    if (scalarCorrection.index === undefined) continue;
    const correctionSpan = span(
      source,
      scalarCorrection.index,
      scalarCorrection.index + scalarCorrection[0].length,
    );
    const label = scalarCorrection[1]!.toLocaleLowerCase("de-CH");
    const code = label.startsWith("temp")
      ? ("temperature" as const)
      : label === "puls"
        ? ("pulse" as const)
        : label === "gewicht"
          ? ("weight" as const)
          : ("oxygen-saturation" as const);
    const unit =
      code === "temperature"
        ? ("°C" as const)
        : code === "pulse"
          ? ("/min" as const)
          : code === "weight"
            ? ("kg" as const)
            : ("%" as const);
    const oldValue = Number(scalarCorrection[2]!.replace(",", "."));
    const newValue = Number(scalarCorrection[3]!.replace(",", "."));
    const correctionContext = semanticContextAt(source, scalarCorrection.index);
    const correctionStatus = reportingStatus(correctionContext);
    const correctionOccurrence = occurrenceText(correctionContext);
    const valid =
      code === "temperature"
        ? newValue >= 25 && newValue <= 45
        : code === "pulse"
          ? newValue >= 20 && newValue <= 260
          : code === "oxygen-saturation"
            ? newValue >= 40 && newValue <= 100
            : newValue >= 1 && newValue <= 400;
    correctedMeasurementSpans.push(correctionSpan);
    if (valid) {
      corrections.push({
        replacedText: String(oldValue),
        replacementText: String(newValue),
        sourceSpan: correctionSpan,
      });
      addFact({
        kind: "measurement",
        label: `${oldValue} ausdrücklich korrigiert`,
        polarity: "negated",
        certainty: "certain",
        reportingStatus: correctionStatus,
        value: oldValue,
        unit,
        sourceSpan: correctionSpan,
      });
      const correctedAction = addAction({
        type: "observation-proposal",
        code,
        value: newValue,
        secondaryValue: null,
        unit,
        certainty: "certain",
        reportingStatus: correctionStatus,
        occurrenceText: correctionOccurrence,
        sourceSpan: correctionSpan,
      });
      observations.push({
        actionId: correctedAction.id,
        code,
        value: newValue,
        secondaryValue: null,
        unit,
        reportingStatus: correctionStatus,
        certainty: "certain",
        sourceSpan: correctionSpan,
      });
      addEvidence(
        `Vom Mitarbeitenden korrigierter Messwert: ${newValue} ${unit}`,
        correctionSpan,
      );
    } else {
      clarificationQuestions.push(
        `Korrigierten Messwert „${newValue} ${unit}“ prüfen.`,
      );
    }
  }

  for (let index = actions.length - 1; index >= 0; index -= 1) {
    const action = actions[index]!;
    if (
      action.type !== "observation-proposal" ||
      !correctedMeasurementSpans.some(
        (corrected) => corrected.start === action.sourceSpan.start,
      )
    )
      continue;
    const incompleteHistoricalTime =
      action.reportingStatus === "historical" &&
      !action.occurrenceText?.toLocaleLowerCase("de-CH").includes("um");
    const futureTime = isFutureSameDayOccurrence(
      action.occurrenceText,
      options.inputTimestamp ?? new Date().toISOString(),
    );
    if (!incompleteHistoricalTime && !futureTime) continue;
    actions.splice(index, 1);
    const understood = observations.find(
      (observation) => observation.actionId === action.id,
    );
    if (understood) understood.actionId = null;
    clarificationQuestions.push(
      incompleteHistoricalTime
        ? "Wann genau wurde der korrigierte Messwert erhoben?"
        : "Die korrigierte Messzeit liegt in der Zukunft. Bitte Zeitangabe prüfen.",
    );
  }

  const measureSpecs = [
    {
      code: "blood-pressure" as const,
      unit: "mmHg" as const,
      regex:
        /(?:blutdruck|\brr\b)[^0-9]{0,16}(\d{2,3})\s*(?:zu|\/|auf)\s*(\d{2,3})/gi,
    },
    {
      code: "temperature" as const,
      unit: "°C" as const,
      regex: /(?:temperatur|\btemp\.?)[^0-9]{0,24}(\d{2}(?:[,.]\d)?)/gi,
    },
    {
      code: "pulse" as const,
      unit: "/min" as const,
      regex: /\bpuls[^0-9]{0,24}(\d{2,3})/gi,
    },
    {
      code: "oxygen-saturation" as const,
      unit: "%" as const,
      regex: /(?:sättigung|spo2)[^0-9]{0,24}(\d{2,3})(?:\s*(?:prozent|%))?/gi,
    },
    {
      code: "weight" as const,
      unit: "kg" as const,
      regex: /(?:gewicht)[^0-9]{0,24}(\d{2,3}(?:[,.]\d)?)(?:\s*kg)?/gi,
    },
  ];
  const executableObservationKeys = new Set(
    actions
      .filter(
        (
          action,
        ): action is Extract<
          ExecutableAssistantAction,
          { type: "observation-proposal" }
        > => action.type === "observation-proposal",
      )
      .map(
        (action) =>
          `${action.code}:${action.value}:${action.secondaryValue ?? ""}:${action.unit}:${action.reportingStatus}:${action.occurrenceText ?? ""}`,
      ),
  );
  for (const spec of measureSpecs) {
    for (const match of source.matchAll(spec.regex)) {
      if (match.index === undefined) continue;
      if (
        correctedMeasurementSpans.some(
          (corrected) =>
            match.index >= corrected.start && match.index < corrected.end,
        )
      )
        continue;
      const value = Number(match[1]!.replace(",", "."));
      const secondary = match[2] ? Number(match[2].replace(",", ".")) : null;
      const valid =
        spec.code === "blood-pressure"
          ? value >= 40 &&
            value <= 300 &&
            secondary !== null &&
            secondary >= 20 &&
            secondary <= 200
          : spec.code === "temperature"
            ? value >= 25 && value <= 45
            : spec.code === "pulse"
              ? value >= 20 && value <= 260
              : spec.code === "oxygen-saturation"
                ? value >= 40 && value <= 100
                : value >= 1 && value <= 400;
      if (!valid) {
        clarificationQuestions.push(`Messwert „${match[0]}“ prüfen.`);
        continue;
      }
      const sourceSpan = span(
        source,
        match.index,
        match.index + match[0].length,
      );
      const localClause = semanticContextAt(source, match.index);
      const localStatus = reportingStatus(localClause);
      const localOccurrence = occurrenceText(localClause);
      const negated = hasLocalNegation(source, match.index, match[0]);
      const uncertain = hasLocalUncertainty(source, match.index, match[0]);
      addFact({
        kind: "measurement",
        label: match[0],
        polarity: negated ? "negated" : "affirmed",
        certainty:
          uncertain || localStatus === "uncertain" ? "uncertain" : "certain",
        reportingStatus: localStatus,
        value,
        unit: spec.unit,
        sourceSpan,
      });
      if (negated) {
        addEvidence(
          `Vom Mitarbeitenden verworfener Messwert: ${match[0]}`,
          sourceSpan,
        );
        continue;
      }
      if (uncertain || localStatus === "uncertain") {
        observations.push({
          actionId: null,
          code: spec.code,
          value,
          secondaryValue: secondary,
          unit: spec.unit,
          reportingStatus: "uncertain",
          certainty: "uncertain",
          sourceSpan,
        });
        clarificationQuestions.push(
          `Ist „${match[0]}“ ein bestätigter Messwert?`,
        );
        continue;
      }
      if (
        isFutureSameDayOccurrence(
          localOccurrence,
          options.inputTimestamp ?? new Date().toISOString(),
        )
      ) {
        observations.push({
          actionId: null,
          code: spec.code,
          value,
          secondaryValue: secondary,
          unit: spec.unit,
          reportingStatus: localStatus,
          certainty: "certain",
          sourceSpan,
        });
        hasFutureOccurrenceAmbiguity = true;
        clarificationQuestions.push(
          `Die Messzeit „${localOccurrence}“ liegt nach dem Eingabezeitpunkt. Ist das eine geplante Messung oder stimmt die Zeitangabe nicht?`,
        );
        continue;
      }
      if (localStatus === "historical" && !localOccurrence?.includes("um")) {
        observations.push({
          actionId: null,
          code: spec.code,
          value,
          secondaryValue: secondary,
          unit: spec.unit,
          reportingStatus: "historical",
          certainty: "certain",
          sourceSpan,
        });
        clarificationQuestions.push(`Wann genau wurde „${match[0]}“ gemessen?`);
        continue;
      }
      const observationKey = `${spec.code}:${value}:${secondary ?? ""}:${spec.unit}:${localStatus}:${localOccurrence ?? ""}`;
      if (executableObservationKeys.has(observationKey)) {
        addEvidence(
          `Wiederholter identischer Messwert ohne zweite Schreibaktion: ${match[0]}`,
          sourceSpan,
        );
        continue;
      }
      executableObservationKeys.add(observationKey);
      const observationAction = addAction({
        type: "observation-proposal",
        code: spec.code,
        value,
        secondaryValue: secondary,
        unit: spec.unit,
        certainty: "certain",
        reportingStatus: localStatus,
        occurrenceText: localOccurrence,
        sourceSpan,
      });
      observations.push({
        actionId: observationAction.id,
        code: spec.code,
        value,
        secondaryValue: secondary,
        unit: spec.unit,
        reportingStatus: localStatus,
        certainty: "certain",
        sourceSpan,
      });
      addEvidence(
        `Vom Mitarbeitenden genannter Messwert: ${match[0]}`,
        sourceSpan,
      );
    }
  }

  const intake =
    /(?:(ca\.?|circa|etwa|ungefähr)\s*)?(\d{1,4})\s*ml\s+(?:getrunken|aufgenommen)/i.exec(
      source,
    );
  if (intake?.index !== undefined) {
    const sourceSpan = span(
      source,
      intake.index,
      intake.index + intake[0].length,
    );
    addFact({
      kind: "fluid-intake",
      label: intake[0],
      polarity: "affirmed",
      certainty: intake[1] ? "uncertain" : "certain",
      reportingStatus: status,
      value: Number(intake[2]),
      unit: "ml",
      sourceSpan,
    });
    addEvidence(
      `Vom Mitarbeitenden genannte Trinkmenge: ${intake[0]}`,
      sourceSpan,
    );
  }

  const foodIntake =
    /\b(?:(fast|nahezu|etwa)\s+)?(?:alles|die\s+hälfte|halb|wenig|nichts)\s+gegessen\b/i.exec(
      source,
    );
  if (foodIntake?.index !== undefined) {
    const sourceSpan = span(
      source,
      foodIntake.index,
      foodIntake.index + foodIntake[0].length,
    );
    addFact({
      kind: "other",
      label: foodIntake[0],
      polarity: "affirmed",
      certainty: /\b(?:fast|nahezu|etwa)\b/i.test(foodIntake[0])
        ? "uncertain"
        : "certain",
      reportingStatus: status,
      sourceSpan,
    });
    addEvidence(
      `Vom Mitarbeitenden beschriebene Nahrungsaufnahme: ${foodIntake[0]}`,
      sourceSpan,
    );
  }

  const symptomNegation =
    /\b(?:kein(?:e|en)?|nicht)\s+(?:erbrechen|übelkeit|schmerzen?|dyspnoe)\b/i.exec(
      source,
    );
  if (symptomNegation?.index !== undefined)
    addFact({
      kind: "symptom",
      label: symptomNegation[0],
      polarity: "negated",
      certainty: "certain",
      reportingStatus: status,
      sourceSpan: span(
        source,
        symptomNegation.index,
        symptomNegation.index + symptomNegation[0].length,
      ),
    });

  const physicianNegated = hasNegatedAction(source, "physician");
  const physician =
    /\b(?:arzt|ärztin|ärztlichen?\s+dienst)\b[^.;]{0,60}\b(?:informieren|benachrichtigen|fragen)\b|\b(?:informieren|benachrichtigen|fragen)\b[^.;]{0,60}\b(?:arzt|ärztin|ärztlichen?\s+dienst)\b/i.exec(
      source,
    );
  if (physicianNegated) {
    const s =
      firstSpan(
        source,
        /(?:arzt|ärztin)[^.;]{0,60}(?:nicht|nie|keinesfalls|auf\s+keinen\s+fall|kein)[^.;]*/i,
      ) ??
      firstSpan(
        source,
        /(?:nicht|nie|keinesfalls|auf\s+keinen\s+fall|kein(?:e|en)?)[^.;]{0,60}(?:arzt|ärztin)[^.;]*/i,
      );
    if (s) {
      addFact({
        kind: "action",
        label: "Ärztliche Information ausdrücklich verneint",
        polarity: "negated",
        certainty: "certain",
        reportingStatus: "current",
        sourceSpan: s,
      });
      communications.push({
        id: `communication-${communicationIndex++}`,
        recipientLabel: "Ärztlicher Dienst",
        requested: false,
        message: "Keine Information senden",
        sourceSpan: s,
      });
      addEvidence("Ausdrücklich verneinte ärztliche Information", s);
    }
  } else if (physician?.index !== undefined) {
    const physicianClause = clauseAt(source, physician.index);
    const sourceSpan = span(source, physicianClause.start, physicianClause.end);
    const communicationDue = dueMinutes(physicianClause.text);
    const communicationRequested =
      reportingStatus(physicianClause.text) === "current" &&
      !/\b(?:wurde|war|erfolgte|erledigt|bereits)\b/i.test(
        physicianClause.text,
      );
    addFact({
      kind: "action",
      label: physician[0],
      polarity: "affirmed",
      certainty: "certain",
      reportingStatus: "current",
      sourceSpan,
    });
    communications.push({
      id: `communication-${communicationIndex++}`,
      recipientLabel: "Ärztlicher Dienst",
      requested: communicationRequested,
      message: physician[0],
      sourceSpan,
    });
    if (communicationRequested)
      addAction({
        type: "communication-proposal",
        recipientRole: "physician",
        request: "Berichteten Pflegezustand beurteilen",
        reason: source,
        priority: hasAffirmedUrgency(physicianClause.text)
          ? "urgent"
          : "routine",
        dueInMinutes: communicationDue,
        sourceSpan,
      });
    if (communicationRequested && communicationDue === null)
      clarificationQuestions.push(
        "Bis wann soll der ärztliche Dienst reagieren?",
      );
  }

  const controlNegated = hasNegatedAction(source, "control");
  const control =
    /\b(?:folgekontrolle|erneut\s+kontrollieren|nachmessen|kontrolle)\b/i.exec(
      source,
    );
  if (controlNegated) {
    const s = firstSpan(
      source,
      /(?:keine?|nicht|nie|keinesfalls|auf\s+keinen\s+fall)[^.;]{0,30}(?:folgekontrolle|kontrolle|nachmessen|kontrollieren)/i,
    );
    if (s)
      addFact({
        kind: "action",
        label: "Folgekontrolle ausdrücklich verneint",
        polarity: "negated",
        certainty: "certain",
        reportingStatus: "current",
        sourceSpan: s,
      });
  } else if (control?.index !== undefined) {
    const controlClause = clauseAt(source, control.index);
    const sourceSpan = span(source, controlClause.start, controlClause.end);
    const controlDue = dueMinutes(controlClause.text);
    const controlRequested =
      reportingStatus(controlClause.text) === "current" &&
      !/\b(?:wurde|war|erfolgte|erledigt|bereits)\b/i.test(controlClause.text);
    addFact({
      kind: "action",
      label: control[0],
      polarity: "affirmed",
      certainty: "certain",
      reportingStatus: "current",
      sourceSpan,
    });
    if (controlRequested)
      addAction({
        type: "task-proposal",
        ownerRole: "registered-nurse",
        title: controlTaskTitle(source, control.index),
        reason: source,
        priority: hasAffirmedUrgency(controlClause.text) ? "urgent" : "routine",
        dueInMinutes: controlDue,
        sourceSpan,
      });
    if (controlRequested && controlDue === null)
      clarificationQuestions.push("Wann ist die Folgekontrolle fällig?");
  }

  if (occurrence) {
    const s = firstSpan(
      source,
      /\b(?:gestern|vorgestern)(?:\s+um\s+\d{1,2}(?::\d{2})?\s*uhr)?\b/i,
    );
    if (s)
      addFact({
        kind: "time",
        label: occurrence,
        polarity: "affirmed",
        certainty: "certain",
        reportingStatus: "historical",
        sourceSpan: s,
      });
  }

  const medicationReport =
    /\b(?:dosis|medikament)[^.;]*(?:geändert|gegeben|abgesetzt|eingenommen)\b|\b(?:gegeben|abgesetzt|eingenommen)[^.;]*(?:dosis|medikament)\b/i.exec(
      source,
    );
  if (medicationReport?.index !== undefined)
    addFact({
      kind: "medication-report",
      label: medicationReport[0],
      polarity: "affirmed",
      certainty: status === "uncertain" ? "uncertain" : "certain",
      reportingStatus: status,
      sourceSpan: span(
        source,
        medicationReport.index,
        medicationReport.index + medicationReport[0].length,
      ),
    });

  const notPerformed =
    workPerformed.some((item) => item.status === "not-performed") ||
    /\b(?:nicht|keine?)\s+(?:durchgeführt|gemacht|erledigt|mobilisiert)\b|\bmobilisation\s+nicht\b/i.test(
      source,
    );
  const partialWork =
    workPerformed.some((item) => item.status === "partial") ||
    (/\bnur\b/i.test(source) &&
      workPerformed.some((item) => item.status === "performed") &&
      workPerformed.some((item) => item.status === "planned-later"));
  const completed =
    !notPerformed &&
    /\b(?:durchgeführt|erledigt|mobilisiert|getrunken|gegeben)\b/i.test(source);
  const pureIdentityCorrection =
    Boolean(identityCorrection) && facts.length === 1;
  const pureTimeCorrection =
    actions.length === 0 &&
    /^(?:in|nach)\s+.+stunde/i.test(source) &&
    !/\b(?:durchgeführt|erledigt|kontrolle|informieren|temperatur|puls|sättigung|blutdruck|\brr\b)\b/i.test(
      source,
    );
  const pureWorkflowChange =
    actions.length > 0 &&
    actions.every((action) => action.type === "workflow-proposal");
  const pureNegatedNoAction =
    actions.length === 0 &&
    facts.length > 0 &&
    facts.every(
      (fact) => fact.polarity === "negated" && fact.kind === "action",
    );
  const pureMeasurementCorrection =
    corrections.length > 0 &&
    actions.length > 0 &&
    actions.every((action) => action.type === "observation-proposal");
  const pureUncertainMeasurements =
    actions.length === 0 &&
    observations.length > 0 &&
    observations.every((observation) => observation.certainty === "uncertain");
  if (
    !pureIdentityCorrection &&
    !pureTimeCorrection &&
    !pureWorkflowChange &&
    !pureNegatedNoAction &&
    !pureMeasurementCorrection &&
    !pureUncertainMeasurements &&
    !hasFutureOccurrenceAmbiguity
  ) {
    addAction({
      type: "note-proposal",
      structuredText: source,
      reportingStatus: status,
      completionStatus: notPerformed
        ? "not-performed"
        : partialWork
          ? "partial"
          : completed
            ? "completed"
            : "reported",
      occurrenceText: occurrence,
      billable: false,
      sourceSpan: span(source, 0, source.length),
    });
    // Documentation should be the first review item; keep measurement/action
    // order otherwise stable and independently selectable.
    actions.unshift(actions.pop()!);
    actions.forEach((action, index) => (action.id = `action-${index + 1}`));
    for (const observation of observations) {
      const action = actions.find(
        (candidate) =>
          candidate.type === "observation-proposal" &&
          candidate.code === observation.code &&
          candidate.sourceSpan.start === observation.sourceSpan.start,
      );
      if (action) observation.actionId = action.id;
    }
    for (const workflowAction of workflowActions) {
      const action = actions.find(
        (candidate) =>
          candidate.type === "workflow-proposal" &&
          candidate.sourceSpan.start === workflowAction.sourceSpan.start,
      );
      if (action) workflowAction.executableActionId = action.id;
    }
  }

  if (pureTimeCorrection)
    clarificationQuestions.push(
      `Wofür gilt die Zeitangabe von ${due ?? "unbestimmten"} Minuten?`,
    );

  if (
    actions.length === 0 &&
    clarificationQuestions.length === 0 &&
    facts.length === 0
  )
    return null;

  return assistantProposalSchema.parse({
    schemaVersion: "3.0",
    requestId: `request-${createHash("sha256").update(source).digest("hex").slice(0, 16)}`,
    inputModality: options.inputModality ?? "typed",
    inputTimestamp: options.inputTimestamp ?? new Date().toISOString(),
    summary:
      actions.length > 0
        ? `${actions.length} prüfbare Änderung${actions.length === 1 ? "" : "en"} verstanden`
        : clarificationQuestions.length > 0
          ? "Eine kurze Rückfrage ist nötig"
          : "Verstanden; keine Änderung angefordert",
    understoodFacts: facts,
    workPerformed,
    observations,
    taskChanges,
    communications,
    workflowActions,
    evidence,
    actions,
    corrections,
    temporal: { occurrenceText: occurrence, dueInMinutes: due },
    clarificationQuestions,
    ambiguities: [...clarificationQuestions],
  });
}

export function actionReviewLabel(action: ExecutableAssistantAction): string {
  const priority = (value: "routine" | "elevated" | "urgent") =>
    ({ routine: "normal", elevated: "erhöht", urgent: "dringend" })[value];
  switch (action.type) {
    case "note-proposal":
      return `Pflegedokumentation (${({ current: "aktuell", historical: "historisch", reported: "berichtet", uncertain: "unsicher" } as const)[action.reportingStatus]}): ${action.structuredText}`;
    case "observation-proposal":
      return `${
        {
          "blood-pressure": "Blutdruck",
          temperature: "Temperatur",
          "oxygen-saturation": "Sättigung",
          pulse: "Puls",
          weight: "Gewicht",
        }[action.code]
      } (${({ current: "aktuell", historical: "historisch", reported: "berichtet", uncertain: "unsicher" } as const)[action.reportingStatus]}${action.occurrenceText ? ` · ${action.occurrenceText}` : ""}): ${action.value}${action.secondaryValue === null ? "" : `/${action.secondaryValue}`} ${action.unit}`;
    case "communication-proposal":
      return `Teamnachricht an Ärztlicher Dienst · Priorität ${priority(action.priority)}${action.dueInMinutes === null ? "" : ` · fällig in ${action.dueInMinutes} Minuten`}: ${action.request}. Begründung: ${action.reason}`;
    case "task-proposal":
      return `Folgeaufgabe für Dipl. Pflege · Priorität ${priority(action.priority)}${action.dueInMinutes === null ? "" : ` · fällig in ${action.dueInMinutes} Minuten`}: ${action.title}. Begründung: ${action.reason}`;
    case "workflow-proposal":
      return `Aktuelle Arbeit sicher pausieren und zu Zimmer ${action.targetRoom} wechseln`;
  }
}

function numberPattern(value: number) {
  return String(value).replace(".", "[.,]");
}

function observationGrounded(
  source: string,
  action: Extract<ExecutableAssistantAction, { type: "observation-proposal" }>,
) {
  const value = numberPattern(action.value);
  if (action.code === "blood-pressure") {
    if (action.secondaryValue === null) return false;
    return new RegExp(
      `\\b(?:blutdruck|rr)\\b(?:[^0-9]{0,16}${value}\\s*(?:zu|/|auf)\\s*${numberPattern(action.secondaryValue)}|[^0-9]{0,20}${value}[^0-9]{1,24}${numberPattern(action.secondaryValue)})\\b`,
      "i",
    ).test(source);
  }
  const marker = {
    temperature: "(?:temperatur|temp\\.?)",
    "oxygen-saturation": "(?:sättigung|saettigung|spo2)",
    pulse: "puls",
    weight: "gewicht",
  }[action.code];
  return new RegExp(`\\b${marker}\\b[^0-9]{0,12}${value}\\b`, "i").test(source);
}

function validateModelAction(
  prompt: string,
  action: ExecutableAssistantAction,
  inputTimestamp: string,
): void {
  if (!action.requestedByUser)
    throw new Error("CLINICAL_PLAN_ACTION_NOT_REQUESTED");
  const grounded = action.sourceSpan.quote;
  if (
    /\b(?:insulin|marcumar|morphin|heparin|medikament|dosis|\d+(?:[,.]\d+)?\s*(?:mg|µg|mcg|ie|einheiten?))\b/i.test(
      JSON.stringify(action),
    ) &&
    !/\b(?:insulin|marcumar|morphin|heparin|medikament|dosis|\d+(?:[,.]\d+)?\s*(?:mg|µg|mcg|ie|einheiten?))\b/i.test(
      grounded,
    )
  )
    throw new Error("CLINICAL_PLAN_UNGROUNDED_CLINICAL_CONTENT");
  if (hasLocalNegation(prompt, action.sourceSpan.start, grounded))
    throw new Error("CLINICAL_PLAN_NEGATED_ACTION");
  if (
    /\b(?:geben|verabreichen|absetzen|dosieren|starten|anordnen|verordnen|diagnostizieren|behandeln|therapieren)\b/i.test(
      grounded,
    ) &&
    /\b(?:dosis|medikament|tablette|kapsel|tropfen|injektion|insulin|marcumar|morphin|heparin|infusion|therapie|behandlung|diagnose|\d+(?:[,.]\d+)?\s*(?:mg|µg|mcg|ie|einheiten?))\b/i.test(
      grounded,
    )
  )
    throw new Error("CLINICAL_PLAN_DEDICATED_WORKFLOW_REQUIRED");

  switch (action.type) {
    case "note-proposal":
      if (action.structuredText !== grounded)
        throw new Error("CLINICAL_PLAN_NOTE_NOT_VERBATIM_GROUNDED");
      if (
        action.completionStatus === "completed" &&
        /\b(?:teilweise|zum\s+teil|nicht|keine?)\b/i.test(grounded)
      )
        throw new Error("CLINICAL_PLAN_COMPLETION_CONTRADICTION");
      return;
    case "observation-proposal": {
      const temporalContext = semanticContextAt(
        prompt,
        action.sourceSpan.start,
      );
      const expectedUnit = {
        "blood-pressure": "mmHg",
        temperature: "°C",
        "oxygen-saturation": "%",
        pulse: "/min",
        weight: "kg",
      }[action.code];
      if (
        !observationGrounded(grounded, action) ||
        action.unit !== expectedUnit ||
        action.reportingStatus !== reportingStatus(temporalContext) ||
        action.occurrenceText !== occurrenceText(temporalContext) ||
        isFutureSameDayOccurrence(action.occurrenceText, inputTimestamp) ||
        /\b(?:ca\.?|circa|etwa|ungefähr|vielleicht|unklar)\b/i.test(grounded)
      )
        throw new Error("CLINICAL_PLAN_OBSERVATION_NOT_GROUNDED");
      if (
        action.reportingStatus === "historical" &&
        action.occurrenceText === null
      )
        throw new Error("CLINICAL_PLAN_OCCURRENCE_REQUIRED");
      return;
    }
    case "communication-proposal":
      if (
        action.request !== "Berichteten Pflegezustand beurteilen" ||
        action.reason !== prompt ||
        action.dueInMinutes !== dueMinutes(grounded) ||
        action.priority !==
          (hasAffirmedUrgency(grounded) ? "urgent" : "routine")
      )
        throw new Error("CLINICAL_PLAN_COMMUNICATION_CONTENT_NOT_GROUNDED");
      if (
        !/\b(?:arzt|ärztin|ärztlich(?:e|en|er)?\s+dienst)\b/i.test(grounded) ||
        !/\b(?:informieren|benachrichtigen|fragen|nachricht|melden)\b/i.test(
          grounded,
        ) ||
        reportingStatus(grounded) !== "current" ||
        /\b(?:wurde|war|erfolgte|erledigt|bereits)\b/i.test(grounded) ||
        (action.priority === "urgent" && !hasAffirmedUrgency(grounded))
      )
        throw new Error("CLINICAL_PLAN_COMMUNICATION_NOT_GROUNDED");
      return;
    case "task-proposal":
      if (
        action.title !== controlTaskTitle(prompt, action.sourceSpan.start) ||
        action.reason !== prompt ||
        action.dueInMinutes !== dueMinutes(grounded) ||
        action.priority !==
          (hasAffirmedUrgency(grounded) ? "urgent" : "routine")
      )
        throw new Error("CLINICAL_PLAN_TASK_CONTENT_NOT_GROUNDED");
      if (
        !/\b(?:folgekontrolle|erneut\s+kontrollieren|nachmessen|kontrolle)\b/i.test(
          grounded,
        ) ||
        reportingStatus(grounded) !== "current" ||
        /\b(?:wurde|war|erfolgte|erledigt|bereits)\b/i.test(grounded) ||
        (action.priority === "urgent" && !hasAffirmedUrgency(grounded))
      )
        throw new Error("CLINICAL_PLAN_TASK_NOT_GROUNDED");
      return;
    case "workflow-proposal":
      if (action.reason !== prompt)
        throw new Error("CLINICAL_PLAN_WORKFLOW_CONTENT_NOT_GROUNDED");
      if (
        !/\b(?:pausieren|pause)\b/i.test(grounded) ||
        !new RegExp(`\\bzimmer\\s+${action.targetRoom}\\b`, "i").test(
          grounded,
        ) ||
        reportingStatus(grounded) !== "current"
      )
        throw new Error("CLINICAL_PLAN_WORKFLOW_NOT_GROUNDED");
  }
}

export function verifyModelProposalAgainstDeterministicCompiler(
  prompt: string,
  input: unknown,
  compiled: AssistantProposal | null,
  authoritativeInputTimestamp?: string,
): AssistantProposal {
  const candidate = verifyPlanSourceSpans(prompt, input);
  const metadata = compiled ?? {
    requestId: `request-${createHash("sha256").update(prompt).digest("hex").slice(0, 16)}`,
    inputModality: "typed" as const,
    inputTimestamp: authoritativeInputTimestamp ?? new Date().toISOString(),
  };
  if (
    compiled?.actions.length === 0 &&
    compiled.understoodFacts.some((fact) => fact.polarity === "negated") &&
    candidate.actions.length > 0
  )
    throw new Error("CLINICAL_PLAN_EXPLICIT_NO_WRITE");
  if (compiled && compiled.corrections.length > 0) {
    for (const correction of compiled.corrections) {
      const correctedObservations = compiled.actions.filter(
        (
          action,
        ): action is Extract<
          ExecutableAssistantAction,
          { type: "observation-proposal" }
        > =>
          action.type === "observation-proposal" &&
          action.sourceSpan.start < correction.sourceSpan.end &&
          action.sourceSpan.end > correction.sourceSpan.start,
      );
      const candidateObservations = candidate.actions.filter(
        (
          action,
        ): action is Extract<
          ExecutableAssistantAction,
          { type: "observation-proposal" }
        > =>
          action.type === "observation-proposal" &&
          action.sourceSpan.start < correction.sourceSpan.end &&
          action.sourceSpan.end > correction.sourceSpan.start,
      );
      for (const action of candidateObservations)
        if (
          !correctedObservations.some(
            (accepted) =>
              accepted.code === action.code &&
              accepted.value === action.value &&
              accepted.secondaryValue === action.secondaryValue &&
              accepted.unit === action.unit &&
              accepted.reportingStatus === action.reportingStatus &&
              accepted.occurrenceText === action.occurrenceText,
          )
        )
          throw new Error("CLINICAL_PLAN_CORRECTION_MISMATCH");
    }
  }
  for (const action of candidate.actions)
    validateModelAction(prompt, action, metadata.inputTimestamp);
  const semanticActionKeys = candidate.actions.map((action) =>
    JSON.stringify(
      Object.fromEntries(
        Object.entries(action).filter(
          ([key]) => !["id", "dependencies", "sourceSpan"].includes(key),
        ),
      ),
    ),
  );
  if (new Set(semanticActionKeys).size !== semanticActionKeys.length)
    throw new Error("CLINICAL_PLAN_DUPLICATE_ACTION");
  const actionIds = new Set(candidate.actions.map((action) => action.id));
  if (
    candidate.actions.some((action) =>
      action.dependencies.some((dependency) => !actionIds.has(dependency)),
    )
  )
    throw new Error("CLINICAL_PLAN_DEPENDENCY_NOT_GROUNDED");
  return {
    ...candidate,
    requestId: metadata.requestId,
    inputModality: metadata.inputModality,
    inputTimestamp: metadata.inputTimestamp,
    summary:
      candidate.actions.length > 0
        ? `${candidate.actions.length} prüfbare Änderung${candidate.actions.length === 1 ? "" : "en"} verstanden`
        : candidate.ambiguities.length > 0
          ? "Eine kurze Rückfrage ist nötig"
          : "Verstanden; keine Änderung angefordert",
    understoodFacts: candidate.understoodFacts.map((fact) => ({
      ...fact,
      label: fact.sourceSpan.quote,
      polarity: hasLocalNegation(
        prompt,
        fact.sourceSpan.start,
        fact.sourceSpan.quote,
      )
        ? ("negated" as const)
        : ("affirmed" as const),
    })),
    workPerformed: candidate.workPerformed.map((work) => ({
      ...work,
      activity: work.sourceSpan.quote,
    })),
    taskChanges: candidate.taskChanges.map((change) => ({
      ...change,
      taskLabel: change.sourceSpan.quote,
    })),
    communications: candidate.communications.map((communication) => ({
      ...communication,
      message: communication.sourceSpan.quote,
    })),
    clarificationQuestions:
      candidate.clarificationQuestions.length > 0
        ? [
            "Eine Angabe ist noch nicht eindeutig. Bitte formuliere sie kurz präziser.",
          ]
        : [],
    ambiguities:
      candidate.ambiguities.length > 0
        ? [
            "Eine Angabe ist noch nicht eindeutig. Bitte formuliere sie kurz präziser.",
          ]
        : [],
  };
}
