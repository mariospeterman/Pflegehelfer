import {
  createLibrary,
  defineComponent,
  useTriggerAction,
} from "@openuidev/react-lang";
import { z } from "zod";

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
    })
    .strict(),
  component: function DraftActionCardComponent({
    props: { kind, title, preview, actionLabel, intentToken, source },
  }) {
    const triggerAction = useTriggerAction();
    return (
      <article className="assistant-card assistant-draft">
        <header>
          <span>Entwurf · nicht freigegeben</span>
          <h3>{title}</h3>
        </header>
        <p>{preview}</p>
        <footer>{source}</footer>
        <button
          className="primary"
          onClick={() => {
            void triggerAction(actionLabel, undefined, {
              type: "ClinicalIntent",
              params: { intentToken, kind },
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
    SafetyNotice,
    DraftActionCard,
  ],
  root: "ClinicalStack",
});
