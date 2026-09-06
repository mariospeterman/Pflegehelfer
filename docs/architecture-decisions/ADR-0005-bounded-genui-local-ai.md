# ADR-0005: Fixed clinical PWA with bounded OpenUI and separated local AI paths

- Status: Superseded in part by ADR-0006
- Date: 2026-09-05

## Context

A chat-only clinical product is unsafe and slow for routine work, while a static UI alone cannot provide the requested natural-language access. OpenUI and OpenAI-compatible local runtimes enable a useful composition layer but are not authorization or evidence authorities.

## Decision

Keep intake, tasks, documentation, communication, handover, rounds, signatures and reconciliation as deterministic workflows, but materialize them contextually in the primary conversation stream per ADR-0006. Use OpenUI Lang only to compose a strict registered catalog of read cards and draft actions. Common clinical intents route deterministically; an optional fast model handles ambiguous language. A separate deep model can summarize only retrieved, current, role-approved local knowledge and must return valid approved citation IDs or fall back to extractive evidence. Generated actions carry opaque one-use bound intents and can only enter typed workflows. Voice is explicit push-to-talk; browser speech is fictional-demo-only and production uses a validated local transcription endpoint.

## Consequences

- The app remains fully usable when every model is unavailable.
- No generated UI, model or transcript can directly mutate FHIR/provider data or supply final approval.
- Runtime labels disclose deterministic/local/hosted/degraded behavior.
- Production activation requires signed weights, prompt/model cards and Swiss clinical language/safety evaluation.
