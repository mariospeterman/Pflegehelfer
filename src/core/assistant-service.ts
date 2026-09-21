import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ModelGateway,
  type AuthorizedModelContext,
  type ClinicalPlanResult,
  type IntentClassification,
} from "../ai/model-gateway.js";
import { ApprovedKnowledgeService } from "../ai/approved-knowledge.js";
import {
  OpaqueIntentBroker,
  validateAssistantComponents,
  type AssistantComponent,
  type DurableIntentRecord,
  type IntentExecutionContext,
} from "./assistant.js";
import type { PflegehelferService } from "./service.js";
import { siteConfiguration } from "./site-config.js";
import { DomainError, isTerminalOutboxState, type Purpose } from "./types.js";
import {
  actionReviewLabel,
  assistantProposalSchema,
  bindVoiceTranscriptProvenance,
  explicitlyRefusesDocumentation,
  isDoubtfulObservation,
  reviseAssistantProposal,
  requiresDedicatedClinicalWorkflow,
  verifyAgentProposal,
  verifyProposalSourceRecords,
  type ExecutableAssistantAction,
} from "../ai/assistant-proposal.js";
import {
  parseVoiceTranscriptProvenance,
  type VoiceTranscriptProvenance,
} from "./voice-provenance.js";
import {
  AuthorizedToolRegistry,
  BoundedAgentRuntime,
  type AgentRunResult,
  type AgentToolResult,
} from "../ai/agent-runtime.js";
import {
  loadApprovedWorkflowSkill,
  resolveRuntimeGuidance,
  runtimeSitePack,
} from "./runtime-instructions.js";
import {
  canonicalClaimTokens,
  verifyNaturalDialogueAgainstSources,
  type SourceBoundAtom,
} from "./source-claim-binding.js";

export interface AssistantRequest {
  prompt: string;
  patientId: string | null;
  purpose?: Purpose;
  inputModality?: "typed" | "voice";
  voiceTranscriptConfirmed?: boolean;
  voiceTranscriptProvenance?: VoiceTranscriptProvenance;
  signal?: AbortSignal;
  onProgress?: (event: {
    stage: "model" | "tool" | "validation";
    toolName?: string;
  }) => void;
  workingContext?: {
    organizationId: string;
    sessionId: string;
    threadId: string;
    contextRevision: number;
    departmentId: string;
    stationId: string | null;
    roleProfileId: string | null;
    workflowId: string | null;
    currentStepId: string;
    activeEpisodeTitle: string | null;
    activeEpisodePatientId: string | null;
    resumableEpisodePatientId: string | null;
    recentPrompts: string[];
    recentConversation?: Array<{
      role: "user" | "assistant";
      text: string;
    }>;
    previousCarePlan?: string | null;
    organizationLabel: string;
    actorRole: string;
    dataClass: "synthetic-demo" | "institution-local";
    workdayHandover?: {
      id: string;
      version: number;
      contentHash: string;
      shiftKey: string;
      status: "open" | "transferred" | "acknowledged";
      acknowledgedCount: number;
      assignedCount: number;
      openCount: number;
      summary: string;
    } | null;
  };
}

export interface AssistantResponse {
  id: string;
  classification: Pick<IntentClassification, "intent">;
  runtime: {
    route: "assistant" | "safe-fallback";
    label: string;
    degraded: boolean;
    failure?: NonNullable<ClinicalPlanResult["failure"]>["code"];
    agent?: {
      packId: string;
      packVersion: number;
      packDigest: string;
      instructionHashes: Readonly<Record<string, string>>;
      toolCalls: number;
      status: AgentRunResult["status"];
      trace: AgentRunResult["trace"];
    };
  };
  patientContext: {
    patientId: string;
    encounterId: string;
    resourceVersion: number;
    displayName: string;
    birthDate: string;
    mrn: string;
  } | null;
  components: AssistantComponent[];
  openUi: string;
  evidence: {
    resourceId: string;
    version: number;
    label: string;
    sourceVersion?: string;
    freshness?: string;
    complete?: boolean;
    claims?: Array<{
      path: string;
      value: string | number | boolean | null;
    }>;
    rowProvenance?: Array<{
      path: string;
      resourceId: string;
      version: string;
      patientId?: string;
      encounterId?: string;
      effectiveAt?: string;
      provider?: string;
    }>;
    contextBinding?: {
      sessionId: string;
      threadId: string;
      contextRevision: number;
      patientId: string | null;
      encounterId: string | null;
    };
    sourceDigest?: string;
    digest?: string;
  }[];
  warnings: string[];
}

export interface AssistantDraftHandoff {
  kind: "task" | "communication";
  patientId: string;
  title: string;
  reason: string;
  recipientRole?:
    | "registered-nurse"
    | "physician"
    | "pharmacy"
    | "physiotherapy"
    | "occupational-therapy";
  recipientId?: string | null;
  recipientLabel?: string;
  dueAt: string;
}

const q = (value: string): string => JSON.stringify(value);

export function toOpenUi(components: AssistantComponent[]): string {
  const statements = components.map((component, index) => {
    const name = `item${index}`;
    switch (component.type) {
      case "AssistantText":
        return `${name} = AssistantMessage(${q(component.message)})`;
      case "ClinicalFacts":
        return `${name} = ClinicalFactsCard(${JSON.stringify(component.items)}, ${q(component.sourceLabel)})`;
      case "PatientPicker":
        return `${name} = PatientPicker(${q(component.title)}, ${q(component.message)}, ${JSON.stringify(component.patients)})`;
      case "PatientSummary":
        return `${name} = PatientContextCard(${q(component.patientId)}, ${q(component.title)}, ${q(component.narrative)}, ${JSON.stringify(component.sections)}, ${q(component.sourceLabel)})`;
      case "TaskList":
        return `${name} = TaskListCard(${q(component.title)}, ${component.count}, ${q(component.summary)}, ${q(component.sourceLabel)})`;
      case "VitalTrend": {
        const points = component.points.map(({ secondaryValue, ...point }) =>
          secondaryValue === null ? point : { ...point, secondaryValue },
        );
        return `${name} = VitalTrendCard(${q(component.label)}, ${q(component.value)}, ${JSON.stringify(points)}, ${q(component.sourceLabel)})`;
      }
      case "HandoverChecklist":
        return `${name} = HandoverDeltaCard(${q(component.title)}, ${component.openCount}, ${q(component.summary)}, ${q(component.sourceLabel)})`;
      case "TeamInbox":
        return `${name} = TeamInboxCard(${q(component.title)}, ${component.count}, ${q(component.summary)}, ${q(component.sourceLabel)}, ${JSON.stringify(component.items)})`;
      case "SyncSummary":
        return `${name} = SyncSummaryCard(${q(component.title)}, ${component.pending}, ${component.conflicts}, ${q(component.summary)}, ${q(component.sourceLabel)})`;
      case "EvidenceTable":
        return `${name} = EvidenceTable(${q(component.title)}, ${JSON.stringify(component.columns)}, ${JSON.stringify(component.rows)}, ${component.complete}, ${q(component.sourceLabel)})`;
      case "EvidenceChart":
        return `${name} = EvidenceChart(${q(component.title)}, ${JSON.stringify(component.points)}, ${component.complete}, ${q(component.sourceLabel)})`;
      case "DraftAction":
        return `${name} = DraftActionCard(${q(component.kind)}, ${q(component.title)}, ${q(component.preview)}, ${q(component.actionLabel)}, ${q(component.intentToken)}, ${q(component.sourceLabel)}, ${JSON.stringify(component.reviewItems ?? [])})`;
      case "MedicationReadOnly":
        return `${name} = MedicationReadOnlyCard(${q(component.summary)}, ${q(component.sourceLabel)})`;
      case "SafetyAlert":
        return `${name} = SafetyNotice(${q(component.severity)}, ${q(component.message)})`;
      case "KnowledgeAnswer":
        return `${name} = PolicyAnswerCard(${q(component.title)}, ${q(component.answer)}, ${q(component.sourceLabel)})`;
      case "UnknownState":
        return `${name} = UnknownStateCard(${q(component.message)})`;
    }
  });
  return [
    `root = ClinicalStack([${components.map((_component, index) => `item${index}`).join(", ")}])`,
    ...statements,
  ].join("\n");
}

function cleanDraft(prompt: string): string {
  return prompt
    .replace(
      /^(bitte\s+)?(notiz|dokumentiere|schreib(?:e)?(?:\s+auf)?|anamnes(?:e|is))\s*[:,-]?\s*/i,
      "",
    )
    .trim()
    .slice(0, 1200);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function formatEvidenceValue(value: string | number | boolean | null): string {
  if (value === null) return "nicht angegeben";
  if (typeof value === "boolean") return value ? "ja" : "nein";
  if (typeof value === "number") return String(value).replace(".", ",");
  return value;
}

function taskStateLabel(value: unknown): string {
  const states: Record<string, string> = {
    accepted: "offen",
    ready: "bereit",
    "in-progress": "in Arbeit",
    paused: "pausiert",
    completed: "erledigt",
    cancelled: "abgebrochen",
  };
  return typeof value === "string" ? (states[value] ?? value) : "unbekannt";
}

function acceptedObservationStatus(value: unknown): string | null {
  return value === "independently-accepted"
    ? "unabhängig bestätigt"
    : value === "accepted"
      ? "freigegeben"
      : value === "draft"
        ? "noch nicht bestätigt"
        : null;
}

function boundedAtomText(
  atoms: readonly string[],
  suffix: string,
  maxLength = 1200,
): string | null {
  const omission = "Weitere belegte Angaben sind in den Quellen einsehbar.";
  const selected: string[] = [];
  let omitted = 0;
  for (const atom of atoms) {
    const candidate = [...selected, atom, suffix].filter(Boolean).join(" ");
    if (candidate.length <= maxLength) selected.push(atom);
    else omitted += 1;
  }
  if (omitted > 0) {
    while (
      selected.length > 0 &&
      [...selected, omission, suffix].filter(Boolean).join(" ").length >
        maxLength
    )
      selected.pop();
    if ([omission, suffix].filter(Boolean).join(" ").length <= maxLength)
      selected.push(omission);
  }
  const result = [...selected, suffix].filter(Boolean).join(" ");
  return result.length > 0 && result.length <= maxLength ? result : null;
}

function containsProtectedTerm(
  text: string,
  protectedTerms: readonly string[],
): boolean {
  return protectedTerms.some((term) =>
    new RegExp(
      `(?:^|[^\\p{L}\\d])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^\\p{L}\\d])`,
      "iu",
    ).test(text),
  );
}

function splitNaturalClauses(text: string): string[] {
  return text
    .split(/(?<=[.!?;])\s+|\n+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * A clarification may sound natural and include a short process explanation.
 * Declarative patient assertions remain unavailable without exact claims.
 */
function boundedClarificationQuestion(
  text: string,
  protectedTerms: readonly string[],
): string | null {
  const clarification = text.trim();
  if (
    clarification.length === 0 ||
    clarification.length > 800 ||
    !clarification.includes("?")
  )
    return null;
  const clauses = splitNaturalClauses(clarification);
  if (clauses.length === 0 || clauses.length > 4) return null;
  const unsupportedDeclarativePremise = clauses.some(
    (clause) =>
      !clause.includes("?") &&
      (containsProtectedTerm(clause, protectedTerms) ||
        /\b\d+(?:[.,/]\d+)?\s*(?:mmhg|°c|grad|ml|kg|%|\/min)\b/iu.test(
          clause,
        ) ||
        /\b(?:schmerzfrei|stabil|selbstständig|abgeschlossen|erledigt|offen|unauffällig|reizlos)\b/iu.test(
          clause,
        )),
  );
  return unsupportedDeclarativePremise ? null : clarification;
}

function safeSourceFreePatientDialogue(
  text: string,
  protectedTerms: readonly string[],
): string | null {
  const dialogue = text.trim();
  if (dialogue.length === 0 || dialogue.length > 1_200) return null;
  if (
    containsProtectedTerm(dialogue, protectedTerms) ||
    canonicalClaimTokens(dialogue).length > 0 ||
    requiresDedicatedClinicalWorkflow(dialogue) ||
    /\b(?:diagnos|schmerzfrei|stabil|unauffällig|reizlos|verabreicht|gegeben|durchgeführt|erledigt|offen|vollständig|dokumentiert)\p{L}*\b/iu.test(
      dialogue,
    )
  )
    return null;
  return dialogue;
}

/**
 * The model selects exact evidence; it never authors displayed clinical facts.
 * Rendering verified atoms here makes label/value/unit/time/status indivisible,
 * so prose cannot swap two rows or turn retrieval time into occurrence time.
 */
function verifiedCoworkerContent(
  run: AgentRunResult,
  options: {
    allowSourceFreeModelText: boolean;
    protectedPatientTerms: readonly string[];
  },
): { dialogue: string; clinicalFacts: string[] } | null {
  if (
    !["conversation", "answer", "clarification-needed", "no-action"].includes(
      run.status,
    ) ||
    run.text.trim().length === 0
  )
    return null;

  if (run.toolCalls === 0) {
    if (
      (run.sourceReferenceIds?.length ?? 0) > 0 ||
      (run.evidenceClaims?.length ?? 0) > 0 ||
      (run.presentation && run.presentation.kind !== "text")
    )
      return null;
    if (run.status === "conversation") {
      const text = safeSourceFreePatientDialogue(
        run.text,
        options.protectedPatientTerms,
      );
      return text ? { dialogue: text, clinicalFacts: [] } : null;
    }
    if (run.status === "clarification-needed") {
      const clarification = boundedClarificationQuestion(
        run.text,
        options.protectedPatientTerms,
      );
      return clarification
        ? { dialogue: clarification, clinicalFacts: [] }
        : null;
    }
    if (run.status === "no-action")
      return {
        dialogue:
          "Verstanden. Es wurde keine Aktion vorbereitet oder ausgeführt.",
        clinicalFacts: [],
      };
    return null;
  }

  if (run.status === "conversation") return null;
  const cited = new Set(run.sourceReferenceIds ?? []);
  if (cited.size === 0) return null;
  const evidenceRecords = (run.evidenceRecords ?? []).filter((record) =>
    cited.has(record.referenceId),
  );
  if (evidenceRecords.length !== cited.size) return null;
  const claims = run.evidenceClaims ?? [];
  if (["answer", "no-action"].includes(run.status) && claims.length === 0)
    return null;
  if (
    run.status === "answer" &&
    [...cited].some(
      (referenceId) =>
        !claims.some((claim) => claim.referenceId === referenceId),
    )
  )
    return null;
  if (
    claims.some((claim) => {
      const record = evidenceRecords.find(
        (candidate) => candidate.referenceId === claim.referenceId,
      );
      return (
        !record ||
        !cited.has(claim.referenceId) ||
        !Object.is(valueAt(record.data, claim.path), claim.value)
      );
    })
  )
    return null;
  const hasExactClaim = (referenceId: string, path: string): boolean =>
    claims.some(
      (candidate) =>
        candidate.referenceId === referenceId && candidate.path === path,
    );
  const renderedAtoms: SourceBoundAtom[] = [];
  const consumed = new Set<string>();
  const claimKey = (referenceId: string, path: string) =>
    `${referenceId}\u0000${path}`;

  // Measurements are rendered as indivisible server-owned atoms.
  if (
    claims.some((claim) => {
      const match = claim.path.match(/^(observations\.\d+)\./);
      if (!match) return false;
      const base = match[1]!;
      const required = [
        "label",
        "value",
        "secondaryValue",
        "unit",
        "effectiveAt",
        "status",
      ];
      if (
        required.some(
          (field) => !hasExactClaim(claim.referenceId, `${base}.${field}`),
        )
      )
        return true;
      const record = evidenceRecords.find(
        ({ referenceId }) => referenceId === claim.referenceId,
      )!;
      const row = valueAt(record.data, base);
      const label = valueAt(row, "label");
      const value = valueAt(row, "value");
      const secondary = valueAt(row, "secondaryValue");
      const unit = valueAt(row, "unit");
      const effectiveAt = valueAt(row, "effectiveAt");
      const status = acceptedObservationStatus(valueAt(row, "status"));
      const provenance = record.rowProvenance?.find(
        ({ path }) => path === base,
      );
      if (
        typeof label !== "string" ||
        typeof value !== "number" ||
        (secondary !== null && typeof secondary !== "number") ||
        typeof unit !== "string" ||
        typeof effectiveAt !== "string" ||
        status === null ||
        !provenance?.resourceId ||
        !provenance.version
      )
        return true;
      for (const candidate of claims)
        if (
          candidate.referenceId === claim.referenceId &&
          candidate.path.startsWith(`${base}.`)
        )
          consumed.add(claimKey(candidate.referenceId, candidate.path));
      const displayValue = `${formatEvidenceValue(value)}${secondary === null ? "" : `/${formatEvidenceValue(secondary)}`}`;
      const occurred = Number.isNaN(Date.parse(effectiveAt))
        ? effectiveAt
        : formatOrganizationTimestamp(effectiveAt);
      const text = `${label}: ${displayValue} ${unit} · gemessen am ${occurred} · ${status}.`;
      if (!renderedAtoms.some((atom) => atom.text === text))
        renderedAtoms.push({ text, entityLabels: [label] });
      return false;
    })
  )
    return null;

  // Task title and state are rendered from the same row.
  if (
    claims.some((claim) => {
      const match = claim.path.match(/^(tasks\.\d+)\./);
      if (!match) return false;
      const base = match[1]!;
      if (
        !hasExactClaim(claim.referenceId, `${base}.title`) ||
        !hasExactClaim(claim.referenceId, `${base}.state`) ||
        !hasExactClaim(claim.referenceId, `${base}.patientLabel`)
      )
        return true;
      const record = evidenceRecords.find(
        ({ referenceId }) => referenceId === claim.referenceId,
      )!;
      const row = valueAt(record.data, base);
      const title = valueAt(row, "title");
      const state = valueAt(row, "state");
      const patientLabel = valueAt(row, "patientLabel");
      const provenance = record.rowProvenance?.find(
        ({ path }) => path === base,
      );
      if (
        typeof title !== "string" ||
        typeof state !== "string" ||
        typeof patientLabel !== "string" ||
        !provenance?.resourceId ||
        !provenance.version
      )
        return true;
      for (const candidate of claims)
        if (
          candidate.referenceId === claim.referenceId &&
          candidate.path.startsWith(`${base}.`)
        )
          consumed.add(claimKey(candidate.referenceId, candidate.path));
      const text = `${patientLabel} · ${title}: ${taskStateLabel(state)}.`;
      if (!renderedAtoms.some((atom) => atom.text === text))
        renderedAtoms.push({
          text,
          entityLabels: [title],
          subjectLabels: [patientLabel],
        });
      return false;
    })
  )
    return null;

  // Team-message facts always retain the patient subject and durable source.
  if (
    claims.some((claim) => {
      const match = claim.path.match(/^(communications\.\d+)\./);
      if (!match) return false;
      const base = match[1]!;
      const required = ["patientLabel", "request", "recipientRole", "state"];
      if (
        required.some(
          (field) => !hasExactClaim(claim.referenceId, `${base}.${field}`),
        )
      )
        return true;
      const record = evidenceRecords.find(
        ({ referenceId }) => referenceId === claim.referenceId,
      )!;
      const row = valueAt(record.data, base);
      const patientLabel = valueAt(row, "patientLabel");
      const request = valueAt(row, "request");
      const recipientRole = valueAt(row, "recipientRole");
      const state = valueAt(row, "state");
      const provenance = record.rowProvenance?.find(
        ({ path }) => path === base,
      );
      if (
        typeof patientLabel !== "string" ||
        typeof request !== "string" ||
        typeof recipientRole !== "string" ||
        typeof state !== "string" ||
        !provenance?.resourceId ||
        !provenance.version
      )
        return true;
      for (const candidate of claims)
        if (
          candidate.referenceId === claim.referenceId &&
          candidate.path.startsWith(`${base}.`)
        )
          consumed.add(claimKey(candidate.referenceId, candidate.path));
      const text = `${patientLabel} · Nachricht an ${recipientRole}: ${request} · ${state}.`;
      if (!renderedAtoms.some((atom) => atom.text === text))
        renderedAtoms.push({
          text,
          entityLabels: [request, recipientRole],
          subjectLabels: [patientLabel],
        });
      return false;
    })
  )
    return null;

  const fieldLabels: Record<string, string> = {
    displayName: "Name",
    room: "Zimmer",
    openCount: "Offene Übergabepunkte",
    acknowledgedCount: "Bestätigte Patientenkontexte",
    assignedCount: "Zugewiesene Patientenkontexte",
    summary: "Zusammenfassung",
    totalCount: "Anzahl",
    id: "Arbeitsablauf",
    status: "Status",
  };
  for (const claim of claims) {
    if (consumed.has(claimKey(claim.referenceId, claim.path))) continue;
    const last = claim.path.split(".").at(-1)!;
    const parent = claim.path.split(".").slice(-2, -1)[0];
    const label =
      parent === "risks"
        ? "Risiko"
        : parent === "careGoals"
          ? "Pflegeziel"
          : (fieldLabels[last] ?? last);
    renderedAtoms.push({
      text: `${label}: ${formatEvidenceValue(claim.value)}.`,
      entityLabels: [label],
    });
  }
  if (renderedAtoms.length === 0 && run.status !== "clarification-needed")
    return null;
  if (run.status === "clarification-needed") {
    const clarification = boundedClarificationQuestion(
      run.text,
      options.protectedPatientTerms,
    );
    return clarification
      ? { dialogue: clarification, clinicalFacts: [] }
      : null;
  }
  const suffix =
    run.status === "no-action"
      ? "Es wurde keine Aktion vorbereitet oder ausgeführt."
      : "";
  const dialogue =
    verifyNaturalDialogueAgainstSources(
      run.text,
      renderedAtoms,
      options.protectedPatientTerms,
    ) ?? "Hier sind die belegten Angaben.";
  const factTexts = renderedAtoms.map(({ text }) => text);
  const facts = boundedAtomText(factTexts, suffix);
  return dialogue && facts
    ? {
        dialogue: suffix ? `${dialogue} ${suffix}` : dialogue,
        clinicalFacts: factTexts,
      }
    : null;
}

function generatedCoworkerSources(
  run: AgentRunResult,
  contextBinding: NonNullable<
    AssistantResponse["evidence"][number]["contextBinding"]
  >,
): AssistantResponse["evidence"] {
  const cited = new Set(run.sourceReferenceIds ?? []);
  const labels: Record<string, string> = {
    get_patient_summary: "Patientenübersicht",
    get_open_tasks: "Aufgabenübersicht",
    get_latest_vitals: "freigegebene Vitalwerte",
    get_handover: "Übergabe",
    get_team_inbox: "Team-Nachrichten",
    get_sync_status: "Synchronisationsstatus",
    search_approved_knowledge: "freigegebene Wissensquelle",
  };
  return (run.evidenceRecords ?? [])
    .filter((record) => cited.has(record.referenceId))
    .map((record) => {
      const parsedVersion = Number.parseInt(record.sourceVersion ?? "", 10);
      const claims = (run.evidenceClaims ?? [])
        .filter(({ referenceId }) => referenceId === record.referenceId)
        .map(({ path, value }) => ({ path, value }));
      const selectedRowPaths = new Set(
        claims.flatMap(({ path }) => {
          const match = path.match(
            /^((?:tasks|observations|communications|deliveries)\.\d+)\./,
          );
          return match ? [match[1]!] : [];
        }),
      );
      const rowProvenance = (record.rowProvenance ?? []).filter(({ path }) =>
        selectedRowPaths.has(path),
      );
      const durableReference = record.sourceReferenceId ?? record.referenceId;
      const qualifier = [
        labels[record.toolName] ?? "autorisierte Laufzeitquelle",
        record.freshness ? `abgerufen am ${record.freshness}` : null,
        record.complete ? "vollständig" : "Ausschnitt, nicht vollständig",
      ]
        .filter(Boolean)
        .join(" · ");
      const archivedEvidence = {
        resourceId: durableReference,
        version: Number.isFinite(parsedVersion) ? parsedVersion : 0,
        label: qualifier,
        ...(record.sourceVersion
          ? { sourceVersion: record.sourceVersion }
          : {}),
        ...(record.freshness ? { freshness: record.freshness } : {}),
        complete: record.complete,
        claims,
        ...(rowProvenance.length > 0
          ? { rowProvenance: structuredClone(rowProvenance) }
          : {}),
        contextBinding,
        sourceDigest: createHash("sha256")
          .update(
            canonicalJson({
              resourceId: durableReference,
              toolName: record.toolName,
              sourceVersion: record.sourceVersion ?? null,
              freshness: record.freshness ?? null,
              complete: record.complete,
              data: record.data,
              rowProvenance: record.rowProvenance ?? [],
            }),
          )
          .digest("hex"),
      };
      return {
        ...archivedEvidence,
        digest: createHash("sha256")
          .update(canonicalJson(archivedEvidence))
          .digest("hex"),
      };
    });
}

export function verifyAssistantEvidenceDigest(
  evidence: AssistantResponse["evidence"][number],
): boolean {
  if (!evidence.digest) return false;
  const { digest, ...archivedEvidence } = evidence;
  return (
    createHash("sha256")
      .update(canonicalJson(archivedEvidence))
      .digest("hex") === digest
  );
}

function valueAt(data: unknown, path: string): unknown {
  if (!/^[A-Za-z][A-Za-z0-9_]*(?:\.\d+|\.[A-Za-z][A-Za-z0-9_]*)*$/.test(path))
    return undefined;
  return path.split(".").reduce<unknown>((current, segment) => {
    if (Array.isArray(current) && /^\d+$/.test(segment))
      return current[Number(segment)];
    if (
      current !== null &&
      typeof current === "object" &&
      !Array.isArray(current) &&
      Object.prototype.hasOwnProperty.call(current, segment)
    )
      return (current as Record<string, unknown>)[segment];
    return undefined;
  }, data);
}

function scalarAt(
  row: unknown,
  path: string,
): string | number | boolean | null {
  const value = valueAt(row, path);
  return value === null ||
    ["string", "number", "boolean"].includes(typeof value)
    ? (value as string | number | boolean | null)
    : null;
}

function modelPresentation(run: AgentRunResult): AssistantComponent | null {
  const spec = run.presentation;
  if (!spec || spec.kind === "text") return null;
  const record = run.evidenceRecords?.find(
    (candidate) => candidate.referenceId === spec.sourceReferenceId,
  );
  if (!record || !(run.sourceReferenceIds ?? []).includes(record.referenceId))
    return null;
  const sourceLabel = `${record.sourceReferenceId ?? record.referenceId}${record.complete ? "" : " · Ausschnitt, nicht vollständig"}`;
  const claimPaths = new Set(
    (run.evidenceClaims ?? [])
      .filter(({ referenceId }) => referenceId === record.referenceId)
      .map(({ path }) => path),
  );
  const selectedRows = (
    collectionPath: string,
    requiredFields: readonly string[],
  ): unknown[] | null => {
    const candidateCollection = valueAt(record.data, collectionPath);
    if (!Array.isArray(candidateCollection)) return null;
    const collection: unknown[] = candidateCollection;
    const indices = [
      ...new Set(
        [...claimPaths].flatMap((path) => {
          const match = path.match(
            new RegExp(`^${collectionPath.replaceAll(".", "\\.")}\\.(\\d+)\\.`),
          );
          return match ? [Number(match[1])] : [];
        }),
      ),
    ].toSorted((left, right) => left - right);
    const rows: unknown[] = indices.flatMap((index) => {
      const base = `${collectionPath}.${index}`;
      return requiredFields.every((field) => claimPaths.has(`${base}.${field}`))
        ? [collection[index]]
        : [];
    });
    return rows.length > 0 && rows.length === indices.length ? rows : null;
  };
  if (spec.kind === "table") {
    if (
      record.toolName === "get_open_tasks" &&
      spec.collectionPath === "tasks"
    ) {
      const rows = selectedRows("tasks", [
        "patientLabel",
        "title",
        "state",
        "dueAt",
      ]);
      if (!rows) return null;
      return {
        type: "EvidenceTable",
        title: "Autorisierte Aufgabenübersicht",
        columns: ["Patient", "Aufgabe", "Status", "Fällig"],
        rows: rows.map((row) => [
          String(scalarAt(row, "patientLabel") ?? "—"),
          String(scalarAt(row, "title") ?? "—"),
          taskStateLabel(scalarAt(row, "state")),
          String(scalarAt(row, "dueAt") ?? "—"),
        ]),
        complete: false,
        sourceLabel,
      };
    }
    if (
      record.toolName === "get_latest_vitals" &&
      spec.collectionPath === "observations"
    ) {
      const rows = selectedRows("observations", [
        "label",
        "value",
        "secondaryValue",
        "unit",
        "effectiveAt",
        "status",
      ]);
      if (!rows) return null;
      return {
        type: "EvidenceTable",
        title: "Autorisierte Messwertübersicht",
        columns: ["Messwert", "Wert", "Einheit", "Gemessen am", "Status"],
        rows: rows.map((row) => [
          String(scalarAt(row, "label") ?? "—"),
          `${formatEvidenceValue(scalarAt(row, "value"))}${scalarAt(row, "secondaryValue") === null ? "" : `/${formatEvidenceValue(scalarAt(row, "secondaryValue"))}`}`,
          String(scalarAt(row, "unit") ?? "—"),
          String(scalarAt(row, "effectiveAt") ?? "—"),
          acceptedObservationStatus(scalarAt(row, "status")) ?? "—",
        ]),
        complete: false,
        sourceLabel,
      };
    }
    if (
      record.toolName === "get_team_inbox" &&
      spec.collectionPath === "communications"
    ) {
      const rows = selectedRows("communications", [
        "patientLabel",
        "request",
        "recipientRole",
        "state",
        "dueAt",
      ]);
      if (!rows) return null;
      return {
        type: "EvidenceTable",
        title: "Autorisierte Teamübersicht",
        columns: ["Patient", "Nachricht", "Empfängerrolle", "Status", "Fällig"],
        rows: rows.map((row) => [
          String(scalarAt(row, "patientLabel") ?? "—"),
          String(scalarAt(row, "request") ?? "—"),
          String(scalarAt(row, "recipientRole") ?? "—"),
          String(scalarAt(row, "state") ?? "—"),
          String(scalarAt(row, "dueAt") ?? "—"),
        ]),
        complete: false,
        sourceLabel,
      };
    }
    return null;
  }
  if (
    record.toolName !== "get_latest_vitals" ||
    spec.collectionPath !== "observations" ||
    spec.xPath !== "effectiveAt" ||
    spec.yPath !== "value" ||
    spec.labelPath !== "label"
  )
    return null;
  const rows = selectedRows("observations", [
    "label",
    "value",
    "secondaryValue",
    "unit",
    "effectiveAt",
    "status",
  ]);
  if (!rows) return null;
  const label = scalarAt(rows[0], "label");
  const unit = scalarAt(rows[0], "unit");
  if (
    typeof label !== "string" ||
    typeof unit !== "string" ||
    rows.some(
      (row) =>
        scalarAt(row, "label") !== label ||
        scalarAt(row, "unit") !== unit ||
        scalarAt(row, "secondaryValue") !== null,
    )
  )
    return null;
  const points = rows.flatMap((row) => {
    const x = scalarAt(row, "effectiveAt");
    const y = scalarAt(row, "value");
    return typeof y === "number" && typeof x === "string"
      ? [{ x, y, label }]
      : [];
  });
  if (points.length !== rows.length) return null;
  return {
    type: "EvidenceChart",
    title: `${label} (${unit}) · Verlauf nach Messzeitpunkt`,
    points,
    complete: false,
    sourceLabel: `${sourceLabel} · Einheit ${unit}`,
  };
}

function explicitlyRequestsNote(prompt: string): boolean {
  return /^\s*(?:bitte\s+)?(?:notiz|dokumentiere|schreib(?:e)?(?:\s+auf)?|anamnes(?:e|is))\b/i.test(
    prompt,
  );
}

function validateDurableIntentPayload(
  record: Pick<DurableIntentRecord, "command" | "payload">,
): void {
  if (record.command !== "care-update:draft") return;
  const plan = verifyProposalSourceRecords(
    assistantProposalSchema.parse(JSON.parse(record.payload.plan ?? "null")),
  );
  const sources = new Map(
    (plan.sourceRecords ?? []).map((source) => [source.id, source.text]),
  );
  for (const action of plan.actions) {
    const sourceText = (action.sourceRecordIds ?? [])
      .map((id) => sources.get(id) ?? "")
      .join("\n");
    const actionText =
      action.type === "note-proposal"
        ? `${sourceText}\n${action.structuredText}`
        : sourceText;
    if (requiresDedicatedClinicalWorkflow(actionText))
      throw new DomainError(
        "VALIDATION",
        "Dieser Inhalt gehört in den dafür vorgesehenen klinischen Fachworkflow.",
        400,
      );
  }
}

function explicitlyRequestsTask(prompt: string): boolean {
  const request =
    /\b(?:erstelle|eröffne|lege)\b[^.;!?]{0,50}\b(?:aufgabe|task)\b|^\s*(?:aufgabe|task)\s*:/i.exec(
      prompt,
    );
  if (!request || request.index === undefined) return false;
  const clauseStart = Math.max(
    prompt.lastIndexOf(".", request.index - 1),
    prompt.lastIndexOf(";", request.index - 1),
    prompt.lastIndexOf("!", request.index - 1),
    prompt.lastIndexOf("?", request.index - 1),
  );
  const clauseEndCandidates = [".", ";", "!", "?"]
    .map((separator) => prompt.indexOf(separator, request.index))
    .filter((index) => index >= 0);
  const clauseEnd = clauseEndCandidates.length
    ? Math.min(...clauseEndCandidates)
    : prompt.length;
  const clause = prompt.slice(clauseStart + 1, clauseEnd + 1);
  return !/\b(?:nicht|nie|keinesfalls|kein(?:e|en|er|es)?|auf\s+keinen\s+fall|vielleicht|möglicherweise|eventuell|unklar)\b|\b(?:sollte|könnte)\s+man\b/i.test(
    clause,
  );
}

function intentVoiceProvenance(
  payload: Record<string, string>,
): VoiceTranscriptProvenance[] {
  if (!payload.voiceTranscriptProvenance) return [];
  const parsed = z
    .array(z.unknown())
    .max(20)
    .parse(JSON.parse(payload.voiceTranscriptProvenance));
  return parsed.map(parseVoiceTranscriptProvenance);
}

function explicitlyRequestsPhysicianMessage(prompt: string): boolean {
  const requested =
    /\bfrage\s+an\s+(?:arzt|ärztin|ärztlichen?\s+dienst)\b|\b(?:arzt|ärztin|ärztlichen?\s+dienst)\b[^.;]{0,60}\b(?:informieren|benachrichtigen|fragen)\b|\b(?:informiere|benachrichtige|frage)\b[^.;]{0,60}\b(?:arzt|ärztin|ärztlichen?\s+dienst)\b|\b(?:frage|nachricht|informiere|benachrichtige|schreibe|sende)\b\s+@\p{L}[\p{L}-]*/iu.test(
      prompt,
    );
  const negated =
    /\b(?:nicht|nie|keinesfalls|keineswegs|mitnichten|kein(?:e|en)?|auf\s+keinen\s+fall)\b[^.;]{0,80}\b(?:arzt|ärztin|informieren|benachrichtigen|fragen)\b|\b(?:arzt|ärztin)\b[^.;]{0,80}\b(?:nicht|nie|keinesfalls|keineswegs|mitnichten|kein(?:e|en)?|auf\s+keinen\s+fall)\b|\b(?:arzt|ärztin)[^.;!?]{0,35}\b(?:informieren|benachrichtigen|fragen)\b\s*\?\s*nein\b/i.test(
      prompt,
    );
  const historicalOrCompleted =
    /\b(?:gestern|vorgestern|früher|damals|bereits)\b|\b(?:wurde|war|ist|hat)\b[^.;]{0,60}\b(?:informiert|benachrichtigt|gefragt)\b/i.test(
      prompt,
    );
  const uncertainOrQuestion =
    /\b(?:vielleicht|möglicherweise|eventuell|unklar|wohl|vermutlich|wahrscheinlich|mutmasslich|mutmaßlich|schätzungsweise|angeblich)\b|\b(?:sollte|könnte|dürfte)\s+man\b[^?]{0,100}\?/i.test(
      prompt,
    );
  return (
    requested && !negated && !historicalOrCompleted && !uncertainOrQuestion
  );
}

const organizationTimeZone = siteConfiguration.timeZone;

function zonedParts(instant: Date): Record<string, number> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: organizationTimeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}

function localZurichToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const localUtc = Date.UTC(year, month - 1, day, hour, minute);
  let guess = new Date(localUtc);
  for (let pass = 0; pass < 3; pass += 1) {
    const parts = zonedParts(guess);
    const represented = Date.UTC(
      parts.year!,
      parts.month! - 1,
      parts.day,
      parts.hour,
      parts.minute,
    );
    guess = new Date(guess.getTime() + (localUtc - represented));
  }
  return guess;
}

export function resolveOccurrenceTime(
  occurrence: string | null,
  inputTimestamp: string,
): string | null {
  if (!occurrence) return inputTimestamp;
  const explicit =
    /\b(?:(gestern|heute)\s+)?um\s+(\d{1,2})(?::(\d{2}))?\s*uhr\b/.exec(
      occurrence.toLocaleLowerCase("de-CH"),
    );
  if (!explicit) return null;
  const input = new Date(inputTimestamp);
  if (Number.isNaN(input.getTime())) return null;
  const parts = zonedParts(input);
  const localDate = new Date(
    Date.UTC(parts.year!, parts.month! - 1, parts.day),
  );
  if (explicit[1] === "gestern")
    localDate.setUTCDate(localDate.getUTCDate() - 1);
  const hour = Number(explicit[2]);
  const minute = Number(explicit[3] ?? "0");
  if (hour > 23 || minute > 59) return null;
  return localZurichToInstant(
    localDate.getUTCFullYear(),
    localDate.getUTCMonth() + 1,
    localDate.getUTCDate(),
    hour,
    minute,
  ).toISOString();
}

function formatOrganizationTime(value: string): string {
  return new Intl.DateTimeFormat("de-CH", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: organizationTimeZone,
  }).format(new Date(value));
}

function formatOrganizationTimestamp(value: string): string {
  return `${new Intl.DateTimeFormat("de-CH", {
    dateStyle: "short",
    timeStyle: "short",
    hour12: false,
    timeZone: "Europe/Zurich",
  }).format(new Date(value))} ${organizationTimeZone}`;
}

export class AssistantService {
  private readonly intents = new OpaqueIntentBroker();

  constructor(
    private readonly clinical: PflegehelferService,
    private readonly models = new ModelGateway(),
    private readonly knowledge = new ApprovedKnowledgeService(),
    private readonly runtimeReaders: {
      getSyncStatus?: () => Promise<AgentToolResult>;
    } = {},
  ) {}

  revokeResponseIntents(response: AssistantResponse): void {
    for (const component of response.components)
      if (component.type === "DraftAction")
        this.intents.revoke(component.intentToken);
  }

  revokeActorIntents(actorId: string): void {
    this.intents.revokeActor(actorId);
  }

  durableIntentRecord(token: string): DurableIntentRecord | null {
    return this.intents.durableRecord(token);
  }

  restoreDurableIntent(token: string, record: DurableIntentRecord): void {
    validateDurableIntentPayload(record);
    this.intents.restore(token, record);
  }

  reissueDurableIntent(userId: string, record: DurableIntentRecord): string {
    const actor = this.clinical.user(userId);
    if (record.actorId !== actor.id || record.actorRole !== actor.role)
      throw new DomainError(
        "AUTH_DENIED",
        "Der offene Entwurf gehört nicht zu dieser Mitarbeitenden-Sitzung.",
        403,
      );
    validateDurableIntentPayload(record);
    return this.intents.issue(actor, {
      command: record.command,
      patientId: record.patientId,
      encounterId: record.encounterId,
      purpose: record.purpose,
      resourceVersion: record.resourceVersion,
      payload: record.payload,
      ttlMs: 120_000,
    });
  }

  async query(
    userId: string,
    request: AssistantRequest,
  ): Promise<AssistantResponse> {
    const actor = this.clinical.user(userId);
    const purpose = request.purpose ?? actor.defaultPurpose;
    const prompt = request.prompt.trim();
    if (prompt.length < 2 || prompt.length > 8_000)
      throw new DomainError(
        "VALIDATION",
        "Assistenzanfrage ist ungültig.",
        400,
      );
    if (request.inputModality === "voice" && !request.voiceTranscriptConfirmed)
      throw new DomainError(
        "VALIDATION",
        "Das Sprachtranskript muss vor der Verarbeitung sichtbar bestätigt werden.",
        400,
      );
    if (request.inputModality === "voice" && !request.voiceTranscriptProvenance)
      throw new DomainError(
        "VALIDATION",
        "Die bestätigte Sprachherkunft fehlt.",
        400,
      );
    if (request.inputModality !== "voice" && request.voiceTranscriptProvenance)
      throw new DomainError(
        "VALIDATION",
        "Sprachherkunft darf nicht als Texteingabe übernommen werden.",
        400,
      );
    const snapshot = this.clinical.snapshot(userId, purpose);
    const patient = request.patientId
      ? snapshot.patients.find((item) => item.id === request.patientId)
      : null;
    if (request.patientId && !patient)
      throw new DomainError(
        "AUTH_DENIED",
        "Patientenkontext ist für diese Assistenzanfrage nicht freigegeben.",
        403,
      );

    const modelContext: AuthorizedModelContext | undefined =
      request.workingContext
        ? {
            organizationLabel: request.workingContext.organizationLabel,
            actorRole: request.workingContext.actorRole,
            workflowStep: request.workingContext.currentStepId,
            activeEpisodeTitle: request.workingContext.activeEpisodeTitle,
            recentPrompts: request.workingContext.recentPrompts,
            ...(request.workingContext.recentConversation
              ? {
                  recentConversation: request.workingContext.recentConversation,
                }
              : {}),
            dataClass: request.workingContext.dataClass,
          }
        : undefined;
    const canRunBoundedAgent = Boolean(
      request.workingContext?.roleProfileId &&
      request.workingContext.workflowId &&
      this.models.supportsAgent(request.workingContext.dataClass),
    );
    // The bounded agent chooses conversational read/draft tools directly.
    // Its free-language path must not pay for, or depend on, a separate model
    // intent enum. The deterministic route remains only a fast presentation
    // hint and an honest degraded-mode control surface.
    const classified = canRunBoundedAgent
      ? this.models.classifyDeterministically(prompt)
      : await this.models.classify(prompt, modelContext, request.signal);
    // Raw-language safety gates are authoritative even when a configured
    // model chose a broader keyword route.
    let safeIntent = classified.intent;
    if (requiresDedicatedClinicalWorkflow(prompt)) {
      safeIntent = "medication-request";
    } else if (explicitlyRefusesDocumentation(prompt)) {
      safeIntent = "care-update";
    } else if (
      (safeIntent === "draft-note" && !explicitlyRequestsNote(prompt)) ||
      (safeIntent === "draft-task" && !explicitlyRequestsTask(prompt)) ||
      (safeIntent === "draft-physician-question" &&
        !explicitlyRequestsPhysicianMessage(prompt))
    ) {
      // A model may classify/navigation-rank an ambiguous utterance, but only
      // independently recognizable user language may unlock a mutation UI.
      safeIntent = "unknown";
    }
    if (
      patient &&
      request.workingContext?.previousCarePlan &&
      /\b(?:korrektur|stattdessen|eher|nur|doch|noch\s+nichts)\b/i.test(prompt)
    )
      safeIntent = "care-update";
    let agentRun: AgentRunResult | null = null;
    let agentGuidance: ReturnType<typeof resolveRuntimeGuidance> | null = null;
    let agentPreparedCarePlan: ClinicalPlanResult | null = null;
    let agentPreparedCareReferenceId: string | null = null;
    const agentEligibleIntents = new Set([
      "patient-summary",
      "open-tasks",
      "latest-vitals",
      "handover",
      "team-inbox",
      "sync-status",
      "draft-note",
      "draft-task",
      "draft-physician-question",
      "care-update",
      "unknown",
    ]);
    if (
      canRunBoundedAgent &&
      request.workingContext &&
      request.workingContext.roleProfileId &&
      request.workingContext.workflowId &&
      agentEligibleIntents.has(safeIntent)
    ) {
      agentGuidance = resolveRuntimeGuidance(runtimeSitePack, {
        departmentId: request.workingContext.departmentId,
        ...(request.workingContext.stationId
          ? { stationId: request.workingContext.stationId }
          : {}),
        roleProfileId: request.workingContext.roleProfileId,
        workflowId: request.workingContext.workflowId,
      });
      const emptyInput = z.object({}).strict();
      const workflowSkillInput = z
        .object({ skillId: z.string().regex(/^[a-z0-9-]{2,80}$/) })
        .strict();
      const canPrepareCareUpdate = Boolean(
        patient &&
        ["care-assistant", "registered-nurse"].includes(actor.role) &&
        !requiresDedicatedClinicalWorkflow(prompt) &&
        !explicitlyRefusesDocumentation(prompt),
      );
      const draftInput = z
        .object({ proposalJson: z.string().min(2).max(20_000) })
        .strict();
      const previousProposal = request.workingContext.previousCarePlan
        ? assistantProposalSchema.safeParse(
            JSON.parse(request.workingContext.previousCarePlan),
          )
        : null;
      const allowedRecipients = snapshot.users
        .filter((candidate) => candidate.id !== actor.id)
        .filter((candidate) =>
          [
            "registered-nurse",
            "physician",
            "pharmacy",
            "physiotherapy",
            "occupational-therapy",
          ].includes(candidate.role),
        )
        .map((candidate) => ({
          label: candidate.displayName,
          role: candidate.role as
            | "registered-nurse"
            | "physician"
            | "pharmacy"
            | "physiotherapy"
            | "occupational-therapy",
        }));
      const prepareDraft = (input: unknown) => {
        const parsed = draftInput.parse(input);
        const plan = verifyAgentProposal(
          prompt,
          JSON.parse(parsed.proposalJson),
          {
            inputTimestamp: new Date().toISOString(),
            inputModality: request.inputModality ?? "typed",
            previous: previousProposal?.success ? previousProposal.data : null,
            allowedRecipients,
          },
        );
        agentPreparedCarePlan = {
          plan,
          mode: this.models.agentMode(),
          model: this.models.agentModel(),
          degraded: false,
        };
        const referenceId = `DraftPreparation/care-update/${plan.requestId}`;
        agentPreparedCareReferenceId = referenceId;
        return Promise.resolve({
          referenceId,
          complete: true,
          data: {
            kind: "care-update-review",
            actionCount: plan.actions.length,
            ambiguityCount: plan.ambiguities.length,
          },
        });
      };
      const registry = new AuthorizedToolRegistry([
        {
          name: "get_patient_summary",
          version: 1,
          description:
            "Read the current authorized patient and encounter summary.",
          effect: "read",
          input: emptyInput,
          execute: () => {
            return Promise.resolve({
              referenceId: `EvidenceResult/get_patient_summary/${randomUUID()}`,
              sourceReferenceId: patient
                ? `Patient/${patient.id}/_history/${patient.source.version}`
                : "Patient/none",
              sourceVersion: patient ? String(patient.source.version) : "0",
              freshness: snapshot.serverTime,
              complete: patient !== null,
              data: patient
                ? {
                    displayName: patient.displayName,
                    room: patient.room,
                    risks: patient.risks,
                    careGoals: patient.careGoals,
                  }
                : { patientContext: "not-selected" },
            });
          },
        },
        {
          name: "get_open_tasks",
          version: 1,
          description:
            "Read authorized open work, optionally scoped by the already selected patient.",
          effect: "read",
          input: emptyInput,
          execute: () => {
            const allTasks = snapshot.tasks.filter((task) => {
              const currentSubject = task.patientId
                ? snapshot.patients.find(
                    (candidate) => candidate.id === task.patientId,
                  )
                : null;
              const currentEncounter =
                task.patientId === null ||
                (currentSubject != null &&
                  task.encounterId === currentSubject.encounterId);
              return (
                currentEncounter &&
                (!patient ||
                  (task.patientId === patient.id &&
                    task.encounterId === patient.encounterId)) &&
                task.state !== "completed"
              );
            });
            const selectedTasks = allTasks.slice(0, 20);
            const tasks = selectedTasks.map(
              ({ patientId, title, reason, state, priority, dueAt }) => {
                const subject = snapshot.patients.find(
                  (candidate) => candidate.id === patientId,
                );
                return {
                  patientLabel: subject
                    ? `${subject.room} · ${subject.displayName}`
                    : "Allgemeine Aufgabe",
                  title,
                  reason,
                  state,
                  priority,
                  dueAt,
                };
              },
            );
            return Promise.resolve({
              referenceId: `EvidenceResult/get_open_tasks/${randomUUID()}`,
              sourceReferenceId: `Task/search/${snapshot.serverTime}`,
              freshness: snapshot.serverTime,
              complete: allTasks.length <= tasks.length,
              rowProvenance: selectedTasks.map((task, index) => ({
                path: `tasks.${index}`,
                resourceId: `Task/${task.id}`,
                version: String(task.source.version),
                ...(task.patientId ? { patientId: task.patientId } : {}),
                ...(task.encounterId ? { encounterId: task.encounterId } : {}),
                effectiveAt: task.dueAt,
                provider: task.source.provider,
              })),
              data: { tasks, totalCount: allTasks.length },
            });
          },
        },
        {
          name: "get_latest_vitals",
          version: 1,
          description:
            "Read accepted authorized observations for the selected encounter.",
          effect: "read",
          input: emptyInput,
          execute: () => {
            const allObservations = patient
              ? snapshot.observations.filter(
                  (item) =>
                    item.patientId === patient.id &&
                    item.encounterId === patient.encounterId &&
                    item.approvedAt !== null,
                )
              : [];
            const selectedObservations = allObservations.slice(-12);
            const observations = selectedObservations.map(
              ({
                label,
                value,
                secondaryValue,
                unit,
                effectiveAt,
                approvedAt,
                approvalPolicy,
                approvals,
              }) => ({
                label,
                value,
                secondaryValue,
                unit,
                effectiveAt,
                status:
                  approvedAt &&
                  ["high-assurance", "four-eyes"].includes(approvalPolicy) &&
                  new Set(approvals).size >= 2
                    ? "independently-accepted"
                    : approvedAt
                      ? "accepted"
                      : "draft",
              }),
            );
            return Promise.resolve({
              referenceId: `EvidenceResult/get_latest_vitals/${randomUUID()}`,
              sourceReferenceId: `Observation/search/${snapshot.serverTime}`,
              freshness: snapshot.serverTime,
              complete:
                patient !== null &&
                allObservations.length <= observations.length,
              rowProvenance: selectedObservations.map((observation, index) => ({
                path: `observations.${index}`,
                resourceId: `Observation/${observation.id}`,
                version: String(observation.version),
                patientId: observation.patientId,
                encounterId: observation.encounterId,
                effectiveAt: observation.effectiveAt,
                provider: observation.source.provider,
              })),
              data: { observations, totalCount: allObservations.length },
            });
          },
        },
        {
          name: "get_handover",
          version: 1,
          description:
            "Read the actor-owned current workday handover and responsibility summary.",
          effect: "read",
          input: emptyInput,
          execute: () => {
            const handover = request.workingContext!.workdayHandover;
            return Promise.resolve({
              referenceId: `EvidenceResult/get_handover/${randomUUID()}`,
              sourceReferenceId: handover
                ? `WorkdayHandover/${handover.id}/_history/${handover.version}`
                : "WorkdayHandover/none",
              sourceVersion: handover
                ? `${handover.version}:${handover.contentHash}`
                : "0",
              freshness: snapshot.serverTime,
              complete: handover !== null,
              data: handover
                ? {
                    shiftKey: handover.shiftKey,
                    status: handover.status,
                    acknowledgedCount: handover.acknowledgedCount,
                    assignedCount: handover.assignedCount,
                    openCount: handover.openCount,
                    summary: handover.summary,
                  }
                : { handover: "not-available-for-role" },
            });
          },
        },
        {
          name: "get_team_inbox",
          version: 1,
          description:
            "Read authorized unresolved patient-team communications.",
          effect: "read",
          input: emptyInput,
          execute: () => {
            const allCommunications = snapshot.communications.filter((item) => {
              const currentSubject = snapshot.patients.find(
                (candidate) => candidate.id === item.patientId,
              );
              return (
                currentSubject !== undefined &&
                item.encounterId === currentSubject.encounterId &&
                (!patient ||
                  (item.patientId === patient.id &&
                    item.encounterId === patient.encounterId)) &&
                item.state !== "closed"
              );
            });
            const selectedCommunications = allCommunications.slice(0, 20);
            const communications = selectedCommunications.map(
              ({
                patientId,
                request,
                reason,
                recipientRole,
                priority,
                dueAt,
                state,
              }) => ({
                patientLabel:
                  snapshot.patients.find(
                    (candidate) => candidate.id === patientId,
                  )?.displayName ?? "Allgemeiner Teamkontext",
                request,
                reason,
                recipientRole,
                priority,
                dueAt,
                state,
              }),
            );
            return Promise.resolve({
              referenceId: `EvidenceResult/get_team_inbox/${randomUUID()}`,
              sourceReferenceId: `Communication/search/${snapshot.serverTime}`,
              freshness: snapshot.serverTime,
              complete: allCommunications.length <= communications.length,
              rowProvenance: selectedCommunications.map(
                (communication, index) => ({
                  path: `communications.${index}`,
                  resourceId: `Communication/${communication.id}`,
                  version: String(communication.source.version),
                  patientId: communication.patientId,
                  encounterId: communication.encounterId,
                  ...(communication.dueAt
                    ? { effectiveAt: communication.dueAt }
                    : {}),
                  provider: communication.source.provider,
                }),
              ),
              data: { communications, totalCount: allCommunications.length },
            });
          },
        },
        {
          name: "get_sync_status",
          version: 1,
          description:
            "Read current provider-delivery and reconciliation status without changing it.",
          effect: "read",
          input: emptyInput,
          execute: async () => {
            if (patient)
              return {
                referenceId: `EvidenceResult/get_sync_status/${randomUUID()}`,
                sourceReferenceId: `ProviderSync/patient-scope-unavailable/${patient.id}`,
                freshness: snapshot.serverTime,
                complete: false,
                data: {
                  status:
                    "patient-encounter-scoped delivery projection unavailable",
                },
              };
            if (this.runtimeReaders.getSyncStatus) {
              const authoritative = await this.runtimeReaders.getSyncStatus();
              return {
                ...authoritative,
                referenceId: `EvidenceResult/get_sync_status/${randomUUID()}`,
                sourceReferenceId:
                  authoritative.sourceReferenceId ?? authoritative.referenceId,
              };
            }
            return {
              referenceId: `EvidenceResult/get_sync_status/${randomUUID()}`,
              sourceReferenceId: `ProviderSync/${snapshot.serverTime}`,
              freshness: snapshot.serverTime,
              complete: true,
              data: {
                summary: snapshot.syncSummary,
                totalCount: snapshot.outbox.length,
              },
            };
          },
        },
        {
          name: "load_workflow_skill",
          version: 1,
          description:
            "Load one listed reviewed workflow skill by exact id when more guidance is needed.",
          effect: "read",
          input: workflowSkillInput,
          execute: (input) => {
            const { skillId } = workflowSkillInput.parse(input);
            const skill = loadApprovedWorkflowSkill(runtimeSitePack, {
              roleProfileId: request.workingContext!.roleProfileId!,
              workflowId: request.workingContext!.workflowId!,
              workflowSkillId: skillId,
            });
            return Promise.resolve({
              referenceId: `EvidenceResult/load_workflow_skill/${randomUUID()}`,
              sourceReferenceId: `RuntimeInstruction/${skill.id}/${skill.sha256}`,
              sourceVersion: String(agentGuidance!.packVersion),
              complete: true,
              data: { id: skill.id, body: skill.body },
            });
          },
        },
        ...(canPrepareCareUpdate
          ? [
              {
                name: "prepare_clinical_draft",
                version: 2,
                description:
                  "Prepare, but never execute, a typed review from the employee's natural report. Pass the complete AssistantProposal as proposalJson. Preserve negation, uncertainty, occurrence time, partial/deferred work and corrections. Include only explicitly requested actions. The server independently binds sources, recipient authority and safety fields.",
                effect: "draft" as const,
                input: draftInput,
                execute: prepareDraft,
              },
            ]
          : []),
      ]);
      agentRun = await new BoundedAgentRuntime(
        this.models.agentAdapter(),
        registry,
        { deadlineMs: 25_000 },
      ).run({
        request: prompt,
        context: {
          organizationId: request.workingContext.organizationId,
          actorId: userId,
          actorRole: actor.role,
          purpose,
          sessionId: request.workingContext.sessionId,
          threadId: request.workingContext.threadId,
          contextRevision: request.workingContext.contextRevision,
          patientId: patient?.id ?? null,
          encounterId: patient?.encounterId ?? null,
          dataClass: request.workingContext.dataClass,
          workingContext: {
            currentStepId: request.workingContext.currentStepId,
            activeEpisodeTitle: request.workingContext.activeEpisodeTitle,
            activeEpisodeIsCurrentPatient:
              patient != null &&
              request.workingContext.activeEpisodePatientId === patient.id,
            hasResumableEpisode:
              request.workingContext.resumableEpisodePatientId !== null,
            recentConversation: request.workingContext.recentConversation ?? [],
          },
          instructions: {
            packVersion: String(agentGuidance.packVersion),
            packDigest: agentGuidance.packDigest,
            system: [
              ...agentGuidance.instructions.map(({ body }) => body),
              `TRUSTED_WORKING_CONTEXT:\n${JSON.stringify({
                currentStepId: request.workingContext.currentStepId,
                activeEpisodeTitle: request.workingContext.activeEpisodeTitle,
                activeEpisodeIsCurrentPatient:
                  patient != null &&
                  request.workingContext.activeEpisodePatientId === patient.id,
                hasResumableEpisode:
                  request.workingContext.resumableEpisodePatientId !== null,
              })}`,
            ],
            skills: agentGuidance.availableSkills.map((skill) => ({
              id: skill.id,
              description: skill.description,
            })),
          },
        },
        allowedTools: [
          "get_patient_summary",
          "get_open_tasks",
          "get_latest_vitals",
          ...(!patient ? ["get_handover"] : []),
          "get_team_inbox",
          ...(!patient ? ["get_sync_status"] : []),
          "load_workflow_skill",
          ...(canPrepareCareUpdate ? ["prepare_clinical_draft"] : []),
        ],
        ...(request.signal ? { signal: request.signal } : {}),
        ...(request.onProgress ? { onProgress: request.onProgress } : {}),
      });
      if (
        agentRun.status === "draft-ready" &&
        agentPreparedCareReferenceId !== null &&
        agentRun.draftReferenceId === agentPreparedCareReferenceId
      )
        safeIntent = "care-update";
      else if (
        [
          "conversation",
          "answer",
          "clarification-needed",
          "no-action",
          "safe-handoff",
        ].includes(agentRun.status) &&
        !requiresDedicatedClinicalWorkflow(prompt)
      )
        safeIntent = "unknown";
    }
    const classification: IntentClassification = {
      ...classified,
      intent: safeIntent,
    };
    const agentFailed = Boolean(
      agentRun &&
      ["failed", "cancelled", "budget-exhausted"].includes(agentRun.status),
    );
    let runtime: AssistantResponse["runtime"] = {
      route:
        agentFailed || classification.degraded ? "safe-fallback" : "assistant",
      label: agentFailed
        ? "Sicherer Fallback · Assistenzlauf nicht abgeschlossen"
        : classification.degraded
          ? "Sicherer Fallback · Sprachdienst nicht verfügbar"
          : agentRun
            ? "Klinischer Coworker mit freigegebenen Werkzeugen"
            : "Klinischer Coworker",
      degraded: classification.degraded || agentFailed,
      ...(classification.failure
        ? { failure: classification.failure.code }
        : {}),
      ...(agentRun && agentGuidance
        ? {
            agent: {
              packId: agentGuidance.packId,
              packVersion: agentGuidance.packVersion,
              packDigest: agentGuidance.packDigest,
              instructionHashes: agentGuidance.provenance.instructionHashes,
              toolCalls: agentRun.toolCalls,
              status: agentRun.status,
              trace: agentRun.trace,
            },
          }
        : {}),
    };
    const evidence: AssistantResponse["evidence"] = [];
    const components: AssistantComponent[] = [];
    const warnings = [
      "Assistenzinhalte sind prüfpflichtig. Klinische Fakten stammen ausschliesslich aus den angezeigten Quellen.",
    ];
    if (classification.degraded)
      warnings.push(
        "Das Sprachmodell ist nicht verfügbar. Direkte Datenansichten und prüfpflichtige wörtliche Entwürfe bleiben verfügbar; freies Sprachverständnis ist nicht bestätigt.",
      );
    if (agentFailed)
      warnings.push(
        "Der begrenzte Agentenlauf wurde nicht abgeschlossen; angezeigt wird ausschliesslich die sichere deterministische Ansicht.",
      );
    const fallbackAgentLead = agentRun
      ? agentRun.status === "clarification-needed"
        ? "Ich brauche noch eine kurze Präzisierung, bevor ich den passenden freigegebenen Kontext öffne."
        : agentRun.status === "no-action"
          ? "Verstanden. Es wurde keine Aktion vorbereitet oder ausgeführt."
          : agentRun.status === "safe-handoff"
            ? "Diese Anfrage braucht den dafür vorgesehenen sicheren Arbeitsablauf."
            : null
      : null;
    const requirePatient = () => {
      if (!patient)
        throw new DomainError(
          "VALIDATION",
          "Bitte zuerst einen Patientenkontext öffnen.",
          400,
        );
      return patient;
    };
    const patientPicker = (): AssistantComponent => ({
      type: "PatientPicker",
      title: "Patientenkontext wählen",
      message:
        "Diese Anfrage benötigt einen bewusst gewählten Patientenkontext. Es wurde nichts gelesen oder verändert.",
      patients: snapshot.patients.map((item) => ({
        id: item.id,
        label: `${item.room} · ${item.displayName}`,
        secondary: `Geb. ${item.birthDate.split("-").reverse().join(".")} · Fall ${item.mrn}`,
      })),
    });
    const issue = (
      command:
        | "note:draft"
        | "communication:draft"
        | "task:draft"
        | "care-update:draft",
      payload: Record<string, string>,
    ) => {
      const current = requirePatient();
      return this.intents.issue(actor, {
        command,
        patientId: current.id,
        encounterId: current.encounterId,
        purpose,
        resourceVersion: current.source.version,
        payload: {
          ...payload,
          ...(request.voiceTranscriptProvenance
            ? {
                voiceTranscriptProvenance: JSON.stringify([
                  parseVoiceTranscriptProvenance(
                    request.voiceTranscriptProvenance,
                  ),
                ]),
              }
            : {}),
        },
      });
    };

    const agentOwnsPresentation = Boolean(
      agentRun &&
      !agentFailed &&
      ((agentRun.status === "conversation" && patient === null) ||
        (["answer", "clarification-needed"].includes(agentRun.status) &&
          agentRun.toolCalls > 0) ||
        ["no-action", "safe-handoff"].includes(agentRun.status)),
    );
    if (!agentOwnsPresentation)
      switch (classification.intent) {
        case "patient-summary": {
          const current = patient;
          if (!current) {
            components.push(patientPicker());
            break;
          }
          evidence.push({
            resourceId: `Patient/${current.id}`,
            version: current.source.version,
            label: `${current.source.provider} · ${formatOrganizationTimestamp(current.source.effectiveAt)}`,
          });
          const latestObservations = snapshot.observations
            .filter(
              (item) =>
                item.patientId === current.id &&
                item.encounterId === current.encounterId &&
                item.approvedAt !== null,
            )
            .toSorted((left, right) =>
              right.effectiveAt.localeCompare(left.effectiveAt),
            )
            .slice(0, 3)
            .map(
              (item) =>
                `${item.label} ${item.value}${item.secondaryValue === null ? "" : `/${item.secondaryValue}`} ${item.unit}`,
            );
          const pendingObservations = snapshot.observations
            .filter(
              (item) =>
                item.patientId === current.id &&
                item.encounterId === current.encounterId &&
                item.approvedAt === null,
            )
            .toSorted((left, right) =>
              right.effectiveAt.localeCompare(left.effectiveAt),
            )
            .slice(0, 3)
            .map(
              (item) =>
                `${item.label} ${item.value}${item.secondaryValue === null ? "" : `/${item.secondaryValue}`} ${item.unit} (${formatOrganizationTimestamp(item.effectiveAt)}, ${["high-assurance", "four-eyes"].includes(item.approvalPolicy) ? "unabhängige Prüfung ausstehend" : "Entwurf – nicht als aktueller klinischer Fakt bestätigt"})`,
            );
          const protocol = [
            ...snapshot.notes
              .filter(
                (item) =>
                  item.patientId === current.id &&
                  item.encounterId === current.encounterId &&
                  item.approvedAt !== null,
              )
              .slice(-3)
              .map((item) => `#Dokumentation ${item.structuredText}`),
            ...snapshot.communications
              .filter(
                (item) =>
                  item.patientId === current.id &&
                  item.encounterId === current.encounterId,
              )
              .slice(-3)
              .map((item) => `#Team ${item.request} · ${item.state}`),
          ];
          components.push({
            type: "PatientSummary",
            patientId: current.id,
            title: `${current.room} · ${current.displayName}`,
            narrative: `${current.displayName} · Zimmer ${current.room} · Fall ${current.encounterId}. Strukturierte, rollenberechtigte Sicht; fehlende Angaben werden nicht als Verneinung dargestellt.`,
            sections: [
              {
                id: "identity",
                label: "Identität & Aufenthalt",
                items: [
                  `Geburtsdatum ${current.birthDate}`,
                  `Zimmer ${current.room}`,
                  `Fall ${current.encounterId}`,
                ],
                state: "confirmed" as const,
                sourceLabel: `${current.source.provider} · Version ${current.source.version}`,
                effectiveAt: current.source.effectiveAt,
              },
              {
                id: "allergies",
                label: "Allergien",
                items:
                  current.allergyStatus === "confirmed"
                    ? current.allergies
                    : current.allergyStatus === "explicit-negative"
                      ? ["Keine bekannten Allergien dokumentiert"]
                      : [],
                state: current.allergyStatus,
                sourceLabel: `${current.source.provider} · freigegebener Ausschnitt`,
                effectiveAt: current.source.effectiveAt,
              },
              {
                id: "risks",
                label: "Risiken & Hinweise",
                items: current.risks,
                state: current.risks.length
                  ? ("confirmed" as const)
                  : ("unknown" as const),
                sourceLabel: `${current.source.provider} · freigegebener Ausschnitt`,
                effectiveAt: current.source.effectiveAt,
              },
              {
                id: "situation",
                label: "Situation",
                items: current.diagnoses,
                state: current.diagnoses.length
                  ? ("confirmed" as const)
                  : ("not-supplied" as const),
                sourceLabel: `${current.source.provider} · klinischer Ausschnitt`,
                effectiveAt: current.source.effectiveAt,
              },
              {
                id: "goals",
                label: "Ziele & Unterstützung",
                items: current.careGoals,
                state: current.careGoals.length
                  ? ("confirmed" as const)
                  : ("not-supplied" as const),
                sourceLabel: `${current.source.provider} · Pflegeplanung`,
                effectiveAt: current.source.effectiveAt,
              },
              {
                id: "medication",
                label: "Medikationskontext · nur lesbar",
                items: current.medicationSummary,
                state: current.medicationSummary.length
                  ? ("confirmed" as const)
                  : ("restricted" as const),
                sourceLabel: `${current.source.provider} · keine Bearbeitung in diesem Arbeitsablauf`,
                effectiveAt: current.source.effectiveAt,
              },
              {
                id: "today",
                label: "Heute",
                items: [
                  `${snapshot.tasks.filter((task) => task.patientId === current.id && task.encounterId === current.encounterId && task.state !== "completed").length} offene Aufgaben`,
                  ...(latestObservations.length
                    ? [`Bestätigte Werte: ${latestObservations.join(" · ")}`]
                    : []),
                  ...(pendingObservations.length
                    ? [
                        `Neu gemeldet, noch nicht als klinischer Ist-Wert freigegeben: ${pendingObservations.join(" · ")}`,
                      ]
                    : []),
                ],
                state: "confirmed" as const,
                sourceLabel:
                  "FHIR Task und Observation · aktueller Rollenbereich",
                effectiveAt: new Date().toISOString(),
              },
              {
                id: "timeline",
                label: "Pflegeprotokoll",
                items: protocol.length
                  ? protocol
                  : ["Noch keine freigegebenen Einträge in dieser Schicht."],
                state: protocol.length
                  ? ("confirmed" as const)
                  : ("not-supplied" as const),
                sourceLabel: "Freigegebene Dokumentation und Teamkommunikation",
                effectiveAt: current.source.effectiveAt,
              },
            ],
            sourceLabel: `${current.source.provider} · Version ${current.source.version} · rollenberechtigte FHIR-/Workflow-Sicht`,
          });
          break;
        }
        case "open-tasks": {
          const tasks = snapshot.tasks.filter((task) => {
            const currentSubject = task.patientId
              ? snapshot.patients.find(
                  (candidate) => candidate.id === task.patientId,
                )
              : null;
            const currentEncounter =
              task.patientId === null ||
              (currentSubject != null &&
                task.encounterId === currentSubject.encounterId);
            return (
              currentEncounter &&
              task.state !== "completed" &&
              (!patient ||
                (task.patientId === patient.id &&
                  task.encounterId === patient.encounterId))
            );
          });
          for (const task of tasks.slice(0, 8))
            evidence.push({
              resourceId: `Task/${task.id}`,
              version: task.source.version,
              label: `${task.source.provider} · ${formatOrganizationTimestamp(task.dueAt)}`,
            });
          components.push({
            type: "TaskList",
            title: patient
              ? `Offene Aufgaben für ${patient.displayName}`
              : "Meine offenen Aufgaben",
            count: tasks.length,
            summary:
              tasks
                .slice(0, 6)
                .map(
                  (task) =>
                    `${task.title} (${task.priority}, fällig ${formatOrganizationTime(task.dueAt)})`,
                )
                .join(" · ") ||
              "Keine offenen Aufgaben im freigegebenen Kontext.",
            sourceLabel: "FHIR Task · aktueller Rollen- und Schichtkontext",
          });
          break;
        }
        case "latest-vitals": {
          const current = patient;
          if (!current) {
            components.push(patientPicker());
            break;
          }
          const observations = snapshot.observations
            .filter(
              (item) =>
                item.patientId === current.id &&
                item.encounterId === current.encounterId,
            )
            .toSorted((a, b) => a.effectiveAt.localeCompare(b.effectiveAt));
          const codes = [...new Set(observations.map((item) => item.code))];
          for (const code of codes.slice(0, 5)) {
            const series = observations.filter((item) => item.code === code);
            const validated = series.filter((item) => item.approvedAt !== null);
            const latestValidated = validated.at(-1) ?? null;
            const pending = series.filter((item) => item.approvedAt === null);
            const newestPending = pending.at(-1) ?? null;
            const pendingRequiresIndependentReview = newestPending
              ? ["high-assurance", "four-eyes"].includes(
                  newestPending.approvalPolicy,
                )
              : false;
            const pendingIsNewer = Boolean(
              newestPending &&
              (!latestValidated ||
                newestPending.effectiveAt > latestValidated.effectiveAt),
            );
            const representative = latestValidated ?? newestPending;
            if (!representative) continue;
            for (const item of series.slice(-12))
              evidence.push({
                resourceId: `Observation/${item.id}`,
                version: item.version,
                label: `${item.source.provider} · ${formatOrganizationTimestamp(item.effectiveAt)} · ${item.approvedAt ? "validiert" : "Prüfung ausstehend"}`,
              });
            components.push({
              type: "VitalTrend",
              patientId: current.id,
              label: representative.label,
              value: latestValidated
                ? `${latestValidated.value}${latestValidated.secondaryValue === null ? "" : `/${latestValidated.secondaryValue}`} ${latestValidated.unit}`
                : "Noch kein unabhängig bestätigter Wert",
              points: series.slice(-12).map((item) => ({
                id: item.id,
                value: item.value,
                secondaryValue: item.secondaryValue,
                unit: item.unit,
                effectiveAt: item.effectiveAt,
                status: item.approvedAt
                  ? "approved"
                  : ["high-assurance", "four-eyes"].includes(
                        item.approvalPolicy,
                      )
                    ? "pending-review"
                    : "draft",
              })),
              sourceLabel: `${latestValidated?.source.provider ?? representative.source.provider} · ${latestValidated ? `letzter bestätigter Stand ${formatOrganizationTimestamp(latestValidated.effectiveAt)}` : "kein bestätigter Stand"}${newestPending ? ` · ${pendingIsNewer ? "neuer " : "zusätzlicher "}gemeldeter Wert vom ${formatOrganizationTimestamp(newestPending.effectiveAt)} ${pendingRequiresIndependentReview ? "wartet auf unabhängige Prüfung" : "ist ein nicht bestätigter Entwurf"}` : ""}`,
            });
          }
          if (!observations.length)
            components.push({
              type: "UnknownState",
              message: "Keine Vitalwerte im freigegebenen Kontext.",
            });
          break;
        }
        case "handover": {
          const operationalHandover = request.workingContext?.workdayHandover;
          if (operationalHandover) {
            const patientOpenTasks = patient
              ? snapshot.tasks.filter(
                  (task) =>
                    task.patientId === patient.id &&
                    task.encounterId === patient.encounterId &&
                    task.state !== "completed",
                )
              : [];
            components.push({
              type: "HandoverChecklist",
              title: patient
                ? `Aktuelle Verantwortung · ${patient.displayName}`
                : "Aktuelle Schichtübergabe",
              summary: patient
                ? patientOpenTasks.map(({ title }) => title).join(" · ") ||
                  "Keine offenen Arbeiten im aktuellen Patientenkontext."
                : operationalHandover.summary,
              openCount: patient
                ? patientOpenTasks.length
                : operationalHandover.openCount,
              sourceLabel: `Operationaler Verantwortungsstand · ${operationalHandover.shiftKey} · ${operationalHandover.status}`,
            });
            break;
          }
          components.push({
            type: "UnknownState",
            message:
              "Für diese Rolle ist keine operative Schichtübergabe aktiv. Historische Provider-Dokumente sind keine Verantwortungsquelle.",
          });
          break;
        }
        case "team-inbox": {
          const messages = snapshot.communications.filter((item) => {
            const currentSubject = snapshot.patients.find(
              (candidate) => candidate.id === item.patientId,
            );
            return (
              currentSubject !== undefined &&
              item.encounterId === currentSubject.encounterId &&
              item.state !== "closed" &&
              (!patient ||
                (item.patientId === patient.id &&
                  item.encounterId === patient.encounterId))
            );
          });
          for (const item of messages.slice(0, 8))
            evidence.push({
              resourceId: `Communication/${item.id}`,
              version: item.source.version,
              label: `${item.source.provider} · ${item.state}`,
            });
          components.push({
            type: "TeamInbox",
            title: "Teamfragen und Erwähnungen",
            count: messages.length,
            summary:
              messages
                .slice(0, 6)
                .map((item) => {
                  const subject = snapshot.patients.find(
                    (patient) => patient.id === item.patientId,
                  );
                  const recipient = item.recipientId
                    ? snapshot.users.find(
                        (user) => user.id === item.recipientId,
                      )?.displayName
                    : item.recipientRole;
                  return `#${subject?.displayName ?? "Patientenkontext"} @${recipient ?? item.recipientRole} · ${item.request}\n${item.reason} · ${item.priority} · ${item.state}${item.response ? `\n↳ ${item.response}` : ""}`;
                })
                .join("\n") || "Keine offenen Teamfragen für diese Rolle.",
            sourceLabel:
              "FHIR Communication · freigegebener Behandlungsteam-Thread",
            items: messages.slice(0, 8).map((item) => {
              const subject = snapshot.patients.find(
                (patient) => patient.id === item.patientId,
              );
              const recipient = item.recipientId
                ? snapshot.users.find((user) => user.id === item.recipientId)
                    ?.displayName
                : item.recipientRole;
              const addressedToActor =
                item.recipientId === actor.id ||
                (item.recipientId === null &&
                  item.recipientRole === actor.role) ||
                (item.escalatedAt !== null &&
                  item.escalationRecipientRole === actor.role);
              const mayOwnResponse =
                addressedToActor &&
                (item.acknowledgedBy === null ||
                  item.acknowledgedBy === actor.id);
              return {
                id: item.id,
                patientId: item.patientId,
                patientLabel: subject?.displayName ?? "Patientenkontext",
                recipientLabel: recipient ?? item.recipientRole,
                request: item.request,
                reason: item.reason,
                priority: item.priority,
                state: item.state,
                // OpenUI's value grammar does not represent nullable string props.
                // Keep the transport schema deterministic and render an empty string
                // until a real response exists.
                response: item.response ?? "",
                canAcknowledge:
                  mayOwnResponse && ["sent", "escalated"].includes(item.state),
                canAnswer:
                  mayOwnResponse &&
                  ["sent", "acknowledged", "escalated"].includes(item.state),
                canClose:
                  [item.senderId, item.answeredBy].includes(actor.id) &&
                  item.state === "answered",
              };
            }),
          });
          break;
        }
        case "sync-status": {
          if (patient) {
            components.push({
              type: "UnknownState",
              message:
                "Der technische Gesamtstatus ist nur im allgemeinen Assistenzgespräch verfügbar; eine encounter-gebundene Zustellansicht ist noch nicht freigegeben.",
            });
            break;
          }
          const authoritative = this.runtimeReaders.getSyncStatus
            ? await this.runtimeReaders.getSyncStatus()
            : null;
          const diagnosticData = authoritative?.data as
            | {
                clinicalProjections?: Record<string, number>;
                providerDeliveries?: Record<string, number>;
              }
            | undefined;
          const pending = diagnosticData
            ? [
                ...Object.entries(diagnosticData.clinicalProjections ?? {}),
                ...Object.entries(diagnosticData.providerDeliveries ?? {}),
              ].reduce(
                (total, [state, count]) =>
                  ["delivered", "cancelled"].includes(state)
                    ? total
                    : total + count,
                0,
              )
            : snapshot.outbox.filter(
                (item) => !isTerminalOutboxState(item.state),
              ).length;
          const conflicts = diagnosticData
            ? (diagnosticData.clinicalProjections?.manual ?? 0) +
              (diagnosticData.providerDeliveries?.manual ?? 0)
            : snapshot.syncSummary.conflicts;
          if (authoritative)
            evidence.push({
              resourceId: authoritative.referenceId,
              version: 0,
              label: `Operationaler Zustellstand · abgerufen am ${authoritative.freshness ?? "unbekannt"}`,
              ...(authoritative.sourceVersion
                ? { sourceVersion: authoritative.sourceVersion }
                : {}),
              ...(authoritative.freshness
                ? { freshness: authoritative.freshness }
                : {}),
              complete: authoritative.complete,
            });
          components.push({
            type: "SyncSummary",
            title: "Synchronisation und Abgleich",
            pending,
            conflicts,
            summary: pending
              ? `${pending} Zustellung(en) sind noch nicht terminal bestätigt.`
              : "Alle aktuellen Übertragungen sind terminal quittiert.",
            sourceLabel: authoritative
              ? "Operationaler relationaler Zustellstand"
              : snapshot.capabilityProfile === "synthetic-simulator"
                ? "Provider-Hub · Simulatorprofil"
                : "Provider-Hub · verifizierte Fähigkeiten",
          });
          break;
        }
        case "draft-note": {
          const current = patient;
          if (!current) {
            components.push(patientPicker());
            break;
          }
          if (
            requiresDedicatedClinicalWorkflow(prompt) ||
            explicitlyRefusesDocumentation(prompt)
          ) {
            components.push({
              type: "SafetyAlert",
              severity: "warning",
              message:
                "Das klingt nach einer Medikamenten-, Behandlungs- oder ausdrücklichen Nicht-Schreiben-Anweisung. Dafür wird kein Pflegebericht-Entwurf erstellt; bitte den vorgesehenen Fachworkflow verwenden oder die Aussage als bereits erfolgte Beobachtung präzisieren.",
            });
            break;
          }
          if (!["care-assistant", "registered-nurse"].includes(actor.role)) {
            components.push({
              type: "SafetyAlert",
              severity: "warning",
              message:
                "Diese Rolle darf keine Pflegenotiz anlegen. Die Assistenz hat keine Aktion vorbereitet.",
            });
            break;
          }
          const draft = cleanDraft(prompt);
          if (draft.length < 10)
            throw new DomainError(
              "VALIDATION",
              "Der Dokumentationsentwurf ist zu kurz.",
              400,
            );
          components.push({
            type: "DraftAction",
            kind: "nursing-note",
            title: `Pflegenotiz für ${current.displayName}`,
            preview: draft,
            actionLabel: "Prüfen, lokal freigeben & synchronisieren",
            intentToken: issue("note:draft", {
              structuredText: draft,
              inputModality: request.inputModality ?? "typed",
            }),
            sourceLabel:
              "Benutzereingabe · noch nicht dokumentiert · eine Bestätigung gibt lokal frei und startet die Synchronisation",
          });
          break;
        }
        case "draft-physician-question": {
          const current = patient;
          if (!current) {
            components.push(patientPicker());
            break;
          }
          if (
            [
              "administration",
              "management",
              "hr",
              "it",
              "quality-safety",
            ].includes(actor.role)
          ) {
            components.push({
              type: "SafetyAlert",
              severity: "warning",
              message:
                "Im aktuellen Rollen- und Zweckkontext ist keine patientenbezogene Nachricht zulässig.",
            });
            break;
          }
          const permittedRoles = [
            "registered-nurse",
            "physician",
            "pharmacy",
            "physiotherapy",
            "occupational-therapy",
          ] as const;
          const normalizedPrompt = prompt.toLocaleLowerCase("de-CH");
          const mentionTokens = [
            ...normalizedPrompt.matchAll(/@([\p{L}][\p{L}-]*)/gu),
          ].map((match) => match[1]!);
          const namedRecipients = snapshot.users
            .map((candidate) => this.clinical.user(candidate.id))
            .filter(
              (candidate) =>
                candidate.id !== actor.id &&
                permittedRoles.includes(
                  candidate.role as (typeof permittedRoles)[number],
                ) &&
                candidate.patientIds.includes(current.id) &&
                [candidate.displayName.replace(/^Dr\.\s*/i, "").split(" ")[0]]
                  .filter(Boolean)
                  .map((name) => name!.toLocaleLowerCase("de-CH"))
                  .some((name) => mentionTokens.includes(name)),
            );
          const uniqueNamedRecipients = [
            ...new Map(
              namedRecipients.map((candidate) => [candidate.id, candidate]),
            ).values(),
          ];
          const namedRecipient =
            uniqueNamedRecipients.length === 1
              ? uniqueNamedRecipients[0]
              : undefined;
          const roleMentions: Array<{
            role: (typeof permittedRoles)[number];
            labels: string[];
            display: string;
          }> = [
            {
              role: "registered-nurse",
              labels: ["pflegefachperson", "pflege", "nurse"],
              display: "Pflegefachdienst",
            },
            {
              role: "physician",
              labels: ["arzt", "ärztin", "physician"],
              display: "ärztlichen Dienst",
            },
            {
              role: "pharmacy",
              labels: ["apotheke", "pharmacy"],
              display: "Apotheke",
            },
            {
              role: "physiotherapy",
              labels: ["physiotherapie", "physio"],
              display: "Physiotherapie",
            },
            {
              role: "occupational-therapy",
              labels: ["ergotherapie", "ergo"],
              display: "Ergotherapie",
            },
          ];
          const mentionedRoles = roleMentions.filter((entry) =>
            entry.labels.some((label) => mentionTokens.includes(label)),
          );
          const mentionedRole =
            mentionedRoles.length === 1 ? mentionedRoles[0] : undefined;
          if (
            prompt.includes("@") &&
            uniqueNamedRecipients.length + mentionedRoles.length !== 1
          ) {
            components.push({
              type: "SafetyAlert",
              severity: "warning",
              message:
                "Die erwähnte Person oder Rolle ist in diesem Behandlungsteam nicht eindeutig. Bitte @Vorname oder eine freigegebene Teamrolle verwenden.",
            });
            break;
          }
          const recipientRole =
            namedRecipient?.role === "registered-nurse" ||
            namedRecipient?.role === "physician" ||
            namedRecipient?.role === "pharmacy" ||
            namedRecipient?.role === "physiotherapy" ||
            namedRecipient?.role === "occupational-therapy"
              ? namedRecipient.role
              : (mentionedRole?.role ?? "physician");
          const recipientLabel =
            namedRecipient?.displayName ??
            mentionedRole?.display ??
            "ärztlichen Dienst";
          components.push({
            type: "DraftAction",
            kind: "physician-question",
            title: `Nachricht an ${recipientLabel} · ${current.displayName}`,
            preview: prompt.slice(0, 1000),
            actionLabel: "Frage prüfen und senden",
            intentToken: issue("communication:draft", {
              request: prompt.slice(0, 1000),
              reason: "Aus kontextueller Pflegehelfer-Assistenz erstellt",
              recipientRole,
              recipientId: namedRecipient?.id ?? "",
              recipientLabel,
            }),
            sourceLabel: "Benutzereingabe · geschlossener Kommunikationsweg",
          });
          break;
        }
        case "draft-task": {
          const current = patient;
          if (!current) {
            components.push(patientPicker());
            break;
          }
          if (
            ["management", "hr", "it", "quality-safety"].includes(actor.role)
          ) {
            components.push({
              type: "SafetyAlert",
              severity: "warning",
              message:
                "Im aktuellen Rollen- und Zweckkontext ist keine klinische Aufgabe zulässig.",
            });
            break;
          }
          components.push({
            type: "DraftAction",
            kind: "task",
            title: `Aufgabenentwurf · ${current.displayName}`,
            preview: prompt.slice(0, 500),
            actionLabel: "Aufgabe prüfen und anlegen",
            intentToken: issue("task:draft", { title: prompt.slice(0, 120) }),
            sourceLabel: "Benutzereingabe · deterministischer Aufgabenworkflow",
          });
          break;
        }
        case "care-update": {
          const current = patient;
          if (!current) {
            components.push(patientPicker());
            break;
          }
          const explicitContextSwitch =
            /\b(?:pausieren|pause)\b[^.;]{0,80}\bzimmer\s+\d{1,4}[A-Za-z]?\b/i.test(
              prompt,
            );
          const mentionedOtherPatient = snapshot.patients.find((candidate) => {
            if (candidate.id === current.id) return false;
            const nameIdentifiers = [
              ...candidate.displayName.split(/\s+/),
              candidate.displayName,
            ].filter((value) => value.length >= 2);
            const escapedRoom = candidate.room.replace(
              /[.*+?^${}()|[\]\\]/g,
              "\\$&",
            );
            const escapedMrn = candidate.mrn.replace(
              /[.*+?^${}()|[\]\\]/g,
              "\\$&",
            );
            return (
              nameIdentifiers.some((identifier) =>
                new RegExp(
                  `(?:^|[^\\p{L}\\d])${identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^\\p{L}\\d])`,
                  "iu",
                ).test(prompt),
              ) ||
              (!explicitContextSwitch &&
                new RegExp(`\\bzimmer\\s+${escapedRoom}\\b`, "iu").test(
                  prompt,
                )) ||
              new RegExp(
                `\\b(?:fall|mrn)\\s*[:#-]?\\s*${escapedMrn}\\b`,
                "iu",
              ).test(prompt)
            );
          });
          if (mentionedOtherPatient) {
            components.push(
              {
                type: "AssistantText",
                message: `Du sprichst von ${mentionedOtherPatient.displayName}, geöffnet ist aber ${current.displayName}. Bitte wechsle zuerst bewusst den Patientenkontext; ich habe nichts vorbereitet.`,
              },
              patientPicker(),
            );
            break;
          }
          if (!["care-assistant", "registered-nurse"].includes(actor.role)) {
            components.push({
              type: "SafetyAlert",
              severity: "warning",
              message:
                "Diese Rolle darf keinen gebündelten Pflegeeintrag freigeben.",
            });
            break;
          }
          const agentDraftIsAccepted =
            agentRun?.status === "draft-ready" &&
            agentPreparedCareReferenceId !== null &&
            agentRun.draftReferenceId === agentPreparedCareReferenceId;
          const modelPlan =
            agentDraftIsAccepted && agentPreparedCarePlan
              ? agentPreparedCarePlan
              : agentRun
                ? this.models.planCareUpdateDeterministically(prompt)
                : await this.models.planCareUpdate(
                    prompt,
                    modelContext,
                    request.signal,
                  );
          const mentionedRecipients = snapshot.users
            .filter((candidate) => candidate.id !== actor.id)
            .filter((candidate) => {
              const givenName = candidate.displayName
                .replace(/^Dr\.\s*/i, "")
                .split(/\s+/)[0];
              return Boolean(
                givenName &&
                new RegExp(
                  `(?:^|[^\\p{L}])${givenName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^\\p{L}])`,
                  "iu",
                ).test(prompt),
              );
            });
          const namedRecipient =
            mentionedRecipients.length === 1 &&
            [
              "registered-nurse",
              "physician",
              "pharmacy",
              "physiotherapy",
              "occupational-therapy",
            ].includes(mentionedRecipients[0]!.role)
              ? mentionedRecipients[0]!
              : null;
          const revisedPlan =
            !agentDraftIsAccepted && request.workingContext?.previousCarePlan
              ? reviseAssistantProposal(
                  JSON.parse(request.workingContext.previousCarePlan),
                  prompt,
                  {
                    inputModality: request.inputModality ?? "typed",
                    inputTimestamp: new Date().toISOString(),
                    ...(namedRecipient
                      ? {
                          namedRecipient: {
                            label: namedRecipient.displayName,
                            role: namedRecipient.role as
                              | "registered-nurse"
                              | "physician"
                              | "pharmacy"
                              | "physiotherapy"
                              | "occupational-therapy",
                          },
                        }
                      : {}),
                  },
                )
              : null;
          const unboundPlan = revisedPlan ?? modelPlan.plan;
          const planned = {
            ...modelPlan,
            plan:
              unboundPlan && request.voiceTranscriptProvenance
                ? bindVoiceTranscriptProvenance(
                    unboundPlan,
                    request.voiceTranscriptProvenance,
                  )
                : unboundPlan,
          };
          if (!planned.plan) {
            components.push({
              type: "UnknownState",
              message:
                "Ich habe daraus keine sichere Änderung erkannt. Sag mir kurz, was erledigt, beobachtet oder im Ablauf geändert werden soll.",
            });
            break;
          }
          if (planned.plan.ambiguities.length > 0) {
            components.push({
              type: "AssistantText",
              message: planned.plan.ambiguities[0]!,
            });
            break;
          }
          verifyProposalSourceRecords(planned.plan);
          runtime = {
            route: planned.degraded ? "safe-fallback" : "assistant",
            label: planned.degraded
              ? "Sicherer Fallback · Sprachdienst nicht verfügbar"
              : "Klinischer Coworker · vorbereitete Änderungen",
            degraded: planned.degraded,
            ...(planned.failure ? { failure: planned.failure.code } : {}),
            ...(runtime.agent ? { agent: runtime.agent } : {}),
          };
          if (planned.plan.actions.length === 0) {
            const negated = planned.plan.understoodFacts
              .filter((fact) => fact.polarity === "negated")
              .map((fact) => fact.label)
              .join("; ");
            components.push({
              type: "AssistantText",
              message: `Verstanden${negated ? `: ${negated}` : ""}. Ich löse keine Änderung aus.`,
            });
            break;
          }
          const reviewItems = planned.plan.actions.map((action) => ({
            id: action.id,
            label: actionReviewLabel(action),
            kind:
              action.type === "note-proposal"
                ? ("note" as const)
                : action.type === "observation-proposal"
                  ? ("observation" as const)
                  : action.type === "communication-proposal"
                    ? ("communication" as const)
                    : action.type === "task-proposal"
                      ? ("task" as const)
                      : ("workflow" as const),
          }));
          const bundlePreview = reviewItems
            .map((item, index) => `${index + 1}. ${item.label}`)
            .join("\n");
          components.push({
            type: "AssistantText",
            message: planned.plan.workPerformed.some(
              (item) => item.status === "planned-later",
            )
              ? "Verstanden. Ich halte erledigte und später geplante Arbeit getrennt und übernehme nichts ohne deine Bestätigung."
              : planned.plan.workflowActions.length > 0
                ? "Verstanden. Ich kann die aktuelle Arbeit sicher pausieren und den spontanen Zimmerbesuch starten."
                : request.workingContext?.activeEpisodePatientId ===
                      current.id && request.workingContext.activeEpisodeTitle
                  ? `Verstanden für die laufende Arbeit „${request.workingContext.activeEpisodeTitle}“. Prüfe bitte kurz nur die Punkte, die übernommen werden sollen.`
                  : "Verstanden. Prüfe bitte kurz nur die Punkte, die übernommen werden sollen.",
          });
          components.push({
            type: "DraftAction",
            kind: "care-update",
            title: `Ich habe Folgendes verstanden · ${current.displayName}`,
            preview: bundlePreview,
            actionLabel: "Auswahl bestätigen",
            intentToken: issue("care-update:draft", {
              plan: JSON.stringify(planned.plan),
              inputModality: request.inputModality ?? "typed",
            }),
            sourceLabel: "Aus deiner Aussage · vor Übernahme sicher geprüft",
            reviewItems,
          });
          break;
        }
        case "knowledge-query": {
          const answer = await this.knowledge.answer(
            prompt,
            actor.role,
            new Date(),
            request.workingContext?.dataClass ?? "institution-local",
          );
          runtime = {
            route: answer.degraded ? "safe-fallback" : "assistant",
            label: answer.degraded
              ? "Sicherer Fallback · Wissensdienst nicht verfügbar"
              : "Freigegebene Wissensunterstützung",
            degraded: answer.degraded,
          };
          for (const citation of answer.citations)
            evidence.push({
              resourceId: `Knowledge/${citation.id}`,
              version: 1,
              label: `${citation.title} · ${citation.version} · ${citation.owner}`,
            });
          components.push({
            type: "KnowledgeAnswer",
            title: "Freigegebene lokale Wissensbasis",
            answer: answer.answer,
            sourceLabel:
              answer.citations.length > 0
                ? answer.citations
                    .map((item) => `${item.title} · ${item.version}`)
                    .join(" | ")
                : "Keine passende gültige Quelle",
          });
          if (answer.degraded)
            warnings.push(
              "Der Deep-LLM-Pfad war nicht verfügbar; die freigegebenen Quellen werden extraktiv angezeigt.",
            );
          break;
        }
        case "medication-request": {
          const current = patient;
          if (!current) {
            components.push(patientPicker());
            break;
          }
          components.push(
            {
              type: "SafetyAlert",
              severity: "warning",
              message:
                "Pflegehelfer ändert oder verordnet keine Medikation. Angezeigt werden nur Quellinformationen; eine Frage an den ärztlichen Dienst kann vorbereitet werden.",
            },
            {
              type: "MedicationReadOnly",
              patientId: current.id,
              summary:
                current.medicationSummary.join(" · ") ||
                "Keine freigegebenen Medikationsinformationen.",
              sourceLabel: `${current.source.provider} · Version ${current.source.version}`,
            },
          );
          const explicitDedicatedHandoff =
            /\b(?:ändere|ändern|anpassen|absetzen|verordnen|bestätige|bestätigen)\b|\b(?:frage|informiere|benachrichtige|kläre)\b[^.;]{0,80}\b(?:arzt|ärztin|ärztlichen?\s+dienst)\b|\b(?:arzt|ärztin|ärztlichen?\s+dienst)\b[^.;]{0,80}\b(?:fragen|informieren|benachrichtigen|klären)\b/i.test(
              prompt,
            ) &&
            !/\b(?:nicht|kein(?:e|en)?)\b[^.;]{0,40}\b(?:geben|ändern|anpassen|absetzen|informieren)\b/i.test(
              prompt,
            );
          if (explicitDedicatedHandoff)
            components.push({
              type: "DraftAction",
              kind: "physician-question",
              title: "Medikationsfrage vorbereiten",
              preview: prompt.slice(0, 1000),
              actionLabel: "Frage prüfen und senden",
              intentToken: issue("communication:draft", {
                request: prompt.slice(0, 1000),
                reason: "Medikationsfrage; keine Änderung durch Pflegehelfer",
              }),
              sourceLabel:
                "Nur Kommunikationsentwurf · keine MedicationRequest",
            });
          break;
        }
        case "unknown":
          if (
            classification.degraded &&
            patient &&
            ["care-assistant", "registered-nurse"].includes(actor.role) &&
            !requiresDedicatedClinicalWorkflow(prompt) &&
            !explicitlyRefusesDocumentation(prompt) &&
            !/\b(?:vielleicht|möglicherweise|eventuell|unklar|wohl|vermutlich|wahrscheinlich|mutmasslich|mutmaßlich|schätzungsweise|angeblich)\b|\b(?:sollte|könnte|dürfte)\s+man\b/i.test(
              prompt,
            ) &&
            /\b(?:morgenpflege|körperpflege|wasch\w*|dusch\w*|anzieh\w*|auszieh\w*|mobilis\w*|lager\w*|transfer\w*|toilett\w*|inkontinenz\w*|gegessen|getrunken|trinkmenge|nahrung|mundpflege|hautpflege|spaziergang|gehtraining)\b/i.test(
              prompt,
            ) &&
            !/^\s*(?:was|wer|wen|wem|wie|wo|wann|warum|wieso|welche|welcher|welches|ist|sind|hat|haben|kann|können|soll|sollen|darf|dürfen)\b/i.test(
              prompt,
            ) &&
            !/\?\s*$/.test(prompt)
          ) {
            components.push({
              type: "AssistantText",
              message:
                "Das Sprachmodell ist nicht verfügbar. Ich habe deinen Wortlaut deshalb nicht interpretiert, sondern unverändert zur Prüfung vorbereitet.",
            });
            components.push({
              type: "DraftAction",
              kind: "nursing-note",
              title: `Wörtlichen Eintrag prüfen · ${patient.displayName}`,
              preview: prompt.slice(0, 1200),
              actionLabel: "Wortlaut prüfen und übernehmen",
              intentToken: issue("note:draft", {
                structuredText: prompt.slice(0, 1200),
                inputModality: request.inputModality ?? "typed",
              }),
              sourceLabel:
                "Wörtliche Eingabe · keine automatische Bedeutungsinterpretation",
            });
          } else if (classification.degraded && patient) {
            components.push({
              type: "AssistantText",
              message:
                "Das Sprachmodell ist nicht verfügbar. Dein Wortlaut bleibt im privaten Gespräch erhalten; ich erstelle daraus ohne klaren Dokumentationsauftrag keine klinische Änderung.",
            });
          } else if (
            !agentRun ||
            (agentRun.status === "answer" && agentRun.toolCalls === 0) ||
            ["failed", "cancelled", "budget-exhausted"].includes(
              agentRun.status,
            )
          )
            components.push({
              type: "UnknownState",
              message:
                "Ich kann Patientenübersicht, Vitalwerte, offene Aufgaben, Übergabe, lokale Richtlinien sowie prüfpflichtige Notiz- oder Arztfrage-Entwürfe vorbereiten.",
            });
          break;
      }

    const generatedCoworkerContent = agentRun
      ? verifiedCoworkerContent(agentRun, {
          allowSourceFreeModelText: patient === null,
          protectedPatientTerms: snapshot.patients.flatMap((candidate) => [
            candidate.displayName,
            ...candidate.displayName
              .split(/\s+/u)
              .filter((term) => term.length >= 3),
            candidate.mrn,
          ]),
        })
      : null;
    if (generatedCoworkerContent && agentRun) {
      if (classification.intent === "unknown")
        for (let index = components.length - 1; index >= 0; index -= 1)
          if (components[index]?.type === "UnknownState")
            components.splice(index, 1);
      components.unshift({
        type: "AssistantText",
        message: generatedCoworkerContent.dialogue,
      });
      if (generatedCoworkerContent.clinicalFacts.length > 0)
        components.splice(1, 0, {
          type: "ClinicalFacts",
          items: generatedCoworkerContent.clinicalFacts,
          sourceLabel: `${new Set(agentRun.sourceReferenceIds ?? []).size} autorisierte Quelle${new Set(agentRun.sourceReferenceIds ?? []).size === 1 ? "" : "n"}`,
        });
      for (const source of generatedCoworkerSources(agentRun, {
        sessionId: request.workingContext!.sessionId,
        threadId: request.workingContext!.threadId,
        contextRevision: request.workingContext!.contextRevision,
        patientId: patient?.id ?? null,
        encounterId: patient?.encounterId ?? null,
      }))
        if (
          !evidence.some(
            (item) =>
              item.resourceId === source.resourceId &&
              item.version === source.version,
          )
        )
          evidence.push(source);
    } else if (fallbackAgentLead) {
      components.unshift({
        type: "AssistantText",
        message: fallbackAgentLead,
      });
      if (agentRun?.status === "answer" && agentRun.toolCalls > 0)
        warnings.push(
          "Die generierte Erläuterung wurde wegen fehlender oder widersprüchlicher Quellenbindung nicht angezeigt.",
        );
    } else if (agentRun?.status === "answer" && agentRun.toolCalls > 0) {
      components.unshift({
        type: "AssistantText",
        message:
          "Die angefragten Daten wurden gelesen, aber die generierte Zusammenfassung war nicht vollständig durch die zitierten Datensätze belegt.",
      });
      warnings.push(
        "Die generierte Erläuterung wurde wegen fehlender oder widersprüchlicher Quellenbindung nicht angezeigt.",
      );
    } else if (agentRun?.status === "conversation") {
      components.unshift({
        type: "AssistantText",
        message: "Gern. Wobei soll ich dich unterstützen?",
      });
    }

    const presentation =
      agentRun && generatedCoworkerContent ? modelPresentation(agentRun) : null;
    if (presentation) components.push(presentation);

    const validated = validateAssistantComponents(components);
    // Tool results render in one stable, measured order. A model is used for
    // language understanding, not for an extra round trip that only permutes
    // already-authorized cards.
    const composed = [
      ...validated.filter((component) => component.type === "AssistantText"),
      ...validated.filter((component) => component.type !== "AssistantText"),
    ];
    this.clinical.audit.append({
      actor,
      action: "assistant:query",
      patientId: patient?.id ?? null,
      purpose,
      outcome: "success",
      detail: {
        intent: classification.intent,
        modelMode: classification.mode,
        model: classification.model,
        evidenceCount: evidence.length,
        degraded: classification.degraded,
        agentToolCalls: agentRun?.toolCalls ?? 0,
        runtimePackVersion: agentGuidance?.packVersion ?? 0,
        runtimePackDigest: agentGuidance?.packDigest ?? null,
      },
    });
    return {
      id: randomUUID(),
      classification: { intent: classification.intent },
      runtime,
      patientContext: patient
        ? {
            patientId: patient.id,
            encounterId: patient.encounterId,
            resourceVersion: patient.source.version,
            displayName: patient.displayName,
            birthDate: patient.birthDate,
            mrn: patient.mrn,
          }
        : null,
      components: composed,
      openUi: toOpenUi(composed),
      evidence,
      warnings,
    };
  }

  executeIntent(
    userId: string,
    token: string,
    context: IntentExecutionContext,
  ): unknown {
    const actor = this.clinical.user(userId);
    let intent;
    try {
      intent = this.intents.consume(token, actor, context);
    } catch (error) {
      this.clinical.audit.append({
        actor,
        action: "assistant:intent-rejected",
        patientId: context.patientId,
        purpose: context.purpose,
        outcome: "denied",
        detail: { reason: "identity-context-version-confirmation-or-replay" },
      });
      throw error;
    }
    const currentSnapshot = this.clinical.snapshot(userId, intent.purpose);
    const currentPatient = currentSnapshot.patients.find(
      (patient) => patient.id === intent.patientId,
    );
    if (
      !currentPatient ||
      currentPatient.source.version !== intent.resourceVersion
    ) {
      this.clinical.audit.append({
        actor,
        action: "assistant:intent-stale",
        patientId: intent.patientId,
        purpose: intent.purpose,
        outcome: "denied",
        detail: {
          expectedVersion: intent.resourceVersion,
          currentVersion: currentPatient?.source.version ?? -1,
        },
      });
      throw new DomainError(
        "VERSION_CONFLICT",
        "Patientenkontext wurde seit dem Entwurf geändert. Bitte Assistenzanfrage neu stellen.",
        409,
      );
    }
    switch (intent.command) {
      case "note:draft": {
        const voiceTranscriptProvenance = intentVoiceProvenance(intent.payload);
        if (
          intent.payload.inputModality === "voice" &&
          voiceTranscriptProvenance.length === 0
        )
          throw new DomainError(
            "VALIDATION",
            "Die Sprachherkunft des Entwurfs fehlt.",
            400,
          );
        const draft = this.clinical.createNoteDraft(userId, {
          patientId: intent.patientId,
          encounterId: intent.encounterId,
          transcript:
            voiceTranscriptProvenance.at(-1)?.original.transcript ?? null,
          ...(voiceTranscriptProvenance.length > 0
            ? { voiceTranscriptProvenance }
            : {}),
          structuredText: intent.payload.structuredText ?? "",
          purpose: intent.purpose,
        });
        const result = this.clinical.approve(userId, "note", draft.id, {
          expectedVersion: draft.version,
          patientMrn: currentPatient.mrn,
          patientBirthDate: currentPatient.birthDate,
          reviewedDiff: true,
          purpose: intent.purpose,
        });
        this.intents.finalize(token);
        return result;
      }
      case "communication:draft": {
        this.clinical.audit.append({
          actor,
          action: "assistant:communication-handoff",
          patientId: intent.patientId,
          purpose: intent.purpose,
          outcome: "success",
          detail: { target: "fixed-communication-form" },
        });
        const result = {
          handoff: {
            kind: "communication",
            patientId: intent.patientId,
            title: intent.payload.request ?? "",
            reason: intent.payload.reason ?? "",
            recipientRole:
              intent.payload.recipientRole === "registered-nurse" ||
              intent.payload.recipientRole === "pharmacy" ||
              intent.payload.recipientRole === "physiotherapy" ||
              intent.payload.recipientRole === "occupational-therapy"
                ? intent.payload.recipientRole
                : "physician",
            recipientId: intent.payload.recipientId || null,
            ...(intent.payload.recipientLabel
              ? { recipientLabel: intent.payload.recipientLabel }
              : {}),
            dueAt: new Date(Date.now() + 30 * 60_000).toISOString(),
          } satisfies AssistantDraftHandoff,
        };
        this.intents.finalize(token);
        return result;
      }
      case "task:draft": {
        this.clinical.audit.append({
          actor,
          action: "assistant:task-handoff",
          patientId: intent.patientId,
          purpose: intent.purpose,
          outcome: "success",
          detail: { target: "fixed-task-form" },
        });
        const result = {
          handoff: {
            kind: "task",
            patientId: intent.patientId,
            title: intent.payload.title ?? "Assistenzaufgabe",
            reason: "Im Gespräch erfasst; fachlich prüfen und konkretisieren",
            dueAt: new Date(Date.now() + 60 * 60_000).toISOString(),
          } satisfies AssistantDraftHandoff,
        };
        this.intents.finalize(token);
        return result;
      }
      case "care-update:draft": {
        validateDurableIntentPayload(intent);
        const plan = verifyProposalSourceRecords(
          assistantProposalSchema.parse(
            JSON.parse(intent.payload.plan ?? "null"),
          ),
        );
        const voiceTranscriptProvenance = (
          plan.voiceTranscriptProvenance ?? []
        ).map(parseVoiceTranscriptProvenance);
        if (
          intent.payload.inputModality === "voice" &&
          voiceTranscriptProvenance.length === 0
        )
          throw new DomainError(
            "VALIDATION",
            "Die Sprachherkunft des Pflegeentwurfs fehlt.",
            400,
          );
        const reviewed = new Set(context.reviewedActionIds ?? []);
        const linkedTaskActionId = intent.payload.linkedTaskActionId;
        const allowedActionIds = new Set([
          ...plan.actions.map((action) => action.id),
          ...(linkedTaskActionId ? [linkedTaskActionId] : []),
        ]);
        if (
          reviewed.size === 0 ||
          [...reviewed].some((id) => !allowedActionIds.has(id))
        )
          throw new DomainError(
            "VALIDATION",
            "Mindestens eine sichtbare Aktion muss einzeln bestätigt werden.",
            400,
          );
        const selected = plan.actions.filter((action) =>
          reviewed.has(action.id),
        );
        const completeLinkedTask = Boolean(
          linkedTaskActionId && reviewed.has(linkedTaskActionId),
        );
        const selectedNote = selected.some(
          (action) => action.type === "note-proposal",
        );
        const doubtfulObservationSpans = plan.actions
          .filter(
            (
              action,
            ): action is Extract<
              ExecutableAssistantAction,
              { type: "observation-proposal" }
            > =>
              action.type === "observation-proposal" &&
              isDoubtfulObservation(action),
          )
          .map((action) => action.sourceSpan);
        // Episode/task completion evidence is a separate trust boundary from
        // the clinical note. Derive it only from current, certain work spans;
        // never copy the free-form note, and fail closed if a work span also
        // contains an uncountersigned high-assurance measurement.
        const safeWorkEvidence = plan.workPerformed
          .filter(
            (work) =>
              ["performed", "partial"].includes(work.status) &&
              work.reportingStatus === "current" &&
              work.certainty === "certain" &&
              !doubtfulObservationSpans.some(
                (span) =>
                  work.sourceSpan.start < span.end &&
                  work.sourceSpan.end > span.start,
              ),
          )
          .map((work) =>
            work.status === "partial"
              ? `Teilweise durchgeführt: ${work.sourceSpan.quote}`
              : `Durchgeführt: ${work.sourceSpan.quote}`,
          )
          .filter((value, index, values) => values.indexOf(value) === index);
        const workflow = selected.filter(
          (action) => action.type === "workflow-proposal",
        );
        if (workflow.length > 0) {
          if (workflow.length !== selected.length || completeLinkedTask)
            throw new DomainError(
              "VALIDATION",
              "Ablaufwechsel und klinische Dokumentation müssen getrennt bestätigt werden.",
              400,
            );
          const result = {
            workflowActions: workflow.map((action) => ({
              operation: action.operation,
              targetRoom: action.targetRoom,
              reason: action.reason,
            })),
          };
          this.intents.finalize(token);
          return result;
        }
        const result = this.clinical.runAtomically(() => {
          const results = selected.map((action: ExecutableAssistantAction) => {
            switch (action.type) {
              case "note-proposal": {
                const draft = this.clinical.createNoteDraft(userId, {
                  patientId: intent.patientId,
                  encounterId: intent.encounterId,
                  transcript:
                    voiceTranscriptProvenance.at(-1)?.original.transcript ??
                    null,
                  ...(voiceTranscriptProvenance.length > 0
                    ? { voiceTranscriptProvenance }
                    : {}),
                  structuredText: action.structuredText,
                  purpose: intent.purpose,
                });
                return this.clinical.approve(userId, "note", draft.id, {
                  expectedVersion: draft.version,
                  patientMrn: currentPatient.mrn,
                  patientBirthDate: currentPatient.birthDate,
                  reviewedDiff: true,
                  purpose: intent.purpose,
                });
              }
              case "observation-proposal": {
                const effectiveAt = resolveOccurrenceTime(
                  action.occurrenceText,
                  plan.inputTimestamp,
                );
                if (!effectiveAt)
                  throw new DomainError(
                    "VALIDATION",
                    "Die berichtete Messzeit ist nicht eindeutig. Bitte Datum und Uhrzeit präzisieren.",
                    400,
                  );
                if (
                  new Date(effectiveAt).getTime() >
                  new Date(plan.inputTimestamp).getTime() + 5 * 60_000
                )
                  throw new DomainError(
                    "VALIDATION",
                    "Die Messzeit liegt in der Zukunft. Bitte geplante Messung und bereits erhobenen Wert trennen.",
                    400,
                  );
                const draft = this.clinical.createObservationDraft(userId, {
                  patientId: intent.patientId,
                  encounterId: intent.encounterId,
                  code: action.code,
                  value: action.value,
                  secondaryValue: action.secondaryValue,
                  effectiveAt,
                  purpose: intent.purpose,
                  approvalPolicy: isDoubtfulObservation(action)
                    ? "high-assurance"
                    : "standard",
                });
                return this.clinical.approve(userId, "observation", draft.id, {
                  expectedVersion: draft.version,
                  patientMrn: currentPatient.mrn,
                  patientBirthDate: currentPatient.birthDate,
                  reviewedDiff: true,
                  purpose: intent.purpose,
                });
              }
              case "communication-proposal": {
                const recipientMatches = currentSnapshot.users.filter(
                  (candidate) =>
                    candidate.role === action.recipientRole &&
                    candidate.displayName === action.recipientLabel,
                );
                if (
                  action.recipientLabel !== "Ärztlicher Dienst" &&
                  recipientMatches.length !== 1
                )
                  throw new DomainError(
                    "VERSION_CONFLICT",
                    "Die gewählte empfangende Person ist im aktuellen Behandlungsteam nicht mehr eindeutig verfügbar.",
                    409,
                  );
                return this.clinical.createCommunication(userId, {
                  patientId: intent.patientId,
                  encounterId: intent.encounterId,
                  request: action.request,
                  reason: action.reason,
                  recipientRole: action.recipientRole,
                  recipientId: recipientMatches[0]?.id ?? null,
                  priority: action.priority,
                  dueAt:
                    action.dueInMinutes === null
                      ? null
                      : new Date(
                          Date.now() + action.dueInMinutes * 60_000,
                        ).toISOString(),
                  purpose: intent.purpose,
                });
              }
              case "task-proposal":
                if (action.dueInMinutes === null)
                  throw new DomainError(
                    "VALIDATION",
                    "Die sichtbare Folgeaufgabe enthält keine bestätigte Frist.",
                    400,
                  );
                return this.clinical.createTask(userId, {
                  patientId: intent.patientId,
                  encounterId: intent.encounterId,
                  title: action.title,
                  reason: action.reason,
                  ownerRole: action.ownerRole,
                  priority: action.priority,
                  dueAt: new Date(
                    Date.now() + action.dueInMinutes * 60_000,
                  ).toISOString(),
                  purpose: intent.purpose,
                });
              case "workflow-proposal":
                throw new DomainError(
                  "INVALID_STATE",
                  "Ablaufaktion wurde nicht getrennt verarbeitet.",
                  409,
                );
            }
          });
          if (completeLinkedTask) {
            const taskId = intent.payload.linkedTaskId;
            if (!taskId)
              throw new DomainError(
                "VALIDATION",
                "Die ausgewählte bestehende Aufgabe ist nicht mehr eindeutig gebunden.",
                400,
              );
            const task = this.clinical
              .snapshot(userId, intent.purpose)
              .tasks.find((candidate) => candidate.id === taskId);
            if (task?.state === "new")
              this.clinical.updateTask(userId, taskId, "accept", {
                purpose: intent.purpose,
              });
            results.push(
              this.clinical.updateTask(userId, taskId, "complete", {
                purpose: intent.purpose,
                evidence: safeWorkEvidence.join("\n"),
              }),
            );
          }
          this.clinical.audit.append({
            actor,
            action: "assistant:plan-executed",
            patientId: intent.patientId,
            purpose: intent.purpose,
            outcome: "success",
            detail: {
              selectedActionCount: selected.length + Number(completeLinkedTask),
              excludedActionCount:
                plan.actions.length +
                Number(Boolean(linkedTaskActionId)) -
                selected.length -
                Number(completeLinkedTask),
            },
          });
          const episodeEvidence = [
            ...(selectedNote || completeLinkedTask ? safeWorkEvidence : []),
            ...selected.flatMap((action) =>
              action.type === "observation-proposal" &&
              !isDoubtfulObservation(action)
                ? [actionReviewLabel(action)]
                : [],
            ),
            ...(completeLinkedTask && intent.payload.linkedTaskLabel
              ? [`Aufgabe abgeschlossen: ${intent.payload.linkedTaskLabel}`]
              : []),
          ]
            .filter((value, index, values) => values.indexOf(value) === index)
            .join("\n")
            .slice(0, 1200);
          return {
            bundle: results,
            ...(episodeEvidence ? { episodeEvidence } : {}),
            itemStates: results.map((result) =>
              typeof result === "object" && result
                ? "status" in result
                  ? String(result.status)
                  : "state" in result
                    ? String(result.state)
                    : "accepted"
                : "accepted",
            ),
          };
        });
        this.intents.finalize(token);
        return result;
      }
    }
  }
}
