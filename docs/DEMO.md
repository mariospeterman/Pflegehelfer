# Integrated synthetic showcase

## Start

```bash
pnpm install --frozen-lockfile
pnpm demo:env
pnpm dev:infra
pnpm dev
```

Wait until <http://127.0.0.1:3000/ready> reports `status: ready`, then open <http://127.0.0.1:5173>. Medplum is available at <http://127.0.0.1:3001>. All patients, staff, facilities, identifiers, policies and provider responses are fictional.

## Recommended walkthrough

1. Start as **Pflegeassistenz**. The conversation opens with the delta handover and current work. Accept “Blutdruck kontrollieren”, start it and complete it with evidence directly in the stream.
2. Select **Anna Beispiel**. Verify the two identifiers, risks and simple sync status. Ask for latest vitals, open tasks and the medication-discrepancy policy; expand source evidence.
3. As **Pflegefachperson**, enter: “Bin mit Anna fertig. Mobilisiert, Blutdruck 151 zu 88, etwas Schwindel. Arzt informieren und Kontrolle in 30 Minuten.” Review the generated four-part bundle once, then approve it. Confirm the documentation, `Observation`, team question and follow-up task all materialize in the stream.
4. Use the contextual **Dokumentieren**, **Vitalwert**, **Aufgabe** or **@ Team** chips to enter a deterministic form when speaking is inconvenient. The available actions are projected from the active role. The form remains an in-conversation sheet; it does not send the user to another module.
5. Open **Team**. Address a question or comment to `@Arzt`/a named synthetic colleague, then switch roles to exercise acknowledgement, response, resulting task and closure.
6. Sign the afternoon delta handover as the outgoing nurse and acknowledge it as the incoming nurse in **Meine Schicht**.
7. Switch to **IT → Synchronisation**. Inspect production integration gates, then run delay/down/reject/conflict simulator cases. Return to an authorised clinician to compare versions and reconcile; no last-write-wins path exists.
8. Open Medplum only as the detailed operational workspace and inspect Patient, Encounter, Task, Observation, Communication, Provenance and AuditEvent resources.
9. Use browser offline mode. Pflegehelfer must display read-only state, discard unapproved intents and disable clinical mutations.

The microphone button is push-to-talk. `browser-demo` may use the browser/platform speech service and is allowed only for this fictional dataset. A configured `local-openai` ASR endpoint receives audio in memory and returns a transcript; Pflegehelfer does not retain raw audio.

“Deterministic” means the model can interpret and draft, while normal tested
code owns permissions, patient/version checks, workflow transitions, approval,
audit and write-back. If the model is unavailable, the fixed actions and all
core workflows still work. The visible sync pill is a disclosure-safe aggregate;
detailed outbox content remains limited to authorised roles.

## Operational commands

```bash
PFH_BASE_URL=http://127.0.0.1:3000 pnpm pfhctl status
PFH_BASE_URL=http://127.0.0.1:3000 pnpm pfhctl provider list
PFH_BASE_URL=http://127.0.0.1:3000 pnpm pfhctl model list
PFH_BASE_URL=http://127.0.0.1:3000 pnpm pfhctl demo reset
```

If Medplum credentials are needed for the detailed UI, read the generated values locally from `.env.demo`. Never publish that file.
