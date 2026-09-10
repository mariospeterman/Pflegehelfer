import { randomUUID } from "node:crypto";
import {
  ModelGateway,
  type AuthorizedModelContext,
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
  explicitlyRefusesDocumentation,
  isDoubtfulObservation,
  requiresDedicatedClinicalWorkflow,
  type ExecutableAssistantAction,
} from "../ai/assistant-proposal.js";

export interface AssistantRequest {
  prompt: string;
  patientId: string | null;
  purpose?: Purpose;
  inputModality?: "typed" | "voice";
  voiceTranscriptConfirmed?: boolean;
  workingContext?: {
    currentStepId: string;
    activeEpisodeTitle: string | null;
    activeEpisodePatientId: string | null;
    resumableEpisodePatientId: string | null;
    recentPrompts: string[];
    recentConversation?: Array<{
      role: "user" | "assistant";
      text: string;
    }>;
    organizationLabel: string;
    actorRole: string;
    dataClass: "synthetic-demo" | "institution-local";
    workdayHandover?: {
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
  classification: IntentClassification;
  runtime: {
    route:
      | "deterministic"
      | "fast-local"
      | "hosted-test"
      | "deep-local"
      | "deep-hosted-test";
    label: string;
    degraded: boolean;
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
  evidence: { resourceId: string; version: number; label: string }[];
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
      case "PatientPicker":
        return `${name} = PatientPicker(${q(component.title)}, ${q(component.message)}, ${JSON.stringify(component.patients)})`;
      case "PatientSummary":
        return `${name} = PatientContextCard(${q(component.patientId)}, ${q(component.title)}, ${q(component.summary)}, ${q(component.sourceLabel)})`;
      case "TaskList":
        return `${name} = TaskListCard(${q(component.title)}, ${component.count}, ${q(component.summary)}, ${q(component.sourceLabel)})`;
      case "VitalTrend":
        return `${name} = VitalTrendCard(${q(component.label)}, ${q(component.value)}, ${q(component.sourceLabel)})`;
      case "HandoverChecklist":
        return `${name} = HandoverDeltaCard(${q(component.title)}, ${component.openCount}, ${q(component.summary)}, ${q(component.sourceLabel)})`;
      case "TeamInbox":
        return `${name} = TeamInboxCard(${q(component.title)}, ${component.count}, ${q(component.summary)}, ${q(component.sourceLabel)}, ${JSON.stringify(component.items)})`;
      case "SyncSummary":
        return `${name} = SyncSummaryCard(${q(component.title)}, ${component.pending}, ${component.conflicts}, ${q(component.summary)}, ${q(component.sourceLabel)})`;
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

function explicitlyRequestsNote(prompt: string): boolean {
  return /^\s*(?:bitte\s+)?(?:notiz|dokumentiere|schreib(?:e)?(?:\s+auf)?|anamnes(?:e|is))\b/i.test(
    prompt,
  );
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
    this.intents.restore(token, record);
  }

  async query(
    userId: string,
    request: AssistantRequest,
  ): Promise<AssistantResponse> {
    const actor = this.clinical.user(userId);
    const purpose = request.purpose ?? actor.defaultPurpose;
    const prompt = request.prompt.trim();
    if (prompt.length < 2 || prompt.length > 1200)
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
    const classified = await this.models.classify(prompt, modelContext);
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
    const classification: IntentClassification = {
      ...classified,
      intent: safeIntent,
    };
    let runtime: AssistantResponse["runtime"] = {
      route:
        classification.model === "deterministic-clinical-router-v1"
          ? "deterministic"
          : classification.mode === "hosted-test"
            ? "hosted-test"
            : "fast-local",
      label:
        classification.model === "deterministic-clinical-router-v1"
          ? "Deterministische klinische Navigation"
          : classification.mode === "hosted-test"
            ? `Synthetischer Testdienst · ${classification.model}`
            : `Lokales Sprachmodell · ${classification.model}`,
      degraded: classification.degraded,
    };
    const evidence: AssistantResponse["evidence"] = [];
    const components: AssistantComponent[] = [];
    const warnings = [
      "Assistenzinhalte sind prüfpflichtig. Klinische Fakten stammen ausschliesslich aus den angezeigten Quellen.",
    ];
    if (classification.degraded)
      warnings.push(
        "Das konfigurierte Modell war nicht verfügbar; sichere deterministische Navigation wurde verwendet.",
      );

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
        payload,
      });
    };

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
            (item) => item.patientId === current.id && item.approvedAt !== null,
          )
          .toSorted((left, right) =>
            right.effectiveAt.localeCompare(left.effectiveAt),
          )
          .slice(0, 3)
          .map(
            (item) =>
              `${item.label} ${item.value}${item.secondaryValue === null ? "" : `/${item.secondaryValue}`} ${item.unit}`,
          );
        const protocol = [
          ...snapshot.notes
            .filter(
              (item) =>
                item.patientId === current.id && item.approvedAt !== null,
            )
            .slice(-3)
            .map((item) => `#Dokumentation ${item.structuredText}`),
          ...snapshot.communications
            .filter((item) => item.patientId === current.id)
            .slice(-3)
            .map((item) => `#Team ${item.request} · ${item.state}`),
        ];
        components.push({
          type: "PatientSummary",
          patientId: current.id,
          title: `${current.room} · ${current.displayName}`,
          summary: [
            `#Situation ${current.diagnoses.join("; ") || "keine Diagnose im freigegebenen Ausschnitt"}`,
            `#Sicherheit ${
              [
                ...(current.allergies.length
                  ? current.allergies.map((item) => `Allergie: ${item}`)
                  : []),
                ...current.risks,
              ].join(" · ") || "keine Warnhinweise erfasst"
            }`,
            `#Ziele ${current.careGoals.join("; ") || "keine erfasst"}`,
            `#Medikation · nur lesbar ${current.medicationSummary.join("; ") || "kein Ausschnitt verfügbar"}`,
            `#Heute ${snapshot.tasks.filter((task) => task.patientId === current.id && task.state !== "completed").length} offene Aufgaben${latestObservations.length ? ` · ${latestObservations.join(" · ")}` : ""}`,
            `#Pflegeprotokoll ${protocol.join("\n") || "Noch keine Einträge in dieser Schicht."}`,
          ].join("\n"),
          sourceLabel: `${current.source.provider} · Version ${current.source.version} · rollenberechtigte FHIR-/Workflow-Sicht`,
        });
        break;
      }
      case "open-tasks": {
        const tasks = snapshot.tasks.filter(
          (task) =>
            task.state !== "completed" &&
            (!patient || task.patientId === patient.id),
        );
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
            (item) => item.patientId === current.id && item.approvedAt !== null,
          )
          .toSorted((a, b) => b.effectiveAt.localeCompare(a.effectiveAt));
        for (const item of observations.slice(0, 4)) {
          evidence.push({
            resourceId: `Observation/${item.id}`,
            version: item.version,
            label: `${item.source.provider} · ${formatOrganizationTimestamp(item.effectiveAt)}`,
          });
          components.push({
            type: "VitalTrend",
            patientId: current.id,
            label: item.label,
            value: `${item.value}${item.secondaryValue === null ? "" : `/${item.secondaryValue}`} ${item.unit}`,
            sourceLabel: `${item.source.provider} · ${item.status === "pending-provider" ? "lokal freigegeben, Anbieter ausstehend · " : item.status === "external-gated" ? "lokal freigegeben, externe Schnittstelle gesperrt · " : ""}${formatOrganizationTimestamp(item.effectiveAt)}`,
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
          components.push({
            type: "HandoverChecklist",
            title: patient
              ? `Aktuelle Verantwortung · ${patient.displayName}`
              : "Aktuelle Schichtübergabe",
            summary: operationalHandover.summary,
            openCount: operationalHandover.openCount,
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
        // The patient-authorized treatment team shares one transparent thread.
        // Addressing controls who may claim/answer, not who may safely read it.
        const messages = snapshot.communications.filter(
          (item) => item.state !== "closed",
        );
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
                  ? snapshot.users.find((user) => user.id === item.recipientId)
                      ?.displayName
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
        const pending = snapshot.outbox.filter(
          (item) => !isTerminalOutboxState(item.state),
        );
        components.push({
          type: "SyncSummary",
          title: "Synchronisation und Abgleich",
          pending: pending.length,
          conflicts: snapshot.syncSummary.conflicts,
          summary:
            pending
              .slice(0, 6)
              .map((item) => `${item.provider} · ${item.state}`)
              .join("\n") || "Alle aktuellen Übertragungen sind quittiert.",
          sourceLabel:
            snapshot.capabilityProfile === "synthetic-simulator"
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
        if (["management", "hr", "it", "quality-safety"].includes(actor.role)) {
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
        const planned = await this.models.planCareUpdate(prompt, modelContext);
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
        runtime = {
          route:
            planned.model === "deterministic-clinical-planner-v1"
              ? "deterministic"
              : planned.mode === "hosted-test"
                ? "hosted-test"
                : "fast-local",
          label:
            planned.model === "deterministic-clinical-planner-v1"
              ? "Deterministischer klinischer Aktionsplan"
              : `${planned.mode === "hosted-test" ? "Synthetischer Testdienst" : "Lokales Sprachmodell"} · strukturierter Aktionsplan`,
          degraded: planned.degraded,
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
        const performedMarkers = planned.plan.workPerformed
          .filter((item) => item.status === "performed")
          .flatMap((item) =>
            [
              "mobilis",
              "morgenpflege",
              "frühstück",
              "essen",
              "trink",
              "lager",
              "hygiene",
            ].filter((marker) =>
              item.activity.toLocaleLowerCase("de-CH").includes(marker),
            ),
          );
        const taskCandidates = snapshot.tasks.filter((task) => {
          const searchable = `${task.title} ${task.reason}`.toLocaleLowerCase(
            "de-CH",
          );
          return (
            task.patientId === current.id &&
            ["new", "accepted", "in-progress", "waiting"].includes(
              task.state,
            ) &&
            performedMarkers.some((marker) => searchable.includes(marker))
          );
        });
        const linkedTask =
          taskCandidates.length === 1 ? taskCandidates[0]! : null;
        const linkedTaskActionId = linkedTask
          ? `action-${planned.plan.actions.length + 1}`
          : null;
        if (
          linkedTask &&
          linkedTaskActionId &&
          /^action-(?:[1-9]|1[0-2])$/.test(linkedTaskActionId)
        )
          reviewItems.push({
            id: linkedTaskActionId,
            label: `Bestehende Aufgabe abschliessen: ${linkedTask.title}`,
            kind: "task",
          });
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
              : request.workingContext?.activeEpisodePatientId === current.id &&
                  request.workingContext.activeEpisodeTitle
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
            ...(linkedTask && linkedTaskActionId
              ? {
                  linkedTaskId: linkedTask.id,
                  linkedTaskActionId,
                  linkedTaskLabel: linkedTask.title,
                }
              : {}),
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
          route:
            answer.mode === "local-deep-llm"
              ? "deep-local"
              : answer.mode === "hosted-test-deep-llm"
                ? "deep-hosted-test"
                : "deterministic",
          label:
            answer.mode === "local-deep-llm"
              ? `Lokales Deep-LLM + freigegebene Wissensbasis · ${this.knowledge.model}`
              : answer.mode === "hosted-test-deep-llm"
                ? `Synthetischer Deep-LLM-Testdienst · ${this.knowledge.model}`
                : "Deterministische lokale Wissenssuche",
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
            sourceLabel: "Nur Kommunikationsentwurf · keine MedicationRequest",
          });
        break;
      }
      case "unknown":
        components.push({
          type: "UnknownState",
          message:
            "Ich kann Patientenübersicht, Vitalwerte, offene Aufgaben, Übergabe, lokale Richtlinien sowie prüfpflichtige Notiz- oder Arztfrage-Entwürfe vorbereiten.",
        });
        break;
    }

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
      },
    });
    return {
      id: randomUUID(),
      classification,
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
    const currentPatient = this.clinical
      .snapshot(userId, intent.purpose)
      .patients.find((patient) => patient.id === intent.patientId);
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
        const draft = this.clinical.createNoteDraft(userId, {
          patientId: intent.patientId,
          transcript:
            intent.payload.inputModality === "voice"
              ? (intent.payload.structuredText ?? "")
              : null,
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
        const plan = assistantProposalSchema.parse(
          JSON.parse(intent.payload.plan ?? "null"),
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
                  transcript:
                    intent.payload.inputModality === "voice"
                      ? action.structuredText
                      : null,
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
              case "communication-proposal":
                if (action.dueInMinutes === null)
                  throw new DomainError(
                    "VALIDATION",
                    "Die sichtbare Teamnachricht enthält keine bestätigte Frist.",
                    400,
                  );
                return this.clinical.createCommunication(userId, {
                  patientId: intent.patientId,
                  request: action.request,
                  reason: action.reason,
                  recipientRole: action.recipientRole,
                  priority: action.priority,
                  dueAt: new Date(
                    Date.now() + action.dueInMinutes * 60_000,
                  ).toISOString(),
                  purpose: intent.purpose,
                });
              case "task-proposal":
                if (action.dueInMinutes === null)
                  throw new DomainError(
                    "VALIDATION",
                    "Die sichtbare Folgeaufgabe enthält keine bestätigte Frist.",
                    400,
                  );
                return this.clinical.createTask(userId, {
                  patientId: intent.patientId,
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
                evidence:
                  plan.actions
                    .filter((action) => action.type === "note-proposal")
                    .map((action) => action.structuredText)
                    .join("\n") || plan.summary,
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
          return {
            bundle: results,
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
