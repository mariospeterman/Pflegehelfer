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
} as const;

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
  component: ({ props: { title, summary, source } }) => (
    <article className="assistant-card patient-context-card">
      <header>
        <span>Patientenkontext</span>
        <h3>{title}</h3>
      </header>
      <p>{summary}</p>
      <footer>{source}</footer>
    </article>
  ),
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
              id: z.string().regex(/^action-[1-6]$/),
              label: z.string().max(1400),
              kind: z.enum(["note", "observation", "communication", "task"]),
            })
            .strict(),
        )
        .max(6)
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
          <span>Entwurf · nicht freigegeben</span>
          <h3>{title}</h3>
        </header>
        {reviewItems.length > 0 ? (
          <fieldset className="assistant-review-items">
            <legend>Einzeln prüfen und auswählen</legend>
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
    ClinicalCard,
    VitalCard,
    PatientPicker,
    PatientContextCard,
    TaskListCard,
    VitalTrendCard,
    HandoverDeltaCard,
    MedicationReadOnlyCard,
    PolicyAnswerCard,
    UnknownStateCard,
    SafetyNotice,
    DraftActionCard,
  ],
  root: "ClinicalStack",
});
