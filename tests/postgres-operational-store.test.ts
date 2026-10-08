import pg from "pg";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PostgresOperationalStore } from "../src/infrastructure/operational-store.js";
import { patients } from "../src/core/seed.js";
import { sourceReadSetFixture } from "./source-read-set-fixture.js";

const databaseUrl = process.env.PFH_OPERATIONAL_DATABASE_URL;
const { Pool } = pg;

async function acknowledgeHandover(
  store: PostgresOperationalStore,
  actorId: string,
  role: "care-assistant" | "registered-nurse",
) {
  let workday = await store.getWorkday(actorId, role);
  if (!workday.handover.clinicalBound)
    workday = await store.bindHandoverClinicalSnapshot(
      actorId,
      role,
      workday.handover.id,
      workday.handover.version,
      workday.handover.patientIds.map((patientId) => ({
        patientId,
        encounterId: patients.find((patient) => patient.id === patientId)!
          .encounterId,
        currentImportant: ["Synthetischer Testhinweis"],
        recentChanges: [],
        openQuestions: [],
      })),
    );
  for (const patientId of workday.handover.patientIds)
    workday = await store.applyWorkdayCommand(actorId, role, {
      type: "acknowledge-handover",
      handoverId: workday.handover.id,
      patientId,
      version: workday.handover.version,
    });
  return workday;
}

describe.runIf(Boolean(databaseUrl))("PostgreSQL operational store", () => {
  it("fences an expired assistant request holder from its replacement", async () => {
    const store = new PostgresOperationalStore(databaseUrl!);
    const inspectionPool = new Pool({
      connectionString: databaseUrl,
      options: "-c pfh.organization_id=org-demo",
    });
    const actorId = "u-nurse";
    const role = "registered-nurse" as const;
    try {
      await store.initialize();
      await store.resetDemoState();
      await store.getOrStartSession(actorId, role);
      const context = await store.bindAssistantContext(
        actorId,
        role,
        crypto.randomUUID(),
        "p-anna",
        "enc-anna-2026",
      );
      const identity = {
        commandId: crypto.randomUUID(),
        requestHash: "d".repeat(64),
        actorId,
        role,
        context,
      };
      const first = await store.claimAssistantRequest(identity);
      const skewedApplicationTime = Date.now() + 365 * 24 * 60 * 60_000;
      const clockSkew = vi
        .spyOn(Date, "now")
        .mockReturnValue(skewedApplicationTime);
      await expect(store.claimAssistantRequest(identity)).resolves.toEqual({
        state: "in-progress",
      });
      clockSkew.mockRestore();
      await inspectionPool.query(
        `UPDATE assistant_request_claims SET lease_expires_at=now()-interval '1 second'
         WHERE organization_id=$1 AND site_id=$2 AND actor_id=$3 AND command_id=$4`,
        ["org-demo", "rehab-2", actorId, identity.commandId],
      );
      const replacement = await store.claimAssistantRequest(identity);
      expect(replacement.holderId).not.toBe(first.holderId);
      await store.releaseAssistantRequest(identity, first.holderId!);
      expect(
        await store.renewAssistantRequest(identity, replacement.holderId!),
      ).toBe(true);

      const turn = {
        id: crypto.randomUUID(),
        prompt: "Synthetischer Fence-Test",
        response: { components: [], openUi: "" },
        createdAt: new Date().toISOString(),
        inputModality: "typed" as const,
        originPatientId: context.patientId,
        originEncounterId: context.encounterId,
        originThreadId: context.threadId,
        originContextRevision: context.contextRevision,
      };
      const authority = {
        tokenHash: createHash("sha256")
          .update("fenced-test-token")
          .digest("hex"),
        record: {
          actorId,
          actorRole: role,
          command: "task:draft" as const,
          patientId: "p-anna",
          encounterId: "enc-anna-2026",
          purpose: "direct-care" as const,
          resourceVersion: 7,
          payload: { title: "Synthetischer Fence-Test" },
          sourceReadSet: sourceReadSetFixture({
            patientId: "p-anna",
            encounterId: "enc-anna-2026",
            version: 7,
          }),
          expiresAt: Date.now() + 60_000,
        },
        sessionId: context.sessionId,
        threadId: context.threadId,
        contextRevision: context.contextRevision,
        responseId: turn.id,
        reviewItems: [{ id: "action-1", kind: "task" }],
        clientContextId: context.clientContextId,
      };
      await expect(
        store.appendConversationTurn(actorId, role, turn, context, {
          ...identity,
          holderId: first.holderId!,
          response: turn.response as never,
          authorities: [authority],
        }),
      ).rejects.toThrow("ASSISTANT_REQUEST_CLAIM_STALE");
      await expect(
        inspectionPool.query(
          `SELECT 1 FROM safety_authority
           WHERE organization_id=$1 AND token_hash=$2`,
          ["org-demo", authority.tokenHash],
        ),
      ).resolves.toMatchObject({ rowCount: 0 });
      await store.appendConversationTurn(actorId, role, turn, context, {
        ...identity,
        holderId: replacement.holderId!,
        response: turn.response as never,
        authorities: [authority],
      });
      await expect(
        inspectionPool.query(
          `SELECT 1 FROM safety_authority
           WHERE organization_id=$1 AND token_hash=$2`,
          ["org-demo", authority.tokenHash],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await Promise.all([store.close(), inspectionPool.end()]);
    }
  });

  it("durably replays only events addressed to the requesting actor", async () => {
    const store = new PostgresOperationalStore(databaseUrl!);
    try {
      await store.initialize();
      await store.resetDemoState();
      const first = await store.appendUiInvalidation("u-assistant", {
        reason: "task-changed",
      });
      await store.appendUiInvalidation("u-nurse", {
        reason: "private-change",
      });
      const third = await store.appendUiInvalidation("u-assistant", {
        reason: "note-changed",
      });
      expect(await store.listUiEventsAfter("u-assistant", 0)).toMatchObject([
        { id: first, payload: { reason: "task-changed" } },
        { id: third, payload: { reason: "note-changed" } },
      ]);
      expect(await store.listUiEventsAfter("u-nurse", 0)).toHaveLength(1);
    } finally {
      await store.close();
    }
  });

  it("rejects acknowledgement when frozen handover content was altered", async () => {
    const store = new PostgresOperationalStore(databaseUrl!);
    const inspectionPool = new Pool({
      connectionString: databaseUrl,
      options: "-c pfh.organization_id=org-demo",
    });
    try {
      await store.initialize();
      await store.resetDemoState();
      let workday = await store.getWorkday("u-assistant", "care-assistant");
      workday = await store.bindHandoverClinicalSnapshot(
        "u-assistant",
        "care-assistant",
        workday.handover.id,
        workday.handover.version,
        workday.handover.patientIds.map((patientId) => ({
          patientId,
          encounterId: patients.find((patient) => patient.id === patientId)!
            .encounterId,
          currentImportant: [],
          recentChanges: [],
          openQuestions: [],
        })),
      );
      await inspectionPool.query(
        `UPDATE handover_snapshots
         SET content=jsonb_set(content, '{0,title}', '"Geänderter Auftrag"')
         WHERE id=$1`,
        [workday.handover.id],
      );
      await expect(
        store.applyWorkdayCommand("u-assistant", "care-assistant", {
          type: "acknowledge-handover",
          handoverId: workday.handover.id,
          patientId: workday.handover.patientIds[0]!,
          version: workday.handover.version,
        }),
      ).rejects.toThrow("HANDOVER_VERSION_STALE");
    } finally {
      await Promise.all([store.close(), inspectionPool.end()]);
    }
  });

  it("reuses one active session when initial PWA requests race", async () => {
    const store = new PostgresOperationalStore(databaseUrl!);
    const actorId = "u-assistant";

    try {
      await store.initialize();
      await store.resetDemoState();
      const sessions = await Promise.all(
        Array.from({ length: 8 }, () =>
          store.getOrStartSession(actorId, "care-assistant"),
        ),
      );

      expect(new Set(sessions.map((session) => session.id)).size).toBe(1);
      expect(new Set(sessions.map((session) => session.threadId)).size).toBe(1);
    } finally {
      await store.close();
    }
  });

  it("keeps two browser client contexts on separate threads", async () => {
    const store = new PostgresOperationalStore(databaseUrl!);
    const actorId = "u-nurse";
    try {
      await store.initialize();
      await store.resetDemoState();
      const anna = await store.bindAssistantContext(
        actorId,
        "registered-nurse",
        crypto.randomUUID(),
        "p-anna",
        "enc-anna-2026",
      );
      const luca = await store.bindAssistantContext(
        actorId,
        "registered-nurse",
        crypto.randomUUID(),
        "p-luca",
        "enc-luca-2026",
      );
      await store.appendConversationTurn(
        actorId,
        "registered-nurse",
        {
          id: crypto.randomUUID(),
          prompt: "Anna-Tab",
          response: {},
          createdAt: new Date().toISOString(),
          inputModality: "typed",
          originPatientId: anna.patientId,
          originEncounterId: anna.encounterId,
          originThreadId: anna.threadId,
          originContextRevision: anna.contextRevision,
        },
        anna,
      );
      await store.appendConversationTurn(
        actorId,
        "registered-nurse",
        {
          id: crypto.randomUUID(),
          prompt: "Luca-Tab",
          response: {},
          createdAt: new Date().toISOString(),
          inputModality: "typed",
          originPatientId: luca.patientId,
          originEncounterId: luca.encounterId,
          originThreadId: luca.threadId,
          originContextRevision: luca.contextRevision,
        },
        luca,
      );

      expect(
        await store.loadConversation(
          actorId,
          "registered-nurse",
          anna.patientId,
          anna,
        ),
      ).toMatchObject([{ prompt: "Anna-Tab" }]);
      expect(
        await store.loadConversation(
          actorId,
          "registered-nurse",
          luca.patientId,
          luca,
        ),
      ).toMatchObject([{ prompt: "Luca-Tab" }]);
      expect(
        await store.resolveAssistantContext(
          actorId,
          "registered-nurse",
          anna.clientContextId,
        ),
      ).toMatchObject({ patientId: "p-anna", threadId: anna.threadId });
    } finally {
      await store.close();
    }
  });

  it("pauses an expired session before starting its replacement", async () => {
    const store = new PostgresOperationalStore(databaseUrl!);
    const inspectionPool = new Pool({
      connectionString: databaseUrl,
      options: "-c pfh.organization_id=org-demo",
    });
    const actorId = "u-assistant";

    try {
      await store.initialize();
      await store.resetDemoState();
      const expired = await store.getOrStartSession(actorId, "care-assistant");
      await inspectionPool.query(
        `UPDATE assistant_threads SET expires_at=now() - interval '1 minute'
         WHERE organization_id=$1 AND id=$2`,
        [expired.organizationId, expired.threadId],
      );

      const replacement = await store.getOrStartSession(
        actorId,
        "care-assistant",
      );
      const statuses = await inspectionPool.query<{
        id: string;
        status: string;
      }>(
        `SELECT id::text, status FROM working_sessions
         WHERE organization_id=$1 AND actor_id=$2 ORDER BY started_at`,
        [expired.organizationId, actorId],
      );

      expect(replacement.id).not.toBe(expired.id);
      expect(statuses.rows).toEqual([
        { id: expired.id, status: "paused" },
        { id: replacement.id, status: "active" },
      ]);
    } finally {
      await Promise.all([store.close(), inspectionPool.end()]);
    }
  });

  it("atomically binds a started work episode to the assistant thread", async () => {
    const store = new PostgresOperationalStore(databaseUrl!);
    const actorId = "u-assistant";

    try {
      await store.initialize();
      await store.resetDemoState();
      const initial = await store.getOrStartSession(actorId, "care-assistant");
      await acknowledgeHandover(store, actorId, "care-assistant");
      const workday = await store.applyWorkdayCommand(
        actorId,
        "care-assistant",
        {
          type: "start-episode",
          patientId: "p-luca",
          encounterId: "enc-luca-2026",
          kind: "planned",
          title: "Morgenpflege und Mobilisation",
        },
      );
      const current = await store.getOrStartSession(actorId, "care-assistant");

      expect(workday.activeEpisode).toMatchObject({
        patientId: "p-luca",
        state: "active",
      });
      expect(current.patientId).toBe("p-luca");
      expect(current.contextRevision).toBe(initial.contextRevision + 1);
      expect(current.currentStepId).toBe("work");
    } finally {
      await store.close();
    }
  });

  it("starts a non-nursing conversational session without inventing a workday", async () => {
    const store = new PostgresOperationalStore(databaseUrl!);
    try {
      await store.initialize();
      await store.resetDemoState();
      await expect(
        store.getOrStartSession("u-physician", "physician"),
      ).resolves.toMatchObject({
        actorId: "u-physician",
        effectiveRole: "physician",
      });
      await expect(
        store.getWorkday("u-physician", "physician"),
      ).rejects.toThrow(/Schichtzuweisung/);
    } finally {
      await store.close();
    }
  });

  it("does not close when only one assigned patient has been resolved", async () => {
    const store = new PostgresOperationalStore(databaseUrl!);
    const actorId = "u-nurse";
    try {
      await store.initialize();
      await store.resetDemoState();
      await acknowledgeHandover(store, actorId, "registered-nurse");
      let workday = await store.applyWorkdayCommand(
        actorId,
        "registered-nurse",
        {
          type: "start-episode",
          patientId: "p-anna",
          encounterId: "enc-anna-2026",
          kind: "planned",
          title: "Morgenpflege",
        },
      );
      workday = await store.applyWorkdayCommand(actorId, "registered-nurse", {
        type: "complete-episode",
        episodeId: workday.activeEpisode!.id,
        evidence: "Morgenpflege vollständig durchgeführt und dokumentiert.",
      });
      expect(
        workday.plan.find((item) => item.patientId === "p-anna")?.status,
      ).toBe("completed");
      await expect(
        store.applyWorkdayCommand(actorId, "registered-nurse", {
          type: "close-shift",
        }),
      ).rejects.toThrow("PLANNED_RESPONSIBILITY_REQUIRES_RESOLUTION");
    } finally {
      await store.close();
    }
  });

  it("keeps terminal episodes final and rejects duplicate planned responsibility", async () => {
    const store = new PostgresOperationalStore(databaseUrl!);
    const actorId = "u-assistant";
    try {
      await store.initialize();
      await store.resetDemoState();
      await acknowledgeHandover(store, actorId, "care-assistant");
      const started = await store.applyWorkdayCommand(
        actorId,
        "care-assistant",
        {
          type: "start-episode",
          patientId: "p-luca",
          encounterId: "enc-luca-2026",
          kind: "planned",
          title: "Morgenpflege",
        },
      );
      const episodeId = started.activeEpisode!.id;
      await store.applyWorkdayCommand(actorId, "care-assistant", {
        type: "complete-episode",
        episodeId,
        evidence: "Morgenpflege vollständig durchgeführt und dokumentiert.",
      });
      await expect(
        store.applyWorkdayCommand(actorId, "care-assistant", {
          type: "resume-episode",
          episodeId,
        }),
      ).rejects.toThrow("EPISODE_STATE_CONFLICT");
      await expect(
        store.applyWorkdayCommand(actorId, "care-assistant", {
          type: "start-episode",
          patientId: "p-luca",
          encounterId: "enc-luca-2026",
          kind: "planned",
          title: "Doppelte Morgenpflege",
        }),
      ).rejects.toThrow("PLANNED_EPISODE_ALREADY_EXISTS");
    } finally {
      await store.close();
    }
  });

  it("persists an interrupted episode draft and an explicit transfer receipt", async () => {
    const store = new PostgresOperationalStore(databaseUrl!);
    try {
      await store.initialize();
      await store.resetDemoState();
      await acknowledgeHandover(store, "u-nurse", "registered-nurse");
      let workday = await store.applyWorkdayCommand(
        "u-nurse",
        "registered-nurse",
        {
          type: "start-episode",
          patientId: "p-anna",
          encounterId: "enc-anna-2026",
          kind: "planned",
          title: "Morgenpflege",
        },
      );
      const episodeId = workday.activeEpisode!.id;
      workday = await store.applyWorkdayCommand("u-nurse", "registered-nurse", {
        type: "pause-episode",
        episodeId,
        reason: "interruption",
        draftText: "Bis zur Mobilisation versorgt.",
      });
      expect(workday.resumableEpisode).toMatchObject({
        id: episodeId,
        draftText: "Bis zur Mobilisation versorgt.",
      });
      workday = await store.applyWorkdayCommand("u-nurse", "registered-nurse", {
        type: "defer-responsibility",
        patientId: "p-anna",
        encounterId: "enc-anna-2026",
        reason: "Mobilisation im Spätdienst fortsetzen.",
        receivingActorId: "u-nurse-evening",
      });
      const transfer = workday.outgoingTransfers[0]!;
      expect(transfer.state).toBe("pending");
      const received = await store.applyWorkdayCommand(
        "u-nurse-evening",
        "registered-nurse",
        { type: "acknowledge-transfer", transferId: transfer.id },
      );
      expect(
        received.incomingTransfers.find((item) => item.id === transfer.id)
          ?.state,
      ).toBe("acknowledged");
    } finally {
      await store.close();
    }
  });

  it("binds normal outgoing handover to the exact receiving-shift receipt", async () => {
    const store = new PostgresOperationalStore(databaseUrl!);
    try {
      await store.initialize();
      await store.resetDemoState();
      let outgoing = await acknowledgeHandover(
        store,
        "u-nurse",
        "registered-nurse",
      );
      for (const patientId of outgoing.handover.patientIds) {
        outgoing = await store.applyWorkdayCommand(
          "u-nurse",
          "registered-nurse",
          {
            type: "start-episode",
            patientId,
            encounterId: `enc-${patientId.slice(2)}-2026`,
            kind: "planned",
            title: "Geplante Tagesversorgung",
          },
        );
        outgoing = await store.applyWorkdayCommand(
          "u-nurse",
          "registered-nurse",
          {
            type: "complete-episode",
            episodeId: outgoing.activeEpisode!.id,
            evidence: "Geplante Versorgung durchgeführt und dokumentiert.",
          },
        );
      }
      outgoing = await store.applyWorkdayCommand(
        "u-nurse",
        "registered-nurse",
        { type: "close-shift" },
      );
      const outgoingId = outgoing.handover.id;
      expect(outgoing.handover.status).toBe("transferred");
      await expect(
        store.applyWorkdayCommand("u-nurse", "registered-nurse", {
          type: "start-episode",
          patientId: "p-anna",
          encounterId: "enc-anna-2026",
          kind: "spontaneous",
          title: "Nach abgeschlossenem Dienst",
        }),
      ).rejects.toThrow("SHIFT_ALREADY_CLOSED");

      let incoming = await store.getWorkday(
        "u-nurse-evening",
        "registered-nurse",
      );
      expect(incoming.handover.id).toBe(outgoingId);
      for (const patientId of incoming.handover.patientIds) {
        incoming = await store.applyWorkdayCommand(
          "u-nurse-evening",
          "registered-nurse",
          {
            type: "acknowledge-handover",
            handoverId: outgoingId,
            patientId,
            version: incoming.handover.version,
          },
        );
      }
      expect(incoming.handover).toMatchObject({
        id: outgoingId,
        status: "acknowledged",
      });
      await expect(
        store.getWorkday("u-nurse", "registered-nurse"),
      ).resolves.toMatchObject({
        handover: { id: outgoingId, status: "acknowledged" },
      });
    } finally {
      await store.close();
    }
  }, 30_000);

  it("keeps same-shift staff responsibility independent", async () => {
    const store = new PostgresOperationalStore(databaseUrl!);
    try {
      await store.initialize();
      await store.resetDemoState();
      let nurse = await acknowledgeHandover(
        store,
        "u-nurse",
        "registered-nurse",
      );
      for (const patientId of nurse.handover.patientIds) {
        nurse = await store.applyWorkdayCommand("u-nurse", "registered-nurse", {
          type: "start-episode",
          patientId,
          encounterId: `enc-${patientId.slice(2)}-2026`,
          kind: "planned",
          title: "Geplante Tagesversorgung",
        });
        nurse = await store.applyWorkdayCommand("u-nurse", "registered-nurse", {
          type: "complete-episode",
          episodeId: nurse.activeEpisode!.id,
          evidence: "Geplante Versorgung durchgeführt und dokumentiert.",
        });
      }
      await store.applyWorkdayCommand("u-nurse", "registered-nurse", {
        type: "close-shift",
      });

      const assistant = await store.getWorkday("u-assistant", "care-assistant");
      expect(assistant.stage).toBe("handover");
      expect(assistant.handover.status).toBe("open");
      expect(assistant.handover.acknowledgedPatientIds).toEqual([]);
    } finally {
      await store.close();
    }
  });

  it("persists and atomically consumes one-use assistant authority", async () => {
    const store = new PostgresOperationalStore(databaseUrl!);
    const inspectionPool = new Pool({
      connectionString: databaseUrl,
      options: "-c pfh.organization_id=org-demo",
    });
    try {
      await store.initialize();
      await store.resetDemoState();
      await store.getOrStartSession("u-nurse", "registered-nurse");
      const session = await store.changePatientContext(
        "u-nurse",
        "registered-nurse",
        "p-anna",
        "enc-anna-2026",
      );
      const tokenHash = createHash("sha256").update("test-token").digest("hex");
      const sourceReadSet = sourceReadSetFixture({
        patientId: "p-anna",
        encounterId: "enc-anna-2026",
        version: 7,
      });
      const record = {
        actorId: "u-nurse",
        actorRole: "registered-nurse" as const,
        command: "task:draft" as const,
        patientId: "p-anna",
        encounterId: "enc-anna-2026",
        purpose: "direct-care" as const,
        resourceVersion: 7,
        payload: { title: "Kontrolle" },
        sourceReadSet,
        expiresAt: Date.now() + 60_000,
      };
      await store.storeIntentAuthority({
        tokenHash,
        record,
        sessionId: session.id,
        threadId: session.threadId,
        contextRevision: session.contextRevision,
        responseId: crypto.randomUUID(),
        reviewItems: [{ id: "action-1", kind: "task" }],
      });
      await expect(
        store.loadIntentAuthority({
          tokenHash,
          actorId: "u-nurse",
          sessionId: session.id,
          threadId: session.threadId,
          contextRevision: session.contextRevision,
          patientId: "p-anna",
          encounterId: "enc-anna-2026",
        }),
      ).resolves.toMatchObject({ command: "task:draft" });
      expect(await store.consumeIntentAuthority(tokenHash)).toBe(true);
      expect(await store.consumeIntentAuthority(tokenHash)).toBe(false);
      const proposal = await inspectionPool.query<{
        status: string;
        proposal_hash: string;
        review_items: Array<{ id: string; kind: string }>;
      }>(
        `SELECT status,proposal_hash,review_items FROM assistant_proposal_revisions
         WHERE organization_id=$1 AND actor_id=$2`,
        [session.organizationId, "u-nurse"],
      );
      expect(proposal.rows).toHaveLength(1);
      expect(proposal.rows[0]?.status).toBe("consumed");
      expect(proposal.rows[0]?.proposal_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(proposal.rows[0]?.review_items).toEqual([
        { id: "action-1", kind: "task" },
      ]);
    } finally {
      await Promise.all([store.close(), inspectionPool.end()]);
    }
  });

  it("assigns a unique durable revision to concurrent assistant turns", async () => {
    const store = new PostgresOperationalStore(databaseUrl!);
    try {
      await store.initialize();
      await store.resetDemoState();
      const initial = await store.getOrStartSession(
        "u-nurse",
        "registered-nurse",
      );
      const revisions = await Promise.all([
        store.advanceAssistantRevision("u-nurse", "registered-nurse"),
        store.advanceAssistantRevision("u-nurse", "registered-nurse"),
      ]);
      expect(new Set(revisions.map((item) => item.contextRevision)).size).toBe(
        2,
      );
      expect(Math.min(...revisions.map((item) => item.contextRevision))).toBe(
        initial.contextRevision + 1,
      );
      expect(Math.max(...revisions.map((item) => item.contextRevision))).toBe(
        initial.contextRevision + 2,
      );
    } finally {
      await store.close();
    }
  });
});
