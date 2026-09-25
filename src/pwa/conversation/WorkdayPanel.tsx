import { useEffect, useState } from "react";
import type { Patient } from "../../core/types";
import type { WorkdayCommand, WorkdayView } from "../../core/workday";

export function WorkdayPanel({
  workday,
  patients,
  busy,
  onPatient,
  onAction,
  onError,
}: {
  workday: WorkdayView;
  patients: Patient[];
  busy: boolean;
  onPatient: (patientId: string) => void;
  onAction: (command: WorkdayCommand) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(
    workday.handover.patientIds.find(
      (id) => !workday.handover.acknowledgedPatientIds.includes(id),
    ) ?? null,
  );
  const [episodeDraft, setEpisodeDraft] = useState({
    episodeId: workday.activeEpisode?.id ?? null,
    text: workday.activeEpisode?.draftText ?? "",
  });
  const [readout, setReadout] = useState<"idle" | "playing" | "paused">("idle");
  const patientFor = (id: string) =>
    patients.find((patient) => patient.id === id) ?? null;
  const interruptPatient = workday.activeEpisode
    ? (patients.find(
        (patient) =>
          patient.id !== workday.activeEpisode?.patientId &&
          workday.plan.some(
            (item) =>
              item.patientId === patient.id && item.status === "planned",
          ),
      ) ?? null)
    : null;
  const episodeEvidence = workday.activeEpisode
    ? episodeDraft.episodeId === workday.activeEpisode.id
      ? episodeDraft.text
      : (workday.activeEpisode.draftText ?? "")
    : "";
  const readoutText = workday.plan
    .map((plan) => {
      const patient = patientFor(plan.patientId);
      const item = workday.handover.items.find(
        (candidate) => candidate.patientId === plan.patientId,
      );
      return [
        `${patient?.displayName ?? "Patient"}, Zimmer ${patient?.room ?? "unbekannt"}.`,
        `Wichtig zu wissen: ${item?.currentImportant.join("; ") || "keine besonderen Hinweise"}.`,
        `Was in der letzten Schicht passiert ist: ${item?.recentChanges.join("; ") || "keine neuen freigegebenen Einträge"}.`,
        `Wichtige nächste Schritte: ${[
          `${plan.title}. ${plan.reason}`,
          ...(item?.openQuestions ?? []),
        ].join("; ")}.`,
      ].join(" ");
    })
    .join(" ");

  useEffect(() => {
    const episode = workday.activeEpisode;
    if (!episode || busy || episodeEvidence === (episode.draftText ?? ""))
      return;
    const timer = window.setTimeout(() => {
      void onAction({
        type: "save-episode-draft",
        episodeId: episode.id,
        draftText: episodeEvidence,
      }).catch((error: unknown) =>
        onError(
          error instanceof Error
            ? error.message
            : "Arbeitsnotiz konnte nicht gespeichert werden.",
        ),
      );
    }, 450);
    return () => window.clearTimeout(timer);
  }, [busy, episodeEvidence, onAction, onError, workday.activeEpisode]);

  useEffect(
    () => () => {
      window.speechSynthesis?.cancel();
    },
    [],
  );

  const act = (command: WorkdayCommand, message: string) =>
    void onAction(command).catch((error: unknown) =>
      onError(error instanceof Error ? error.message : message),
    );

  const toggleReadout = () => {
    if (!("speechSynthesis" in window)) return;
    if (readout === "playing") {
      window.speechSynthesis.pause();
      setReadout("paused");
      return;
    }
    if (readout === "paused") {
      window.speechSynthesis.resume();
      setReadout("playing");
      return;
    }
    const utterance = new SpeechSynthesisUtterance(readoutText);
    utterance.lang = "de-CH";
    utterance.onend = () => setReadout("idle");
    utterance.onerror = () => setReadout("idle");
    window.speechSynthesis.speak(utterance);
    setReadout("playing");
  };

  return (
    <article className="workday-panel" data-genui-component="Workday">
      <header>
        <div>
          <span>
            {workday.stage === "handover"
              ? "Schichtübernahme"
              : workday.stage === "closed"
                ? "Schicht abgeschlossen"
                : "Aktueller Arbeitstag"}
          </span>
          <h2>
            {workday.stage === "handover"
              ? "Übergabe patientenweise übernehmen"
              : workday.stage === "closed"
                ? "Schicht sicher abgeschlossen"
                : "Dein sicherer Arbeitsplan"}
          </h2>
        </div>
        <strong>
          {workday.handover.acknowledgedPatientIds.length}/
          {workday.handover.patientIds.length} Patientenkontexte geprüft
        </strong>
      </header>

      {workday.stage === "handover" && (
        <>
          <div className="workday-readout">
            <button type="button" onClick={toggleReadout} disabled={busy}>
              {readout === "idle"
                ? "Übergabe vorlesen"
                : readout === "playing"
                  ? "Pause"
                  : "Weiterlesen"}
            </button>
            {readout !== "idle" && (
              <button
                type="button"
                onClick={() => {
                  window.speechSynthesis.cancel();
                  setReadout("idle");
                }}
              >
                Stop
              </button>
            )}
            <small>
              Vorlesen bestätigt die Übergabe nicht. Inhalt entspricht exakt dem
              eingefrorenen Stand.
            </small>
          </div>
          <div className="workday-roster" aria-label="Übergabe-Roster">
            {workday.handover.patientIds.map((patientId) => {
              const patient = patientFor(patientId);
              const item = workday.handover.items.find(
                (candidate) => candidate.patientId === patientId,
              );
              const plan = workday.plan.find(
                (candidate) => candidate.patientId === patientId,
              );
              const done =
                workday.handover.acknowledgedPatientIds.includes(patientId);
              if (!patient) return null;
              return (
                <section className="workday-row handover-row" key={patientId}>
                  <button
                    className="workday-patient"
                    aria-expanded={expanded === patientId}
                    disabled={busy}
                    onClick={() => {
                      setExpanded(expanded === patientId ? null : patientId);
                      onPatient(patientId);
                    }}
                  >
                    <strong>
                      {patient.room} · {patient.displayName}
                    </strong>
                    <small>{plan?.title ?? "Pflegeplanung prüfen"}</small>
                  </button>
                  <button
                    className={done ? "status-button done" : "status-button"}
                    disabled={busy || done}
                    aria-label={`${done ? "Übergabe geprüft" : "Gelesen und übernehmen"}: Zimmer ${patient.room}, ${patient.displayName}`}
                    onClick={() =>
                      act(
                        {
                          type: "acknowledge-handover",
                          handoverId: workday.handover.id,
                          patientId,
                          version: workday.handover.version,
                        },
                        "Übergabe konnte nicht bestätigt werden.",
                      )
                    }
                  >
                    {done ? "Geprüft" : "Gelesen & übernehmen"}
                  </button>
                  {expanded === patientId && (
                    <div className="handover-expanded">
                      <dl className="handover-sections">
                        <div>
                          <dt>Wichtig zu wissen</dt>
                          <dd>
                            {item?.currentImportant.join(" · ") ||
                              "Keine besonderen Hinweise"}
                          </dd>
                        </div>
                        <div>
                          <dt>Was in der letzten Schicht passiert ist</dt>
                          <dd>
                            {item?.recentChanges.join(" · ") ||
                              "Keine neuen freigegebenen Einträge"}
                          </dd>
                        </div>
                        <div>
                          <dt>Wichtige nächste Schritte</dt>
                          <dd>
                            {plan
                              ? `${plan.title} · ${plan.reason}`
                              : "Keine Planung"}
                            {item?.openQuestions.length
                              ? ` · ${item.openQuestions.join(" · ")}`
                              : ""}
                          </dd>
                        </div>
                      </dl>
                      <details className="handover-technical">
                        <summary>Technische Bindung</summary>
                        <small>
                          Fall {item?.encounterId ?? "nicht gebunden"} ·
                          eingefroren{" "}
                          {new Date(workday.handover.cutoffAt).toLocaleString(
                            "de-CH",
                          )}{" "}
                          · Version {workday.handover.version}
                        </small>
                      </details>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}

      {workday.stage !== "handover" && workday.stage !== "closed" && (
        <div className="workday-roster" aria-label="Patientenplan">
          {workday.plan.map((plan) => {
            const patient = patientFor(plan.patientId);
            if (!patient) return null;
            return (
              <section className="workday-row" key={plan.patientId}>
                <button
                  className="workday-patient"
                  disabled={busy}
                  onClick={() => onPatient(patient.id)}
                >
                  <strong>
                    {patient.room} · {patient.displayName}
                  </strong>
                  <span>{plan.title}</span>
                  <small>{plan.reason}</small>
                </button>
                {plan.status === "planned" && !workday.activeEpisode ? (
                  <div className="button-row compact-actions">
                    <button
                      className="status-button"
                      disabled={busy}
                      aria-label={`Arbeit beginnen: Zimmer ${patient.room}, ${patient.displayName}`}
                      onClick={() =>
                        act(
                          {
                            type: "start-episode",
                            patientId: patient.id,
                            encounterId: patient.encounterId,
                            kind: "planned",
                            title: plan.title,
                          },
                          "Arbeit konnte nicht begonnen werden.",
                        )
                      }
                    >
                      Beginnen
                    </button>
                    <button
                      className="status-button secondary"
                      disabled={busy}
                      aria-label={`Offene Verantwortung übergeben: Zimmer ${patient.room}, ${patient.displayName}`}
                      onClick={() =>
                        act(
                          {
                            type: "defer-responsibility",
                            patientId: patient.id,
                            encounterId: patient.encounterId,
                            reason:
                              "Im aktuellen Dienst nicht abgeschlossen; sichtbar an die nächste Verantwortung übergeben.",
                            receivingActorId:
                              workday.handover.nextResponsibleActorId,
                          },
                          "Verantwortung konnte nicht übergeben werden.",
                        )
                      }
                    >
                      Übergeben
                    </button>
                  </div>
                ) : (
                  <span className={`episode-state ${plan.status}`}>
                    {plan.status === "active"
                      ? "Aktiv"
                      : plan.status === "paused"
                        ? "Unterbrochen"
                        : "Dokumentiert"}
                  </span>
                )}
              </section>
            );
          })}
        </div>
      )}

      {workday.activeEpisode && (
        <section className="episode-controls" aria-label="Aktive Arbeit">
          <strong>{workday.activeEpisode.title}</strong>
          <label>
            Was wurde tatsächlich durchgeführt?
            <textarea
              value={episodeEvidence}
              rows={2}
              maxLength={8000}
              onChange={(event) =>
                setEpisodeDraft({
                  episodeId: workday.activeEpisode!.id,
                  text: event.target.value,
                })
              }
            />
          </label>
          <div className="button-row">
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                act(
                  {
                    type: "pause-episode",
                    episodeId: workday.activeEpisode!.id,
                    reason: "interruption",
                    draftText: episodeEvidence,
                  },
                  "Unterbrechung konnte nicht gespeichert werden.",
                )
              }
            >
              Unterbrechen
            </button>
            {interruptPatient && (
              <button
                className="secondary alarm-button"
                disabled={busy}
                onClick={() =>
                  act(
                    {
                      type: "interrupt-and-start",
                      episodeId: workday.activeEpisode!.id,
                      patientId: interruptPatient.id,
                      encounterId: interruptPatient.encounterId,
                      title: `Simulierter Klingelruf · Zimmer ${interruptPatient.room}`,
                      pausedDraftText: episodeEvidence,
                    },
                    "Klingelruf konnte nicht übernommen werden.",
                  )
                }
              >
                Simulierten Ruf {interruptPatient.room} übernehmen
              </button>
            )}
            <button
              className="primary"
              disabled={busy || episodeEvidence.trim().length < 10}
              onClick={() =>
                act(
                  {
                    type: "complete-episode",
                    episodeId: workday.activeEpisode!.id,
                    evidence: episodeEvidence,
                  },
                  "Abschluss konnte nicht gespeichert werden.",
                )
              }
            >
              Dokumentieren & abschliessen
            </button>
          </div>
        </section>
      )}

      {!workday.activeEpisode && workday.resumableEpisode && (
        <section className="episode-resume">
          <span>Unterbrochen</span>
          <strong>{workday.resumableEpisode.title}</strong>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              act(
                {
                  type: "resume-episode",
                  episodeId: workday.resumableEpisode!.id,
                },
                "Arbeit konnte nicht fortgesetzt werden.",
              )
            }
          >
            Patientenkontext fortsetzen
          </button>
        </section>
      )}

      {workday.incomingTransfers
        .filter((transfer) => transfer.state === "pending")
        .map((transfer) => (
          <section className="episode-resume" key={transfer.id}>
            <span>Nächste Schicht · Eingang</span>
            <strong>{patientFor(transfer.patientId)?.displayName}</strong>
            <p>{transfer.reason}</p>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                act(
                  { type: "acknowledge-transfer", transferId: transfer.id },
                  "Übernahme konnte nicht quittiert werden.",
                )
              }
            >
              Verantwortung übernehmen
            </button>
          </section>
        ))}

      {workday.stage === "closed" && workday.outgoingTransfers.length > 0 && (
        <section
          className="episode-resume"
          aria-label="Ausgehende Verantwortungsübergaben"
        >
          <span>Nächste Schicht · Ausgang</span>
          {workday.outgoingTransfers.map((transfer) => (
            <div className="transfer-row" key={transfer.id}>
              <strong>
                {patientFor(transfer.patientId)?.displayName ??
                  "Patientenkontext"}
              </strong>
              <p>{transfer.reason}</p>
              <small>
                {transfer.state === "acknowledged"
                  ? "Übernahme bestätigt"
                  : "Wartet auf Bestätigung der nächsten Schicht"}
              </small>
            </div>
          ))}
        </section>
      )}

      {workday.stage !== "handover" &&
        workday.stage !== "closed" &&
        !workday.activeEpisode &&
        !workday.resumableEpisode &&
        workday.episodes.length > 0 &&
        workday.plan.every((item) =>
          ["completed", "paused"].includes(item.status),
        ) && (
          <button
            className="primary close-shift-button"
            disabled={busy}
            onClick={() =>
              act(
                { type: "close-shift" },
                "Schicht konnte nicht abgeschlossen werden.",
              )
            }
          >
            Übergabe vorbereiten und Schicht beenden
          </button>
        )}
    </article>
  );
}
