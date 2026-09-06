import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type {
  AppSnapshot,
  ClinicalOutboxSummary,
  ClinicalTask,
  Communication,
  Observation,
  Patient,
  ProviderId,
  Role,
} from "../core/types";
import { decide, type Action } from "../core/policy";
import {
  AssistantSurface,
  type AssistantHandoff,
} from "./assistant/AssistantSurface";

type Focus = "shift" | "patient" | "team" | "sync";
type ActionKind = "note" | "vital" | "task" | "communication" | "round";

const actionPolicies: Record<ActionKind, Action> = {
  note: "note:draft",
  vital: "observation:draft",
  task: "task:create",
  communication: "communication:create",
  round: "round:decide",
};

const actionLabels: Record<ActionKind, string> = {
  note: "Notiz",
  vital: "Vital",
  task: "Aufgabe",
  communication: "@ Team",
  round: "Visite",
};

function allowedActionKinds(
  user: AppSnapshot["currentUser"],
  patient: Patient,
): ActionKind[] {
  return (Object.keys(actionPolicies) as ActionKind[]).filter(
    (kind) =>
      decide(user, actionPolicies[kind], user.defaultPurpose, patient).allow,
  );
}

function canPerform(
  user: AppSnapshot["currentUser"],
  patient: Patient,
  action: Action,
): boolean {
  return decide(user, action, user.defaultPurpose, patient).allow;
}

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

const focusLabels: Record<Focus, string> = {
  shift: "Meine Schicht",
  patient: "Patient",
  team: "Team",
  sync: "Synchronisation",
};

const statusLabels: Record<string, string> = {
  new: "Neu",
  accepted: "Angenommen",
  "in-progress": "In Arbeit",
  waiting: "Wartet",
  completed: "Erledigt",
  escalated: "Eskaliert",
  draft: "Entwurf",
  reviewed: "Geprüft",
  approved: "Freigegeben",
  sent: "Gesendet",
  signed: "Signiert",
  acknowledged: "Quittiert",
  answered: "Beantwortet",
  closed: "Geschlossen",
  "pending-provider": "Noch nicht synchronisiert",
  synced: "Synchronisiert",
  rejected: "Abgelehnt",
  conflict: "Konflikt",
  "manual-review": "Manuelle Prüfung",
  EXTERNAL_VENDOR_GATE: "Externer Vendor-Gate",
  SIMULATED: "Simulator",
  READY: "Bereit",
};

function isTargetedCommunication(
  message: Communication,
  user: AppSnapshot["currentUser"],
): boolean {
  const direct =
    message.recipientRole === user.role &&
    (!message.recipientId || message.recipientId === user.id);
  const escalatedPool =
    message.state === "escalated" &&
    message.escalationRecipientRole === user.role;
  return (
    ["sent", "escalated"].includes(message.state) && (direct || escalatedPool)
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("de-CH", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Zurich",
  }).format(new Date(value));
}

function toDateTimeLocal(value: string): string {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function PatientSafetyContext({
  patient,
  compact = false,
  warningsDisclosed = true,
}: {
  patient: Patient;
  compact?: boolean;
  warningsDisclosed?: boolean;
}) {
  const alerts = [...patient.allergies, ...patient.risks];
  return (
    <span
      className={`patient-safety-context${compact ? " compact" : ""}`}
      aria-label="Permanenter Patienten-Sicherheitskontext"
    >
      <strong>
        {patient.room} · {patient.displayName}
      </strong>
      <span>
        Geb. {patient.birthDate.split("-").reverse().join(".")} · Fall{" "}
        {patient.mrn}
      </span>
      <span className="patient-safety-alerts">
        {!warningsDisclosed
          ? "Klinische Warnhinweise in dieser Rolle nicht freigegeben"
          : alerts.length > 0
            ? alerts.join(" · ")
            : "Keine bekannten Warnhinweise"}
      </span>
    </span>
  );
}

async function api<T>(
  path: string,
  userId: string,
  init?: RequestInit,
): Promise<T> {
  const mutating = init?.method?.toUpperCase() === "POST";
  const commandId = mutating ? crypto.randomUUID() : null;
  const execute = () =>
    fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "x-demo-user": userId,
        ...(commandId ? { "x-command-id": commandId } : {}),
        ...init?.headers,
      },
    });
  let response: Response;
  try {
    response = await execute();
  } catch (error) {
    if (!mutating || !navigator.onLine) throw error;
    response = await execute();
  }
  const body = (await response.json()) as T & { message?: string };
  if (!response.ok) throw new Error(body.message ?? "Aktion fehlgeschlagen.");
  return body;
}

export function App() {
  const [userId, setUserId] = useState(
    () => sessionStorage.getItem("pfh-demo-user") ?? "u-assistant",
  );
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [focus, setFocus] = useState<Focus>("shift");
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(
    null,
  );
  const [action, setAction] = useState<ActionKind | null>(null);
  const [handoff, setHandoff] = useState<AssistantHandoff | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [apiReachable, setApiReachable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const loadGeneration = useRef(0);
  const activeUserId = useRef(userId);
  const activeRoleEpoch = useRef(0);
  const targetedMessageIds = useRef<Set<string> | null>(null);
  const [roleEpoch, setRoleEpoch] = useState(0);
  const safetyEditorReturnFocus = useRef<HTMLElement | null>(null);

  const openSafetyEditor = (
    next: ActionKind,
    targetPatientId = selectedPatientId,
  ) => {
    const targetPatient = snapshot?.patients.find(
      (candidate) => candidate.id === targetPatientId,
    );
    if (
      !snapshot ||
      !targetPatient ||
      !allowedActionKinds(snapshot.currentUser, targetPatient).includes(next)
    ) {
      setNotice({
        kind: "error",
        text: "Diese Aktion ist im aktuellen Rollen- und Patientenkontext nicht verfügbar.",
      });
      return;
    }
    safetyEditorReturnFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setAction(next);
  };

  const load = useCallback(async () => {
    const requestedUser = userId;
    const requestedEpoch = roleEpoch;
    if (
      activeUserId.current !== requestedUser ||
      activeRoleEpoch.current !== requestedEpoch
    )
      return;
    const generation = ++loadGeneration.current;
    try {
      const data = await api<AppSnapshot>("/api/v1/snapshot", requestedUser);
      if (
        generation !== loadGeneration.current ||
        activeUserId.current !== requestedUser ||
        activeRoleEpoch.current !== requestedEpoch
      )
        return;
      setApiReachable(true);
      const nextTargeted = new Set(
        data.communications
          .filter((message) =>
            isTargetedCommunication(message, data.currentUser),
          )
          .map((message) => message.id),
      );
      if (
        targetedMessageIds.current &&
        [...nextTargeted].some((id) => !targetedMessageIds.current?.has(id))
      )
        setNotice({
          kind: "success",
          text: "Neue adressierte Team-Anfrage. Öffne Team für den klinischen Kontext.",
        });
      targetedMessageIds.current = nextTargeted;
      setSnapshot(data);
      setSelectedPatientId((current) =>
        current && data.patients.some((patient) => patient.id === current)
          ? current
          : (data.patients[0]?.id ?? null),
      );
    } catch (failure) {
      if (generation !== loadGeneration.current) return;
      setApiReachable(false);
      setNotice({
        kind: "error",
        text:
          failure instanceof Error
            ? failure.message
            : "Daten konnten nicht geladen werden.",
      });
    }
  }, [roleEpoch, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (navigator.onLine && document.visibilityState === "visible")
        void load();
    }, 3_000);
    return () => window.clearInterval(timer);
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

  const run = async (work: () => Promise<unknown>, message: string) => {
    const actionUser = userId;
    const actionEpoch = roleEpoch;
    const current = () =>
      activeUserId.current === actionUser &&
      activeRoleEpoch.current === actionEpoch;
    if (!navigator.onLine) {
      setNotice({
        kind: "error",
        text: "Offline: Nichts wurde gespeichert. Nach Wiederverbindung bitte erneut freigeben.",
      });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await work();
      await load();
      if (current()) setNotice({ kind: "success", text: message });
    } catch (failure) {
      await load();
      if (current())
        setNotice({
          kind: "error",
          text:
            failure instanceof Error
              ? failure.message
              : "Aktion fehlgeschlagen.",
        });
    } finally {
      if (current()) setBusy(false);
    }
  };

  const changeUser = (next: string) => {
    activeRoleEpoch.current += 1;
    setRoleEpoch(activeRoleEpoch.current);
    activeUserId.current = next;
    loadGeneration.current += 1;
    targetedMessageIds.current = null;
    sessionStorage.setItem("pfh-demo-user", next);
    setSnapshot(null);
    setSelectedPatientId(null);
    setAction(null);
    setHandoff(null);
    setNotice(null);
    setBusy(false);
    setFocus("shift");
    setUserId(next);
  };

  if (!snapshot)
    return (
      <main className="safe-loading" role={notice ? "alert" : "status"}>
        <div className="brand-orb">P</div>
        <strong>
          {notice
            ? "Sicherer Offline-/Fehlerzustand"
            : "Pflegehelfer verbindet…"}
        </strong>
        {notice && (
          <p>{notice.text} Es werden keine klinischen Daten angezeigt.</p>
        )}
        {notice && online && (
          <button className="primary" onClick={() => void load()}>
            Erneut verbinden
          </button>
        )}
      </main>
    );

  const connected = online && apiReachable;
  const unresolvedSync = snapshot.syncSummary.unresolved;
  const syncConflict = snapshot.syncSummary.conflicts > 0;
  const syncLabel = !connected
    ? "Offline"
    : syncConflict
      ? "Sync prüfen"
      : unresolvedSync > 0
        ? `${unresolvedSync} ausstehend`
        : "Aktuell";
  const patient =
    snapshot.patients.find((item) => item.id === selectedPatientId) ?? null;
  const revision = JSON.stringify({
    tasks: snapshot.tasks.map(({ id, state, source }) => [
      id,
      state,
      source.version,
    ]),
    observations: snapshot.observations.map(({ id, status, version }) => [
      id,
      status,
      version,
    ]),
    notes: snapshot.notes.map(({ id, status, version }) => [
      id,
      status,
      version,
    ]),
    communications: snapshot.communications.map(({ id, state, source }) => [
      id,
      state,
      source.version,
    ]),
    handovers: snapshot.handovers.map(({ id, status }) => [id, status]),
    outbox: snapshot.outbox.map(({ id, state, attempts }) => [
      id,
      state,
      attempts,
    ]),
    syncSummary: snapshot.syncSummary,
  });

  const streamProjectionRegistry: Record<Focus, ReactNode> = {
    shift: (
      <ShiftStreamProjection
        snapshot={snapshot}
        userId={userId}
        busy={busy}
        online={connected}
        run={run}
        selectPatient={(id) => {
          setSelectedPatientId(id);
          setFocus("patient");
        }}
      />
    ),
    patient: patient ? (
      <PatientStreamProjection
        snapshot={snapshot}
        patient={patient}
        userId={userId}
        busy={busy}
        online={connected}
        run={run}
        openAction={openSafetyEditor}
      />
    ) : (
      <BoundaryStreamProjection snapshot={snapshot} />
    ),
    team: (
      <TeamStreamProjection
        snapshot={snapshot}
        patient={patient}
        userId={userId}
        busy={busy}
        online={connected}
        run={run}
        openComposer={() => openSafetyEditor("communication")}
      />
    ),
    sync: (
      <IntegrationStreamProjection
        snapshot={snapshot}
        userId={userId}
        busy={busy}
        online={connected}
        run={run}
      />
    ),
  };

  return (
    <div className="genui-app">
      <header className="compact-header">
        <div className="brand-lockup">
          <div className="brand-orb">P</div>
          <div>
            <strong>Pflegehelfer</strong>
            <span>Reha 2 · Demo</span>
          </div>
        </div>
        <div
          className={`sync-pill ${!connected ? "offline" : syncConflict ? "conflict" : unresolvedSync > 0 ? "pending" : "online"}`}
          role="status"
        >
          <i /> {syncLabel}
        </div>
        <label className="role-control">
          <span className="sr-only">Aktive Rolle</span>
          <select
            aria-label="Demo-Rolle wechseln"
            value={userId}
            onChange={(event) => changeUser(event.target.value)}
          >
            {snapshot.users.map((user) => (
              <option key={user.id} value={user.id}>
                {roleLabels[user.role]} · {user.displayName}
              </option>
            ))}
          </select>
        </label>
      </header>

      {notice && (
        <div
          className={`toast ${notice.kind}`}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          <span>{notice.text}</span>
          <button
            aria-label="Meldung schliessen"
            onClick={() => setNotice(null)}
          >
            ×
          </button>
        </div>
      )}

      <aside className="context-sidebar" aria-label="Arbeitskontext">
        <div className="shift-identity">
          <small>Angemeldet als</small>
          <strong>{snapshot.currentUser.displayName}</strong>
          <span>{roleLabels[snapshot.currentUser.role]}</span>
        </div>
        <nav aria-label="Gesprächskontext">
          {(Object.keys(focusLabels) as Focus[]).map((item) => (
            <button
              key={item}
              data-nav={
                item === "shift" ? "today" : item === "team" ? "inbox" : item
              }
              className={focus === item ? "active" : ""}
              aria-current={focus === item ? "page" : undefined}
              onClick={() => setFocus(item)}
            >
              <span aria-hidden="true">
                {item === "shift"
                  ? "✦"
                  : item === "patient"
                    ? "○"
                    : item === "team"
                      ? "@"
                      : "↻"}
              </span>
              {focusLabels[item]}
              {item === "team" &&
                snapshot.communications.some((message) =>
                  isTargetedCommunication(message, snapshot.currentUser),
                ) && (
                  <b>
                    {
                      snapshot.communications.filter((message) =>
                        isTargetedCommunication(message, snapshot.currentUser),
                      ).length
                    }
                  </b>
                )}
            </button>
          ))}
        </nav>
        {snapshot.patients.length > 0 && (
          <div className="patient-context-list">
            <small>Patientenkontext</small>
            {snapshot.patients.map((item) => (
              <button
                key={item.id}
                className={patient?.id === item.id ? "active" : ""}
                onClick={() => {
                  setSelectedPatientId(item.id);
                  setFocus("patient");
                }}
              >
                <span>{item.room}</span>
                <strong>{item.displayName}</strong>
              </button>
            ))}
            {patient && (
              <PatientSafetyContext
                patient={patient}
                warningsDisclosed={
                  snapshot.currentUser.role !== "administration"
                }
              />
            )}
          </div>
        )}
        {snapshot.workspaceLinks && (
          <a
            className="detail-link"
            href={snapshot.workspaceLinks.home}
            target="_blank"
            rel="noreferrer"
          >
            Medplum-Details ↗
          </a>
        )}
      </aside>

      <main id="conversation" className="conversation-main" tabIndex={-1}>
        <div
          className="mobile-context-tabs"
          role="navigation"
          aria-label="Gesprächskontext"
        >
          {(Object.keys(focusLabels) as Focus[]).map((item) => (
            <button
              key={item}
              data-nav={
                item === "shift" ? "today" : item === "team" ? "inbox" : item
              }
              className={focus === item ? "active" : ""}
              onClick={() => setFocus(item)}
            >
              {focusLabels[item]}
            </button>
          ))}
        </div>
        {snapshot.patients.length > 0 && (
          <label className="mobile-patient-select">
            <span>Aktueller Kontext</span>
            <select
              aria-label="Patient auswählen"
              value={patient?.id ?? ""}
              onChange={(event) => {
                setSelectedPatientId(event.target.value);
                setFocus("patient");
              }}
            >
              {snapshot.patients.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.room} · {item.displayName}
                </option>
              ))}
            </select>
            {patient && (
              <PatientSafetyContext
                patient={patient}
                compact
                warningsDisclosed={
                  snapshot.currentUser.role !== "administration"
                }
              />
            )}
          </label>
        )}
        <AssistantSurface
          key={`${userId}:${roleEpoch}:${focus}:${patient?.id ?? "no-patient"}`}
          patient={patient}
          userId={userId}
          online={connected}
          snapshotRevision={revision}
          contextProjection={streamProjectionRegistry[focus]}
          conversationId={`${userId}:${focus}:${patient?.id ?? "no-patient"}`}
          onHandoff={(next) => {
            setSelectedPatientId(next.patientId);
            setHandoff(next);
            openSafetyEditor(
              next.kind === "task" ? "task" : "communication",
              next.patientId,
            );
          }}
          onExecuted={async (message) => {
            await load();
            if (
              activeUserId.current === userId &&
              activeRoleEpoch.current === roleEpoch
            )
              setNotice({ kind: "success", text: message });
          }}
        />
      </main>

      {action && patient && (
        <DeterministicSafetyEditor
          kind={action}
          setKind={setAction}
          patient={patient}
          snapshot={snapshot}
          handoff={handoff}
          userId={userId}
          busy={busy}
          online={connected}
          run={run}
          returnFocus={safetyEditorReturnFocus.current}
          close={() => {
            setAction(null);
            setHandoff(null);
          }}
        />
      )}
    </div>
  );
}

function ShiftStreamProjection({
  snapshot,
  userId,
  busy,
  online,
  run,
  selectPatient,
}: {
  snapshot: AppSnapshot;
  userId: string;
  busy: boolean;
  online: boolean;
  run: Runner;
  selectPatient: (id: string) => void;
}) {
  const activeTasks = snapshot.tasks.filter(
    (task) => task.state !== "completed",
  );
  return (
    <>
      <section className="welcome-message">
        <div className="assistant-avatar" aria-hidden="true">
          P
        </div>
        <div>
          <p>Guten Morgen, {snapshot.currentUser.displayName.split(" ")[0]}.</p>
          <span>
            Hier ist dein aktueller, rollenbasierter Arbeitsstand. Du kannst
            jederzeit schreiben oder sprechen.
          </span>
        </div>
      </section>
      {snapshot.currentUser.role === "hr" && (
        <BoundaryCard
          title="Getrennte HR-Grenze"
          text="HR hat keinen Zugriff auf Patientenakten oder operative Pflegeaktivitäten."
        />
      )}
      {snapshot.currentUser.role === "management" && (
        <BoundaryCard
          title="Aggregierte Prozessansicht"
          text="Keine individuellen Patienten- oder Mitarbeitenden-Ranglisten. Klinische Einzelfälle bleiben ausgeblendet."
        />
      )}
      {snapshot.handovers.map((handover) => (
        <article className="stream-card handover-sheet" key={handover.id}>
          <header>
            <div>
              <small>
                Übergabe {handover.fromShift} → {handover.toShift}
              </small>
              <h2>{handover.narrative}</h2>
            </div>
            <Status value={handover.status} />
          </header>
          <div className="metric-row">
            <div>
              <b>{handover.deltaObservationIds.length}</b>
              <span>Änderungen</span>
            </div>
            <div>
              <b>{handover.deltaTaskIds.length}</b>
              <span>Aufgaben</span>
            </div>
            <div>
              <b>{handover.unresolvedCommunicationIds.length}</b>
              <span>wartet auf Team</span>
            </div>
          </div>
          <div className="button-row">
            {handover.status === "draft" &&
              snapshot.currentUser.role === "registered-nurse" && (
                <button
                  className="primary"
                  disabled={busy || !online}
                  onClick={() =>
                    void run(
                      () =>
                        api(`/api/v1/handovers/${handover.id}/sign`, userId, {
                          method: "POST",
                          body: "{}",
                        }),
                      "Übergabe signiert und bereitgestellt.",
                    )
                  }
                >
                  Übergabe signieren
                </button>
              )}
            {handover.status === "signed" &&
              handover.signedBy !== userId &&
              ["care-assistant", "registered-nurse"].includes(
                snapshot.currentUser.role,
              ) && (
                <button
                  className="primary"
                  disabled={busy || !online}
                  onClick={() =>
                    void run(
                      () =>
                        api(
                          `/api/v1/handovers/${handover.id}/acknowledge`,
                          userId,
                          { method: "POST", body: "{}" },
                        ),
                      "Übergabe übernommen; offene Arbeit bleibt sichtbar.",
                    )
                  }
                >
                  Übergabe übernehmen
                </button>
              )}
          </div>
        </article>
      ))}
      {activeTasks.length > 0 && (
        <section className="stream-group">
          <header>
            <div>
              <small>Meine Schicht</small>
              <h2>Was jetzt wichtig ist</h2>
            </div>
            <b>{activeTasks.length}</b>
          </header>
          {activeTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              snapshot={snapshot}
              userId={userId}
              busy={busy}
              online={online}
              run={run}
              selectPatient={selectPatient}
            />
          ))}
        </section>
      )}
      {activeTasks.length === 0 && snapshot.currentUser.role !== "hr" && (
        <BoundaryCard
          title="Schicht aktuell"
          text="Im freigegebenen Kontext sind keine offenen Aufgaben vorhanden."
        />
      )}
    </>
  );
}

function PatientStreamProjection({
  snapshot,
  patient,
  userId,
  busy,
  online,
  run,
  openAction,
}: {
  snapshot: AppSnapshot;
  patient: Patient;
  userId: string;
  busy: boolean;
  online: boolean;
  run: Runner;
  openAction: (kind: ActionKind) => void;
}) {
  const tasks = snapshot.tasks.filter(
    (item) => item.patientId === patient.id && item.state !== "completed",
  );
  const observations = snapshot.observations
    .filter((item) => item.patientId === patient.id)
    .toSorted((a, b) => b.effectiveAt.localeCompare(a.effectiveAt));
  const notes = snapshot.notes
    .filter((item) => item.patientId === patient.id)
    .toSorted((a, b) => b.source.recordedAt.localeCompare(a.source.recordedAt));
  const intake = snapshot.intake.filter(
    (item) => item.patientId === patient.id,
  );
  const conflicts = snapshot.outbox.filter(
    (item): item is ClinicalOutboxSummary =>
      "patientId" in item &&
      item.patientId === patient.id &&
      item.state === "conflict",
  );
  const allowedActions = allowedActionKinds(snapshot.currentUser, patient);
  const canApproveNote = canPerform(
    snapshot.currentUser,
    patient,
    "note:approve",
  );
  const canApproveObservation = canPerform(
    snapshot.currentUser,
    patient,
    "observation:approve",
  );
  return (
    <>
      <article className="patient-banner stream-card">
        <header>
          <div>
            <small>Zimmer {patient.room}</small>
            <h1>{patient.displayName}</h1>
            <p>
              Geb. {patient.birthDate.split("-").reverse().join(".")} · Fall{" "}
              {patient.mrn}
            </p>
          </div>
          <Status
            value={patient.source.syncedAt ? "synced" : "pending-provider"}
          />
        </header>
        <div className="risk-row">
          {patient.allergies.map((item) => (
            <span className="allergy" key={item}>
              {item}
            </span>
          ))}
          {patient.risks.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
        <footer>
          {patient.source.provider} · aktualisiert{" "}
          {formatTime(patient.source.effectiveAt)} · Version{" "}
          {patient.source.version}
        </footer>
      </article>
      <div className="in-chat-tabs" aria-label="Schnelle klinische Aktionen">
        {allowedActions.map((kind) => (
          <button key={kind} onClick={() => openAction(kind)}>
            {kind === "note"
              ? "Dokumentieren"
              : kind === "vital"
                ? "Vitalwert"
                : actionLabels[kind]}
          </button>
        ))}
      </div>
      <article className="stream-card patient-pulse">
        <header>
          <div>
            <small>Patientenprofil</small>
            <h2>Heute relevant</h2>
          </div>
          <span>{tasks.length} offen</span>
        </header>
        <p>
          <strong>Ziele:</strong>{" "}
          {patient.careGoals.join(" · ") || "keine erfasst"}
        </p>
        <p>
          <strong>Medikation (nur lesbar):</strong>{" "}
          {patient.medicationSummary.join(" · ") ||
            "keine freigegebenen Informationen"}
        </p>
      </article>
      {tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          snapshot={snapshot}
          userId={userId}
          busy={busy}
          online={online}
          run={run}
        />
      ))}
      {observations.length > 0 && (
        <section className="stream-group">
          <header>
            <div>
              <small>FHIR Observation</small>
              <h2>Vitalverlauf</h2>
            </div>
            {allowedActions.includes("vital") && (
              <button
                className="text-button"
                onClick={() => openAction("vital")}
              >
                + Erfassen
              </button>
            )}
          </header>
          <div className="vital-grid">
            {observations.map((item) => (
              <ObservationCard
                key={item.id}
                item={item}
                patient={patient}
                userId={userId}
                busy={busy}
                online={online}
                run={run}
                canApprove={canApproveObservation}
              />
            ))}
          </div>
        </section>
      )}
      {notes.length > 0 && (
        <section className="stream-group">
          <header>
            <div>
              <small>Pflegedokumentation</small>
              <h2>Dokumentierte Arbeit</h2>
            </div>
            {allowedActions.includes("note") && (
              <button
                className="text-button"
                onClick={() => openAction("note")}
              >
                + Notiz
              </button>
            )}
          </header>
          {notes.map((note) => (
            <article className="note" key={note.id}>
              <header>
                <Status value={note.status} />
                <small>
                  {note.provider} · v{note.version}
                </small>
              </header>
              <p>{note.structuredText}</p>
              {note.criticalEntities.length > 0 && (
                <div className="entity-row">
                  {note.criticalEntities.map((entity) => (
                    <span key={entity}>{entity}</span>
                  ))}
                </div>
              )}
              {canApproveNote &&
                ["draft", "reviewed"].includes(note.status) && (
                  <button
                    className="primary"
                    disabled={busy || !online}
                    onClick={() =>
                      approveRecord(
                        "note",
                        note.id,
                        note.version,
                        patient,
                        userId,
                        run,
                      )
                    }
                  >
                    Prüfen &amp; freigeben
                  </button>
                )}
            </article>
          ))}
        </section>
      )}
      {intake.some((item) =>
        ["missing", "discrepancy"].includes(item.state),
      ) && (
        <section className="stream-group">
          <header>
            <div>
              <small>Eintritt</small>
              <h2>Offene Klärungen</h2>
            </div>
          </header>
          {intake
            .filter((item) => ["missing", "discrepancy"].includes(item.state))
            .map((item) => (
              <article className="intake" key={item.id}>
                <strong>{item.label}</strong>
                <p>{item.detail}</p>
                <small>{item.sourceLabels.join(" · ")}</small>
                <button
                  className="secondary"
                  disabled={busy || !online}
                  onClick={() => {
                    const detail = window.prompt(
                      "Wie wurde dieser Punkt in den autoritativen Quellen geklärt?",
                    );
                    if (detail)
                      void run(
                        () =>
                          api(`/api/v1/intake/${item.id}/review`, userId, {
                            method: "POST",
                            body: JSON.stringify({ detail }),
                          }),
                        "Eintrittspunkt nachvollziehbar geklärt.",
                      );
                  }}
                >
                  Klärung dokumentieren
                </button>
              </article>
            ))}
        </section>
      )}
      {conflicts.map((item) => (
        <article className="stream-card reconciliation" key={item.id}>
          <header>
            <div>
              <small>Synchronisationskonflikt</small>
              <h2>Provider-Konflikt abgleichen</h2>
            </div>
            <Status value={item.state} />
          </header>
          <p className="local-summary">{item.localSummary}</p>
          <p>{item.conflictSnapshot?.summary}</p>
          <button
            className="primary"
            disabled={busy || !online}
            onClick={() =>
              void run(
                () =>
                  api(`/api/v1/outbox/${item.id}/reconcile`, userId, {
                    method: "POST",
                    body: JSON.stringify({
                      confirmedVersionComparison: true,
                      expectedLocalVersion: item.localVersion,
                      expectedLocalHash: item.localHash,
                      expectedProviderVersion: item.providerVersion,
                      expectedProviderHash: item.providerHash,
                    }),
                  }),
                "Inhalts- und Versionsvergleich bestätigt; lokaler Stand neu eingereiht.",
              )
            }
          >
            Beide Inhalte geprüft · lokalen Stand neu senden
          </button>
        </article>
      ))}
      {snapshot.roundActions
        .filter((item) => item.patientId === patient.id)
        .map((item) => (
          <article className="stream-card" key={item.id}>
            <header>
              <div>
                <small>Visitenbeschluss</small>
                <h2>{item.decision}</h2>
              </div>
              <Status value={item.status} />
            </header>
            <p>
              {roleLabels[item.ownerRole]} · bis {formatTime(item.deadline)} ·{" "}
              {item.requiredConfirmation}
            </p>
          </article>
        ))}
    </>
  );
}

type Runner = (work: () => Promise<unknown>, message: string) => Promise<void>;

function TaskCard({
  task,
  snapshot,
  userId,
  busy,
  online,
  run,
  selectPatient,
}: {
  task: ClinicalTask;
  snapshot: AppSnapshot;
  userId: string;
  busy: boolean;
  online: boolean;
  run: Runner;
  selectPatient?: (id: string) => void;
}) {
  return (
    <article className={`task-card priority-${task.priority}`}>
      <div className="task-time">{formatTime(task.dueAt)}</div>
      <div className="task-copy">
        {task.patientId && selectPatient && (
          <button
            className="context-link"
            onClick={() => selectPatient(task.patientId!)}
          >
            {snapshot.patients.find((item) => item.id === task.patientId)
              ?.displayName ?? "Patientenkontext"}
          </button>
        )}
        <strong>{task.title}</strong>
        <p>{task.reason}</p>
        {task.source.provider === "nurse-call" && (
          <div className="alarm-provenance">
            <strong>Sekundärer Spiegel</strong>
            <span>Primäre Rufanlage bleibt autoritativ</span>
            <span>
              Eskalation {formatTime(task.dueAt)} · {task.escalation}
            </span>
            <span>
              Lokaler Abschluss dokumentiert Arbeit, quittiert aber nicht die
              primäre Anlage.
            </span>
          </div>
        )}
        <div>
          <Status value={task.state} />
          <span>{roleLabels[task.ownerRole]}</span>
        </div>
      </div>
      <div className="task-actions">
        {["new", "escalated"].includes(task.state) &&
          task.ownerRole === snapshot.currentUser.role && (
            <button
              className="primary"
              disabled={busy || !online}
              onClick={() =>
                void run(
                  () =>
                    api(`/api/v1/tasks/${task.id}/accept`, userId, {
                      method: "POST",
                      body: "{}",
                    }),
                  "Aufgabe angenommen.",
                )
              }
            >
              Annehmen
            </button>
          )}
        {task.state === "accepted" && task.ownerId === userId && (
          <button
            className="primary"
            disabled={busy || !online}
            onClick={() =>
              void run(
                () =>
                  api(`/api/v1/tasks/${task.id}/start`, userId, {
                    method: "POST",
                    body: "{}",
                  }),
                "Aufgabe gestartet.",
              )
            }
          >
            Starten
          </button>
        )}
        {task.state === "in-progress" && task.ownerId === userId && (
          <button
            className="primary"
            disabled={busy || !online}
            onClick={() => {
              const evidence = window.prompt("Was wurde gemacht / beobachtet?");
              if (evidence)
                void run(
                  () =>
                    api(`/api/v1/tasks/${task.id}/complete`, userId, {
                      method: "POST",
                      body: JSON.stringify({ evidence }),
                    }),
                  "Aufgabe mit Nachweis abgeschlossen.",
                );
            }}
          >
            Abschliessen
          </button>
        )}
        {["registered-nurse", "physician"].includes(
          snapshot.currentUser.role,
        ) &&
          (!task.ownerId || task.ownerId === userId) &&
          task.state !== "completed" && (
            <select
              aria-label={`${task.title} delegieren`}
              defaultValue=""
              disabled={busy || !online}
              onChange={(event) => {
                if (event.target.value)
                  void run(
                    () =>
                      api(`/api/v1/tasks/${task.id}/delegate`, userId, {
                        method: "POST",
                        body: JSON.stringify({
                          delegateRole: event.target.value,
                        }),
                      }),
                    "Aufgabe delegiert.",
                  );
              }}
            >
              <option value="">Delegieren…</option>
              {(
                [
                  "care-assistant",
                  "registered-nurse",
                  "physician",
                  "pharmacy",
                  "physiotherapy",
                  "occupational-therapy",
                ] as Role[]
              ).map((role) => (
                <option value={role} key={role}>
                  {roleLabels[role]}
                </option>
              ))}
            </select>
          )}
      </div>
    </article>
  );
}

function ObservationCard({
  item,
  patient,
  userId,
  busy,
  online,
  run,
  canApprove,
}: {
  item: Observation;
  patient: Patient;
  userId: string;
  busy: boolean;
  online: boolean;
  run: Runner;
  canApprove: boolean;
}) {
  return (
    <article className="vital">
      <header>
        <span>{item.label}</span>
        <Status value={item.status} />
      </header>
      <strong>
        {item.value}
        {item.secondaryValue === null ? "" : `/${item.secondaryValue}`}{" "}
        <small>{item.unit}</small>
      </strong>
      <footer>
        {formatTime(item.effectiveAt)} · {item.source.provider}
      </footer>
      {canApprove && ["draft", "reviewed"].includes(item.status) && (
        <button
          className="primary"
          disabled={busy || !online}
          onClick={() =>
            approveRecord(
              "observation",
              item.id,
              item.version,
              patient,
              userId,
              run,
            )
          }
        >
          Prüfen &amp; freigeben
        </button>
      )}
    </article>
  );
}

function approveRecord(
  type: "note" | "observation",
  id: string,
  version: number,
  patient: Patient,
  userId: string,
  run: Runner,
) {
  if (
    !window.confirm(
      `${patient.displayName}, geb. ${patient.birthDate.split("-").reverse().join(".")}, Fall ${patient.mrn}: sichtbare Änderung geprüft und freigeben?`,
    )
  )
    return;
  void run(
    () =>
      api(`/api/v1/${type}/${id}/approve`, userId, {
        method: "POST",
        body: JSON.stringify({
          expectedVersion: version,
          patientMrn: patient.mrn,
          patientBirthDate: patient.birthDate,
          reviewedDiff: true,
        }),
      }),
    "Freigabe erfasst; Provider-Status bleibt bis zur Quittung sichtbar.",
  );
}

function TeamStreamProjection({
  snapshot,
  patient,
  userId,
  busy,
  online,
  run,
  openComposer,
}: {
  snapshot: AppSnapshot;
  patient: Patient | null;
  userId: string;
  busy: boolean;
  online: boolean;
  run: Runner;
  openComposer: () => void;
}) {
  const [replies, setReplies] = useState<Record<string, string>>({});
  return (
    <>
      <section className="welcome-message">
        <div className="assistant-avatar" aria-hidden="true">
          @
        </div>
        <div>
          <p>Teamkommunikation</p>
          <span>
            Transparent im berechtigten Behandlungsteam, patientengebunden,
            quittierbar und mit Frist.
          </span>
        </div>
      </section>
      {patient &&
        canPerform(snapshot.currentUser, patient, "communication:create") && (
          <button className="new-thread" onClick={openComposer}>
            + Frage, Kommentar oder @Erwähnung
          </button>
        )}
      <div className="team-thread">
        {snapshot.communications.map((item) => (
          <CommunicationCard
            key={item.id}
            item={item}
            snapshot={snapshot}
            userId={userId}
            busy={busy}
            online={online}
            run={run}
            reply={replies[item.id] ?? ""}
            setReply={(value) =>
              setReplies((current) => ({ ...current, [item.id]: value }))
            }
          />
        ))}
      </div>
      {snapshot.communications.length === 0 && (
        <BoundaryCard
          title="Keine offenen Threads"
          text="Schreibe zum Beispiel: „Frag den Arzt wegen Annas Blutdruck, heute noch.“"
        />
      )}
    </>
  );
}

function CommunicationCard({
  item,
  snapshot,
  userId,
  busy,
  online,
  run,
  reply,
  setReply,
}: {
  item: Communication;
  snapshot: AppSnapshot;
  userId: string;
  busy: boolean;
  online: boolean;
  run: Runner;
  reply: string;
  setReply: (value: string) => void;
}) {
  const canRespond =
    (item.recipientRole === snapshot.currentUser.role &&
      (!item.recipientId || item.recipientId === snapshot.currentUser.id)) ||
    (item.escalatedAt !== null &&
      item.escalationRecipientRole === snapshot.currentUser.role);
  const canClose = item.senderId === userId;
  const sender = snapshot.users.find((user) => user.id === item.senderId);
  const recipient = item.recipientId
    ? snapshot.users.find((user) => user.id === item.recipientId)
    : null;
  const patient = snapshot.patients.find(
    (candidate) => candidate.id === item.patientId,
  );
  return (
    <article className="message">
      <header>
        <div className="mention">
          @{recipient?.displayName ?? roleLabels[item.recipientRole]}
        </div>
        <Status value={item.state} />
        <time>{formatTime(item.dueAt)}</time>
      </header>
      <h2>{item.request}</h2>
      <p>{item.reason}</p>
      {item.state === "escalated" && item.escalationRecipientRole && (
        <p className="message-escalation">
          Überfällig · jetzt an @{roleLabels[item.escalationRecipientRole]}
          -Bereitschaft eskaliert. Ursprüngliche Adressierung bleibt im Verlauf.
        </p>
      )}
      <small>
        {sender?.displayName ?? "Team"} ·{" "}
        {patient
          ? `${patient.room} · ${patient.displayName}`
          : "Patientengebunden"}
      </small>
      {item.response && (
        <blockquote>
          <strong>Antwort</strong>
          {item.response}
        </blockquote>
      )}
      <footer>
        {["sent", "escalated"].includes(item.state) &&
          !item.acknowledgedBy &&
          canRespond && (
            <button
              className="secondary"
              disabled={busy || !online}
              onClick={() =>
                void run(
                  () =>
                    api(
                      `/api/v1/communications/${item.id}/acknowledge`,
                      userId,
                      {
                        method: "POST",
                        body: "{}",
                      },
                    ),
                  "Anfrage quittiert.",
                )
              }
            >
              Quittieren
            </button>
          )}
        {["sent", "acknowledged", "escalated"].includes(item.state) &&
          canRespond && (
            <>
              <input
                aria-label="Antwort"
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                placeholder="Antwort oder Kommentar…"
              />
              <button
                className="primary"
                disabled={busy || !online || !reply.trim()}
                onClick={() =>
                  void run(
                    () =>
                      api(`/api/v1/communications/${item.id}/answer`, userId, {
                        method: "POST",
                        body: JSON.stringify({
                          response: reply,
                          createTask: true,
                        }),
                      }),
                    "Antwort gesendet und Folgeauftrag erstellt.",
                  )
                }
              >
                Antworten
              </button>
            </>
          )}
        {item.state === "answered" && canClose && (
          <button
            className="primary"
            disabled={busy || !online}
            onClick={() =>
              void run(
                () =>
                  api(`/api/v1/communications/${item.id}/close`, userId, {
                    method: "POST",
                    body: "{}",
                  }),
                "Kommunikationsschleife geschlossen.",
              )
            }
          >
            Schliessen
          </button>
        )}
      </footer>
    </article>
  );
}

function IntegrationStreamProjection({
  snapshot,
  userId,
  busy,
  online,
  run,
}: {
  snapshot: AppSnapshot;
  userId: string;
  busy: boolean;
  online: boolean;
  run: Runner;
}) {
  const [profiles, setProfiles] = useState<
    Array<{
      provider: ProviderId;
      displayName: string;
      adapterVersion: string;
      operationalStatus: string;
      gates: Array<{ capability: string; missingArtifacts: string[] }>;
    }>
  >([]);
  useEffect(() => {
    if (snapshot.currentUser.role !== "it") return;
    const controller = new AbortController();
    void fetch("/api/v1/providers/registry?profile=production", {
      headers: { "x-demo-user": userId },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("provider-registry-unavailable");
        return (await response.json()) as { providers: typeof profiles };
      })
      .then((result) => setProfiles(result.providers))
      .catch(() => setProfiles([]));
    return () => controller.abort();
  }, [snapshot.currentUser.role, userId]);
  if (snapshot.currentUser.role !== "it")
    return (
      <>
        <section className="welcome-message">
          <div className="assistant-avatar" aria-hidden="true">
            ↻
          </div>
          <div>
            <p>Synchronisationsstatus</p>
            <span>
              Patientennahe Zustände erscheinen direkt bei Dokumentation und
              Messwerten.
            </span>
          </div>
        </section>
        <article className="stream-card">
          <header>
            <div>
              <small>Provider Hub</small>
              <h2>
                {
                  snapshot.outbox.filter(
                    (item) => item.state !== "acknowledged",
                  ).length
                }{" "}
                noch nicht bestätigt
              </h2>
            </div>
            <Status
              value={
                snapshot.outbox.some((item) => item.state === "conflict")
                  ? "conflict"
                  : "synced"
              }
            />
          </header>
          <p>
            Technische Konfiguration und Simulatoren sind nur für IT sichtbar.
          </p>
        </article>
      </>
    );
  const providers: ProviderId[] = [
    "wicare",
    "carecoach",
    "sap-vitals",
    "device-gateway",
    "nurse-call",
  ];
  return (
    <>
      <section className="welcome-message">
        <div className="assistant-avatar" aria-hidden="true">
          ↻
        </div>
        <div>
          <p>Provider-Verbindungen &amp; Simulatoren</p>
          <span>
            Die Schalter prüfen Adapter, Retry und Konflikte. Sie behaupten
            keine undokumentierten Vendor-APIs.
          </span>
        </div>
      </section>
      <button
        className="new-thread"
        disabled={busy || !online}
        onClick={() =>
          void run(
            () =>
              api("/api/v1/outbox/process", userId, {
                method: "POST",
                body: "{}",
              }),
            "Outbox verarbeitet; Zustände wurden abgeglichen.",
          )
        }
      >
        Outbox verarbeiten
      </button>
      {providers.map((provider) => {
        const health = snapshot.providerHealth.find(
          (item) => item.provider === provider,
        );
        return (
          <article className="provider-row" key={provider}>
            <div>
              <strong>{provider}</strong>
              <small>
                {health?.message ?? "nicht geprüft"} ·{" "}
                {
                  snapshot.outbox.filter(
                    (item) =>
                      item.provider === provider &&
                      item.state !== "acknowledged",
                  ).length
                }{" "}
                wartend
              </small>
            </div>
            <select
              aria-label={`${provider} Simulationsmodus`}
              defaultValue="normal"
              disabled={busy || !online}
              onChange={(event) =>
                void run(
                  () =>
                    api(
                      `/api/v1/simulators/providers/${provider}/${event.target.value}`,
                      userId,
                      { method: "POST", body: "{}" },
                    ),
                  `${provider}: Simulationsmodus gesetzt.`,
                )
              }
            >
              <option value="normal">Normal</option>
              <option value="delay">Verzögert</option>
              <option value="reject">Ablehnung</option>
              <option value="down">Ausfall</option>
              <option value="conflict">Konflikt</option>
            </select>
          </article>
        );
      })}
      <button
        className="secondary"
        disabled={busy || !online}
        onClick={() =>
          void run(
            () =>
              api("/api/v1/simulators/nurse-call", userId, {
                method: "POST",
                body: JSON.stringify({ patientId: "p-anna" }),
              }),
            "Gespiegeltes Rufereignis als Alarmaufgabe erstellt; die primäre Rufanlage bleibt autoritativ.",
          )
        }
      >
        Nurse-call Ereignis spiegeln
      </button>
      <button
        className="secondary"
        disabled={busy || !online}
        onClick={() =>
          void run(
            () =>
              api("/api/v1/simulators/nurse-call/escalations/run", userId, {
                method: "POST",
                body: JSON.stringify({ advanceMinutes: 3 }),
              }),
            "Überfällige Rufereignisse wurden deterministisch eskaliert; die primäre Rufanlage bleibt autoritativ.",
          )
        }
      >
        Ruf-Eskalation +3 Min simulieren
      </button>
      <button
        className="secondary"
        disabled={busy || !online}
        onClick={() =>
          void run(
            () =>
              api("/api/v1/simulators/communications/escalations/run", userId, {
                method: "POST",
                body: JSON.stringify({ advanceMinutes: 24 * 60 }),
              }),
            "Überfällige Team-Anfragen wurden deterministisch eskaliert.",
          )
        }
      >
        Teamfristen +24 Std simulieren
      </button>
      <section className="gate-list">
        {profiles.map((profile) => (
          <details key={profile.provider}>
            <summary>
              <span>
                <strong>{profile.displayName}</strong>
                <small>{profile.adapterVersion}</small>
              </span>
              <Status value={profile.operationalStatus} />
            </summary>
            {profile.gates.map((gate) => (
              <p key={gate.capability}>
                <strong>{gate.capability}</strong>
                <br />
                {gate.missingArtifacts.join(" · ")}
              </p>
            ))}
          </details>
        ))}
      </section>
    </>
  );
}

function DeterministicSafetyEditor({
  kind,
  setKind,
  patient,
  snapshot,
  handoff,
  userId,
  busy,
  online,
  run,
  close,
  returnFocus,
}: {
  kind: ActionKind;
  setKind: (kind: ActionKind) => void;
  patient: Patient;
  snapshot: AppSnapshot;
  handoff: AssistantHandoff | null;
  userId: string;
  busy: boolean;
  online: boolean;
  run: Runner;
  close: () => void;
  returnFocus: HTMLElement | null;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const allowedActions = allowedActionKinds(snapshot.currentUser, patient);
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  }, [close]);
  useEffect(() => {
    const previousFocus =
      returnFocus ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    const dialog = dialogRef.current;
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    requestAnimationFrame(() => (focusable()[0] ?? dialog)?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      const first = items[0]!;
      const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [returnFocus]);
  useEffect(() => {
    if (!allowedActions.includes(kind)) closeRef.current();
  }, [allowedActions, kind]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const value = (name: string) => {
      const field = data.get(name);
      return typeof field === "string" ? field : "";
    };
    let work: () => Promise<unknown>;
    let message: string;
    if (kind === "note") {
      work = () =>
        api("/api/v1/notes/drafts", userId, {
          method: "POST",
          body: JSON.stringify({
            patientId: patient.id,
            transcript: value("text"),
            structuredText: value("text"),
          }),
        });
      message = "Dokumentation als prüfpflichtiger Entwurf erstellt.";
    } else if (kind === "vital") {
      const code = value("code");
      work = () =>
        api("/api/v1/observations/drafts", userId, {
          method: "POST",
          body: JSON.stringify({
            patientId: patient.id,
            code,
            value: Number(value("value")),
            secondaryValue:
              code === "blood-pressure"
                ? Number(value("secondaryValue"))
                : null,
            effectiveAt: new Date().toISOString(),
          }),
        });
      message = "Messwert als prüfpflichtiger Entwurf erstellt.";
    } else if (kind === "task") {
      work = () =>
        api("/api/v1/tasks", userId, {
          method: "POST",
          body: JSON.stringify({
            patientId: patient.id,
            title: value("title"),
            reason: value("reason"),
            ownerRole: value("ownerRole"),
            priority: value("priority"),
            dueAt: new Date(value("dueAt")).toISOString(),
          }),
        });
      message = "Spontane Aufgabe mit eindeutiger Verantwortung erstellt.";
    } else if (kind === "communication") {
      const recipient = snapshot.users.find(
        (item) => item.id === value("recipient"),
      );
      work = () =>
        api("/api/v1/communications", userId, {
          method: "POST",
          body: JSON.stringify({
            patientId: patient.id,
            request: value("request"),
            reason: value("reason"),
            recipientRole: recipient?.role ?? "registered-nurse",
            recipientId: recipient?.id ?? null,
            priority: value("priority"),
            dueAt: new Date(value("dueAt")).toISOString(),
          }),
        });
      message =
        "Teamfrage gesendet; Quittierung, Antwort und Folgearbeit bleiben sichtbar.";
    } else {
      work = () =>
        api("/api/v1/round-actions", userId, {
          method: "POST",
          body: JSON.stringify({
            patientId: patient.id,
            actionKind: value("actionKind"),
            ownerRole: value("ownerRole"),
            deadline: new Date(value("dueAt")).toISOString(),
            targetSystem: "pflegehelfer",
          }),
        });
      message = "Visitenbeschluss freigegeben und als Aufgabe nachverfolgt.";
    }
    void run(async () => {
      await work();
      close();
    }, message);
  };
  const clinicalRecipients = snapshot.users.filter((user) =>
    [
      "registered-nurse",
      "physician",
      "pharmacy",
      "physiotherapy",
      "occupational-therapy",
    ].includes(user.role),
  );
  const [defaultDue] = useState(() =>
    new Date(Date.now() + 60 * 60_000).toISOString(),
  );
  const due = handoff?.dueAt ?? defaultDue;
  return (
    <div
      className="sheet-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <section
        ref={dialogRef}
        className="action-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="action-title"
        tabIndex={-1}
      >
        <header>
          <div>
            <small>
              {patient.room} · {patient.displayName}
            </small>
            <h2 id="action-title">Arbeit im Gespräch erfassen</h2>
          </div>
          <button aria-label="Erfassung schliessen" onClick={close}>
            ×
          </button>
        </header>
        <div className="sheet-tabs">
          {allowedActions.map((item) => (
            <button
              key={item}
              className={item === kind ? "active" : ""}
              onClick={() => setKind(item)}
            >
              {actionLabels[item]}
            </button>
          ))}
        </div>
        <form className="sheet-form" onSubmit={submit}>
          {kind === "note" && (
            <label>
              Beobachtung / Diktat
              <textarea
                name="text"
                aria-label="Beobachtung / Diktat"
                minLength={10}
                defaultValue={handoff?.kind === "task" ? handoff.reason : ""}
                required
                autoFocus
              />
            </label>
          )}
          {kind === "vital" && (
            <>
              <label>
                Messung
                <select name="code" aria-label="Messung">
                  <option value="blood-pressure">Blutdruck</option>
                  <option value="temperature">Temperatur</option>
                  <option value="oxygen-saturation">Sauerstoffsättigung</option>
                  <option value="pulse">Puls</option>
                  <option value="weight">Gewicht</option>
                </select>
              </label>
              <div className="form-pair">
                <label>
                  Wert
                  <input
                    name="value"
                    aria-label="Wert"
                    type="number"
                    step="0.1"
                    required
                  />
                </label>
                <label>
                  Zweiter Wert (bei Blutdruck)
                  <input name="secondaryValue" type="number" />
                </label>
              </div>
            </>
          )}
          {kind === "task" && (
            <>
              <label>
                Auftrag
                <input
                  name="title"
                  defaultValue={handoff?.kind === "task" ? handoff.title : ""}
                  minLength={3}
                  required
                />
              </label>
              <label>
                Grund
                <textarea
                  name="reason"
                  defaultValue={handoff?.kind === "task" ? handoff.reason : ""}
                  minLength={3}
                  required
                />
              </label>
              <label>
                Zuständig
                <select name="ownerRole" defaultValue="registered-nurse">
                  {(
                    [
                      "care-assistant",
                      "registered-nurse",
                      "physician",
                      "pharmacy",
                      "physiotherapy",
                      "occupational-therapy",
                    ] as Role[]
                  ).map((role) => (
                    <option value={role} key={role}>
                      {roleLabels[role]}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {kind === "communication" && (
            <>
              <label>
                An / @Erwähnung
                <select
                  name="recipient"
                  defaultValue={
                    snapshot.users.find(
                      (user) =>
                        user.role ===
                        (handoff?.recipientRole ?? "registered-nurse"),
                    )?.id
                  }
                >
                  {clinicalRecipients.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.displayName} · {roleLabels[user.role]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Anfrage
                <input
                  name="request"
                  aria-label="Anfrage"
                  defaultValue={
                    handoff?.kind === "communication" ? handoff.title : ""
                  }
                  minLength={3}
                  required
                />
              </label>
              <label>
                Kontext / Kommentar
                <textarea
                  name="reason"
                  defaultValue={
                    handoff?.kind === "communication" ? handoff.reason : ""
                  }
                  minLength={3}
                  required
                />
              </label>
            </>
          )}
          {kind === "round" && (
            <>
              <label>
                Sicherer Folgetyp
                <select name="actionKind">
                  <option value="mobility-followup">
                    Mobilität nachverfolgen
                  </option>
                  <option value="vital-sign-followup">
                    Vitalwert nachverfolgen
                  </option>
                  <option value="wound-observation">Wundbeobachtung</option>
                  <option value="therapy-followup">
                    Therapie nachverfolgen
                  </option>
                  <option value="diagnostic-followup">
                    Diagnostik nachverfolgen
                  </option>
                </select>
              </label>
              <label>
                Zuständig
                <select name="ownerRole" defaultValue="registered-nurse">
                  {(
                    [
                      "care-assistant",
                      "registered-nurse",
                      "physician",
                      "pharmacy",
                      "physiotherapy",
                      "occupational-therapy",
                    ] as Role[]
                  ).map((role) => (
                    <option value={role} key={role}>
                      {roleLabels[role]}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {["task", "communication", "round"].includes(kind) && (
            <div className="form-pair">
              <label>
                Priorität
                {kind === "round" ? (
                  <input value="Durch Regel festgelegt" disabled />
                ) : (
                  <select name="priority" defaultValue="routine">
                    <option value="routine">Routine</option>
                    <option value="elevated">Erhöht</option>
                    <option value="urgent">Dringend</option>
                  </select>
                )}
              </label>
              <label>
                Frist
                <input
                  name="dueAt"
                  type="datetime-local"
                  defaultValue={toDateTimeLocal(due)}
                  required
                />
              </label>
            </div>
          )}
          <div className="review-strip">
            <strong>Noch keine Freigabe</strong>
            <span>
              Patient, Rolle, Werte, Version und Zielsystem werden serverseitig
              geprüft.
            </span>
          </div>
          <button className="primary submit-work" disabled={busy || !online}>
            {kind === "note" || kind === "vital"
              ? "Sicheren Entwurf erstellen"
              : kind === "round"
                ? "Beschluss freigeben"
                : kind === "communication"
                  ? "Anfrage senden"
                  : "Aufgabe erstellen"}
          </button>
        </form>
      </section>
    </div>
  );
}

function BoundaryStreamProjection({ snapshot }: { snapshot: AppSnapshot }) {
  return (
    <>
      <section className="welcome-message">
        <div className="assistant-avatar" aria-hidden="true">
          P
        </div>
        <div>
          <p>Kein klinischer Kontext für diese Rolle</p>
          <span>
            {roleLabels[snapshot.currentUser.role]} sieht nur den erforderlichen
            Arbeitskontext.
          </span>
        </div>
      </section>
      <BoundaryCard
        title="Minimalprinzip aktiv"
        text="Es werden keine Patientendaten in Oberfläche oder Assistenzkontext geladen."
      />
    </>
  );
}

function BoundaryCard({ title, text }: { title: string; text: string }) {
  return (
    <article className="stream-card boundary-card">
      <h2>{title}</h2>
      <p>{text}</p>
    </article>
  );
}

function Status({ value }: { value: string }) {
  return (
    <span className={`status status-${value}`}>
      {statusLabels[value] ?? value}
    </span>
  );
}
