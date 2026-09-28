import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/server/app.js";

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

const headers = (userId: string, commandId = randomUUID()) => ({
  "x-demo-user": userId,
  "x-command-id": commandId,
});

describe("persisted workspace collaboration", () => {
  it("keeps status dimensions separate and does not turn configured AI into acceptance", async () => {
    const app = buildApp(undefined, { demoMode: true });
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/status",
      headers: { "x-demo-user": "u-nurse" },
    });
    expect(response.statusCode).toBe(200);
    const status = response.json<{
      api: { reachable: boolean; authenticated: boolean };
      session: { actorId: string };
      stores: { postgresql: { ready: boolean } };
      ai: {
        model: { acceptance: string };
        asr: { acceptance: string };
        tts: { acceptance: string };
      };
      delivery: Record<string, unknown>;
    }>();
    expect(status).toMatchObject({
      api: { reachable: true, authenticated: true },
      session: { actorId: "u-nurse" },
      stores: { postgresql: { ready: true } },
    });
    expect(status.ai.model.acceptance).toEqual(expect.any(String));
    expect(status.ai.asr.acceptance).toEqual(expect.any(String));
    expect(status.ai.tts.acceptance).toEqual(expect.any(String));
    expect(status.delivery).toBeTypeOf("object");
  });

  it("persists scoped comments, replays the same command, and denies an unrelated role", async () => {
    const app = buildApp(undefined, { demoMode: true });
    apps.push(app);
    const commandId = randomUUID();
    const payload = {
      patientId: "p-anna",
      audienceKind: "patient-team",
      body: "Bitte Mobilisation gemeinsam prüfen.",
      recipientIds: ["u-assistant"],
      recipientRoleIds: ["care-assistant"],
      topicIds: ["mobilitaet"],
      parentId: null,
    };
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/workspace/comments",
      headers: headers("u-nurse", commandId),
      payload,
    });
    expect(first.statusCode).toBe(201);
    const commentId = first.json<{ value: { id: string } }>().value.id;
    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/workspace/comments",
      headers: headers("u-nurse", commandId),
      payload,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({
      value: { id: commentId },
      replayed: false,
    });

    const visible = await app.inject({
      method: "GET",
      url: "/api/v1/workspace/comments?patientId=p-anna&topicId=mobilitaet",
      headers: { "x-demo-user": "u-assistant" },
    });
    expect(visible.statusCode).toBe(200);
    expect(
      visible.json<{ comments: Array<{ id: string; unread: boolean }> }>()
        .comments,
    ).toEqual([expect.objectContaining({ id: commentId, unread: true })]);
    const denied = await app.inject({
      method: "GET",
      url: "/api/v1/workspace/comments?patientId=p-anna",
      headers: { "x-demo-user": "u-hr" },
    });
    expect(denied.statusCode).toBe(403);
  });

  it("binds an attachment to its digest, content signature, actor, and patient scope", async () => {
    const app = buildApp(undefined, { demoMode: true });
    apps.push(app);
    const content = Buffer.from("synthetic library note\n", "utf8");
    const digest = createHash("sha256").update(content).digest("hex");
    const boundary = `pfh-${randomUUID()}`;
    const multipart = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="note.txt"\r\nContent-Type: text/plain\r\n\r\n`,
      ),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const upload = await app.inject({
      method: "POST",
      url: "/api/v1/workspace/attachments?patientId=p-anna&audienceKind=private",
      headers: {
        ...headers("u-nurse"),
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "x-content-sha256": digest,
      },
      payload: multipart,
    });
    expect(upload.statusCode).toBe(201);
    expect(upload.json()).toMatchObject({
      value: { fileName: "note.txt", sha256: digest, state: "available" },
    });
    const attachmentId = upload.json<{ value: { id: string } }>().value.id;
    const contentResponse = await app.inject({
      method: "GET",
      url: `/api/v1/workspace/attachments/${attachmentId}/content`,
      headers: { "x-demo-user": "u-nurse" },
    });
    expect(contentResponse.statusCode).toBe(200);
    expect(contentResponse.rawPayload).toEqual(content);
    const otherActor = await app.inject({
      method: "GET",
      url: `/api/v1/workspace/attachments/${attachmentId}/content`,
      headers: { "x-demo-user": "u-assistant" },
    });
    expect(otherActor.statusCode).toBe(404);
  });

  it("requires review before a versioned profile update and rejects unauthorized edits", async () => {
    const app = buildApp(undefined, { demoMode: true });
    apps.push(app);
    const denied = await app.inject({
      method: "POST",
      url: "/api/v1/workspace/profile/prepare",
      headers: headers("u-assistant"),
      payload: {
        patientId: "p-anna",
        fieldKey: "care-preference",
        label: "Pflegepräferenz",
        proposedValue: "Morgens zuerst informieren.",
        expectedVersion: 0,
        sourceLabel: "synthetischer Test",
      },
    });
    expect(denied.statusCode).toBe(403);
    const prepared = await app.inject({
      method: "POST",
      url: "/api/v1/workspace/profile/prepare",
      headers: headers("u-nurse"),
      payload: {
        patientId: "p-anna",
        fieldKey: "care-preference",
        label: "Pflegepräferenz",
        proposedValue: "Morgens zuerst informieren.",
        expectedVersion: 0,
        sourceLabel: "synthetischer Test",
      },
    });
    expect(prepared.statusCode).toBe(201);
    const proposalId = prepared.json<{ value: { id: string } }>().value.id;
    const before = await app.inject({
      method: "GET",
      url: "/api/v1/workspace/profile?patientId=p-anna",
      headers: { "x-demo-user": "u-nurse" },
    });
    expect(before.json<{ fields: unknown[] }>().fields).toEqual([]);
    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/workspace/profile/${proposalId}/accept`,
      headers: headers("u-nurse"),
      payload: {},
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({
      value: {
        field: {
          patientId: "p-anna",
          value: "Morgens zuerst informieren.",
          version: 1,
        },
      },
    });
  });

  it("returns only authorized patient-team members and links the existing task authority into a project", async () => {
    const app = buildApp(undefined, { demoMode: true });
    apps.push(app);
    const members = await app.inject({
      method: "GET",
      url: "/api/v1/workspace/team-members?patientId=p-anna",
      headers: { "x-demo-user": "u-nurse" },
    });
    expect(members.statusCode).toBe(200);
    const memberIds = members
      .json<{ members: Array<{ id: string }> }>()
      .members.map((member) => member.id);
    expect(memberIds).toContain("u-assistant");
    expect(memberIds).not.toContain("u-hr");

    const project = await app.inject({
      method: "POST",
      url: "/api/v1/workspace/projects",
      headers: headers("u-nurse"),
      payload: {
        title: "Synthetische Mobilitätskoordination",
        purpose: "Vorhandene Arbeit gemeinsam verfolgen",
        memberIds: ["u-assistant"],
      },
    });
    expect(project.statusCode).toBe(201);
    const created = project.json<{
      value: { id: string; version: number };
    }>().value;
    const linked = await app.inject({
      method: "POST",
      url: `/api/v1/workspace/projects/${created.id}/links`,
      headers: headers("u-nurse"),
      payload: {
        expectedVersion: created.version,
        link: { kind: "task", id: "t-bp-anna" },
      },
    });
    expect(linked.statusCode).toBe(200);
    expect(linked.json()).toMatchObject({
      value: {
        version: 2,
        links: [{ kind: "task", id: "t-bp-anna" }],
      },
    });
    const visibleToMember = await app.inject({
      method: "GET",
      url: "/api/v1/workspace/projects",
      headers: { "x-demo-user": "u-assistant" },
    });
    const visibleProject = visibleToMember
      .json<{ projects: Array<{ id: string; links: unknown[] }> }>()
      .projects.find((item) => item.id === created.id);
    expect(visibleProject?.id).toBe(created.id);
    expect(visibleProject?.links).toHaveLength(1);
  });
});
