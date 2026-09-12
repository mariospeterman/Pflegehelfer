import { describe, expect, it } from "vitest";
import { PflegehelferService } from "../src/core/service.js";
import { nursingPatientIds } from "../src/core/site-config.js";

describe("least-privilege policy", () => {
  it("keeps HR and management outside patient records", () => {
    const service = new PflegehelferService();
    expect(service.snapshot("u-hr").patients).toEqual([]);
    expect(service.snapshot("u-hr").tasks).toEqual([]);
    expect(service.snapshot("u-manager").patients).toEqual([]);
    expect(service.snapshot("u-manager").observations).toEqual([]);
  });

  it("gives transport only its minimum task context and no clinical patient record", () => {
    const service = new PflegehelferService();
    const snapshot = service.snapshot("u-transport");
    expect(snapshot.patients).toEqual([]);
    expect(snapshot.observations).toEqual([]);
    expect(snapshot.tasks.map((task) => task.id)).toEqual(["t-transport-luca"]);
    expect(() =>
      service.updateTask("u-transport", "t-transport-luca", "accept", {
        purpose: "quality-review",
      }),
    ).toThrow(/Betriebszweck/);
    expect(
      service.updateTask("u-transport", "t-transport-luca", "accept", {}).state,
    ).toBe("accepted");
    expect(
      service.updateTask("u-transport", "t-transport-luca", "start", {}).state,
    ).toBe("in-progress");
    expect(
      service.updateTask("u-transport", "t-transport-luca", "complete", {
        evidence:
          "Transport zur Radiologie durchgeführt und persönliche Übergabe bestätigt.",
      }).state,
    ).toBe("completed");
  });

  it("rejects clinical writes from non-clinical roles", () => {
    const service = new PflegehelferService();
    expect(() =>
      service.createObservationDraft("u-transport", {
        patientId: "p-luca",
        encounterId: "enc-luca-2026",
        code: "temperature",
        value: 37,
        effectiveAt: "2026-09-05T08:10:00.000Z",
      }),
    ).toThrow(/nicht berechtigt/);
  });

  it("prevents cross-patient access outside the active relationship", () => {
    const service = new PflegehelferService();
    const snapshot = service.snapshot("u-assistant");
    expect(snapshot.patients.map((patient) => patient.id)).toEqual(
      nursingPatientIds,
    );
    expect(
      snapshot.patients.find((patient) => patient.id === "p-mei"),
    ).toBeUndefined();
    expect(JSON.stringify(snapshot)).not.toContain("Mei Muster");
  });

  it("does not expose patient work or assignments to quality review", () => {
    const service = new PflegehelferService();
    const snapshot = service.snapshot("u-quality");
    expect(snapshot.patients).toEqual([]);
    expect(snapshot.tasks).toEqual([]);
    expect(snapshot.users.every((user) => user.patientIds.length === 0)).toBe(
      true,
    );
    expect(snapshot.users.every((user) => user.wardIds.length === 0)).toBe(
      true,
    );
  });

  it("prevents one role from accepting another role's task", () => {
    const service = new PflegehelferService();
    expect(() =>
      service.updateTask("u-assistant", "t-transport-luca", "accept", {}),
    ).toThrow(/zugewiesene Rolle/);
  });

  it("prevents a coordinator from delegating another person's claimed task", () => {
    const service = new PflegehelferService();
    const task = service.createTask("u-physician", {
      patientId: "p-anna",
      encounterId: "enc-anna-2026",
      title: "Ärztliche Verlaufskontrolle",
      reason: "Verantwortung bleibt beim übernehmenden Arzt",
      ownerRole: "physician",
      priority: "routine",
      dueAt: "2026-09-05T15:00:00.000Z",
    });
    service.updateTask("u-physician", task.id, "accept", {});
    expect(() =>
      service.updateTask("u-nurse", task.id, "delegate", {
        delegateRole: "care-assistant",
      }),
    ).toThrow(/verantwortliche Person/);
  });

  it("binds an acknowledged communication to the person who claimed it", () => {
    const service = new PflegehelferService();
    const message = service.createCommunication("u-nurse", {
      patientId: "p-anna",
      encounterId: "enc-anna-2026",
      request: "Bitte im ärztlichen Dienst übernehmen",
      reason: "Rollenkanal mit persönlicher Quittierung",
      recipientRole: "physician",
      priority: "routine",
      dueAt: "2026-09-05T15:00:00.000Z",
    });
    service.transitionCommunication(
      "u-physician",
      message.id,
      "acknowledge",
      {},
    );
    expect(() =>
      service.transitionCommunication(
        "u-physician-evening",
        message.id,
        "answer",
        { response: "Peer darf nicht unter fremder Quittierung antworten." },
      ),
    ).toThrow(/übernommen hat/);
  });

  it("shows the patient thread to the authorized treatment team and lets the responder close the loop", () => {
    const service = new PflegehelferService();
    const message = service.createCommunication("u-nurse", {
      patientId: "p-anna",
      encounterId: "enc-anna-2026",
      request: "Bitte aktuellen Zustand beurteilen",
      reason: "Transparente Frage im Behandlungsteam",
      recipientRole: "physician",
      priority: "routine",
      dueAt: "2026-09-05T15:00:00.000Z",
    });
    expect(
      service
        .snapshot("u-nurse-evening")
        .communications.some((item) => item.id === message.id),
    ).toBe(true);
    service.transitionCommunication("u-physician", message.id, "answer", {
      response: "Beurteilung erfolgt; Verlauf weiter beobachten.",
    });
    expect(
      service.transitionCommunication("u-physician", message.id, "close", {})
        .state,
    ).toBe("closed");
  });

  it("prevents patient work from being routed into HR or IT boundaries", () => {
    const service = new PflegehelferService();
    expect(() =>
      service.createTask("u-nurse", {
        patientId: "p-anna",
        encounterId: "enc-anna-2026",
        title: "Unsichere Zuweisung",
        reason: "Darf die klinische Grenze nicht verlassen",
        ownerRole: "hr",
        priority: "routine",
        dueAt: "2026-09-05T15:00:00.000Z",
      }),
    ).toThrow(/nichtklinische Rollen/);
    expect(() =>
      service.createCommunication("u-nurse", {
        patientId: "p-anna",
        encounterId: "enc-anna-2026",
        request: "Patientendaten an HR",
        reason: "Negativtest",
        recipientRole: "hr",
        priority: "routine",
        dueAt: "2026-09-05T15:00:00.000Z",
      }),
    ).toThrow(/Behandlungsteams/);
    expect(() =>
      service.createTask("u-nurse", {
        patientId: "p-anna",
        encounterId: "enc-anna-2026",
        title: "Klinischer Freitext",
        reason: "Darf nicht in Administration oder Transport gelangen",
        ownerRole: "administration",
        priority: "routine",
        dueAt: "2026-09-05T15:00:00.000Z",
      }),
    ).toThrow(/nichtklinische Rollen/);
  });

  it("keeps ordinary basic-care and mobility assignments in the generic task workflow", () => {
    const service = new PflegehelferService();
    expect(
      service.createTask("u-nurse", {
        patientId: "p-anna",
        encounterId: "enc-anna-2026",
        title: "Bewohnerin mobilisieren und beim Ankleiden unterstützen",
        reason: "Geplante Grundpflege",
        ownerRole: "care-assistant",
        priority: "routine",
        dueAt: "2026-09-05T15:00:00.000Z",
      }),
    ).toMatchObject({ ownerRole: "care-assistant", state: "new" });
    expect(
      service.createTask("u-nurse", {
        patientId: "p-anna",
        encounterId: "enc-anna-2026",
        title: "Beim Essen und Trinken unterstützen",
        reason: "Geplante Grundpflege",
        ownerRole: "care-assistant",
        priority: "routine",
        dueAt: "2026-09-05T15:30:00.000Z",
      }),
    ).toMatchObject({ ownerRole: "care-assistant", state: "new" });
  });

  it.each([
    "Torasemid geben",
    "Torasemid mit Wasser geben",
    "Metoprolol zum Essen geben",
    "Bisoprolol mit Tee geben",
    "Unterstützung bei Torasemid geben",
    "Hilfestellung beim Metoprolol geben",
    "Beim Essen Hilfestellung für Torasemid geben",
    "Metoprolol verabreichen",
    "Neues Präparat absetzen",
  ])("keeps %s out of the generic task workflow", (title) => {
    const service = new PflegehelferService();
    expect(() =>
      service.createTask("u-nurse", {
        patientId: "p-anna",
        encounterId: "enc-anna-2026",
        title,
        reason: "Freie generische Aufgabe",
        ownerRole: "registered-nurse",
        priority: "urgent",
        dueAt: "2026-09-05T15:00:00.000Z",
      }),
    ).toThrow(/Fachworkflow/);
  });

  it("requires explicit ownership for completion and recipient responses", () => {
    const service = new PflegehelferService();
    const task = service.createTask("u-physician", {
      patientId: "p-anna",
      encounterId: "enc-anna-2026",
      title: "Ärztliche Rückfrage prüfen",
      reason: "Expliziter Eigentümer-Negativtest",
      ownerRole: "physician",
      priority: "routine",
      dueAt: "2026-09-05T15:00:00.000Z",
    });
    service.updateTask("u-physician", task.id, "accept", {});
    expect(() =>
      service.updateTask("u-nurse", task.id, "complete", {
        evidence: "Nicht delegierter Abschluss",
      }),
    ).toThrow(/verantwortliche Person/);

    const message = service.createCommunication("u-nurse", {
      patientId: "p-anna",
      encounterId: "enc-anna-2026",
      request: "Apothekerische Prüfung",
      reason: "Empfängerbindung",
      recipientRole: "pharmacy",
      recipientId: "u-pharmacy",
      priority: "routine",
      dueAt: "2026-09-05T15:00:00.000Z",
    });
    expect(() =>
      service.transitionCommunication("u-physician", message.id, "answer", {
        response: "Nicht zuständig",
      }),
    ).toThrow(/adressierte Person/);
  });

  it("binds a named mention to one identity, not merely a shared role", () => {
    const service = new PflegehelferService();
    const message = service.createCommunication("u-nurse", {
      patientId: "p-anna",
      encounterId: "enc-anna-2026",
      request: "Bitte Schwindel beurteilen",
      reason: "Gezielte ärztliche Rückfrage",
      recipientRole: "physician",
      recipientId: "u-physician",
      priority: "elevated",
      dueAt: "2026-09-05T15:00:00.000Z",
    });
    expect(message.recipientId).toBe("u-physician");
    expect(() =>
      service.transitionCommunication(
        "u-physician-evening",
        message.id,
        "acknowledge",
        {},
      ),
    ).toThrow(/adressierte Person/);
    expect(
      service.transitionCommunication(
        "u-physician",
        message.id,
        "acknowledge",
        {},
      ).acknowledgedBy,
    ).toBe("u-physician");
  });

  it("routes an overdue named mention to the explicit on-call pool", () => {
    const service = new PflegehelferService();
    const dueAt = new Date(Date.now() + 60_000).toISOString();
    const message = service.createCommunication("u-nurse", {
      patientId: "p-anna",
      encounterId: "enc-anna-2026",
      request: "Bitte zeitkritischen Verlauf beurteilen",
      reason: "Gezielte Person ist möglicherweise nicht verfügbar",
      recipientRole: "physician",
      recipientId: "u-physician",
      priority: "elevated",
      dueAt,
    });
    expect(() =>
      service.transitionCommunication(
        "u-physician-evening",
        message.id,
        "acknowledge",
        {},
      ),
    ).toThrow(/adressierte Person/);

    const firstSweep = service.runScheduledEscalations(dueAt);
    expect(firstSweep.communications).toHaveLength(1);
    expect(firstSweep.communications[0]).toMatchObject({
      id: message.id,
      state: "escalated",
      recipientId: "u-physician",
      escalationRecipientRole: "physician",
    });
    expect(service.runScheduledEscalations(dueAt).communications).toEqual([]);
    expect(
      service.transitionCommunication(
        "u-physician-evening",
        message.id,
        "acknowledge",
        {},
      ).acknowledgedBy,
    ).toBe("u-physician-evening");
    expect(
      service.transitionCommunication(
        "u-physician-evening",
        message.id,
        "answer",
        { response: "Bereitschaft hat übernommen." },
      ).state,
    ).toBe("answered");
    const escalationAudit = service.audit
      .snapshot()
      .find((entry) => entry.action === "communication:deadline-escalate");
    expect(escalationAudit).toMatchObject({
      actorId: "system:deadline-engine",
      actorType: "system",
      detail: {
        rule: "communication-unacknowledged-due-v1",
        escalationRoute: "on-call:physician",
      },
    });
  });

  it("honours purpose for minimum-context transport work", () => {
    const service = new PflegehelferService();
    expect(service.snapshot("u-transport", "quality-review").tasks).toEqual([]);
  });
});
