import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppSnapshot, Patient, Role } from "../core/types";
import {
  AssistantSurface,
  type AssistantHandoff,
  type ConversationOpening,
} from "./assistant/AssistantSurface";
import type { WorkdayView } from "../core/workday";
import type {
  OrganizationCommercialConfig,
  OrganizationStatement,
} from "../core/organization-economics";
import {
  assistantClientContextHeaders,
  createAssistantContextBindingCoordinator,
  rotateAssistantClientContext,
} from "./assistant-context";
import {
  WorkspaceView,
  type WorkspaceDestination,
} from "./workspace/WorkspaceView";

interface ConversationDescriptor {
  id: string;
  type:
    | "general-assistant"
    | "patient-assistant"
    | "patient-team"
    | "department"
    | "direct";
  title: string;
  patientId: string | null;
  pinned: boolean;
  lastActivityAt: string;
  active: boolean;
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

const workflowOpenings: Partial<Record<Role, ConversationOpening>> = {
  "care-assistant": {
    eyebrow: "Dein Arbeitstag · Schritt 1 von 10",
    title: "Guten Morgen.",
    summary: "Die Übergabe ist vorbereitet. Was möchtest du zuerst ansehen?",
    progress: "Übergabe · Aufgaben · Teamfragen",
  },
  "registered-nurse": {
    eyebrow: "Dein Arbeitstag · Schritt 1 von 10",
    title: "Guten Morgen.",
    summary: "Die Schichtübergabe ist bereit. Womit möchtest du beginnen?",
    progress: "Übergabe · Aufgaben · Teamfragen",
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
  title: "Guten Morgen.",
  summary:
    "Wie kann ich dich in deinem freigegebenen Arbeitskontext unterstützen?",
  progress: "Fragen · Arbeit · Abschluss",
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
      ...assistantClientContextHeaders(),
      ...(init?.method === "POST"
        ? { "x-command-id": crypto.randomUUID() }
        : {}),
      ...init?.headers,
    },
  });
  const raw = await response.text();
  let result: T & { message?: string };
  try {
    result = JSON.parse(raw) as T & { message?: string };
  } catch {
    throw new Error("Der Dienst antwortet nicht im erwarteten Format.");
  }
  if (!response.ok) throw new Error(result.message ?? "Aktion fehlgeschlagen.");
  return result;
}

function formatBirthDate(value: string): string {
  return value.split("-").reverse().join(".");
}

function PatientSafetyBar({
  patient,
  onProfile,
}: {
  patient: Patient;
  onProfile: () => void;
}) {
  return (
    <div className="patient-safety-bar" aria-label="Aktiver Patientenkontext">
      <button
        type="button"
        className="patient-identity-trigger"
        aria-label={`Vollständiges Profil von ${patient.displayName} öffnen`}
        onClick={onProfile}
      >
        <span className="patient-room">{patient.room}</span>
        <span>
          <strong>{patient.displayName}</strong>
          <small>
            Geb. {formatBirthDate(patient.birthDate)} · Fall {patient.mrn}
          </small>
          <small className="patient-channel-label">
            Pflegehelfer zu {patient.displayName.split(" ")[0]} · Privater
            Assistenzchat
          </small>
        </span>
      </button>
      <span className="patient-safety-signals">
        {patient.allergyStatus === "confirmed" &&
          patient.allergies.length > 0 && (
            <strong className="patient-allergy">
              Allergie: {patient.allergies.join(" · ")}
            </strong>
          )}
        {patient.allergyStatus === "explicit-negative" && (
          <small>
            Allergien: keine bekannten gemäss aktuellem Quellenstand
          </small>
        )}
        {patient.allergyStatus === "unknown" && (
          <small>Allergiestatus im freigegebenen Ausschnitt: unbekannt</small>
        )}
        {patient.risks.length > 0 && (
          <small className="patient-risk">
            Risiko: {patient.risks.join(" · ")}
          </small>
        )}
        {patient.risks.length === 0 && (
          <small>
            Weitere Warnhinweise im freigegebenen Ausschnitt: unbekannt
          </small>
        )}
      </span>
    </div>
  );
}

function CountersignaturePanel({
  snapshot,
  userId,
  activePatientId,
  activeEncounterId,
  done,
}: {
  snapshot: AppSnapshot;
  userId: string;
  activePatientId: string | null;
  activeEncounterId: string | null;
  done: (message: string) => Promise<void>;
}) {
  const reviewed = snapshot.observations.filter(
    (item) =>
      item.status === "reviewed" &&
      item.patientId === activePatientId &&
      item.encounterId === activeEncounterId,
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  if (reviewed.length === 0) return null;
  return (
    <section
      className="countersignature-panel"
      aria-label="Unabhängige Zweitfreigaben"
    >
      <strong>Ungewöhnliche Messwerte · unabhängige Zweitfreigabe</strong>
      {reviewed.map((item) => {
        const patient = snapshot.patients.find(
          (candidate) => candidate.id === item.patientId,
        );
        const ownReview = item.approvals.includes(userId);
        return (
          <div key={item.id}>
            <span>
              {patient?.room ?? "–"} · {patient?.displayName ?? "Patient"} ·{" "}
              {item.label} {item.value}
              {item.secondaryValue === null
                ? ""
                : `/${item.secondaryValue}`}{" "}
              {item.unit}
              {patient && (
                <small>
                  Geb. {patient.birthDate} · Fall {patient.mrn} · gemessen{" "}
                  {new Date(item.effectiveAt).toLocaleString("de-CH", {
                    timeZone: "Europe/Zurich",
                  })}{" "}
                  · Quelle {item.source.provider}
                  {item.deviceId ? ` / ${item.deviceId}` : ""} · Erstprüfung{" "}
                  {item.approvals
                    .map(
                      (id) =>
                        snapshot.users.find((candidate) => candidate.id === id)
                          ?.displayName ?? id,
                    )
                    .join(", ")}
                </small>
              )}
            </span>
            <button
              className="primary"
              aria-label={`Identität und Wert bestätigen: ${patient?.displayName ?? item.patientId}, ${item.label} ${item.value}${item.secondaryValue === null ? "" : `/${item.secondaryValue}`} ${item.unit}`}
              disabled={busyId !== null || ownReview || !patient}
              onClick={() => {
                if (!patient) return;
                setBusyId(item.id);
                void api(`/api/v1/observation/${item.id}/approve`, userId, {
                  method: "POST",
                  body: JSON.stringify({
                    expectedVersion: item.version,
                    patientMrn: patient.mrn,
                    patientBirthDate: patient.birthDate,
                    reviewedDiff: true,
                  }),
                })
                  .then(() =>
                    done(
                      "Unabhängige Zweitfreigabe erfasst; Anbieterabgleich bleibt sichtbar.",
                    ),
                  )
                  .catch((failure: unknown) =>
                    done(
                      failure instanceof Error
                        ? failure.message
                        : "Zweitfreigabe fehlgeschlagen.",
                    ),
                  )
                  .finally(() => setBusyId(null));
              }}
            >
              {ownReview
                ? "Andere Fachperson erforderlich"
                : busyId === item.id
                  ? "Wird geprüft…"
                  : "Identität & Wert bestätigen"}
            </button>
          </div>
        );
      })}
    </section>
  );
}

function money(amountMinor: number | null, currency: string): string {
  if (amountMinor === null) return "Nicht verfügbar";
  return new Intl.NumberFormat("de-CH", {
    style: "currency",
    currency,
  }).format(amountMinor / 100);
}

function moneyInput(amountMinor: number | null): string {
  return amountMinor === null ? "" : (amountMinor / 100).toFixed(2);
}

function parseMoneyInput(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (normalized === "") return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized))
    throw new Error("Betrag mit höchstens zwei Dezimalstellen eingeben.");
  const [major, fraction = ""] = normalized.split(".");
  return Number(major) * 100 + Number(fraction.padEnd(2, "0"));
}

function OrganizationEconomicsPanel({
  userId,
  canEdit,
}: {
  userId: string;
  canEdit: boolean;
}) {
  const [data, setData] = useState<{
    configuration: OrganizationCommercialConfig;
    statement: OrganizationStatement;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [subscription, setSubscription] = useState("");
  const [allowance, setAllowance] = useState("");
  const [limit, setLimit] = useState("");
  const [supplyMode, setSupplyMode] =
    useState<OrganizationCommercialConfig["usage"]["supplyMode"]>(
      "hosted-provider",
    );
  const downloadStatement = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const period = new Date().toISOString().slice(0, 7);
      const response = await fetch(
        `/api/v1/admin/organization-economics/statement.csv?period=${period}`,
        {
          headers: {
            "x-demo-user": userId,
            ...assistantClientContextHeaders(),
          },
        },
      );
      if (!response.ok) {
        const failure = (await response.json()) as { message?: string };
        throw new Error(failure.message ?? "Monatsauszug nicht verfügbar.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `pflegehelfer-organization-statement-${period}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Monatsauszug nicht verfügbar.",
      );
    } finally {
      setBusy(false);
    }
  }, [userId]);
  const loadEconomics = useCallback(async () => {
    try {
      const result = await api<{
        configuration: OrganizationCommercialConfig;
        statement: OrganizationStatement;
      }>("/api/v1/admin/organization-economics", userId);
      setData(result);
      setSubscription(
        moneyInput(result.configuration.subscription.monthlyAmountMinor),
      );
      setAllowance(
        moneyInput(result.configuration.usage.includedAllowanceMinor),
      );
      setLimit(moneyInput(result.configuration.usage.spendingLimitMinor));
      setSupplyMode(result.configuration.usage.supplyMode);
      setError(null);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Kostenansicht nicht verfügbar.",
      );
    }
  }, [userId]);
  useEffect(() => void loadEconomics(), [loadEconomics]);
  if (!data)
    return (
      <section
        className="organization-economics"
        aria-label="Organisation und Nutzungskosten"
      >
        <strong>Organisation & Nutzungskosten</strong>
        <p>{error ?? "Kostenansicht wird geladen…"}</p>
      </section>
    );
  const { configuration, statement } = data;
  return (
    <details className="organization-economics">
      <summary>
        <span>
          <strong>Organisation & Nutzungskosten</strong>
          <small>
            {statement.preparedAmountMinor === null
              ? "Monatsbetrag nicht vollständig messbar"
              : `${money(statement.preparedAmountMinor, statement.currency)} · Entwurf`}
          </small>
        </span>
        <span className={`budget-state ${statement.budget.newInference}`}>
          KI:{" "}
          {statement.budget.newInference === "paused"
            ? "pausiert"
            : statement.budget.newInference === "allowed"
              ? "verfügbar"
              : "Kosten offen"}
        </span>
      </summary>
      <p>
        Eine Organisationsvereinbarung für definierte Standorte, Abläufe,
        Integrationen und Support. Mitarbeitende, Konten, Geräte und Rollen
        werden nicht einzeln verrechnet.
      </p>
      <dl>
        <div>
          <dt>Pilot</dt>
          <dd>{configuration.pilot.status}</dd>
        </div>
        <div>
          <dt>Bereitstellung</dt>
          <dd>
            {configuration.deployment.status} ·{" "}
            {configuration.deployment.hosting}
          </dd>
        </div>
        <div>
          <dt>Monatsabo</dt>
          <dd>
            {money(statement.subscription.amountMinor, statement.currency)}
          </dd>
        </div>
        <div>
          <dt>Providerkosten</dt>
          <dd>
            {money(statement.usage.providerCostMinor, statement.currency)}
          </dd>
        </div>
        <div>
          <dt>Zusätzliche KI-Nutzung</dt>
          <dd>
            {money(statement.usage.additionalUsageMinor, statement.currency)}
          </dd>
        </div>
        <div>
          <dt>Messbasis</dt>
          <dd>
            {statement.usage.sourceCoverage.providerReported} Providerbelege ·{" "}
            {statement.usage.sourceCoverage.estimated} geschätzt ·{" "}
            {statement.usage.sourceCoverage.unavailable} nicht verfügbar
          </dd>
        </div>
      </dl>
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={() => void downloadStatement()}
      >
        Monatsauszug herunterladen
      </button>
      {canEdit && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            try {
              const next = structuredClone(configuration);
              next.subscription.monthlyAmountMinor =
                parseMoneyInput(subscription);
              next.usage.includedAllowanceMinor =
                parseMoneyInput(allowance) ?? 0;
              next.usage.spendingLimitMinor = parseMoneyInput(limit);
              next.usage.supplyMode = supplyMode;
              void api<OrganizationCommercialConfig>(
                "/api/v1/admin/organization-economics/configuration",
                userId,
                {
                  method: "POST",
                  body: JSON.stringify({
                    expectedVersion: configuration.version,
                    configuration: next,
                  }),
                },
              )
                .then(() => loadEconomics())
                .catch((failure: unknown) =>
                  setError(
                    failure instanceof Error
                      ? failure.message
                      : "Speichern fehlgeschlagen.",
                  ),
                )
                .finally(() => setBusy(false));
            } catch (failure) {
              setError(
                failure instanceof Error
                  ? failure.message
                  : "Ungültige Eingabe.",
              );
              setBusy(false);
            }
          }}
        >
          <label>
            Bereitstellung der KI
            <select
              value={supplyMode}
              onChange={(event) =>
                setSupplyMode(event.target.value as typeof supplyMode)
              }
            >
              <option value="hosted-provider">Gehosteter Provider</option>
              <option value="customer-owned-key">
                API-Schlüssel der Organisation
              </option>
              <option value="local-inference">
                Lokale / air-gapped Inferenz
              </option>
            </select>
          </label>
          <label>
            Monatsabo ({statement.currency})
            <input
              inputMode="decimal"
              value={subscription}
              onChange={(event) => setSubscription(event.target.value)}
            />
          </label>
          <label>
            Gepoolte KI-Gutschrift ({statement.currency})
            <input
              inputMode="decimal"
              value={allowance}
              onChange={(event) => setAllowance(event.target.value)}
            />
          </label>
          <label>
            Ausgabenlimit ({statement.currency}, leer = nicht festgelegt)
            <input
              inputMode="decimal"
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
            />
          </label>
          <button className="secondary" disabled={busy}>
            {busy ? "Wird gespeichert…" : "Geprüfte Konfiguration speichern"}
          </button>
        </form>
      )}
      {error && (
        <div role="alert" className="assistant-error">
          {error}
        </div>
      )}
      <small>
        Zahlungen sind deaktiviert. Ein ausgeschöpftes KI-Budget stoppt nur neue
        Inferenz; manuelle Arbeit, bestehende Datensätze und bereits
        freigegebene Zustellungen bleiben verfügbar.
      </small>
    </details>
  );
}

function PflegehelferMark() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className="brand-mark">
      <defs>
        <mask id="pflegehelfer-edelweiss-cutout">
          <rect width="40" height="40" fill="white" />
          <path d="M17.5 13.5h5v4h4v5h-4v4h-5v-4h-4v-5h4z" fill="black" />
        </mask>
      </defs>
      <g mask="url(#pflegehelfer-edelweiss-cutout)">
        <path d="M20 2.5c4 3.3 5.1 7 3.2 11.2C21.9 16.5 18.1 16.5 16.8 13.7 14.9 9.5 16 5.8 20 2.5Z" />
        <path d="M37.5 20c-3.3 4-7 5.1-11.2 3.2-2.8-1.3-2.8-5.1 0-6.4 4.2-1.9 7.9-.8 11.2 3.2Z" />
        <path d="M20 37.5c-4-3.3-5.1-7-3.2-11.2 1.3-2.8 5.1-2.8 6.4 0 1.9 4.2.8 7.9-3.2 11.2Z" />
        <path d="M2.5 20c3.3-4 7-5.1 11.2-3.2 2.8 1.3 2.8 5.1 0 6.4C9.5 25.1 5.8 24 2.5 20Z" />
        <path d="M7.6 7.6c5.2.5 8.6 2.4 10.2 6.7 1.1 2.9-1.6 5.6-4.5 4.5-4.3-1.6-6.2-5-5.7-11.2Z" />
        <path d="M32.4 7.6c.5 5.2-1.4 8.6-5.7 10.2-2.9 1.1-5.6-1.6-4.5-4.5 1.6-4.3 5-6.2 10.2-5.7Z" />
        <path d="M32.4 32.4c-5.2.5-8.6-1.4-10.2-5.7-1.1-2.9 1.6-5.6 4.5-4.5 4.3 1.6 6.2 5 5.7 10.2Z" />
        <path d="M7.6 32.4c-.5-5.2 1.4-8.6 5.7-10.2 2.9-1.1 5.6 1.6 4.5 4.5-1.6 4.3-5 6.2-10.2 5.7Z" />
      </g>
    </svg>
  );
}

function InterfaceIcon({ name }: { name: "menu" | "scope" | "chevron" }) {
  if (name === "menu") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    );
  }
  if (name === "scope") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M16 20v-1.5a4.5 4.5 0 0 0-4.5-4.5h-3A4.5 4.5 0 0 0 4 18.5V20M10 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM17 11a3 3 0 0 0 0-6M18.5 14.2A4 4 0 0 1 22 18v2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m7 9 5 5 5-5" />
    </svg>
  );
}

function ContextPanel({
  snapshot,
  patient,
  onPatient,
  onNavigate,
  onUser,
  modal,
  theme,
  onTheme,
  busy,
  close,
  conversations,
}: {
  snapshot: AppSnapshot;
  patient: Patient | null;
  onPatient: (id: string | null) => Promise<boolean>;
  onNavigate: (destination: WorkspaceDestination) => void;
  onUser: (id: string) => void;
  modal: boolean;
  theme: "system" | "light" | "dark";
  onTheme: (theme: "system" | "light" | "dark") => void;
  busy: boolean;
  close: () => void;
  conversations: ConversationDescriptor[];
}) {
  const actions: Array<[string, WorkspaceDestination]> = [
    ["Mein Assistent", "Chat"],
    ["Bibliothek", "Library"],
    ["Pläne", "Plans"],
    ["Projekte", "Projects"],
    ["Patient:innen", "Patients"],
    ["Team & @Fragen", "Team"],
    ["Anbieter", "Provider"],
    ["Betriebsstatus", "Status"],
  ];
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLocaleLowerCase("de-CH");
  const visiblePatients = snapshot.patients.filter((item) =>
    `${item.room} ${item.displayName} ${item.mrn}`
      .toLocaleLowerCase("de-CH")
      .includes(normalizedSearch),
  );
  return (
    <aside
      className="context-panel"
      aria-label="Kontext und Verlauf"
      role={modal ? "dialog" : "complementary"}
      aria-modal={modal ? true : undefined}
    >
      <div className="context-brand">
        <span>
          <strong>Pflegehelfer</strong>
          <small>{snapshot.organization.displayName}</small>
        </span>
        <button
          className="drawer-close"
          aria-label="Menü schliessen"
          onClick={close}
        >
          ×
        </button>
      </div>
      <label className="context-search">
        <span className="sr-only">Arbeitsbereich durchsuchen</span>
        <input
          type="search"
          value={search}
          placeholder="Patienten suchen"
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <button
        className="new-context-button"
        disabled={busy}
        onClick={() =>
          void onPatient(null).then((changed) => {
            if (!changed) return;
            onNavigate("Chat");
            close();
          })
        }
      >
        <span aria-hidden="true">＋</span> Aktuellen Arbeitstag öffnen
      </button>
      <nav className="context-actions" aria-label="Arbeitskontext">
        {actions.map(([label, destination]) => (
          <button
            key={label}
            disabled={busy}
            onClick={() => {
              if (label === "Mein Assistent") {
                void onPatient(null).then((changed) => {
                  if (!changed) return;
                  onNavigate(destination);
                  close();
                });
                return;
              }
              onNavigate(destination);
              close();
            }}
          >
            <span>{label}</span>
            <small>Arbeitsbereich öffnen</small>
          </button>
        ))}
      </nav>
      <section className="governed-topics" aria-label="Freigegebene Teamthemen">
        <h2>Teamthemen</h2>
        <div>
          {snapshot.organization.governedTopics.map((topic) => (
            <button
              key={topic.id}
              title={topic.description}
              onClick={() => {
                onNavigate("Team");
                close();
              }}
            >
              #{topic.label}
            </button>
          ))}
        </div>
        <small>
          Themen filtern Gespräche; sie sind keine klinischen Warnungen.
        </small>
      </section>
      <section className="patient-context-list">
        <h2>Patientenkontext</h2>
        <p>Bewusst wählen — kein automatischer Wechsel.</p>
        {visiblePatients.map((item) => (
          <button
            key={item.id}
            disabled={busy}
            className={patient?.id === item.id ? "active" : ""}
            onClick={() =>
              void onPatient(item.id).then((changed) => {
                if (changed) {
                  onNavigate("Chat");
                  close();
                }
              })
            }
          >
            <span className="room-dot">{item.room}</span>
            <span>
              <strong>{item.displayName}</strong>
              <small>Fall {item.mrn}</small>
            </span>
          </button>
        ))}
      </section>
      {conversations.length > 1 && (
        <section className="conversation-history">
          <h2>Letzte Gespräche</h2>
          {conversations
            .filter((item) => item.type === "patient-assistant")
            .slice(0, 8)
            .map((item) => {
              const subject = snapshot.patients.find(
                (patient) => patient.id === item.patientId,
              );
              if (!subject) return null;
              return (
                <button
                  key={item.id}
                  className={item.active ? "active" : ""}
                  disabled={busy}
                  onClick={() =>
                    void onPatient(subject.id).then((changed) => {
                      if (changed) close();
                    })
                  }
                >
                  <span>{subject.room}</span>
                  <span>
                    <strong>{subject.displayName}</strong>
                    <small>
                      Privat mit Pflegehelfer ·{" "}
                      {new Date(item.lastActivityAt).toLocaleDateString(
                        "de-CH",
                      )}
                    </small>
                  </span>
                </button>
              );
            })}
        </section>
      )}
      <footer className="context-footer">
        <label className="drawer-role-switcher">
          <span>Demo-Rolle</span>
          <select
            value={snapshot.currentUser.id}
            disabled={busy}
            onChange={(event) => onUser(event.target.value)}
          >
            {snapshot.users.map((user) => (
              <option value={user.id} key={user.id}>
                {user.displayName} · {roleLabels[user.role]}
              </option>
            ))}
          </select>
        </label>
        <label className="theme-select">
          <span>Darstellung</span>
          <select
            value={theme}
            onChange={(event) =>
              onTheme(event.target.value as "system" | "light" | "dark")
            }
          >
            <option value="system">System</option>
            <option value="light">Hell</option>
            <option value="dark">Dunkel</option>
          </select>
        </label>
        {snapshot.organization.dataClass === "synthetic-demo" ? (
          <>
            <strong>Synthetische Demonstrationsumgebung</strong>
            <span>
              Keine offizielle Tertianum-Installation. Keine echten
              Patientendaten eingeben. Alle Personen und Datensätze sind frei
              erfunden.
            </span>
          </>
        ) : (
          <>
            <strong>Institutioneller Arbeitsbereich</strong>
            <span>
              Es gelten die freigegebenen Datenschutz- und Betriebsregeln.
            </span>
          </>
        )}
      </footer>
    </aside>
  );
}

function DraftHandoffSheet({
  handoff,
  patient,
  userId,
  close,
  done,
}: {
  handoff: AssistantHandoff;
  patient: Patient;
  userId: string;
  close: () => void;
  done: (message: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(handoff.title);
  const [reason, setReason] = useState(handoff.reason);
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]",
        ),
      ];
      if (controls.length === 0) return;
      const first = controls[0]!;
      const last = controls.at(-1)!;
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
      if (previous?.isConnected) previous.focus();
      else
        document
          .querySelector<HTMLElement>(".composer-input textarea")
          ?.focus();
    };
  }, [close]);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (handoff.kind === "communication")
        await api("/api/v1/communications", userId, {
          method: "POST",
          body: JSON.stringify({
            patientId: patient.id,
            request: title.trim(),
            reason: reason.trim(),
            recipientRole: handoff.recipientRole ?? "physician",
            recipientId: handoff.recipientId ?? null,
            priority: "routine",
            dueAt: handoff.dueAt,
          }),
        });
      else
        await api("/api/v1/tasks", userId, {
          method: "POST",
          body: JSON.stringify({
            patientId: patient.id,
            title: title.trim(),
            reason: reason.trim(),
            ownerRole: "registered-nurse",
            priority: "routine",
            dueAt: handoff.dueAt,
          }),
        });
      close();
      await done(
        handoff.kind === "communication"
          ? "Die geprüfte Teamfrage wurde gesendet."
          : "Die geprüfte Aufgabe wurde angelegt.",
      );
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
        ref={dialogRef}
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
          <button
            ref={closeRef}
            onClick={close}
            aria-label="Entwurf schliessen"
          >
            ×
          </button>
        </header>
        <div className="draft-review-copy">
          <label>
            <span>
              {handoff.kind === "communication" ? "Nachricht" : "Aufgabe"}
            </span>
            <input
              value={title}
              maxLength={1000}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            <span>Kontext / Begründung</span>
            <textarea
              value={reason}
              maxLength={1000}
              rows={4}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <small>
            {handoff.kind === "communication"
              ? `Empfänger: ${handoff.recipientLabel ?? handoff.recipientRole ?? "ärztlicher Dienst"}${handoff.recipientId ? " (bewusst gewählte Person)" : " (zuständige Rollenwarteschlange)"}. `
              : ""}
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
            Verwerfen
          </button>
          <button
            className="primary"
            disabled={
              busy ||
              !navigator.onLine ||
              title.trim().length < 3 ||
              reason.trim().length < 3
            }
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
  const [workday, setWorkday] = useState<WorkdayView | null>(null);
  const [conversations, setConversations] = useState<ConversationDescriptor[]>(
    [],
  );
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(
    () => sessionStorage.getItem("pfh-patient-context"),
  );
  const [destination, setDestination] = useState<WorkspaceDestination>("Chat");
  const [online, setOnline] = useState(navigator.onLine);
  const [apiReady, setApiReady] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [launchPrompt] = useState<{
    id: number;
    text: string;
    autoSubmit?: boolean;
  } | null>(null);
  const [handoff, setHandoff] = useState<AssistantHandoff | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [contextBusy, setContextBusy] = useState(false);
  const [theme, setTheme] = useState<"system" | "light" | "dark">(() => {
    const stored = localStorage.getItem("pfh-theme");
    return stored === "light" || stored === "dark" ? stored : "system";
  });
  const generation = useRef(0);
  const assistantContextBinding = useRef(
    createAssistantContextBindingCoordinator(),
  );

  const load = useCallback(
    async (selectedPatientOverride?: string | null) => {
      const current = ++generation.current;
      try {
        const data = await api<AppSnapshot>("/api/v1/snapshot", userId);
        const requestedPatientId =
          selectedPatientOverride === undefined
            ? selectedPatientId
            : selectedPatientOverride;
        const preferredPatientId =
          requestedPatientId &&
          data.patients.some((item) => item.id === requestedPatientId)
            ? requestedPatientId
            : null;
        await assistantContextBinding.current.ensure(
          { userId, patientId: preferredPatientId },
          () =>
            api("/api/v1/assistant/context", userId, {
              method: "POST",
              body: JSON.stringify({ patientId: preferredPatientId }),
            }),
        );
        if (current !== generation.current) return;
        const conversationData = await api<{
          conversations: ConversationDescriptor[];
        }>("/api/v1/assistant/conversation", userId);
        const workdayData = ["care-assistant", "registered-nurse"].includes(
          data.currentUser.role,
        )
          ? await api<WorkdayView>("/api/v1/workday", userId)
          : null;
        if (current !== generation.current) return;
        setSnapshot(data);
        setWorkday(workdayData);
        setConversations(conversationData.conversations);
        setApiReady(true);
        setSelectedPatientId(preferredPatientId);
      } catch (failure) {
        if (current !== generation.current) return;
        setApiReady(false);
        setNotice(
          failure instanceof Error
            ? failure.message
            : "Verbindung fehlgeschlagen.",
        );
      }
    },
    [selectedPatientId, userId],
  );

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!notice || !apiReady || !snapshot) return;
    const timer = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [apiReady, notice, snapshot]);
  useEffect(() => {
    if (!online || workday?.providerState !== "pending") return;
    let stopped = false;
    let timer: number | null = null;
    const pollDelivery = async () => {
      let stillPending = true;
      try {
        const next = await api<WorkdayView>("/api/v1/workday", userId);
        if (stopped) return;
        setWorkday(next);
        setApiReady(true);
        stillPending = next.providerState === "pending";
        if (!stillPending) void load();
      } catch {
        if (!stopped) setApiReady(false);
      }
      if (!stopped && stillPending)
        timer = window.setTimeout(() => void pollDelivery(), 1500);
    };
    timer = window.setTimeout(() => void pollDelivery(), 1500);
    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [load, online, userId, workday?.providerState]);
  useEffect(() => {
    if (theme === "system") {
      document.documentElement.removeAttribute("data-theme");
      localStorage.removeItem("pfh-theme");
    } else {
      document.documentElement.dataset.theme = theme;
      localStorage.setItem("pfh-theme", theme);
    }
  }, [theme]);
  useEffect(() => {
    if (snapshot)
      document.title = `Pflegehelfer · ${snapshot.organization.displayName}`;
  }, [snapshot]);
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = document.querySelector<HTMLElement>(".context-panel");
    panel?.querySelector<HTMLElement>(".drawer-close")?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setDrawerOpen(false);
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = [
        ...panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), select:not([disabled]), a[href], textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      previous?.focus();
    };
  }, [drawerOpen]);
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
    let reloadTimer: number | null = null;
    let stopped = false;
    let lastEventId = 0;
    const scheduleReload = () => {
      if (reloadTimer !== null) window.clearTimeout(reloadTimer);
      reloadTimer = window.setTimeout(() => {
        reloadTimer = null;
        void load();
      }, 75);
    };
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
            if (frame.includes("event: snapshot-invalidated")) scheduleReload();
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
      if (reloadTimer !== null) window.clearTimeout(reloadTimer);
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

  const choosePatient = async (id: string | null): Promise<boolean> => {
    if (assistantBusy || contextBusy) return false;
    const requestGeneration = generation.current;
    const requestUserId = userId;
    setContextBusy(true);
    setNotice(null);
    try {
      await api("/api/v1/assistant/context", userId, {
        method: "POST",
        body: JSON.stringify({ patientId: id }),
      });
      assistantContextBinding.current.markBound({ userId, patientId: id });
      if (requestGeneration !== generation.current || requestUserId !== userId)
        return false;
      const conversationData = await api<{
        conversations: ConversationDescriptor[];
      }>("/api/v1/assistant/conversation", userId);
      if (requestGeneration !== generation.current || requestUserId !== userId)
        return false;
      setConversations(conversationData.conversations);
      // Commit the visible selection only after all transition reads finish.
      // selectedPatientId intentionally triggers load(); doing this before the
      // conversation read increments generation and leaves this transition's
      // busy state permanently stale on fast clients.
      setSelectedPatientId(id);
      setDestination("Chat");
      if (id) sessionStorage.setItem("pfh-patient-context", id);
      else sessionStorage.removeItem("pfh-patient-context");
      return true;
    } catch (failure) {
      if (requestGeneration !== generation.current || requestUserId !== userId)
        return false;
      setNotice(
        failure instanceof Error
          ? failure.message
          : "Patientenkontext konnte nicht sicher gewechselt werden.",
      );
      return false;
    } finally {
      if (requestGeneration === generation.current && requestUserId === userId)
        setContextBusy(false);
    }
  };
  const changeUser = (next: string) => {
    generation.current += 1;
    rotateAssistantClientContext();
    assistantContextBinding.current.reset();
    setContextBusy(false);
    sessionStorage.setItem("pfh-demo-user", next);
    sessionStorage.removeItem("pfh-patient-context");
    setSelectedPatientId(null);
    setDestination("Chat");
    setSnapshot(null);
    setWorkday(null);
    setConversations([]);
    setNotice(null);
    setUserId(next);
  };

  if (!snapshot)
    return (
      <main className="safe-loading" role={notice ? "alert" : "status"}>
        <PflegehelferMark />
        <strong>
          {notice ? "Sicherer Fehlerzustand" : "Pflegehelfer verbindet…"}
        </strong>
        <p>{notice ?? "Pflegehelfer wird sicher geladen."}</p>
        {notice && online && (
          <button className="primary" onClick={() => void load()}>
            Erneut verbinden
          </button>
        )}
      </main>
    );

  const connected = online && apiReady;
  const queueCount = (queue: Record<string, number>, states: string[]) =>
    states.reduce((total, state) => total + (queue[state] ?? 0), 0);
  const delivery = snapshot.deliveryDiagnostics;
  const clinicalOpen = delivery
    ? queueCount(delivery.clinicalProjections, ["pending", "leased", "retry"])
    : 0;
  const clinicalReview = delivery
    ? queueCount(delivery.clinicalProjections, ["manual"])
    : 0;
  const providerOpen = delivery
    ? queueCount(delivery.providerDeliveries, ["pending", "leased", "retry"])
    : 0;
  const providerReview = delivery
    ? queueCount(delivery.providerDeliveries, ["manual"])
    : 0;
  const clinicalDelivered = delivery?.clinicalProjections.delivered ?? 0;
  const providerDelivered = delivery?.providerDeliveries.delivered ?? 0;
  const syncLabel = !connected
    ? "Offline"
    : snapshot.syncSummary.conflicts || providerReview
      ? "Abgleich prüfen"
      : clinicalReview
        ? "Medplum prüfen"
        : clinicalOpen
          ? "Lokal angenommen · Medplum offen"
          : providerOpen || workday?.providerState === "pending"
            ? "Medplum gespeichert · Anbieter offen"
            : clinicalDelivered > 0 && providerDelivered > 0
              ? "Medplum gespeichert · Anbieter bestätigt"
              : snapshot.syncSummary.unresolved
                ? `${snapshot.syncSummary.unresolved} ausstehend`
                : "Gespeichert · aktuell";
  const syncTitle = delivery
    ? `Lokal angenommen: ${Object.values(delivery.acceptedCommands).reduce((sum, count) => sum + count, 0)} · Medplum gespeichert: ${clinicalDelivered}, offen: ${clinicalOpen}, Prüfung: ${clinicalReview} · Anbieter bestätigt: ${providerDelivered}, offen: ${providerOpen}, Prüfung: ${providerReview}`
    : syncLabel;
  const syncCompactLabel =
    syncLabel === "Lokal angenommen · Medplum offen"
      ? "Lokal · Medplum offen"
      : syncLabel === "Medplum gespeichert · Anbieter offen"
        ? "Medplum · Anbieter offen"
        : syncLabel === "Medplum gespeichert · Anbieter bestätigt"
          ? "Gespeichert · bestätigt"
          : syncLabel;
  const opening =
    workflowOpenings[snapshot.currentUser.role] ?? fallbackOpening;
  const actorInitials = snapshot.currentUser.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase("de-CH");
  const patientLensDestinations: Record<string, WorkspaceDestination> = {
    Chat: "Chat",
    Profil: "Profile",
    Verlauf: "History",
    Werte: "Values",
    Team: "Team",
    Mehr: "Provider",
  };

  return (
    <div
      className={`clinical-coworker-shell${drawerOpen ? " drawer-open" : ""}`}
    >
      <button
        className="drawer-scrim"
        aria-label="Menü schliessen"
        onClick={() => setDrawerOpen(false)}
      />
      {drawerOpen && (
        <ContextPanel
          snapshot={snapshot}
          patient={patient}
          onPatient={choosePatient}
          onNavigate={setDestination}
          modal
          onUser={(id) => {
            setDrawerOpen(false);
            changeUser(id);
          }}
          theme={theme}
          onTheme={setTheme}
          busy={contextBusy || assistantBusy}
          close={() => setDrawerOpen(false)}
          conversations={conversations}
        />
      )}
      <main
        className="coworker-main"
        aria-hidden={drawerOpen ? true : undefined}
      >
        <header className="coworker-header">
          <button
            className="menu-button"
            aria-label="Kontext und Verlauf öffnen"
            onClick={() => setDrawerOpen(true)}
          >
            <InterfaceIcon name="menu" />
          </button>
          <div className="header-identity">
            <PflegehelferMark />
            <span>
              <strong>Pflegehelfer</strong>
              <small>{snapshot.organization.displayName}</small>
            </span>
          </div>
          <button
            className="header-scope-switcher"
            aria-label={
              patient
                ? `Aktiver Kontext: ${patient.displayName}, Zimmer ${patient.room}. Kontext wechseln`
                : "Aktiver Kontext: Mein Assistent. Kontext wechseln"
            }
            onClick={() => setDrawerOpen(true)}
          >
            <InterfaceIcon name="scope" />
            <span>
              <strong>{patient?.displayName ?? "Mein Assistent"}</strong>
              <small>
                {patient ? `${patient.room} · Privat` : "Privat · Allgemein"}
              </small>
            </span>
            <InterfaceIcon name="chevron" />
          </button>
          <div className="header-state">
            <span
              className={`connection-state ${connected ? "connected" : "offline"}${workday?.providerState === "pending" ? " pending" : ""}`}
              title={syncTitle}
              aria-label={syncTitle}
            >
              <i />
              <span
                className="sync-label"
                aria-hidden={connected ? true : undefined}
              >
                {syncCompactLabel}
              </span>
            </span>
            {snapshot.workspaceLinks && patient && (
              <a
                href={snapshot.workspaceLinks.patients[patient.id]}
                target="_blank"
                rel="noreferrer"
              >
                Klinische Detailansicht
              </a>
            )}
            <button
              type="button"
              className={`actor-avatar ${connected ? "connected" : "offline"}${workday?.providerState === "pending" ? " pending" : ""}`}
              aria-label={`Eigenes Profil öffnen: ${snapshot.currentUser.displayName}, ${roleLabels[snapshot.currentUser.role]}. ${syncTitle}`}
              title={`${snapshot.currentUser.displayName} · ${roleLabels[snapshot.currentUser.role]} · ${syncTitle}`}
              onClick={() => setDestination("MyProfile")}
            >
              {actorInitials}
              <i aria-hidden="true" />
            </button>
          </div>
        </header>
        {patient ? (
          <>
            <PatientSafetyBar
              patient={patient}
              onProfile={() => setDestination("Profile")}
            />
            <nav
              className="patient-workspace-tabs"
              aria-label="Patientenarbeitsbereich"
            >
              {["Chat", "Profil", "Verlauf", "Werte", "Team", "Mehr"].map(
                (label) => (
                  <button
                    key={label}
                    className={
                      patientLensDestinations[label] === destination
                        ? "active"
                        : ""
                    }
                    aria-current={
                      patientLensDestinations[label] === destination
                        ? "page"
                        : undefined
                    }
                    disabled={assistantBusy || contextBusy}
                    onClick={() => {
                      setDestination(patientLensDestinations[label] ?? "Chat");
                    }}
                  >
                    {label}
                  </button>
                ),
              )}
            </nav>
          </>
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
        {destination === "Chat" && (
          <CountersignaturePanel
            snapshot={snapshot}
            userId={userId}
            activePatientId={selectedPatientId}
            activeEncounterId={patient?.encounterId ?? null}
            done={async (message) => {
              await load();
              setNotice(message);
            }}
          />
        )}
        {destination === "Provider" &&
          ["management", "it", "quality-safety"].includes(
            snapshot.currentUser.role,
          ) && (
            <OrganizationEconomicsPanel
              userId={userId}
              canEdit={["management", "it"].includes(snapshot.currentUser.role)}
            />
          )}
        {destination === "Chat" ? (
          <AssistantSurface
            patient={patient}
            userId={userId}
            online={connected}
            onExecuted={async (message, activePatientId) => {
              if (activePatientId) {
                assistantContextBinding.current.markBound({
                  userId,
                  patientId: activePatientId,
                });
                setSelectedPatientId(activePatientId);
                sessionStorage.setItem("pfh-patient-context", activePatientId);
              }
              await load(activePatientId);
              setNotice(message);
            }}
            onHandoff={setHandoff}
            snapshotRevision={revision}
            opening={opening}
            launchPrompt={launchPrompt}
            onSelectPatient={(id) => void choosePatient(id)}
            externallyBusy={contextBusy}
            onBusyChange={setAssistantBusy}
          />
        ) : (
          <WorkspaceView
            destination={destination}
            snapshot={snapshot}
            patient={patient}
            userId={userId}
            workday={
              ["care-assistant", "registered-nurse"].includes(
                snapshot.currentUser.role,
              )
                ? workday
                : null
            }
            busy={contextBusy || assistantBusy}
            onPatient={(id) => {
              void choosePatient(id).then((changed) => {
                if (changed) setDestination("Profile");
              });
            }}
            onError={setNotice}
            onWorkdayAction={async (command) => {
              const next = await api<WorkdayView>("/api/v1/workday", userId, {
                method: "POST",
                body: JSON.stringify(command),
              });
              setWorkday(next);
              const activePatientId = next.activeEpisode?.patientId ?? null;
              if (activePatientId) {
                await api("/api/v1/assistant/context", userId, {
                  method: "POST",
                  body: JSON.stringify({ patientId: activePatientId }),
                });
                assistantContextBinding.current.markBound({
                  userId,
                  patientId: activePatientId,
                });
                setSelectedPatientId(activePatientId);
                sessionStorage.setItem("pfh-patient-context", activePatientId);
              }
              await load();
            }}
          />
        )}
      </main>
      {handoff && patient && (
        <DraftHandoffSheet
          handoff={handoff}
          patient={patient}
          userId={userId}
          close={() => {
            setHandoff(null);
            setNotice("Entwurf verworfen. Es wurde nichts gesendet.");
          }}
          done={async (message) => {
            await load();
            setNotice(message);
          }}
        />
      )}
    </div>
  );
}
