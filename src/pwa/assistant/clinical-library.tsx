import {
  createLibrary,
  defineComponent,
  useTriggerAction,
} from "@openuidev/react-lang";
import { z } from "zod";
import { useState } from "react";

const reviewKindLabel = {
  note: "Pflegedokumentation",
  observation: "Messwert",
  communication: "Teamnachricht",
  task: "Folgeaufgabe",
  workflow: "Arbeitsablauf",
} as const;

const AssistantMessage = defineComponent({
  name: "AssistantMessage",
  description:
    "Short conversational coworker response shown before review controls.",
  props: z.object({ message: z.string().max(1200) }).strict(),
  component: ({ props: { message } }) => (
    <p className="assistant-coworker-message">{message}</p>
  ),
});

const ClinicalCard = defineComponent({
  name: "ClinicalCard",
  description: "Source-linked, read-only clinical summary card.",
  props: z
    .object({
      tone: z.enum(["neutral", "task", "handover", "warning"]),
      title: z.string().max(160),
      body: z.string().max(1600),
      source: z.string().max(240),
    })
    .strict(),
  component: ({ props: { tone, title, body, source } }) => (
    <article className={`assistant-card tone-${tone}`}>
      <header>
        <span>Assistenzansicht · Quelle verknüpft</span>
        <h3>{title}</h3>
      </header>
      <p>{body}</p>
      <footer>{source}</footer>
    </article>
  ),
});

const VitalCard = defineComponent({
  name: "VitalCard",
  description: "Read-only source-linked vital observation.",
  props: z
    .object({
      label: z.string().max(100),
      value: z.string().max(100),
      source: z.string().max(240),
    })
    .strict(),
  component: ({ props: { label, value, source } }) => (
    <article className="assistant-card assistant-vital">
      <span>{label}</span>
      <strong>{value}</strong>
      <footer>{source}</footer>
    </article>
  ),
});

const PatientPicker = defineComponent({
  name: "PatientPicker",
  description: "Explicit patient-context selection; never selects implicitly.",
  props: z
    .object({
      title: z.string().max(160),
      message: z.string().max(1200),
      patients: z
        .array(
          z
            .object({
              id: z.string().max(64),
              label: z.string().max(120),
              secondary: z.string().max(120),
            })
            .strict(),
        )
        .max(20),
    })
    .strict(),
  component: function PatientPickerComponent({
    props: { title, message, patients },
  }) {
    const triggerAction = useTriggerAction();
    return (
      <article className="assistant-card patient-picker-card">
        <header>
          <span>Sicherer Kontext</span>
          <h3>{title}</h3>
        </header>
        <p>{message}</p>
        <div className="patient-picker-options">
          {patients.map((patient) => (
            <button
              key={patient.id}
              onClick={() =>
                void triggerAction(patient.label, undefined, {
                  type: "SelectPatient",
                  params: { patientId: patient.id },
                })
              }
            >
              <strong>{patient.label}</strong>
              <span>{patient.secondary}</span>
            </button>
          ))}
        </div>
      </article>
    );
  },
});

const PatientContextCard = defineComponent({
  name: "PatientContextCard",
  description:
    "Patient summary with explicit source and stable patient reference.",
  props: z
    .object({
      patientId: z.string().max(64),
      title: z.string().max(160),
      summary: z.string().max(1600),
      source: z.string().max(240),
    })
    .strict(),
  component: ({ props: { title, summary, source } }) => {
    const sections = summary.split("\n").filter(Boolean);
    return (
      <article className="assistant-card patient-context-card">
        <header>
          <span>Patientenkontext</span>
          <h3>{title}</h3>
        </header>
        <div className="patient-summary-sections">
          {sections.map((line, index) => {
            const tagged = /^#([^\s]+)(?:\s+(.+))?$/.exec(line);
            return (
              <section key={`${index}-${line.slice(0, 24)}`}>
                {tagged ? <h4>{tagged[1]}</h4> : null}
                <p>{tagged?.[2] ?? line}</p>
              </section>
            );
          })}
        </div>
        <footer>{source}</footer>
      </article>
    );
  },
});

const TaskListCard = defineComponent({
  name: "TaskListCard",
  description: "Role-filtered task overview.",
  props: z
    .object({
      title: z.string().max(160),
      count: z.number().int().min(0).max(50),
      summary: z.string().max(1600),
      source: z.string().max(240),
    })
    .strict(),
  component: ({ props: { title, count, summary, source } }) => (
    <article className="assistant-card task-list-card">
      <header>
        <span>{count} offen</span>
        <h3>{title}</h3>
      </header>
      <p>{summary}</p>
      <footer>{source}</footer>
    </article>
  ),
});

const VitalTrendCard = defineComponent({
  name: "VitalTrendCard",
  description: "Accessible vital result with a restrained visual indicator.",
  props: z
    .object({
      label: z.string().max(100),
      value: z.string().max(100),
      source: z.string().max(240),
    })
    .strict(),
  component: ({ props: { label, value, source } }) => (
    <article className="assistant-card vital-trend-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <div className="vital-line" aria-hidden="true" />
      <footer>{source}</footer>
    </article>
  ),
});

const HandoverDeltaCard = defineComponent({
  name: "HandoverDeltaCard",
  description: "Delta-based handover summary.",
  props: z
    .object({
      title: z.string().max(160),
      openCount: z.number().int().min(0).max(100),
      summary: z.string().max(1600),
      source: z.string().max(240),
    })
    .strict(),
  component: ({ props: { title, openCount, summary, source } }) => (
    <article className="assistant-card handover-delta-card">
      <header>
        <span>Übergabe · {openCount} offen</span>
        <h3>{title}</h3>
      </header>
      <p>{summary}</p>
      <footer>{source}</footer>
    </article>
  ),
});

const MedicationReadOnlyCard = defineComponent({
  name: "MedicationReadOnlyCard",
  description: "Strictly read-only medication context.",
  props: z
    .object({ summary: z.string().max(1600), source: z.string().max(240) })
    .strict(),
  component: ({ props: { summary, source } }) => (
    <article className="assistant-card medication-readonly-card">
      <header>
        <span>Nur lesbar</span>
        <h3>Medikationskontext</h3>
      </header>
      <p>{summary}</p>
      <footer>{source}</footer>
    </article>
  ),
});

const PolicyAnswerCard = defineComponent({
  name: "PolicyAnswerCard",
  description: "Answer grounded in approved local policy sources.",
  props: z
    .object({
      title: z.string().max(160),
      answer: z.string().max(2400),
      source: z.string().max(500),
    })
    .strict(),
  component: ({ props: { title, answer, source } }) => (
    <article className="assistant-card policy-answer-card">
      <header>
        <span>Freigegebene Wissensbasis</span>
        <h3>{title}</h3>
      </header>
      <p>{answer}</p>
      <footer>{source}</footer>
    </article>
  ),
});

const UnknownStateCard = defineComponent({
  name: "UnknownStateCard",
  description: "Safe recovery guidance for unsupported or ambiguous requests.",
  props: z.object({ message: z.string().max(1200) }).strict(),
  component: ({ props: { message } }) => (
    <div className="assistant-safety info" role="status">
      <strong>Noch nicht eindeutig</strong>
      <p>{message}</p>
    </div>
  ),
});

const SafetyNotice = defineComponent({
  name: "SafetyNotice",
  description: "Non-dismissible clinical safety or availability notice.",
  props: z
    .object({
      severity: z.enum(["info", "warning"]),
      message: z.string().max(1200),
    })
    .strict(),
  component: ({ props: { severity, message } }) => (
    <div className={`assistant-safety ${severity}`} role="status">
      <strong>
        {severity === "warning" ? "Sicherheitsgrenze" : "Hinweis"}
      </strong>
      <p>{message}</p>
    </div>
  ),
});

const DraftActionCard = defineComponent({
  name: "DraftActionCard",
  description:
    "Reviewable draft that can only enter a deterministic server workflow.",
  props: z
    .object({
      kind: z.enum([
        "nursing-note",
        "physician-question",
        "task",
        "care-update",
      ]),
      title: z.string().max(160),
      preview: z.string().max(1600),
      actionLabel: z.string().max(100),
      intentToken: z.string().uuid(),
      source: z.string().max(240),
      reviewItems: z
        .array(
          z
            .object({
              id: z.string().regex(/^action-(?:[1-9]|1[0-2])$/),
              label: z.string().max(1400),
              kind: z.enum([
                "note",
                "observation",
                "communication",
                "task",
                "workflow",
              ]),
            })
            .strict(),
        )
        .max(12)
        .default([]),
    })
    .strict(),
  component: function DraftActionCardComponent({
    props: {
      kind,
      title,
      preview,
      actionLabel,
      intentToken,
      source,
      reviewItems,
    },
  }) {
    const triggerAction = useTriggerAction();
    const [selected, setSelected] = useState(() =>
      reviewItems.map((item) => item.id),
    );
    return (
      <article className="assistant-card assistant-draft">
        <header>
          <span>Bitte kurz prüfen</span>
          <h3>{title}</h3>
        </header>
        {reviewItems.length > 0 ? (
          <fieldset className="assistant-review-items">
            <legend>Was soll übernommen werden?</legend>
            {reviewItems.map((item) => (
              <label key={item.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(item.id)}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, item.id]
                        : current.filter((id) => id !== item.id),
                    )
                  }
                />
                <span>
                  <strong>{reviewKindLabel[item.kind]}</strong>
                  {item.label}
                </span>
              </label>
            ))}
          </fieldset>
        ) : (
          <p>{preview}</p>
        )}
        <footer>{source}</footer>
        <button
          className="primary"
          disabled={reviewItems.length > 0 && selected.length === 0}
          onClick={() => {
            void triggerAction(actionLabel, undefined, {
              type: "ClinicalIntent",
              params: { intentToken, kind, reviewedActionIds: selected },
            });
          }}
        >
          {actionLabel}
        </button>
      </article>
    );
  },
});

const TeamInboxCard = defineComponent({
  name: "TeamInboxCard",
  description: "Role-filtered clinical questions and mentions.",
  props: z
    .object({
      title: z.string().max(160),
      count: z.number().int().min(0).max(100),
      summary: z.string().max(1600),
      source: z.string().max(240),
      items: z
        .array(
          z
            .object({
              id: z.string(),
              patientId: z.string(),
              patientLabel: z.string(),
              recipientLabel: z.string(),
              request: z.string(),
              reason: z.string(),
              priority: z.enum(["routine", "elevated", "urgent"]),
              state: z.enum([
                "sent",
                "acknowledged",
                "answered",
                "closed",
                "escalated",
              ]),
              response: z.string(),
              canAcknowledge: z.boolean(),
              canAnswer: z.boolean(),
              canClose: z.boolean(),
            })
            .strict(),
        )
        .max(8),
    })
    .strict(),
  component: function TeamInboxComponent({
    props: { title, count, summary, source, items },
  }) {
    const triggerAction = useTriggerAction();
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const priorityLabel = {
      routine: "Normal",
      elevated: "Erhöht",
      urgent: "Dringend",
    } as const;
    const stateLabel = {
      sent: "Neu",
      acknowledged: "Übernommen",
      answered: "Beantwortet",
      closed: "Geschlossen",
      escalated: "Eskaliert",
    } as const;
    return (
      <article className="assistant-card team-inbox-card">
        <header>
          <span>@ Team · {count} offen</span>
          <h3>{title}</h3>
        </header>
        {items.length === 0 ? (
          <p>{summary}</p>
        ) : (
          <div className="team-thread-list">
            {items.map((item) => (
              <section className="team-thread" key={item.id}>
                <div className="team-thread-meta">
                  <strong>{item.patientLabel}</strong>
                  <span>@{item.recipientLabel}</span>
                  <span>
                    {priorityLabel[item.priority]} · {stateLabel[item.state]}
                  </span>
                </div>
                <strong>{item.request}</strong>
                <p>{item.reason}</p>
                {item.response && <blockquote>{item.response}</blockquote>}
                {item.canAnswer && (
                  <label>
                    <span className="sr-only">
                      Antwort für {item.patientLabel}
                    </span>
                    <textarea
                      rows={2}
                      value={answers[item.id] ?? ""}
                      placeholder="Kurze Antwort an das Team…"
                      onChange={(event) =>
                        setAnswers((current) => ({
                          ...current,
                          [item.id]: event.target.value,
                        }))
                      }
                    />
                  </label>
                )}
                <div className="team-thread-actions">
                  {item.canAcknowledge && (
                    <button
                      aria-label={`Teamfrage für ${item.patientLabel} übernehmen`}
                      onClick={() =>
                        void triggerAction("Übernehmen", undefined, {
                          type: "TransitionCommunication",
                          params: { id: item.id, transition: "acknowledge" },
                        })
                      }
                    >
                      Übernehmen
                    </button>
                  )}
                  {item.canAnswer && (
                    <button
                      className="primary"
                      aria-label={`Teamfrage für ${item.patientLabel} beantworten`}
                      disabled={(answers[item.id] ?? "").trim().length < 2}
                      onClick={() =>
                        void triggerAction("Antworten", undefined, {
                          type: "TransitionCommunication",
                          params: {
                            id: item.id,
                            transition: "answer",
                            response: answers[item.id]?.trim(),
                          },
                        })
                      }
                    >
                      Antworten
                    </button>
                  )}
                  {item.canClose && (
                    <button
                      aria-label={`Teamfrage für ${item.patientLabel} schliessen`}
                      onClick={() =>
                        void triggerAction("Schliessen", undefined, {
                          type: "TransitionCommunication",
                          params: { id: item.id, transition: "close" },
                        })
                      }
                    >
                      Schleife schliessen
                    </button>
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
        <footer>{source}</footer>
      </article>
    );
  },
});

const SyncSummaryCard = defineComponent({
  name: "SyncSummaryCard",
  description: "Provider delivery receipts and conflicts.",
  props: z
    .object({
      title: z.string().max(160),
      pending: z.number().int().min(0).max(1000),
      conflicts: z.number().int().min(0).max(1000),
      summary: z.string().max(1600),
      source: z.string().max(240),
    })
    .strict(),
  component: ({ props: { title, pending, conflicts, summary, source } }) => (
    <article
      className={`assistant-card sync-summary-card${conflicts ? " has-conflict" : ""}`}
    >
      <header>
        <span>
          {pending} ausstehend · {conflicts} Konflikte
        </span>
        <h3>{title}</h3>
      </header>
      <p>{summary}</p>
      <footer>{source}</footer>
    </article>
  ),
});

const ClinicalStack = defineComponent({
  name: "ClinicalStack",
  description: "Bounded vertical group of approved clinical components.",
  props: z
    .object({
      items: z
        .array(
          z.union([
            ClinicalCard.ref,
            VitalCard.ref,
            PatientPicker.ref,
            PatientContextCard.ref,
            TaskListCard.ref,
            VitalTrendCard.ref,
            HandoverDeltaCard.ref,
            TeamInboxCard.ref,
            SyncSummaryCard.ref,
            MedicationReadOnlyCard.ref,
            PolicyAnswerCard.ref,
            UnknownStateCard.ref,
            SafetyNotice.ref,
            DraftActionCard.ref,
          ]),
        )
        .max(12),
    })
    .strict(),
  component: ({ props: { items }, renderNode }) => (
    <div className="assistant-component-stack">
      {items.map((item, index) => (
        <div key={index}>{renderNode(item)}</div>
      ))}
    </div>
  ),
});

export const clinicalAssistantLibrary = createLibrary({
  components: [
    ClinicalStack,
    AssistantMessage,
    ClinicalCard,
    VitalCard,
    PatientPicker,
    PatientContextCard,
    TaskListCard,
    VitalTrendCard,
    HandoverDeltaCard,
    TeamInboxCard,
    SyncSummaryCard,
    MedicationReadOnlyCard,
    PolicyAnswerCard,
    UnknownStateCard,
    SafetyNotice,
    DraftActionCard,
  ],
  root: "ClinicalStack",
});
