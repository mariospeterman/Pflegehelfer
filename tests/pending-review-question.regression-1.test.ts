import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/server/app.js";

const apps: ReturnType<typeof buildApp>[] = [];
const commandHeaders = (user: string, commandId = crypto.randomUUID()) => ({
  "x-demo-user": user,
  "x-command-id": commandId,
});

afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe("pending review continuity", () => {
  // Regression: ISSUE-008 — an ordinary question revoked unrelated pending work
  // Found by /qa on 2026-09-13
  // Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-09-13.md
  it("keeps the same patient review executable after a read-only question", async () => {
    const app = buildApp(undefined, { demoMode: true });
    apps.push(app);
    await app.inject({
      method: "POST",
      url: "/api/v1/assistant/context",
      headers: commandHeaders("u-nurse"),
      payload: { patientId: "p-anna" },
    });

    const draftResponse = await app.inject({
      method: "POST",
      url: "/api/v1/assistant/query",
      headers: commandHeaders("u-nurse"),
      payload: {
        patientId: "p-anna",
        prompt: "Puls 82.",
        inputModality: "typed",
      },
    });
    expect(draftResponse.statusCode).toBe(200);
    const draftBody = draftResponse.json<{
      id: string;
      patientContext: {
        patientId: string;
        encounterId: string;
        resourceVersion: number;
      };
      components: Array<{
        type: string;
        intentToken?: string;
        reviewItems?: Array<{ id: string }>;
      }>;
    }>();
    const draft = draftBody.components.find(
      (component) => component.type === "DraftAction",
    );
    expect(draft?.intentToken).toBeTypeOf("string");

    const question = await app.inject({
      method: "POST",
      url: "/api/v1/assistant/query",
      headers: commandHeaders("u-nurse"),
      payload: {
        patientId: "p-anna",
        prompt: "Was ist noch offen?",
        inputModality: "typed",
      },
    });
    expect(question.statusCode).toBe(200);
    expect(
      question
        .json<{ components: Array<{ type: string }> }>()
        .components.some((component) => component.type === "DraftAction"),
    ).toBe(false);

    const restored = await app.inject({
      method: "POST",
      url: "/api/v1/assistant/pending-review",
      headers: commandHeaders("u-nurse"),
      payload: {},
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({
      pending: { responseId: draftBody.id },
    });

    const executed = await app.inject({
      method: "POST",
      url: `/api/v1/assistant/intents/${draft!.intentToken}/execute`,
      headers: commandHeaders("u-nurse"),
      payload: {
        patientId: draftBody.patientContext.patientId,
        encounterId: draftBody.patientContext.encounterId,
        purpose: "direct-care",
        resourceVersion: draftBody.patientContext.resourceVersion,
        explicitlyConfirmed: true,
        reviewedActionIds: draft!.reviewItems!.map((item) => item.id),
      },
    });
    expect(executed.statusCode).toBe(200);
  });

  it("suspends a patient review across a context switch and reauthorizes it on return", async () => {
    const app = buildApp(undefined, { demoMode: true });
    apps.push(app);
    const switchTo = (patientId: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/assistant/context",
        headers: commandHeaders("u-nurse"),
        payload: { patientId },
      });
    await switchTo("p-anna");
    const draftResponse = await app.inject({
      method: "POST",
      url: "/api/v1/assistant/query",
      headers: commandHeaders("u-nurse"),
      payload: {
        patientId: "p-anna",
        prompt: "Puls 82.",
        inputModality: "typed",
      },
    });
    const draftBody = draftResponse.json<{
      patientContext: {
        patientId: string;
        encounterId: string;
        resourceVersion: number;
      };
      components: Array<{
        type: string;
        intentToken?: string;
        reviewItems?: Array<{ id: string }>;
      }>;
    }>();
    const original = draftBody.components.find(
      (component) => component.type === "DraftAction",
    )!;
    await switchTo("p-luca");
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/assistant/pending-review",
          headers: commandHeaders("u-nurse"),
          payload: {},
        })
      ).json(),
    ).toEqual({ pending: null });
    await switchTo("p-anna");
    const restored = (
      await app.inject({
        method: "POST",
        url: "/api/v1/assistant/pending-review",
        headers: commandHeaders("u-nurse"),
        payload: {},
      })
    ).json<{
      pending: {
        response: {
          components: Array<{
            type: string;
            intentToken?: string;
            reviewItems?: Array<{ id: string }>;
          }>;
        };
      };
    }>();
    const reauthorized = restored.pending.response.components.find(
      (component) => component.type === "DraftAction",
    )!;
    expect(reauthorized.intentToken).not.toBe(original.intentToken);
    const payload = {
      patientId: draftBody.patientContext.patientId,
      encounterId: draftBody.patientContext.encounterId,
      purpose: "direct-care",
      resourceVersion: draftBody.patientContext.resourceVersion,
      explicitlyConfirmed: true,
      reviewedActionIds: reauthorized.reviewItems!.map((item) => item.id),
    };
    const stale = await app.inject({
      method: "POST",
      url: `/api/v1/assistant/intents/${original.intentToken}/execute`,
      headers: commandHeaders("u-nurse"),
      payload,
    });
    expect(stale.statusCode).toBe(403);
    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/assistant/intents/${reauthorized.intentToken}/execute`,
      headers: commandHeaders("u-nurse"),
      payload,
    });
    expect(accepted.statusCode).toBe(200);
  });
});
