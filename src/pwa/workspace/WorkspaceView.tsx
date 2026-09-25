import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppSnapshot, Patient, Role } from "../../core/types";
import type {
  WorkspaceAttachment,
  WorkspaceComment,
  WorkspaceProfileField,
  WorkspaceProfileProposal,
  WorkspaceProject,
} from "../../core/workspace";
import type { WorkdayCommand, WorkdayView } from "../../core/workday";
import { assistantClientContextHeaders } from "../assistant-context";
import { WorkdayPanel } from "../conversation/WorkdayPanel";

export type WorkspaceDestination =
  | "Chat"
  | "Library"
  | "Plans"
  | "Projects"
  | "Patients"
  | "Team"
  | "Provider"
  | "Status"
  | "MyProfile"
  | "Profile"
  | "History"
  | "Values";

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

const providerLabels: Record<
  AppSnapshot["providerHealth"][number]["provider"],
  string
> = {
  wicare: "WiCare",
  carecoach: "careCoach",
  "sap-vitals": "SAP Vitals",
  "device-gateway": "Geräte-Gateway",
  "nurse-call": "Rufanlage",
};

const providerStatusLabels: Record<
  AppSnapshot["providerHealth"][number]["status"],
  string
> = {
  available: "Verfügbar",
  degraded: "Eingeschränkt",
  down: "Nicht verfügbar",
};

async function request<T>(
  path: string,
  userId: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData)
        ? { "content-type": "application/json" }
        : {}),
      "x-demo-user": userId,
      ...assistantClientContextHeaders(),
      ...(init?.method === "POST"
        ? { "x-command-id": crypto.randomUUID() }
        : {}),
      ...init?.headers,
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? ((await response.json()) as T & { message?: string })
    : null;
  if (!response.ok)
    throw new Error(
      body?.message ?? `Aktion fehlgeschlagen (${response.status}).`,
    );
  return body as T;
}

function SectionState({ children }: { children: string }) {
  return <p className="workspace-empty">{children}</p>;
}

function PatientIdentity({ patient }: { patient: Patient }) {
  return (
    <div className="compact-identity">
      <span>{patient.room}</span>
      <div>
        <strong>{patient.displayName}</strong>
        <small>
          Geb. {patient.birthDate.split("-").reverse().join(".")} · Fall{" "}
          {patient.mrn}
        </small>
      </div>
    </div>
  );
}

function PatientProfile({
  snapshot,
  patient,
  userId,
  onError,
  onClose,
}: {
  snapshot: AppSnapshot;
  patient: Patient;
  userId: string;
  onError: (message: string | null) => void;
  onClose: () => void;
}) {
  const [fields, setFields] = useState<WorkspaceProfileField[]>([]);
  const [draft, setDraft] = useState("");
  const [proposal, setProposal] = useState<WorkspaceProfileProposal | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const canEdit = ["registered-nurse", "administration"].includes(
    snapshot.currentUser.role,
  );
  const load = useCallback(async () => {
    const result = await request<{ fields: WorkspaceProfileField[] }>(
      `/api/v1/workspace/profile?patientId=${encodeURIComponent(patient.id)}`,
      userId,
    );
    setFields(result.fields);
  }, [patient.id, userId]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((error: unknown) =>
        onError(
          error instanceof Error ? error.message : "Profil nicht verfügbar.",
        ),
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, onError]);
  const preference = fields.find(
    (field) => field.fieldKey === "care-preference",
  );
  const carePreference =
    preference?.value ??
    patient.carePreferences?.join(" · ") ??
    "Nicht dokumentiert";
  return (
    <section className="workspace-card patient-profile-card">
      <div className="workspace-card-heading">
        <PatientIdentity patient={patient} />
        <button className="secondary" type="button" onClick={onClose}>
          Zurück zum Gespräch
        </button>
      </div>
      <dl className="profile-facts">
        <div>
          <dt>Allergiestatus</dt>
          <dd>
            {patient.allergyStatus === "confirmed"
              ? patient.allergies.join(" · ")
              : patient.allergyStatus === "explicit-negative"
                ? "Keine bekannten Allergien dokumentiert"
                : "Ungeklärt – aktiv prüfen"}
          </dd>
        </div>
        <div>
          <dt>Risiken</dt>
          <dd>{patient.risks.join(" · ") || "Nicht dokumentiert"}</dd>
        </div>
        <div>
          <dt>Pflegepräferenz</dt>
          <dd>{carePreference}</dd>
        </div>
        <div>
          <dt>Diagnosen / Behandlungsanlass</dt>
          <dd>{patient.diagnoses.join(" · ") || "Nicht dokumentiert"}</dd>
        </div>
        <div>
          <dt>Aktuelle Pflegeziele</dt>
          <dd>{patient.careGoals.join(" · ") || "Nicht dokumentiert"}</dd>
        </div>
        <div>
          <dt>Kommunikation</dt>
          <dd>
            {patient.communicationPreferences?.join(" · ") ||
              "Keine besondere Präferenz dokumentiert"}
          </dd>
        </div>
        <div>
          <dt>Tagesroutine</dt>
          <dd>{patient.dailyRoutine?.join(" · ") || "Nicht dokumentiert"}</dd>
        </div>
        <div>
          <dt>Medikationskontext</dt>
          <dd>
            {patient.medicationSummary.join(" · ") || "Nicht dokumentiert"}
          </dd>
        </div>
        <div>
          <dt>Aufenthalt</dt>
          <dd>
            Zimmer {patient.room} · Fall {patient.mrn} · Encounter{" "}
            {patient.encounterId}
          </dd>
        </div>
        <div>
          <dt>Quellstand</dt>
          <dd>
            {patient.source.provider === "pflegehelfer"
              ? "Pflegehelfer"
              : providerLabels[patient.source.provider]}{" "}
            · Version {patient.source.version} ·{" "}
            {new Date(patient.source.effectiveAt).toLocaleString("de-CH")}
          </dd>
        </div>
      </dl>
      {proposal ? (
        <div className="review-diff" aria-label="Profiländerung prüfen">
          <strong>Änderung prüfen</strong>
          <del>{proposal.currentValue ?? "Nicht dokumentiert"}</del>
          <ins>{proposal.proposedValue}</ins>
          <small>Quelle: {proposal.sourceLabel} · noch nicht übernommen</small>
          <div>
            <button
              className="secondary"
              onClick={() => setProposal(null)}
              disabled={busy}
            >
              Verwerfen
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void request<{ value: { field: WorkspaceProfileField } }>(
                  `/api/v1/workspace/profile/${proposal.id}/accept`,
                  userId,
                  { method: "POST", body: "{}" },
                )
                  .then(() => load())
                  .then(() => {
                    setProposal(null);
                    setDraft("");
                  })
                  .catch((error: unknown) =>
                    onError(
                      error instanceof Error
                        ? error.message
                        : "Übernahme fehlgeschlagen.",
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "Wird übernommen…" : "Geprüft übernehmen"}
            </button>
          </div>
        </div>
      ) : canEdit ? (
        <form
          className="profile-edit"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            onError(null);
            void request<{ value: WorkspaceProfileProposal }>(
              "/api/v1/workspace/profile/prepare",
              userId,
              {
                method: "POST",
                body: JSON.stringify({
                  patientId: patient.id,
                  fieldKey: "care-preference",
                  label: "Pflegepräferenz",
                  proposedValue: draft,
                  expectedVersion: preference?.version ?? 0,
                  sourceLabel: "Manuell im Patientenprofil geprüft",
                }),
              },
            )
              .then((result) => setProposal(result.value))
              .catch((error: unknown) =>
                onError(
                  error instanceof Error
                    ? error.message
                    : "Entwurf fehlgeschlagen.",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          <label>
            Pflegepräferenz ändern
            <textarea
              value={draft}
              maxLength={1000}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <button
            className="secondary"
            disabled={busy || draft.trim().length < 1}
          >
            Änderung prüfen
          </button>
        </form>
      ) : (
        <small>Profiländerungen sind für diese Rolle nur lesbar.</small>
      )}
    </section>
  );
}

function TeamView({
  snapshot,
  patient,
  userId,
  onError,
}: {
  snapshot: AppSnapshot;
  patient: Patient | null;
  userId: string;
  onError: (message: string | null) => void;
}) {
  const [comments, setComments] = useState<WorkspaceComment[]>([]);
  const [body, setBody] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [recipientRole, setRecipientRole] = useState<Role | "">("");
  const [topicId, setTopicId] = useState("");
  const [busy, setBusy] = useState(false);
  const [teamMemberIds, setTeamMemberIds] = useState<string[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const load = useCallback(async () => {
    const parameters = new URLSearchParams();
    if (patient) parameters.set("patientId", patient.id);
    else parameters.set("scope", "direct");
    if (topicId) parameters.set("topicId", topicId);
    const [result, team] = await Promise.all([
      request<{ comments: WorkspaceComment[] }>(
        `/api/v1/workspace/comments?${parameters.toString()}`,
        userId,
      ),
      patient
        ? request<{
            members: Array<{ id: string; displayName: string; role: Role }>;
          }>(
            `/api/v1/workspace/team-members?patientId=${encodeURIComponent(patient.id)}`,
            userId,
          )
        : Promise.resolve({ members: snapshot.users }),
    ]);
    setComments(result.comments);
    setTeamMemberIds(team.members.map((member) => member.id));
  }, [patient, snapshot.users, topicId, userId]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((error: unknown) =>
        onError(
          error instanceof Error
            ? error.message
            : "Kommentare nicht verfügbar.",
        ),
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, onError]);
  return (
    <section className="workspace-card team-workspace">
      <div className="workspace-card-heading">
        <div>
          <strong>
            {patient
              ? `Team zu ${patient.displayName}`
              : "Direkte Teamnachricht"}
          </strong>
          <small>Geteilt, adressiert und dauerhaft gespeichert</small>
        </div>
        <label>
          <span className="sr-only">Thema filtern</span>
          <select
            value={topicId}
            onChange={(event) => setTopicId(event.target.value)}
          >
            <option value="">Alle #Themen</option>
            {snapshot.organization.governedTopics.map((topic) => (
              <option key={topic.id} value={topic.id}>
                #{topic.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!patient && (
        <div className="staff-directory" aria-label="Teamverzeichnis">
          {snapshot.users
            .filter((user) => user.id !== userId)
            .map((user) => (
              <button
                key={user.id}
                type="button"
                className={selectedStaffId === user.id ? "active" : ""}
                onClick={() => {
                  setSelectedStaffId(user.id);
                  setRecipientId(user.id);
                }}
              >
                <span>{user.displayName.slice(0, 1)}</span>
                <span>
                  <strong>{user.displayName}</strong>
                  <small>{roleLabels[user.role]}</small>
                </span>
              </button>
            ))}
        </div>
      )}
      {!patient && selectedStaffId && (
        <div className="staff-profile" aria-label="Mitarbeitendenprofil">
          {(() => {
            const member = snapshot.users.find(
              (user) => user.id === selectedStaffId,
            );
            if (!member) return <strong>Teammitglied nicht verfügbar</strong>;
            return (
              <>
                <strong>{member.displayName}</strong>
                <span>
                  {member.directoryProfile?.professionalTitle ??
                    roleLabels[member.role]}
                </span>
                <dl className="profile-facts">
                  <div>
                    <dt>Team / Station</dt>
                    <dd>
                      {member.directoryProfile
                        ? `${member.directoryProfile.team} · ${member.directoryProfile.station}`
                        : "Nicht dokumentiert"}
                    </dd>
                  </div>
                  <div>
                    <dt>Dienstlicher Kontakt</dt>
                    <dd>
                      {member.directoryProfile
                        ? `${member.directoryProfile.workPhone} · ${member.directoryProfile.workEmail}`
                        : "Nicht dokumentiert"}
                    </dd>
                  </div>
                  <div>
                    <dt>Sprachen</dt>
                    <dd>
                      {member.directoryProfile?.languages.join(" · ") ??
                        "Nicht dokumentiert"}
                    </dd>
                  </div>
                  <div>
                    <dt>Zuständigkeiten</dt>
                    <dd>
                      {member.directoryProfile?.responsibilities.join(" · ") ??
                        "Nicht dokumentiert"}
                    </dd>
                  </div>
                </dl>
              </>
            );
          })()}
          <small>
            Dienstliches Profil im freigegebenen Verzeichnis. Keine privaten
            Chats, Präsenz- oder HR-Daten.
          </small>
        </div>
      )}
      <div className="comment-list">
        {comments.length === 0 && (
          <SectionState>
            Noch keine Beiträge in diesem freigegebenen Kontext.
          </SectionState>
        )}
        {comments.map((comment) => {
          const author = snapshot.users.find(
            (user) => user.id === comment.authorId,
          );
          return (
            <article
              key={comment.id}
              className={comment.unread ? "unread" : ""}
            >
              <div>
                <strong>{author?.displayName ?? "Teammitglied"}</strong>
                <time>
                  {new Date(comment.createdAt).toLocaleString("de-CH")}
                </time>
              </div>
              <p>{comment.body}</p>
              <small>
                {comment.recipientIds
                  .map(
                    (id) =>
                      `@${snapshot.users.find((user) => user.id === id)?.displayName ?? id}`,
                  )
                  .join(" ")}{" "}
                {comment.topicIds
                  .map(
                    (id) =>
                      `#${snapshot.organization.governedTopics.find((topic) => topic.id === id)?.label ?? id}`,
                  )
                  .join(" ")}
              </small>
            </article>
          );
        })}
      </div>
      <form
        className="comment-composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (!patient && !recipientId) return;
          setBusy(true);
          onError(null);
          void request("/api/v1/workspace/comments", userId, {
            method: "POST",
            body: JSON.stringify({
              patientId: patient?.id ?? null,
              audienceKind: patient ? "patient-team" : "direct",
              body,
              recipientIds: recipientId ? [recipientId] : [],
              recipientRoleIds: recipientRole ? [recipientRole] : [],
              topicIds: topicId ? [topicId] : [],
              parentId: null,
            }),
          })
            .then(() => load())
            .then(() => setBody(""))
            .catch((error: unknown) =>
              onError(
                error instanceof Error
                  ? error.message
                  : "Senden fehlgeschlagen.",
              ),
            )
            .finally(() => setBusy(false));
        }}
      >
        <select
          aria-label="Empfänger erwähnen"
          value={recipientId}
          onChange={(event) => setRecipientId(event.target.value)}
        >
          <option value="">
            {patient ? "@ optional" : "@ Empfänger wählen"}
          </option>
          {snapshot.users
            .filter(
              (user) =>
                user.id !== userId &&
                (!patient || teamMemberIds.includes(user.id)),
            )
            .map((user) => (
              <option key={user.id} value={user.id}>
                @{user.displayName}
              </option>
            ))}
        </select>
        {patient && (
          <select
            aria-label="Rolle erwähnen"
            value={recipientRole}
            onChange={(event) =>
              setRecipientRole(event.target.value as Role | "")
            }
          >
            <option value="">@ Rolle optional</option>
            {[
              ...new Set(
                snapshot.users
                  .filter((user) => teamMemberIds.includes(user.id))
                  .map((user) => user.role),
              ),
            ].map((role) => (
              <option key={role} value={role}>
                @{roleLabels[role]}
              </option>
            ))}
          </select>
        )}
        <textarea
          aria-label="Geteilten Kommentar verfassen"
          value={body}
          maxLength={2000}
          placeholder={
            patient ? "Mit dem Behandlungsteam teilen…" : "Direkte Nachricht…"
          }
          onChange={(event) => setBody(event.target.value)}
        />
        <button
          className="primary"
          disabled={
            busy || body.trim().length < 1 || (!patient && !recipientId)
          }
        >
          {busy ? "Wird gesendet…" : "Teilen"}
        </button>
      </form>
    </section>
  );
}

function LibraryView({
  patient,
  userId,
  onError,
}: {
  patient: Patient | null;
  userId: string;
  onError: (message: string | null) => void;
}) {
  const [items, setItems] = useState<WorkspaceAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  const load = useCallback(async () => {
    const suffix = patient
      ? `?patientId=${encodeURIComponent(patient.id)}`
      : "";
    const result = await request<{ attachments: WorkspaceAttachment[] }>(
      `/api/v1/workspace/attachments${suffix}`,
      userId,
    );
    setItems(result.attachments);
  }, [patient, userId]);
  useEffect(() => {
    void load().catch((error: unknown) =>
      onError(
        error instanceof Error ? error.message : "Bibliothek nicht verfügbar.",
      ),
    );
  }, [load, onError]);
  const openAttachment = async (item: WorkspaceAttachment) => {
    const response = await fetch(
      `/api/v1/workspace/attachments/${item.id}/content`,
      {
        headers: {
          "x-demo-user": userId,
          ...assistantClientContextHeaders(),
        },
      },
    );
    if (!response.ok) {
      const failure = (await response.json()) as { message?: string };
      throw new Error(failure.message ?? "Datei nicht verfügbar.");
    }
    const url = URL.createObjectURL(await response.blob());
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const upload = async (file: File) => {
    setBusy(true);
    onError(null);
    try {
      const sha256 = [
        ...new Uint8Array(
          await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
        ),
      ]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      const parameters = new URLSearchParams({ audienceKind: "private" });
      if (patient) parameters.set("patientId", patient.id);
      const form = new FormData();
      form.set("file", file, file.name);
      await request(
        `/api/v1/workspace/attachments?${parameters.toString()}`,
        userId,
        { method: "POST", body: form, headers: { "x-content-sha256": sha256 } },
      );
      await load();
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <section className="workspace-card library-workspace">
      <div className="workspace-card-heading">
        <div>
          <strong>Bibliothek</strong>
          <small>
            {patient
              ? `Privat zu ${patient.displayName}`
              : "Deine privaten Arbeitsdateien"}
          </small>
        </div>
        <button
          className="primary"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          Datei hinzufügen
        </button>
      </div>
      <input
        ref={input}
        className="sr-only"
        type="file"
        accept="application/pdf,image/png,image/jpeg,text/plain"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file)
            void upload(file).catch((error: unknown) =>
              onError(
                error instanceof Error
                  ? error.message
                  : "Upload fehlgeschlagen.",
              ),
            );
        }}
      />
      <div className="library-grid">
        {items.length === 0 && (
          <SectionState>Noch keine Dateien in diesem Kontext.</SectionState>
        )}
        {items.map((item) => (
          <article key={item.id}>
            <strong>{item.fileName}</strong>
            <small>
              {item.mediaType} · {Math.ceil(item.size / 1024)} KB
            </small>
            <span>
              {item.state === "available" ? "Verfügbar" : "Zurückgezogen"}
            </span>
            {item.state === "available" && (
              <button
                className="secondary"
                onClick={() =>
                  void openAttachment(item).catch((error: unknown) =>
                    onError(
                      error instanceof Error
                        ? error.message
                        : "Datei nicht verfügbar.",
                    ),
                  )
                }
              >
                Öffnen
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function ProjectsView({
  snapshot,
  userId,
  onError,
}: {
  snapshot: AppSnapshot;
  userId: string;
  onError: (message: string | null) => void;
}) {
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [memberId, setMemberId] = useState("");
  const [taskSelections, setTaskSelections] = useState<Record<string, string>>(
    {},
  );
  const load = useCallback(
    async () =>
      setProjects(
        (
          await request<{ projects: WorkspaceProject[] }>(
            "/api/v1/workspace/projects",
            userId,
          )
        ).projects,
      ),
    [userId],
  );
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((error: unknown) =>
        onError(
          error instanceof Error ? error.message : "Projekte nicht verfügbar.",
        ),
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, onError]);
  return (
    <section className="workspace-card projects-workspace">
      <div className="workspace-card-heading">
        <div>
          <strong>Projekte</strong>
          <small>Mitglieder und verknüpfte Arbeit bleiben explizit.</small>
        </div>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void request("/api/v1/workspace/projects", userId, {
            method: "POST",
            body: JSON.stringify({
              title,
              purpose,
              memberIds: memberId ? [memberId] : [],
            }),
          })
            .then(() => load())
            .then(() => {
              setTitle("");
              setPurpose("");
              setMemberId("");
            })
            .catch((error: unknown) =>
              onError(
                error instanceof Error
                  ? error.message
                  : "Projekt konnte nicht erstellt werden.",
              ),
            );
        }}
      >
        <input
          aria-label="Projekttitel"
          placeholder="Projekttitel"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <select
          aria-label="Projektmitglied"
          value={memberId}
          onChange={(event) => setMemberId(event.target.value)}
        >
          <option value="">Ohne weiteres Mitglied</option>
          {snapshot.users
            .filter((user) => user.id !== userId)
            .map((user) => (
              <option key={user.id} value={user.id}>
                {user.displayName} · {roleLabels[user.role]}
              </option>
            ))}
        </select>
        <input
          aria-label="Projektzweck"
          placeholder="Zweck"
          value={purpose}
          onChange={(event) => setPurpose(event.target.value)}
        />
        <button
          className="primary"
          disabled={title.trim().length < 3 || purpose.trim().length < 3}
        >
          Projekt erstellen
        </button>
      </form>
      <div className="project-list">
        {projects.length === 0 && (
          <SectionState>Noch keine Projekte.</SectionState>
        )}
        {projects.map((project) => (
          <article key={project.id}>
            <strong>{project.title}</strong>
            <p>{project.purpose}</p>
            <small>
              {project.memberIds.length} Mitglied(er) · {project.links.length}{" "}
              Verknüpfung(en) · Version {project.version}
            </small>
            <div className="project-linker">
              <select
                aria-label={`Aufgabe mit ${project.title} verknüpfen`}
                value={taskSelections[project.id] ?? ""}
                onChange={(event) =>
                  setTaskSelections((current) => ({
                    ...current,
                    [project.id]: event.target.value,
                  }))
                }
              >
                <option value="">Bestehende Aufgabe wählen</option>
                {snapshot.tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title} · {task.state}
                  </option>
                ))}
              </select>
              <button
                className="secondary"
                disabled={!taskSelections[project.id]}
                onClick={() => {
                  const taskId = taskSelections[project.id];
                  if (!taskId) return;
                  void request(
                    `/api/v1/workspace/projects/${project.id}/links`,
                    userId,
                    {
                      method: "POST",
                      body: JSON.stringify({
                        expectedVersion: project.version,
                        link: { kind: "task", id: taskId },
                      }),
                    },
                  )
                    .then(() => load())
                    .then(() =>
                      setTaskSelections((current) => ({
                        ...current,
                        [project.id]: "",
                      })),
                    )
                    .catch((error: unknown) =>
                      onError(
                        error instanceof Error
                          ? error.message
                          : "Verknüpfung fehlgeschlagen.",
                      ),
                    );
                }}
              >
                Aufgabe verknüpfen
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function StatusView({
  userId,
  onError,
}: {
  userId: string;
  onError: (message: string | null) => void;
}) {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    void request<Record<string, unknown>>("/api/v1/status", userId)
      .then(setStatus)
      .catch((error: unknown) =>
        onError(
          error instanceof Error ? error.message : "Status nicht verfügbar.",
        ),
      );
  }, [onError, userId]);
  if (!status) return <SectionState>Status wird geprüft…</SectionState>;
  const apiStatus = status.api as {
    reachable?: boolean;
    authenticated?: boolean;
  };
  const session = status.session as { state?: string; expiresAt?: string };
  const stores = status.stores as {
    postgresql?: { ready?: boolean };
    medplum?: { ready?: boolean; message?: string };
  };
  const ai = status.ai as {
    model?: { ready?: boolean; acceptance?: string; message?: string };
    asr?: { acceptance?: string; message?: string };
    tts?: { acceptance?: string; message?: string };
  };
  const delivery = status.delivery as {
    clinicalProjections?: Record<string, number>;
    providerDeliveries?: Record<string, number>;
  };
  const queueSummary = (queue: Record<string, number> | undefined) => {
    const entries = Object.entries(queue ?? {}).filter(
      ([, count]) => count > 0,
    );
    return entries.length === 0
      ? "keine Aufträge"
      : entries.map(([state, count]) => `${state}: ${count}`).join(" · ");
  };
  return (
    <section className="workspace-card status-workspace">
      <div className="workspace-card-heading">
        <div>
          <strong>Betriebsstatus</strong>
          <small>
            Getrennte Signale — kein Sammelpunkt, der Fehler verdeckt.
          </small>
        </div>
      </div>
      <dl className="status-grid">
        <div>
          <dt>Netz / API</dt>
          <dd>
            {navigator.onLine ? "Netz verfügbar" : "Browser offline"} ·{" "}
            {apiStatus.reachable && apiStatus.authenticated
              ? "API authentifiziert"
              : "API nicht bestätigt"}
          </dd>
        </div>
        <div>
          <dt>Sitzung</dt>
          <dd>
            {session.state ?? "unbekannt"} · bis{" "}
            {session.expiresAt
              ? new Date(session.expiresAt).toLocaleString("de-CH")
              : "unbekannt"}
          </dd>
        </div>
        <div>
          <dt>Daten</dt>
          <dd>
            PostgreSQL {stores.postgresql?.ready ? "bereit" : "nicht bereit"} ·
            Medplum {stores.medplum?.ready ? "bereit" : "nicht bereit"}
          </dd>
        </div>
        <div>
          <dt>KI</dt>
          <dd>
            Modell {ai.model?.acceptance ?? "unbekannt"} · ASR{" "}
            {ai.asr?.acceptance ?? "unbekannt"} · TTS{" "}
            {ai.tts?.acceptance ?? "unbekannt"}
            <small>{ai.model?.message ?? "Kein Modellstatus."}</small>
            <small>{ai.asr?.message ?? "Kein ASR-Status."}</small>
            <small>{ai.tts?.message ?? "Kein TTS-Status."}</small>
          </dd>
        </div>
        <div>
          <dt>Zustellung</dt>
          <dd>
            Klinisch: {queueSummary(delivery.clinicalProjections)} · Anbieter:{" "}
            {queueSummary(delivery.providerDeliveries)}
          </dd>
        </div>
      </dl>
    </section>
  );
}

export function WorkspaceView({
  destination,
  snapshot,
  patient,
  userId,
  workday,
  busy,
  onPatient,
  onWorkdayAction,
  onError,
  onNavigate,
}: {
  destination: WorkspaceDestination;
  snapshot: AppSnapshot;
  patient: Patient | null;
  userId: string;
  workday: WorkdayView | null;
  busy: boolean;
  onPatient: (patientId: string) => void;
  onWorkdayAction: (command: WorkdayCommand) => Promise<void>;
  onError: (message: string | null) => void;
  onNavigate: (destination: WorkspaceDestination) => void;
}) {
  const patientNotes = useMemo(
    () => snapshot.notes.filter((item) => item.patientId === patient?.id),
    [patient, snapshot.notes],
  );
  const patientObservations = useMemo(
    () =>
      snapshot.observations.filter((item) => item.patientId === patient?.id),
    [patient, snapshot.observations],
  );
  if (destination === "MyProfile")
    return (
      <section className="workspace-card own-profile-card">
        <div className="workspace-card-heading">
          <div className="compact-identity">
            <span>
              {snapshot.currentUser.displayName
                .split(/\s+/)
                .map((part) => part[0])
                .join("")
                .slice(0, 2)
                .toLocaleUpperCase("de-CH")}
            </span>
            <div>
              <strong>{snapshot.currentUser.displayName}</strong>
              <small>{roleLabels[snapshot.currentUser.role]}</small>
            </div>
          </div>
          <button
            className="secondary"
            type="button"
            onClick={() => onNavigate("Chat")}
          >
            Zurück zum Gespräch
          </button>
        </div>
        <dl className="profile-facts">
          <div>
            <dt>Organisation</dt>
            <dd>{snapshot.organization.displayName}</dd>
          </div>
          <div>
            <dt>Funktion</dt>
            <dd>
              {snapshot.currentUser.directoryProfile?.professionalTitle ??
                roleLabels[snapshot.currentUser.role]}
            </dd>
          </div>
          <div>
            <dt>Team / Station</dt>
            <dd>
              {snapshot.currentUser.directoryProfile
                ? `${snapshot.currentUser.directoryProfile.team} · ${snapshot.currentUser.directoryProfile.station}`
                : snapshot.organization.siteId}
            </dd>
          </div>
          <div>
            <dt>Dienstlicher Kontakt</dt>
            <dd>
              {snapshot.currentUser.directoryProfile
                ? `${snapshot.currentUser.directoryProfile.workPhone} · ${snapshot.currentUser.directoryProfile.workEmail}`
                : "Nicht dokumentiert"}
            </dd>
          </div>
          <div>
            <dt>Sprachen</dt>
            <dd>
              {snapshot.currentUser.directoryProfile?.languages.join(" · ") ??
                "Nicht dokumentiert"}
            </dd>
          </div>
          <div>
            <dt>Zuständigkeiten</dt>
            <dd>
              {snapshot.currentUser.directoryProfile?.responsibilities.join(
                " · ",
              ) ?? "Nicht dokumentiert"}
            </dd>
          </div>
          <div>
            <dt>Freigegebene Bereiche</dt>
            <dd>{snapshot.currentUser.wardIds.join(" · ") || "Keine"}</dd>
          </div>
          <div>
            <dt>Arbeitszweck</dt>
            <dd>{snapshot.currentUser.defaultPurpose}</dd>
          </div>
          <div>
            <dt>Gerätestatus</dt>
            <dd>
              {snapshot.currentUser.managedDevice
                ? "Verwaltetes Gerät"
                : "Nicht verwaltetes Gerät"}
            </dd>
          </div>
        </dl>
        <small>
          Dienstliches Eigenprofil aus der authentifizierten Sitzung. Die
          Demo-Rolle kann nur in der synthetischen Testumgebung gewechselt
          werden.
        </small>
      </section>
    );
  if (destination === "Profile" && patient)
    return (
      <PatientProfile
        snapshot={snapshot}
        patient={patient}
        userId={userId}
        onError={onError}
        onClose={() => onNavigate("Chat")}
      />
    );
  if (destination === "Team")
    return (
      <TeamView
        snapshot={snapshot}
        patient={patient}
        userId={userId}
        onError={onError}
      />
    );
  if (destination === "Library")
    return <LibraryView patient={patient} userId={userId} onError={onError} />;
  if (destination === "Projects")
    return (
      <ProjectsView snapshot={snapshot} userId={userId} onError={onError} />
    );
  if (destination === "Status")
    return <StatusView userId={userId} onError={onError} />;
  if (destination === "Plans")
    return (
      <section className="workspace-card plans-workspace">
        {workday ? (
          <WorkdayPanel
            workday={workday}
            patients={snapshot.patients}
            busy={busy}
            onPatient={onPatient}
            onError={onError}
            onAction={onWorkdayAction}
          />
        ) : (
          <SectionState>
            Für diese Rolle ist kein klinischer Arbeitstag freigegeben.
          </SectionState>
        )}
      </section>
    );
  if (destination === "Patients")
    return (
      <section className="workspace-card patient-directory">
        <div className="workspace-card-heading">
          <div>
            <strong>Patient:innen</strong>
            <small>
              Freigegebene Identitäten; Auswahl öffnet den privaten Kontext.
            </small>
          </div>
        </div>
        {snapshot.patients.map((item) => (
          <button key={item.id} onClick={() => onPatient(item.id)}>
            <PatientIdentity patient={item} />
            <span>Profil öffnen</span>
          </button>
        ))}
      </section>
    );
  if (destination === "History" && patient)
    return (
      <section className="workspace-card record-list">
        <div className="workspace-card-heading">
          <PatientIdentity patient={patient} />
        </div>
        {patientNotes.length === 0 && (
          <SectionState>Kein freigegebener Verlauf.</SectionState>
        )}
        {patientNotes.map((note) => (
          <article key={note.id}>
            <strong>{note.status}</strong>
            <p>{note.structuredText}</p>
            <small>
              {new Date(note.source.effectiveAt).toLocaleString("de-CH")} ·{" "}
              {note.source.provider}
            </small>
          </article>
        ))}
      </section>
    );
  if (destination === "Values" && patient)
    return (
      <section className="workspace-card record-list">
        <div className="workspace-card-heading">
          <PatientIdentity patient={patient} />
        </div>
        {patientObservations.length === 0 && (
          <SectionState>Keine freigegebenen Messwerte.</SectionState>
        )}
        {patientObservations.map((observation) => (
          <article key={observation.id}>
            <strong>{observation.label}</strong>
            <p>
              {observation.value}
              {observation.secondaryValue === null
                ? ""
                : `/${observation.secondaryValue}`}{" "}
              {observation.unit}
            </p>
            <small>
              {observation.status} ·{" "}
              {new Date(observation.effectiveAt).toLocaleString("de-CH")} ·{" "}
              {observation.source.provider}
            </small>
          </article>
        ))}
      </section>
    );
  if (destination === "Provider") {
    const authorized = [
      "registered-nurse",
      "physician",
      "it",
      "quality-safety",
    ].includes(snapshot.currentUser.role);
    return (
      <section className="workspace-card provider-workspace">
        <div className="workspace-card-heading">
          <div>
            <strong>Anbieter & klinische Quelle</strong>
            <small>Nur freigegebene Betriebs- und Detailansichten.</small>
          </div>
        </div>
        {!authorized ? (
          <SectionState>
            Diese Rolle hat keinen Zugriff auf Anbieterdiagnostik.
          </SectionState>
        ) : (
          <>
            <div className="provider-list" aria-label="Anbieterdiagnostik">
              {snapshot.providerHealth.length === 0 && (
                <SectionState>
                  Keine freigegebene Anbieterdiagnostik vorhanden.
                </SectionState>
              )}
              {snapshot.providerHealth.map((provider) => (
                <article key={provider.provider}>
                  <header>
                    <div>
                      <strong>{providerLabels[provider.provider]}</strong>
                      <small>{provider.provider}</small>
                    </div>
                    <span className={`provider-state ${provider.status}`}>
                      {providerStatusLabels[provider.status]}
                    </span>
                  </header>
                  <p>{provider.message}</p>
                  <dl>
                    <div>
                      <dt>Betriebsart</dt>
                      <dd>
                        {snapshot.capabilityProfile === "synthetic-simulator"
                          ? "SIMULATED"
                          : "Produktion"}
                      </dd>
                    </div>
                    <div>
                      <dt>Latenz</dt>
                      <dd>{provider.latencyMs} ms</dd>
                    </div>
                    <div>
                      <dt>Geprüft</dt>
                      <dd>
                        {new Date(provider.checkedAt).toLocaleString("de-CH")}
                      </dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
            {patient && snapshot.workspaceLinks?.patients[patient.id] && (
              <a
                className="primary"
                href={snapshot.workspaceLinks.patients[patient.id]}
                target="_blank"
                rel="noreferrer"
              >
                Klinische Detailansicht öffnen
              </a>
            )}
          </>
        )}
      </section>
    );
  }
  return null;
}
