import { randomUUID } from "node:crypto";
import {
  ModelGateway,
  type IntentClassification,
} from "../ai/model-gateway.js";
import { ApprovedKnowledgeService } from "../ai/approved-knowledge.js";
import {
  OpaqueIntentBroker,
  validateAssistantComponents,
  type AssistantComponent,
  type IntentExecutionContext,
} from "./assistant.js";
import type { PflegehelferService } from "./service.js";
import { DomainError, type Purpose } from "./types.js";
import {
  actionReviewLabel,
  clinicalActionPlanSchema,
  type ClinicalAction,
} from "../ai/clinical-action-plan.js";

export interface AssistantRequest {
  prompt: string;
  patientId: string | null;
  purpose?: Purpose;
  inputModality?: "typed" | "voice";
  voiceTranscriptConfirmed?: boolean;
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
  recipientRole?: "physician";
  dueAt: string;
}

const q = (value: string): string => JSON.stringify(value);

export function toOpenUi(components: AssistantComponent[]): string {
  const statements = components.map((component, index) => {
    const name = `item${index}`;
    switch (component.type) {
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

function formatOrganizationTime(value: string): string {
  return new Intl.DateTimeFormat("de-CH", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/Zurich",
  }).format(new Date(value));
}

function formatOrganizationTimestamp(value: string): string {
  return `${new Intl.DateTimeFormat("de-CH", {
    dateStyle: "short",
    timeStyle: "short",
    hour12: false,
    timeZone: "Europe/Zurich",
  }).format(new Date(value))} Europe/Zurich`;
}

export class AssistantService {
  private readonly intents = new OpaqueIntentBroker();

  constructor(
    private readonly clinical: PflegehelferService,
    private readonly models = new ModelGateway(),
    private readonly knowledge = new ApprovedKnowledgeService(),
  ) {}

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

    const classification = await this.models.classify(prompt);
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
        components.push({
          type: "PatientSummary",
          patientId: current.id,
          title: `${current.room} · ${current.displayName}`,
          summary: `Risiken: ${current.risks.join(", ") || "keine erfasst"}. Ziele: ${current.careGoals.join("; ") || "keine erfasst"}. Offene Aufgaben: ${snapshot.tasks.filter((task) => task.patientId === current.id && task.state !== "completed").length}.`,
          sourceLabel: `${current.source.provider} · Version ${current.source.version}`,
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
          .filter((item) => item.patientId === current.id)
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
            sourceLabel: `${item.source.provider} · ${formatOrganizationTimestamp(item.effectiveAt)}`,
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
        const handover = snapshot.handovers.at(-1);
        if (!handover) {
          components.push({
            type: "UnknownState",
            message: "Keine Übergabe im freigegebenen Schichtkontext.",
          });
          break;
        }
        evidence.push({
          resourceId: `Task/${handover.id}`,
          version: 1,
          label: handover.createdAt,
        });
        const patientSummary = patient
          ? [
              ...snapshot.tasks
                .filter(
                  (task) =>
                    task.patientId === patient.id && task.state !== "completed",
                )
                .map((task) => `${task.title}: ${task.state}`),
              ...snapshot.communications
                .filter(
                  (item) =>
                    item.patientId === patient.id && item.state !== "closed",
                )
                .map(
                  (item) => `Kommunikation: ${item.request} (${item.state})`,
                ),
            ].join(" · ") || "Keine offenen patientenbezogenen Deltas."
          : handover.narrative;
        components.push({
          type: "HandoverChecklist",
          title: patient
            ? `Patientenübergabe · ${patient.displayName}`
            : `Stationsübergabe · ${handover.fromShift} → ${handover.toShift}`,
          summary: patientSummary,
          openCount:
            handover.deltaTaskIds.length +
            handover.unresolvedCommunicationIds.length,
          sourceLabel: `Deterministische Delta-Abfrage · ${handover.createdAt}`,
        });
        break;
      }
      case "draft-note": {
        const current = patient;
        if (!current) {
          components.push(patientPicker());
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
          actionLabel: "Als prüfpflichtigen Entwurf anlegen",
          intentToken: issue("note:draft", {
            structuredText: draft,
            inputModality: request.inputModality ?? "typed",
          }),
          sourceLabel: "Benutzereingabe · noch nicht dokumentiert",
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
        components.push({
          type: "DraftAction",
          kind: "physician-question",
          title: `Frage an ärztlichen Dienst · ${current.displayName}`,
          preview: prompt.slice(0, 1000),
          actionLabel: "Frage prüfen und senden",
          intentToken: issue("communication:draft", {
            request: prompt.slice(0, 1000),
            reason: "Aus kontextueller Pflegehelfer-Assistenz erstellt",
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
        if (!["care-assistant", "registered-nurse"].includes(actor.role)) {
          components.push({
            type: "SafetyAlert",
            severity: "warning",
            message:
              "Diese Rolle darf keinen gebündelten Pflegeeintrag freigeben.",
          });
          break;
        }
        const planned = await this.models.planCareUpdate(prompt);
        if (!planned.plan || planned.plan.ambiguities.length > 0)
          throw new DomainError(
            "VALIDATION",
            "Der gebündelte Eintrag ist nicht eindeutig. Bitte Messwert, ausgeführte Arbeit, Empfänger und Zeitpunkt klar nennen.",
            400,
          );
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
                  : ("task" as const),
        }));
        const bundlePreview = reviewItems
          .map((item, index) => `${index + 1}. ${item.label}`)
          .join("\n");
        components.push({
          type: "DraftAction",
          kind: "care-update",
          title: `Gebündelter Pflegeeintrag · ${current.displayName}`,
          preview: bundlePreview,
          actionLabel: "Änderungen gemeinsam prüfen",
          intentToken: issue("care-update:draft", {
            plan: JSON.stringify(planned.plan),
            inputModality: request.inputModality ?? "typed",
          }),
          sourceLabel: `${planned.model} · ${reviewItems.length} getrennte, servervalidierte Vorschläge`,
          reviewItems,
        });
        break;
      }
      case "knowledge-query": {
        const answer = await this.knowledge.answer(prompt, actor.role);
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
          {
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
          },
        );
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
      components: validated,
      openUi: toOpenUi(validated),
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
      case "note:draft":
        return this.clinical.createNoteDraft(userId, {
          patientId: intent.patientId,
          transcript:
            intent.payload.inputModality === "voice"
              ? (intent.payload.structuredText ?? "")
              : null,
          structuredText: intent.payload.structuredText ?? "",
          purpose: intent.purpose,
        });
      case "communication:draft":
        this.clinical.audit.append({
          actor,
          action: "assistant:communication-handoff",
          patientId: intent.patientId,
          purpose: intent.purpose,
          outcome: "success",
          detail: { target: "fixed-communication-form" },
        });
        return {
          handoff: {
            kind: "communication",
            patientId: intent.patientId,
            title: intent.payload.request ?? "",
            reason: intent.payload.reason ?? "",
            recipientRole: "physician",
            dueAt: new Date(Date.now() + 30 * 60_000).toISOString(),
          } satisfies AssistantDraftHandoff,
        };
      case "task:draft":
        this.clinical.audit.append({
          actor,
          action: "assistant:task-handoff",
          patientId: intent.patientId,
          purpose: intent.purpose,
          outcome: "success",
          detail: { target: "fixed-task-form" },
        });
        return {
          handoff: {
            kind: "task",
            patientId: intent.patientId,
            title: intent.payload.title ?? "Assistenzaufgabe",
            reason:
              "Aus Assistenzvorschlag; fachlich prüfen und konkretisieren",
            dueAt: new Date(Date.now() + 60 * 60_000).toISOString(),
          } satisfies AssistantDraftHandoff,
        };
      case "care-update:draft": {
        const plan = clinicalActionPlanSchema.parse(
          JSON.parse(intent.payload.plan ?? "null"),
        );
        const reviewed = new Set(context.reviewedActionIds ?? []);
        if (
          reviewed.size === 0 ||
          [...reviewed].some(
            (id) => !plan.actions.some((action) => action.id === id),
          )
        )
          throw new DomainError(
            "VALIDATION",
            "Mindestens eine sichtbare Aktion muss einzeln bestätigt werden.",
            400,
          );
        const selected = plan.actions.filter((action) =>
          reviewed.has(action.id),
        );
        return this.clinical.runAtomically(() => {
          const results = selected.map((action: ClinicalAction) => {
            switch (action.type) {
              case "note-proposal":
                return this.clinical.createNoteDraft(userId, {
                  patientId: intent.patientId,
                  transcript:
                    intent.payload.inputModality === "voice"
                      ? action.structuredText
                      : null,
                  structuredText: action.structuredText,
                  purpose: intent.purpose,
                });
              case "observation-proposal":
                return this.clinical.createObservationDraft(userId, {
                  patientId: intent.patientId,
                  code: action.code,
                  value: action.systolic,
                  secondaryValue: action.diastolic,
                  effectiveAt: new Date().toISOString(),
                  purpose: intent.purpose,
                });
              case "communication-proposal":
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
            }
          });
          this.clinical.audit.append({
            actor,
            action: "assistant:plan-executed",
            patientId: intent.patientId,
            purpose: intent.purpose,
            outcome: "success",
            detail: {
              selectedActionCount: selected.length,
              excludedActionCount: plan.actions.length - selected.length,
            },
          });
          return {
            bundle: results,
            draftOnly: selected.every(
              (action) =>
                action.type === "note-proposal" ||
                action.type === "observation-proposal",
            ),
          };
        });
      }
    }
  }
}
