import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppSnapshot, Patient, Role } from "../core/types";
import {
  AssistantSurface,
  type AssistantHandoff,
  type ConversationOpening,
} from "./assistant/AssistantSurface";

const roleLabels: Record<Role, string> = {
  "care-assistant": "Pflegeassistenz",
  "registered-nurse": "Pflegefachperson",
  physician: "Ärztlicher Dienst",
  pharmacy: "Apotheke",
  physiotherapy: "Physiotherapie",
  "occupational-therapy": "Ergotherapie",
  transport: "Transport",
  service: "Service",
  administration: "Administration",
  management: "Management",
  hr: "HR",
  it: "IT",
  "quality-safety": "Qualität & Sicherheit",
};

const workflowOpenings: Partial<Record<Role, ConversationOpening>> = {
  "care-assistant": {
    eyebrow: "Dein Arbeitstag · Schritt 1 von 10",
    title: "Guten Morgen — beginnen wir mit der Übergabe.",
    summary:
      "Ich führe dich durch offene Aufgaben, bewusste Patientenkontexte, Dokumentation, Teamfragen und die nächste Übergabe. Nichts wird ohne deine Prüfung freigegeben.",
    progress: "Übergabe → Priorisieren → Patientenarbeit",
  },
  "registered-nurse": {
    eyebrow: "Dein Arbeitstag · Schritt 1 von 10",
    title: "Guten Morgen — die Schichtübergabe ist bereit.",
    summary:
      "Wir prüfen zuerst die Deltas und dringenden Punkte. Danach begleite ich dich patientenweise bis Dokumentation, Freigabe und Synchronisation abgeschlossen sind.",
    progress: "Übergabe → Priorisieren → Patientenarbeit",
  },
  physician: {
    eyebrow: "Ärztlicher Dienst · Visitenworkflow",
    title: "Guten Morgen — Fragen und Visitenpunkte sind gebündelt.",
    summary:
      "Öffne eine adressierte Frage oder wähle bewusst einen Patientenkontext. Quellen, Antworten und Folgeaufträge bleiben gemeinsam nachvollziehbar.",
    progress: "Anfragen → Evidenz → Entscheidung → Rückmeldung",
  },
};

const fallbackOpening: ConversationOpening = {
  eyebrow: "Rollenbezogener Arbeitskontext",
  title: "Willkommen bei Pflegehelfer.",
  summary:
    "Ich zeige nur Arbeit und Informationen, die für deine aktuelle Rolle und deinen Zweck freigegeben sind.",
  progress: "Orientierung → Arbeit → Abschluss",
};

async function api<T>(
  path: string,
  userId: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      "x-demo-user": userId,
      ...(init?.method === "POST"
        ? { "x-command-id": crypto.randomUUID() }
        : {}),
      ...init?.headers,
    },
  });
  const result = (await response.json()) as T & { message?: string };
  if (!response.ok) throw new Error(result.message ?? "Aktion fehlgeschlagen.");
  return result;
}

function formatBirthDate(value: string): string {
  return value.split("-").reverse().join(".");
}

function PatientSafetyBar({ patient }: { patient: Patient }) {
  const warnings = [...patient.allergies, ...patient.risks];
  return (
    <div className="patient-safety-bar" aria-label="Aktiver Patientenkontext">
      <span className="patient-room">{patient.room}</span>
      <span>
        <strong>{patient.displayName}</strong>
        <small>
          Geb. {formatBirthDate(patient.birthDate)} · Fall {patient.mrn}
        </small>
      </span>
      <span className="patient-warnings">
        {warnings.length
          ? warnings.join(" · ")
          : "Keine bekannten Warnhinweise"}
      </span>
    </div>
  );
}

function EdelweissMark() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className="brand-mark">
      <path d="M20 3c3 5 3 8 0 12-3-4-3-7 0-12Zm0 34c-3-5-3-8 0-12 3 4 3 7 0 12ZM3 20c5-3 8-3 12 0-4 3-7 3-12 0Zm34 0c-5 3-8 3-12 0 4-3 7-3 12 0ZM8 8c6 1 8 3 8 8-5 0-7-2-8-8Zm24 24c-6-1-8-3-8-8 5 0 7 2 8 8ZM32 8c-1 6-3 8-8 8 0-5 2-7 8-8ZM8 32c1-6 3-8 8-8 0 5-2 7-8 8Z" />
      <circle cx="20" cy="20" r="7" />
      <path className="brand-cross" d="M18 15h4v3h3v4h-3v3h-4v-3h-3v-4h3z" />
    </svg>
  );
}

function ContextPanel({
  snapshot,
  patient,
  onPatient,
  onPrompt,
  close,
}: {
  snapshot: AppSnapshot;
  patient: Patient | null;
  onPatient: (id: string | null) => void;
  onPrompt: (text: string) => void;
  close: () => void;
}) {
  const actions = [
    ["Heute", "Übergabe"],
    ["Offene Arbeit", "Was ist noch offen?"],
    ["Team & @Fragen", "Welche Teamfragen sind offen?"],
    ["Synchronisation", "Was wartet auf Synchronisation?"],
  ] as const;
  return (
    <aside className="context-panel" aria-label="Kontext und Verlauf">
      <div className="context-brand">
        <EdelweissMark />
        <span>
          <strong>Pflegehelfer</strong>
          <small>Tertianum Kronenhof · Demo</small>
        </span>
        <button
          className="drawer-close"
          aria-label="Menü schliessen"
          onClick={close}
        >
          ×
        </button>
      </div>
      <button
        className="new-context-button"
        onClick={() => {
          onPatient(null);
          onPrompt("Übergabe");
          close();
        }}
      >
        <span aria-hidden="true">＋</span> Aktuellen Arbeitstag öffnen
      </button>
      <nav className="context-actions" aria-label="Arbeitskontext">
        {actions.map(([label, prompt]) => (
          <button
            key={label}
            onClick={() => {
              onPrompt(prompt);
              close();
            }}
          >
            <span>{label}</span>
            <small>im Gespräch anzeigen</small>
          </button>
        ))}
      </nav>
      <section className="patient-context-list">
        <h2>Patientenkontext</h2>
        <p>Bewusst wählen — kein automatischer Wechsel.</p>
        {snapshot.patients.map((item) => (
          <button
            key={item.id}
            className={patient?.id === item.id ? "active" : ""}
            onClick={() => {
              onPatient(item.id);
              close();
            }}
          >
            <span className="room-dot">{item.room}</span>
            <span>
              <strong>{item.displayName}</strong>
              <small>Fall {item.mrn}</small>
            </span>
          </button>
        ))}
      </section>
      <footer className="context-footer">
        <strong>Synthetische Demonstration</strong>
        <span>Alle Personen und klinischen Daten sind frei erfunden.</span>
      </footer>
    </aside>
  );
}

function DraftHandoffSheet({
  handoff,
  patient,
  userId,
  users,
  close,
  done,
}: {
  handoff: AssistantHandoff;
  patient: Patient;
  userId: string;
  users: AppSnapshot["users"];
  close: () => void;
  done: (message: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recipient = users.find((candidate) => candidate.role === "physician");
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (handoff.kind === "communication")
        await api("/api/v1/communications", userId, {
          method: "POST",
          body: JSON.stringify({
            patientId: patient.id,
            request: handoff.title,
            reason: handoff.reason,
            recipientRole: handoff.recipientRole ?? "physician",
            recipientId: recipient?.id ?? null,
            priority: "routine",
            dueAt: handoff.dueAt,
          }),
        });
      else
        await api("/api/v1/tasks", userId, {
          method: "POST",
          body: JSON.stringify({
            patientId: patient.id,
            title: handoff.title,
            reason: handoff.reason,
            ownerRole: "registered-nurse",
            priority: "routine",
            dueAt: handoff.dueAt,
          }),
        });
      await done(
        handoff.kind === "communication"
          ? "Die geprüfte Teamfrage wurde gesendet."
          : "Die geprüfte Aufgabe wurde angelegt.",
      );
      close();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Aktion fehlgeschlagen.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="sheet-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <section
        className="action-sheet compact-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="draft-title"
      >
        <header>
          <div>
            <small>
              {patient.room} · {patient.displayName}
            </small>
            <h2 id="draft-title">
              {handoff.kind === "communication"
                ? "Teamfrage prüfen"
                : "Aufgabe prüfen"}
            </h2>
          </div>
          <button onClick={close} aria-label="Entwurf schliessen">
            ×
          </button>
        </header>
        <div className="draft-review-copy">
          <strong>{handoff.title}</strong>
          <p>{handoff.reason}</p>
          <small>
            Patient, Empfänger und Inhalt werden beim Senden serverseitig erneut
            geprüft.
          </small>
        </div>
        {error && (
          <div className="assistant-error" role="alert">
            {error}
          </div>
        )}
        <div className="sheet-actions">
          <button className="secondary" onClick={close}>
            Ändern / verwerfen
          </button>
          <button
            className="primary"
            disabled={busy || !navigator.onLine}
            onClick={() => void submit()}
          >
            {busy ? "Wird geprüft…" : "Jetzt freigeben"}
          </button>
        </div>
      </section>
    </div>
  );
}

export function App() {
  const [userId, setUserId] = useState(
    () => sessionStorage.getItem("pfh-demo-user") ?? "u-assistant",
  );
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(
    () => sessionStorage.getItem("pfh-patient-context"),
  );
  const [online, setOnline] = useState(navigator.onLine);
  const [apiReady, setApiReady] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [launchPrompt, setLaunchPrompt] = useState<{
    id: number;
    text: string;
  } | null>(null);
  const [handoff, setHandoff] = useState<AssistantHandoff | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const current = ++generation.current;
    try {
      const [data, session] = await Promise.all([
        api<AppSnapshot>("/api/v1/snapshot", userId),
        api<{ patientId: string | null }>("/api/v1/working-session", userId),
      ]);
      if (current !== generation.current) return;
      setSnapshot(data);
      setApiReady(true);
      setSelectedPatientId(
        session.patientId &&
          data.patients.some((item) => item.id === session.patientId)
          ? session.patientId
          : null,
      );
    } catch (failure) {
      if (current !== generation.current) return;
      setApiReady(false);
      setNotice(
        failure instanceof Error
          ? failure.message
          : "Verbindung fehlgeschlagen.",
      );
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let reconnect: number | null = null;
    let stopped = false;
    let lastEventId = 0;
    const connect = async () => {
      try {
        const response = await fetch("/api/v1/events", {
          headers: {
            "x-demo-user": userId,
            ...(lastEventId ? { "last-event-id": String(lastEventId) } : {}),
          },
          signal: controller.signal,
        });
        if (!response.ok || !response.body)
          throw new Error("events-unavailable");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!stopped) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const id = /^id:\s*(\d+)$/m.exec(frame)?.[1];
            if (id) lastEventId = Number(id);
            if (frame.includes("event: snapshot-invalidated")) void load();
          }
        }
      } catch (failure) {
        if (
          stopped ||
          (failure instanceof DOMException && failure.name === "AbortError")
        )
          return;
      }
      if (!stopped) reconnect = window.setTimeout(() => void connect(), 3000);
    };
    void connect();
    return () => {
      stopped = true;
      controller.abort();
      if (reconnect !== null) window.clearTimeout(reconnect);
    };
  }, [load, userId]);

  const patient = useMemo(
    () =>
      snapshot?.patients.find((item) => item.id === selectedPatientId) ?? null,
    [selectedPatientId, snapshot],
  );
  const revision = snapshot
    ? JSON.stringify({
        tasks: snapshot.tasks.map((item) => [
          item.id,
          item.state,
          item.source.version,
        ]),
        notes: snapshot.notes.map((item) => [
          item.id,
          item.status,
          item.version,
        ]),
        observations: snapshot.observations.map((item) => [
          item.id,
          item.status,
          item.version,
        ]),
        communications: snapshot.communications.map((item) => [
          item.id,
          item.state,
          item.source.version,
        ]),
        outbox: snapshot.outbox.map((item) => [
          item.id,
          item.state,
          item.attempts,
        ]),
      })
    : "loading";

  const choosePatient = async (id: string | null) => {
    await api("/api/v1/assistant/context", userId, {
      method: "POST",
      body: JSON.stringify({ patientId: id }),
    });
    setSelectedPatientId(id);
    if (id) sessionStorage.setItem("pfh-patient-context", id);
    else sessionStorage.removeItem("pfh-patient-context");
  };
  const prompt = (text: string) => setLaunchPrompt({ id: Date.now(), text });
  const changeUser = (next: string) => {
    generation.current += 1;
    sessionStorage.setItem("pfh-demo-user", next);
    sessionStorage.removeItem("pfh-patient-context");
    setSelectedPatientId(null);
    setSnapshot(null);
    setNotice(null);
    setUserId(next);
  };

  if (!snapshot)
    return (
      <main className="safe-loading" role={notice ? "alert" : "status"}>
        <EdelweissMark />
        <strong>
          {notice ? "Sicherer Fehlerzustand" : "Pflegehelfer verbindet…"}
        </strong>
        <p>{notice ?? "Tertianum Kronenhof · Demo"}</p>
        {notice && online && (
          <button className="primary" onClick={() => void load()}>
            Erneut verbinden
          </button>
        )}
      </main>
    );

  const connected = online && apiReady;
  const syncLabel = !connected
    ? "Offline"
    : snapshot.syncSummary.conflicts
      ? "Konflikt prüfen"
      : snapshot.syncSummary.unresolved
        ? `${snapshot.syncSummary.unresolved} ausstehend`
        : "Synchronisiert";
  const opening =
    workflowOpenings[snapshot.currentUser.role] ?? fallbackOpening;

  return (
    <div
      className={`clinical-coworker-shell${drawerOpen ? " drawer-open" : ""}`}
    >
      <button
        className="drawer-scrim"
        aria-label="Menü schliessen"
        onClick={() => setDrawerOpen(false)}
      />
      <ContextPanel
        snapshot={snapshot}
        patient={patient}
        onPatient={(id) => void choosePatient(id)}
        onPrompt={prompt}
        close={() => setDrawerOpen(false)}
      />
      <main className="coworker-main">
        <header className="coworker-header">
          <button
            className="menu-button"
            aria-label="Kontext und Verlauf öffnen"
            onClick={() => setDrawerOpen(true)}
          >
            ☰
          </button>
          <div className="header-identity">
            <strong>Pflegehelfer</strong>
            <span>Tertianum Kronenhof · Demo</span>
          </div>
          <div className="header-state">
            <span
              className={`connection-state ${connected ? "connected" : "offline"}`}
            >
              <i />
              {syncLabel}
            </span>
            {snapshot.workspaceLinks && patient && (
              <a
                href={snapshot.workspaceLinks.patients[patient.id]}
                target="_blank"
                rel="noreferrer"
              >
                FHIR-Detail
              </a>
            )}
            <label className="role-switcher">
              <span className="sr-only">Demo-Rolle</span>
              <select
                value={userId}
                onChange={(event) => changeUser(event.target.value)}
                disabled={assistantBusy}
              >
                {snapshot.users.map((user) => (
                  <option value={user.id} key={user.id}>
                    {user.displayName} · {roleLabels[user.role]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>
        {patient ? (
          <PatientSafetyBar patient={patient} />
        ) : (
          <div className="no-patient-context">
            <span>Kein Patient aktiv</span>
            <button onClick={() => setDrawerOpen(true)}>
              Patient bewusst wählen
            </button>
          </div>
        )}
        {notice && (
          <div className="global-notice" role="status">
            <span>{notice}</span>
            <button
              aria-label="Hinweis schliessen"
              onClick={() => setNotice(null)}
            >
              ×
            </button>
          </div>
        )}
        <AssistantSurface
          patient={patient}
          userId={userId}
          online={connected}
          onExecuted={async (message) => {
            await load();
            setNotice(message);
          }}
          onHandoff={setHandoff}
          snapshotRevision={revision}
          opening={opening}
          launchPrompt={launchPrompt}
          onSelectPatient={(id) => void choosePatient(id)}
          onBusyChange={setAssistantBusy}
        />
      </main>
      {handoff && patient && (
        <DraftHandoffSheet
          handoff={handoff}
          patient={patient}
          userId={userId}
          users={snapshot.users}
          close={() => setHandoff(null)}
          done={async (message) => {
            await load();
            setNotice(message);
          }}
        />
      )}
    </div>
  );
}
