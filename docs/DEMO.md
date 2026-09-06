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

1. Start as **Pflegeassistenz**. No patient is silently active. Ask for the handover or current work; patient-bound questions show an explicit picker.
2. Select **Anna Beispiel**. Verify the two identifiers, risks and simple sync status. Ask for latest vitals, open tasks and the medication-discrepancy policy; expand source evidence. Accept “Blutdruck kontrollieren”, start it and complete it with evidence directly in the stream.
3. As **Pflegefachperson**, enter: “Bin mit Anna fertig. Mobilisiert, Blutdruck 151 zu 88, etwas Schwindel. Arzt informieren und Kontrolle in 30 Minuten.” Review and select each of the four proposed actions, then confirm the exact selection. The note and `Observation` remain drafts for normal clinical approval; the explicitly selected team message and follow-up task enter their visible workflow states. Medication or dose instructions are intentionally refused by this free-text compiler.
4. Use the contextual **Dokumentieren**, **Vitalwert**, **Aufgabe** or **@ Team** chips to enter a deterministic form when speaking is inconvenient. The available actions are projected from the active role. The form remains an in-conversation sheet; it does not send the user to another module.
5. Ask “Zeige Team-Nachrichten” and address a question or comment to `@Arzt`/a named synthetic colleague. Switch roles to exercise acknowledgement, response, resulting task and closure without leaving the stream.
6. Ask for the handover, sign the afternoon delta as the outgoing nurse and acknowledge it as the incoming nurse in the rendered handover component.
7. As IT, ask for synchronization status. Inspect production integration gates, run delay/down/reject/conflict simulator cases, then return to an authorised clinician to compare versions and reconcile; no last-write-wins path exists.
8. Open Medplum only as the detailed operational workspace and inspect Patient, Encounter, Task, Observation, Communication, Provenance and AuditEvent resources.
9. Use browser offline mode. Pflegehelfer must display read-only state, discard unapproved intents and disable clinical mutations.

The microphone button is push-to-talk. `browser-demo` may use the browser/platform speech service and is allowed only for this fictional dataset; it does not receive trusted voice provenance. A configured `local-openai` ASR endpoint receives audio in memory, returns a one-use actor/patient/purpose/text-bound receipt and discards the raw audio. Every detected critical span must be checked separately before the transcript can be submitted.

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
pnpm pfhctl fhir import
pnpm pfhctl fhir verify
pnpm pfhctl fhir validate
```

If Medplum credentials are needed for the detailed UI, read the generated values locally from `.env.demo`. Never publish that file.
