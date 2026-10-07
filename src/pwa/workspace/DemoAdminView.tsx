import { useCallback, useEffect, useState } from "react";

type Inventory = {
  users: number;
  patients: number;
  assignedPatients: number;
  tasks: number;
  observations: number;
  notes: number;
  communications: number;
};

type DemoAdminState = {
  run: {
    runId: string;
    scenarioId: string;
    scenarioVersion: number;
    label: string;
    clock: { mode: "frozen" | "start-today"; anchor: string; timeZone: string };
    digest: string;
    inventory: Inventory;
    updatedAt: string;
  };
  runs: Array<{
    runId: string;
    label: string;
    active: boolean;
    stateDigest: string;
    updatedAt: string;
  }>;
};

async function adminRequest<T>(
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
  const body = (await response.json()) as T & { message?: string };
  if (!response.ok)
    throw new Error(
      body.message ?? `Aktion fehlgeschlagen (${response.status}).`,
    );
  return body;
}

export function DemoAdminView({
  userId,
  onError,
}: {
  userId: string;
  onError: (message: string | null) => void;
}) {
  const [state, setState] = useState<DemoAdminState | null>(null);
  const [busy, setBusy] = useState(false);
  const [newPatientId, setNewPatientId] = useState("p-klara");
  const [newPatientName, setNewPatientName] = useState("Klara Testfall");
  const [newRoom, setNewRoom] = useState("219");
  const [newMrn, setNewMrn] = useState("SH-260916-018");
  const [assignmentIds, setAssignmentIds] = useState("");
  const load = useCallback(async () => {
    setState(await adminRequest<DemoAdminState>("/api/v1/admin/demo", userId));
  }, [userId]);
  useEffect(() => {
    void load().catch((error: unknown) =>
      onError(
        error instanceof Error ? error.message : "Szenario nicht verfügbar.",
      ),
    );
  }, [load, onError]);

  const run = async (operation: () => Promise<unknown>, notice: string) => {
    setBusy(true);
    onError(null);
    try {
      await operation();
      await load();
      onError(notice);
    } catch (error) {
      onError(
        error instanceof Error ? error.message : "Aktion fehlgeschlagen.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!state)
    return (
      <section className="workspace-card">
        <p className="workspace-empty">Szenariolauf wird geprüft…</p>
      </section>
    );

  return (
    <section className="workspace-card demo-admin-workspace">
      <div className="workspace-card-heading">
        <div>
          <strong>Demo verwalten</strong>
          <small>
            Geschützte synthetische Szenarien; Änderungen werden als normale
            Medplum-/PostgreSQL-Daten materialisiert.
          </small>
        </div>
      </div>

      <div className="demo-run-card">
        <strong>{state.run.label}</strong>
        <small>
          Version {state.run.scenarioVersion} · Lauf {state.run.runId} ·{" "}
          {state.run.clock.mode === "frozen"
            ? "eingefrorene Zeit"
            : "heute gestartet"}
        </small>
        <code title={state.run.digest}>{state.run.digest.slice(0, 16)}…</code>
        <dl className="profile-facts">
          {Object.entries(state.run.inventory).map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="demo-admin-actions">
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void fetch("/api/v1/admin/demo/export", {
              headers: { "x-demo-user": userId },
            })
              .then(async (response) => {
                if (!response.ok) throw new Error("Export fehlgeschlagen.");
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = `pflegehelfer-${state.run.scenarioId}-${state.run.runId}.json`;
                link.click();
                URL.revokeObjectURL(url);
                onError("Szenarioexport wurde erstellt.");
              })
              .catch((error: unknown) =>
                onError(
                  error instanceof Error
                    ? error.message
                    : "Export fehlgeschlagen.",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          Aktuellen Lauf exportieren
        </button>
        <label className="secondary file-label">
          Export importieren
          <input
            type="file"
            accept="application/json,.json"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void run(async () => {
                const bundle = JSON.parse(await file.text()) as unknown;
                await adminRequest("/api/v1/admin/demo/import", userId, {
                  method: "POST",
                  body: JSON.stringify(bundle),
                });
              }, "Import als inaktiver, prüfbarer Lauf gespeichert.");
            }}
          />
        </label>
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            void run(
              () =>
                adminRequest("/api/v1/admin/demo/runs", userId, {
                  method: "POST",
                  body: JSON.stringify({
                    source: "current",
                    label: `${state.run.label} · sichere Arbeitskopie`,
                    clockMode: state.run.clock.mode,
                  }),
                }),
              "Arbeitskopie wurde inaktiv angelegt; der laufende Tag blieb unverändert.",
            )
          }
        >
          Aktuellen Stand klonen
        </button>
      </div>

      <details>
        <summary>Fiktive Patientin hinzufügen</summary>
        <form
          className="profile-edit demo-editor"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () =>
                adminRequest("/api/v1/admin/demo/patients", userId, {
                  method: "POST",
                  body: JSON.stringify({
                    id: newPatientId,
                    displayName: newPatientName,
                    birthDate: "1947-04-22",
                    mrn: newMrn,
                    room: newRoom,
                    encounterId: `enc-${newPatientId.slice(2)}-2026`,
                    allergyStatus: "unknown",
                    allergies: [],
                    risks: ["Sturzrisiko bei Müdigkeit"],
                    diagnoses: [
                      "Dekonditionierung nach längerer Hospitalisation",
                    ],
                    careGoals: ["Sicherer Transfer mit Rollator"],
                    medicationSummary: [
                      "Medikation im führenden KIS – nur lesbar",
                    ],
                    carePreferences: [
                      "Vor der Mobilisation den Tagesplan erklären",
                    ],
                    communicationPreferences: [
                      "Kurze, klare Schritte ankündigen",
                    ],
                    dailyRoutine: ["Ruhepause nach dem Mittagessen"],
                  }),
                }),
              "Fiktive Patientin wurde dauerhaft hinzugefügt.",
            );
          }}
        >
          <label>
            ID
            <input
              value={newPatientId}
              onChange={(event) => setNewPatientId(event.target.value)}
            />
          </label>
          <label>
            Name
            <input
              value={newPatientName}
              onChange={(event) => setNewPatientName(event.target.value)}
            />
          </label>
          <label>
            Fallnummer
            <input
              value={newMrn}
              onChange={(event) => setNewMrn(event.target.value)}
            />
          </label>
          <label>
            Zimmer
            <input
              value={newRoom}
              onChange={(event) => setNewRoom(event.target.value)}
            />
          </label>
          <button className="primary" disabled={busy}>
            Prüfen und hinzufügen
          </button>
        </form>
      </details>

      <details>
        <summary>Aufgabe und Zuweisung ergänzen</summary>
        <form
          className="profile-edit demo-editor"
          onSubmit={(event) => {
            event.preventDefault();
            const patientIds = assignmentIds
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean);
            void run(async () => {
              await adminRequest("/api/v1/admin/demo/task-assignment", userId, {
                method: "POST",
                body: JSON.stringify({
                  task: {
                    id: `t-mobilise-${newPatientId.slice(2)}`,
                    patientId: newPatientId,
                    title: "Morgenpflege und Mobilisation vorbereiten",
                    reason: "Synthetischer Rehabilitationsplan",
                    ownerRole: "care-assistant",
                    ownerId: "u-assistant",
                    priority: "routine",
                    escalation: "Bei Abweichung Pflegefachperson informieren",
                  },
                  dueOffsetMinutes: 165,
                  actorId: "u-assistant",
                  patientIds,
                }),
              });
            }, "Aufgabe und explizite AGS-Zuweisung wurden gespeichert.");
          }}
        >
          <label>
            Patient:innen-IDs für Lea (Komma getrennt)
            <textarea
              value={assignmentIds}
              placeholder="p-anna, p-luca, …, p-klara"
              onChange={(event) => setAssignmentIds(event.target.value)}
            />
          </label>
          <button className="primary" disabled={busy}>
            Aufgabe + Zuweisung speichern
          </button>
        </form>
      </details>

      <details>
        <summary>Fiktive Mitarbeitende hinzufügen</summary>
        <p>
          Die Rolle wählt nur ein bestehendes, zentral begrenztes Rechteprofil;
          Szenariodaten können keine zusätzlichen Berechtigungen erteilen.
        </p>
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            void run(
              () =>
                adminRequest("/api/v1/admin/demo/staff", userId, {
                  method: "POST",
                  body: JSON.stringify({
                    id: "u-fage-demo",
                    displayName: "Eliane Testperson",
                    role: "care-assistant",
                    patientIds: [newPatientId],
                    managedDevice: true,
                    professionalTitle:
                      "Fachfrau Gesundheit EFZ · synthetische Demo",
                    languages: ["Deutsch", "Französisch"],
                    responsibilities: [
                      "Zugewiesene Grundpflege",
                      "Beobachtungen weitergeben",
                    ],
                  }),
                }),
              "Fiktive Mitarbeitende wurde mit bestehendem Rechteprofil angelegt.",
            )
          }
        >
          Eliane Testperson anlegen
        </button>
      </details>

      <details>
        <summary>Kontrolliertes Ereignis</summary>
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            void run(
              () =>
                adminRequest("/api/v1/admin/demo/events/call-luca", userId, {
                  method: "POST",
                  body: "{}",
                }),
              "Synthetischer Ruf für Luca wurde ausgelöst.",
            )
          }
        >
          Ruf von Luca auslösen
        </button>
      </details>

      <section className="demo-run-list">
        <strong>Gespeicherte Läufe</strong>
        {state.runs.map((item) => (
          <div key={item.runId}>
            <span>{item.label}</span>
            <small>
              {item.active ? "Aktiv" : "Inaktiv"} · {item.runId}
            </small>
          </div>
        ))}
        <small>
          Ein inaktiver Lauf wird nicht still aktiviert. Vor einem Reset zeigt
          die API den exakten Quell-/Zieldigest; integrierte Aktivierung bleibt
          bis zum vollständigen Store-Restore gesperrt.
        </small>
      </section>
    </section>
  );
}
