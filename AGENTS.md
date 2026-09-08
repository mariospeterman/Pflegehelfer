# Pflegehelfer repository instructions

Read and follow [`agent.md`](agent.md), the active [`docs/PRODUCT_CONTRACT.md`](docs/PRODUCT_CONTRACT.md), the single canonical [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/PRODUCT_EXPERIENCE.md`](docs/PRODUCT_EXPERIENCE.md) and [`docs/WORKFLOWS.md`](docs/WORKFLOWS.md) before changing code.

Non-negotiable: one persistent role-aware GenUI/chat/voice clinical coworker. **Conversational outside, structured inside:** staff never sees proposal/schema terminology or a form wizard; the assistant responds naturally first and shows only the minimum useful review UI. Do not add workflow-owning dashboards, focus modes or mobile module tabs. Models may interpret/compose bounded presentation; deterministic server code alone validates, authorizes and executes. Preserve negation, uncertainty, historical/occurrence time, partial/deferred work, interruption and corrections; never infer an unstated clinical action, completion or billable activity.
