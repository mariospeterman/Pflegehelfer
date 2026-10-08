import { useEffect, useRef, useState } from "react";
import type { Patient } from "../../core/types";
import type { WorkdayCommand, WorkdayView } from "../../core/workday";
import { assistantClientContextHeaders } from "../assistant-context";

export function WorkdayPanel({
  workday,
  patients,
  busy,
  view,
  userId,
  onPatient,
  onAction,
  onError,
  onNavigate,
}: {
  workday: WorkdayView;
  patients: Patient[];
  busy: boolean;
  view: "handover" | "plan" | "tasks";
  userId: string;
  onPatient: (patientId: string) => void;
  onAction: (command: WorkdayCommand) => Promise<void>;
  onError: (message: string) => void;
  onNavigate: (destination: "Handover" | "Plans" | "Tasks") => void;
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
  const [readout, setReadout] = useState<{
    patientId: string | null;
    state: "idle" | "playing" | "paused";
  }>({ patientId: null, state: "idle" });
  const [readoutError, setReadoutError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const readoutRequestRef = useRef<{
    generation: number;
    abort: AbortController;
  } | null>(null);
  const [reviewEvidence, setReviewEvidence] = useState<string | null>(null);
  const [additionalOpen, setAdditionalOpen] = useState(false);
  const [additionalPatientId, setAdditionalPatientId] = useState(
    workday.activeEpisode?.patientId ?? workday.plan[0]?.patientId ?? "",
  );
  const [additionalTitle, setAdditionalTitle] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const blocked = busy || actionBusy;
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
  const readoutText = (patientId: string) => {
    const patient = patientFor(patientId);
    const plan = workday.plan.find(
      (candidate) => candidate.patientId === patientId,
    );
    const item = workday.handover.items.find(
      (candidate) => candidate.patientId === patientId,
    );
    return [
      `${patient?.displayName ?? "Patient"}, Zimmer ${patient?.room ?? "unbekannt"}.`,
      `Wichtig zu wissen: ${item?.currentImportant.join("; ") || "keine freigegebenen Angaben verfügbar"}.`,
      `Was in der letzten Schicht passiert ist: ${item?.recentChanges.join("; ") || "keine freigegebenen Angaben verfügbar"}.`,
      `Wichtige nächste Schritte: ${[
        ...(plan
          ? [`${plan.title}. ${plan.reason}`]
          : ["keine freigegebene Planung verfügbar"]),
        ...(item?.openQuestions ?? []),
      ].join("; ")}.`,
    ].join(" ");
  };

  useEffect(() => {
    const episode = workday.activeEpisode;
    if (!episode || blocked || episodeEvidence === (episode.draftText ?? ""))
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
  }, [blocked, episodeEvidence, onAction, onError, workday.activeEpisode]);

  useEffect(
    () => () => {
      readoutRequestRef.current?.abort.abort();
      readoutRequestRef.current = null;
      audioRef.current?.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      window.speechSynthesis?.cancel();
    },
    [],
  );
  const act = (command: WorkdayCommand, message: string) => {
    if (blocked) return;
    setActionBusy(true);
    void onAction(command)
      .catch((error: unknown) =>
        onError(error instanceof Error ? error.message : message),
      )
      .finally(() => setActionBusy(false));
  };

  const stopReadout = () => {
    readoutRequestRef.current?.abort.abort();
    readoutRequestRef.current = null;
    audioRef.current?.pause();
    audioRef.current = null;
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
    window.speechSynthesis?.cancel();
    setReadout({ patientId: null, state: "idle" });
  };

  const toggleReadout = async (patientId: string) => {
    setReadoutError(null);
    if (readout.patientId === patientId && readout.state === "playing") {
      if (audioRef.current) audioRef.current.pause();
      else window.speechSynthesis?.pause();
      setReadout({ patientId, state: "paused" });
      return;
    }
    if (readout.patientId === patientId && readout.state === "paused") {
      if (audioRef.current) await audioRef.current.play();
      else window.speechSynthesis?.resume();
      setReadout({ patientId, state: "playing" });
      return;
    }
    const reset = () => {
      audioRef.current = null;
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
      setReadout({ patientId: null, state: "idle" });
    };
    audioRef.current?.pause();
    reset();
    window.speechSynthesis?.cancel();
    const generation = (readoutRequestRef.current?.generation ?? 0) + 1;
    readoutRequestRef.current?.abort.abort();
    const abort = new AbortController();
    readoutRequestRef.current = { generation, abort };
    const current = () =>
      readoutRequestRef.current?.generation === generation &&
      !abort.signal.aborted;
    try {
      const statusResponse = await fetch("/api/v1/ai/status", {
        signal: abort.signal,
        headers: {
          "x-demo-user": userId,
          ...assistantClientContextHeaders(),
        },
      });
      const status = (await statusResponse.json()) as {
        tts?: { mode?: string; ready?: boolean; acceptance?: string };
        message?: string;
      };
      if (!current()) return;
      if (!statusResponse.ok)
        throw new Error(status.message ?? "Sprachausgabe nicht verfügbar.");
      const text = readoutText(patientId);
      if (
        status.tts?.ready &&
        status.tts.acceptance === "accepted" &&
        status.tts.mode !== "browser-demo"
      ) {
        const response = await fetch("/api/v1/assistant/speech", {
          method: "POST",
          signal: abort.signal,
          headers: {
            "content-type": "application/json",
            "x-demo-user": userId,
            ...assistantClientContextHeaders(),
            "x-command-id": crypto.randomUUID(),
          },
          body: JSON.stringify({ text }),
        });
        if (!response.ok) {
          const failure = (await response.json()) as { message?: string };
          throw new Error(failure.message ?? "Sprachausgabe fehlgeschlagen.");
        }
        const blob = await response.blob();
        if (!current()) return;
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        audioUrlRef.current = url;
        audio.onended = reset;
        audio.onerror = () => {
          reset();
          setReadoutError("Die Audiodatei konnte nicht abgespielt werden.");
        };
        setReadout({ patientId, state: "playing" });
        await audio.play();
        return;
      }
      if (status.tts?.mode === "browser-demo" && "speechSynthesis" in window) {
        if (!current()) return;
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "de-CH";
        const voice = window.speechSynthesis
          .getVoices()
          .find((candidate) => /^de(-CH|-DE)?$/i.test(candidate.lang));
        if (voice) utterance.voice = voice;
        utterance.onend = reset;
        utterance.onerror = () => {
          reset();
          setReadoutError("Browser-Vorlesen wurde abgebrochen.");
        };
        window.speechSynthesis.speak(utterance);
        setReadout({ patientId, state: "playing" });
        return;
      }
      throw new Error("Sprachausgabe ist in diesem Modus nicht freigegeben.");
    } catch (error) {
      if (abort.signal.aborted) return;
      reset();
      setReadoutError(
        error instanceof Error
          ? error.message
          : "Sprachausgabe fehlgeschlagen.",
      );
    }
  };

  const completedCount = workday.plan.filter(
    (item) => item.status === "completed",
  ).length;
  const header =
    view === "handover"
      ? {
          eyebrow: "Schritt 1 · Schichtübernahme",
          title: "Übergabe patientenweise übernehmen",
          status: `${workday.handover.acknowledgedPatientIds.length}/${workday.handover.patientIds.length} Patientenkontexte geprüft`,
        }
      : view === "plan"
        ? {
            eyebrow: "Schritt 2 · Orientierung",
            title: "Dein Arbeitsplan",
            status: `${completedCount}/${workday.plan.length} Meilensteine dokumentiert`,
          }
        : {
            eyebrow: "Schritt 3 · Ausführen und prüfen",
            title: "Deine heutigen Aufgaben",
            status: `${completedCount}/${workday.plan.length} abgeschlossen`,
          };

  return (
    <article className="workday-panel" data-genui-component="Workday">
      <header>
        <div>
          <span>{header.eyebrow}</span>
          <h2>{header.title}</h2>
        </div>
        <strong>{header.status}</strong>
      </header>

      <nav className="workday-steps" aria-label="Arbeitstagsschritte">
        <button
          type="button"
          className={view === "handover" ? "active" : ""}
          aria-current={view === "handover" ? "step" : undefined}
          onClick={() => onNavigate("Handover")}
        >
          <span>1</span> Übergabe
        </button>
        <button
          type="button"
          className={view === "plan" ? "active" : ""}
          aria-current={view === "plan" ? "step" : undefined}
          onClick={() => onNavigate("Plans")}
        >
          <span>2</span> Arbeitsplan
        </button>
        <button
          type="button"
          className={view === "tasks" ? "active" : ""}
          aria-current={view === "tasks" ? "step" : undefined}
          onClick={() => onNavigate("Tasks")}
        >
          <span>3</span> Arbeiten & prüfen
        </button>
      </nav>

      {view === "handover" && (
        <>
          {workday.stage !== "handover" && (
            <div className="workday-started" role="status">
              Übergabe vollständig geprüft. Der eingefrorene Stand bleibt hier
              jederzeit lesbar; der Arbeitsplan ist separat geöffnet.
            </div>
          )}
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
                    disabled={blocked}
                    onClick={() => {
                      if (
                        readout.patientId &&
                        readout.patientId !== patientId
                      ) {
                        stopReadout();
                      }
                      setExpanded(expanded === patientId ? null : patientId);
                    }}
                  >
                    <strong>
                      {patient.room} · {patient.displayName}
                    </strong>
                    <small>{plan?.title ?? "Pflegeplanung prüfen"}</small>
                  </button>
                  <button
                    className={done ? "status-button done" : "status-button"}
                    disabled={blocked || done}
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
                              "Keine freigegebenen Angaben verfügbar"}
                          </dd>
                        </div>
                        <div>
                          <dt>Was in der letzten Schicht passiert ist</dt>
                          <dd>
                            {item?.recentChanges.join(" · ") ||
                              "Keine freigegebenen Angaben verfügbar"}
                          </dd>
                        </div>
                        <div>
                          <dt>Wichtige nächste Schritte</dt>
                          <dd>
                            {plan
                              ? `${plan.title} · ${plan.reason}`
                              : "Keine freigegebene Planung verfügbar"}
                            {item?.openQuestions.length
                              ? ` · ${item.openQuestions.join(" · ")}`
                              : ""}
                          </dd>
                        </div>
                      </dl>
                      <div className="handover-readout">
                        <button
                          type="button"
                          className="handover-readout-button"
                          aria-label={`Übergabe von ${patient.displayName} ${
                            readout.patientId === patientId &&
                            readout.state === "playing"
                              ? "pausieren"
                              : readout.patientId === patientId &&
                                  readout.state === "paused"
                                ? "weiterlesen"
                                : "vorlesen"
                          }`}
                          onClick={() => void toggleReadout(patientId)}
                          disabled={blocked}
                        >
                          <span aria-hidden="true">▷</span>
                          {readout.patientId === patientId &&
                          readout.state === "playing"
                            ? "Pause"
                            : readout.patientId === patientId &&
                                readout.state === "paused"
                              ? "Weiterlesen"
                              : "Vorlesen"}
                        </button>
                        {readout.patientId === patientId &&
                          readout.state !== "idle" && (
                            <button
                              type="button"
                              className="handover-readout-button"
                              onClick={stopReadout}
                            >
                              Stop
                            </button>
                          )}
                        <small>
                          Liest genau diesen eingefrorenen Patientenstand;
                          bestätigt ihn nicht.
                        </small>
                      </div>
                      {readoutError && (
                        <small className="handover-readout-error" role="alert">
                          {readoutError}
                        </small>
                      )}
                      <details className="handover-technical">
                        <summary>Stand der Übergabe</summary>
                        <small>
                          Fall {patient.mrn} · eingefroren{" "}
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

      {view === "plan" && (
        <>
          {workday.stage === "handover" ? (
            <div className="workday-gate" role="status">
              <div>
                <strong>Arbeitsplan noch nicht freigegeben</strong>
                <small>
                  Zuerst alle {workday.handover.patientIds.length}
                  Patientenkontexte der Übergabe prüfen.
                </small>
              </div>
              <button
                className="primary"
                onClick={() => onNavigate("Handover")}
              >
                Übergabe fortsetzen
              </button>
            </div>
          ) : (
            <div className="workday-started" role="status">
              Zeitfenster, Begründung und aktueller Stand stammen aus dem
              freigegebenen Schichtplan. Arbeit wird unter Aufgaben ausgeführt.
            </div>
          )}
          <div className="work-plan-list" aria-label="Arbeitsplan">
            {workday.plan.map((plan, index) => {
              const patient = patientFor(plan.patientId);
              if (!patient) return null;
              const [windowLabel, ...reasonParts] = plan.reason.split(" · ");
              const handoverItem = workday.handover.items.find(
                (item) => item.patientId === plan.patientId,
              );
              return (
                <article className="work-plan-card" key={plan.patientId}>
                  <span className="work-plan-order">{index + 1}</span>
                  <button
                    type="button"
                    className="work-plan-patient"
                    onClick={() => onPatient(patient.id)}
                  >
                    <strong>
                      {patient.room} · {patient.displayName}
                    </strong>
                    <span>{plan.title}</span>
                  </button>
                  <dl>
                    <div>
                      <dt>Zeit</dt>
                      <dd>{windowLabel}</dd>
                    </div>
                    <div>
                      <dt>Grund / Quelle</dt>
                      <dd>
                        {reasonParts.join(" · ") || "Freigegebener Pflegeplan"}
                      </dd>
                    </div>
                    <div>
                      <dt>Abhängigkeiten</dt>
                      <dd>
                        {handoverItem?.openQuestions.join(" · ") ||
                          "Keine dokumentiert"}
                      </dd>
                    </div>
                    <div>
                      <dt>Stand</dt>
                      <dd>
                        {plan.status === "planned"
                          ? "Geplant"
                          : plan.status === "active"
                            ? "In Arbeit"
                            : plan.status === "paused"
                              ? "Unterbrochen / übergeben"
                              : "Dokumentiert"}
                      </dd>
                    </div>
                  </dl>
                </article>
              );
            })}
          </div>
          {workday.stage !== "handover" && workday.stage !== "closed" && (
            <button
              className="primary workday-next"
              onClick={() => onNavigate("Tasks")}
            >
              Arbeitstag mit Aufgaben starten
            </button>
          )}
        </>
      )}

      {view === "tasks" && workday.stage === "handover" && (
        <div className="workday-gate" role="status">
          <div>
            <strong>Aufgaben starten nach der Übergabe</strong>
            <small>
              Noch{" "}
              {workday.handover.patientIds.length -
                workday.handover.acknowledgedPatientIds.length}
              Patientenkontexte prüfen. Dringende Arbeit bleibt ausserhalb
              dieses Routineablaufs möglich.
            </small>
          </div>
          <button className="primary" onClick={() => onNavigate("Handover")}>
            Zur Übergabe
          </button>
        </div>
      )}

      {view === "tasks" && workday.stage !== "handover" && (
        <>
          <div className="workday-started" role="status">
            Meilenstein wählen, Arbeit bei Unterbrechung pausieren und die
            tatsächliche Zusammenfassung vor dem Schreiben prüfen.
          </div>
          <div className="workday-roster" aria-label="Heutige Aufgaben">
            {workday.plan.map((plan) => {
              const patient = patientFor(plan.patientId);
              if (!patient) return null;
              const episode = [...workday.episodes]
                .reverse()
                .find(
                  (item) =>
                    item.patientId === plan.patientId &&
                    item.kind === "planned",
                );
              return (
                <section className="workday-row" key={plan.patientId}>
                  <button
                    className="workday-patient"
                    onClick={() => onPatient(patient.id)}
                  >
                    <strong>
                      {patient.room} · {patient.displayName}
                    </strong>
                    <span>{plan.title}</span>
                    <small>{plan.reason}</small>
                    {episode?.completionEvidence && (
                      <small className="task-evidence">
                        Dokumentiert: {episode.completionEvidence}
                      </small>
                    )}
                  </button>
                  {plan.status === "planned" && !workday.activeEpisode ? (
                    <div className="button-row compact-actions">
                      <button
                        className="status-button"
                        disabled={blocked}
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
                        disabled={blocked}
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

          {workday.activeEpisode && (
            <section className="episode-controls" aria-label="Aktive Arbeit">
              <span>Aktiver Meilenstein</span>
              <strong>{workday.activeEpisode.title}</strong>
              {reviewEvidence === null ? (
                <>
                  <label>
                    Was wurde tatsächlich durchgeführt?
                    <textarea
                      value={episodeEvidence}
                      rows={3}
                      maxLength={1200}
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
                      disabled={blocked}
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
                    <button
                      className="secondary"
                      disabled={blocked}
                      onClick={() => {
                        setAdditionalPatientId(
                          interruptPatient?.id ??
                            workday.activeEpisode!.patientId,
                        );
                        setAdditionalOpen(true);
                      }}
                    >
                      Zusätzliche Arbeit
                    </button>
                    <button
                      className="primary"
                      disabled={blocked || episodeEvidence.trim().length < 10}
                      onClick={() => setReviewEvidence(episodeEvidence.trim())}
                    >
                      Zusammenfassung prüfen
                    </button>
                  </div>
                </>
              ) : (
                <div
                  className="episode-review"
                  aria-label="Dokumentation prüfen"
                >
                  <strong>Vor dem Schreiben prüfen</strong>
                  <p>{reviewEvidence}</p>
                  <small>
                    Ziel: Pflegehelfer-Dokumentation, danach Medplum und der
                    freigegebene Anbieterweg. Die nächste Übergabe übernimmt den
                    bestätigten Stand.
                  </small>
                  <div className="button-row">
                    <button
                      className="secondary"
                      onClick={() => setReviewEvidence(null)}
                    >
                      Korrigieren
                    </button>
                    <button
                      className="primary"
                      disabled={blocked}
                      onClick={() => {
                        act(
                          {
                            type: "complete-episode",
                            episodeId: workday.activeEpisode!.id,
                            evidence: reviewEvidence,
                          },
                          "Abschluss konnte nicht gespeichert werden.",
                        );
                        setReviewEvidence(null);
                      }}
                    >
                      Geprüft schreiben & abschliessen
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          {!workday.activeEpisode && workday.resumableEpisode && (
            <section className="episode-resume">
              <span>Unterbrochen</span>
              <strong>{workday.resumableEpisode.title}</strong>
              <button
                className="primary"
                disabled={blocked}
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

          {additionalOpen && (
            <form
              className="additional-work"
              onSubmit={(event) => {
                event.preventDefault();
                const patient = patientFor(additionalPatientId);
                if (!patient) return;
                const title = additionalTitle.trim();
                if (workday.activeEpisode)
                  act(
                    {
                      type: "interrupt-and-start",
                      episodeId: workday.activeEpisode.id,
                      patientId: patient.id,
                      encounterId: patient.encounterId,
                      title,
                      pausedDraftText: episodeEvidence,
                    },
                    "Zusätzliche Arbeit konnte nicht übernommen werden.",
                  );
                else
                  act(
                    {
                      type: "start-episode",
                      patientId: patient.id,
                      encounterId: patient.encounterId,
                      kind: "spontaneous",
                      title,
                    },
                    "Zusätzliche Arbeit konnte nicht begonnen werden.",
                  );
                setAdditionalOpen(false);
                setAdditionalTitle("");
              }}
            >
              <strong>Zusätzliche Arbeit aufnehmen</strong>
              <label>
                Patient:in
                <select
                  value={additionalPatientId}
                  onChange={(event) =>
                    setAdditionalPatientId(event.target.value)
                  }
                >
                  {workday.plan.map((plan) => {
                    const patient = patientFor(plan.patientId);
                    return patient ? (
                      <option key={patient.id} value={patient.id}>
                        {patient.room} · {patient.displayName}
                      </option>
                    ) : null;
                  })}
                </select>
              </label>
              <label>
                Anlass / Aufgabe
                <input
                  value={additionalTitle}
                  maxLength={160}
                  onChange={(event) => setAdditionalTitle(event.target.value)}
                />
              </label>
              <div className="button-row">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setAdditionalOpen(false)}
                >
                  Abbrechen
                </button>
                <button
                  className="primary"
                  disabled={blocked || additionalTitle.trim().length < 3}
                >
                  {workday.activeEpisode
                    ? "Aktuelle Arbeit unterbrechen & beginnen"
                    : "Arbeit beginnen"}
                </button>
              </div>
            </form>
          )}

          {!additionalOpen && !workday.activeEpisode && (
            <button
              className="secondary add-work-button"
              onClick={() => setAdditionalOpen(true)}
            >
              + Zusätzliche Arbeit hinzufügen
            </button>
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
                  disabled={blocked}
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

          {workday.stage === "closed" &&
            workday.outgoingTransfers.length > 0 && (
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

          {workday.stage !== "closed" &&
            !workday.activeEpisode &&
            !workday.resumableEpisode &&
            workday.episodes.length > 0 &&
            workday.plan.every((item) =>
              ["completed", "paused"].includes(item.status),
            ) && (
              <section className="shift-close-review">
                <strong>Schichtabschluss prüfen</strong>
                <p>
                  Alle geplanten Verantwortungen sind dokumentiert oder sichtbar
                  übergeben. Jetzt wird der bestätigte Stand für die nächste
                  Schicht eingefroren; die empfangende Person bestätigt separat.
                </p>
                <button
                  className="primary close-shift-button"
                  disabled={blocked}
                  onClick={() =>
                    act(
                      { type: "close-shift" },
                      "Schicht konnte nicht abgeschlossen werden.",
                    )
                  }
                >
                  Übergabe vorbereiten und Schicht beenden
                </button>
              </section>
            )}
        </>
      )}
    </article>
  );
}
