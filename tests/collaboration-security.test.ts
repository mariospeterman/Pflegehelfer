import { describe, expect, it } from "vitest";
import { PflegehelferService } from "../src/core/service.js";

describe("clinical communication visibility", () => {
  it("shows a named mention transparently to the patient-authorized treatment team", () => {
    const service = new PflegehelferService();
    const direct = service.createCommunication("u-nurse", {
      patientId: "p-anna",
      request: "Bitte den Blutdruckverlauf persönlich beurteilen.",
      reason: "Schwindel nach Mobilisation",
      recipientRole: "physician",
      recipientId: "u-physician",
      priority: "elevated",
      dueAt: "2026-09-06T10:00:00.000Z",
    });

    expect(
      service
        .snapshot("u-nurse", "direct-care")
        .communications.some((item) => item.id === direct.id),
    ).toBe(true);
    expect(
      service
        .snapshot("u-physician", "direct-care")
        .communications.some((item) => item.id === direct.id),
    ).toBe(true);
    expect(
      service
        .snapshot("u-physician-evening", "direct-care")
        .communications.some((item) => item.id === direct.id),
    ).toBe(true);
    expect(
      service
        .snapshot("u-nurse-evening", "direct-care")
        .communications.some((item) => item.id === direct.id),
    ).toBe(true);
  });

  it("shows an overdue named message to the governed on-call role", () => {
    const service = new PflegehelferService();
    const direct = service.createCommunication("u-nurse", {
      patientId: "p-anna",
      request: "Bitte den Blutdruckverlauf persönlich beurteilen.",
      reason: "Schwindel nach Mobilisation",
      recipientRole: "physician",
      recipientId: "u-physician",
      priority: "elevated",
      dueAt: "2026-09-06T10:00:00.000Z",
    });
    service.runCommunicationEscalations("u-it", "2026-09-06T10:01:00.000Z");
    const onCall = service.snapshot("u-physician-evening", "direct-care");
    expect(onCall.communications.some((item) => item.id === direct.id)).toBe(
      true,
    );
    expect(() =>
      service.transitionCommunication(
        "u-physician-evening",
        direct.id,
        "acknowledge",
        {},
      ),
    ).not.toThrow();
  });

  it("rejects a same-ward recipient without a current patient relationship", () => {
    const service = new PflegehelferService();
    expect(() =>
      service.createCommunication("u-nurse", {
        patientId: "p-mei",
        request: "Bitte Mobilität beurteilen.",
        reason: "Unklarer Transferstatus",
        recipientRole: "physiotherapy",
        recipientId: "u-physio",
        priority: "routine",
        dueAt: "2026-09-06T10:00:00.000Z",
      }),
    ).toThrow("keine Behandlungsbeziehung");
  });
});
