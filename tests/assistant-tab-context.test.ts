import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/server/app.js";
import {
  assistantClientContextHeaders,
  rotateAssistantClientContext,
} from "../src/pwa/assistant-context.js";

const apps: ReturnType<typeof buildApp>[] = [];
const actorId = "u-nurse";
const tabHeaders = (clientContextId: string) => ({
  "x-demo-user": actorId,
  "x-pfh-client-context": clientContextId,
  "x-command-id": crypto.randomUUID(),
});

afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe("per-tab assistant context", () => {
  it("rotates the browser binding when the acting user changes", () => {
    const before = assistantClientContextHeaders()["x-pfh-client-context"];
    rotateAssistantClientContext();
    expect(assistantClientContextHeaders()["x-pfh-client-context"]).not.toBe(
      before,
    );
  });

  it("keeps two tabs on their own patient threads and authority", async () => {
    const app = buildApp(undefined, { demoMode: true });
    apps.push(app);
    const annaTab = crypto.randomUUID();
    const lucaTab = crypto.randomUUID();

    const annaContext = await app.inject({
      method: "POST",
      url: "/api/v1/assistant/context",
      headers: tabHeaders(annaTab),
      payload: { patientId: "p-anna" },
    });
    const lucaContext = await app.inject({
      method: "POST",
      url: "/api/v1/assistant/context",
      headers: tabHeaders(lucaTab),
      payload: { patientId: "p-luca" },
    });
    expect(annaContext.statusCode).toBe(200);
    expect(lucaContext.statusCode).toBe(200);
    expect(annaContext.json()).toMatchObject({ patientId: "p-anna" });
    expect(lucaContext.json()).toMatchObject({ patientId: "p-luca" });

    const annaDraftResponse = await app.inject({
      method: "POST",
      url: "/api/v1/assistant/query",
      headers: tabHeaders(annaTab),
      payload: {
        patientId: "p-anna",
        prompt: "Puls 82.",
        inputModality: "typed",
      },
    });
    expect(annaDraftResponse.statusCode).toBe(200);
    const annaDraftBody = annaDraftResponse.json<{
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
    const annaDraft = annaDraftBody.components.find(
      (component) => component.type === "DraftAction",
    )!;

    const lucaQuestion = await app.inject({
      method: "POST",
      url: "/api/v1/assistant/query",
      headers: tabHeaders(lucaTab),
      payload: {
        patientId: "p-luca",
        prompt: "Was ist noch offen?",
        inputModality: "typed",
      },
    });
    expect(lucaQuestion.statusCode).toBe(200);

    const [annaHistory, lucaHistory] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/api/v1/assistant/conversation",
        headers: tabHeaders(annaTab),
      }),
      app.inject({
        method: "GET",
        url: "/api/v1/assistant/conversation",
        headers: tabHeaders(lucaTab),
      }),
    ]);
    const annaHistoryBody = annaHistory.json<{
      turns: Array<{ prompt: string }>;
      conversations: Array<{ patientId: string | null; active: boolean }>;
    }>();
    const lucaHistoryBody = lucaHistory.json<{
      turns: Array<{ prompt: string }>;
      conversations: Array<{ patientId: string | null; active: boolean }>;
    }>();
    expect(annaHistoryBody.turns).toEqual([
      expect.objectContaining({ prompt: "Puls 82." }),
    ]);
    expect(lucaHistoryBody.turns).toEqual([
      expect.objectContaining({ prompt: "Was ist noch offen?" }),
    ]);
    expect(
      annaHistoryBody.conversations.find(
        (conversation) => conversation.patientId === "p-anna",
      ),
    ).toMatchObject({ active: true });
    expect(
      lucaHistoryBody.conversations.find(
        (conversation) => conversation.patientId === "p-luca",
      ),
    ).toMatchObject({ active: true });

    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/assistant/intents/${annaDraft.intentToken}/execute`,
      headers: tabHeaders(annaTab),
      payload: {
        patientId: annaDraftBody.patientContext.patientId,
        encounterId: annaDraftBody.patientContext.encounterId,
        purpose: "direct-care",
        resourceVersion: annaDraftBody.patientContext.resourceVersion,
        explicitlyConfirmed: true,
        reviewedActionIds: annaDraft.reviewItems!.map((item) => item.id),
      },
    });
    expect(accepted.statusCode).toBe(200);

    const cleared = await app.inject({
      method: "POST",
      url: "/api/v1/assistant/conversation/clear",
      headers: tabHeaders(annaTab),
      payload: {},
    });
    expect(cleared.statusCode).toBe(200);
    const lucaAfterClear = await app.inject({
      method: "GET",
      url: "/api/v1/assistant/conversation",
      headers: tabHeaders(lucaTab),
    });
    expect(
      lucaAfterClear.json<{ turns: Array<{ prompt: string }> }>().turns,
    ).toEqual([expect.objectContaining({ prompt: "Was ist noch offen?" })]);
  });

  it("rejects authority from the previous scope of the same tab", async () => {
    const app = buildApp(undefined, { demoMode: true });
    apps.push(app);
    const tab = crypto.randomUUID();
    await app.inject({
      method: "POST",
      url: "/api/v1/assistant/context",
      headers: tabHeaders(tab),
      payload: { patientId: "p-anna" },
    });
    const draftResponse = await app.inject({
      method: "POST",
      url: "/api/v1/assistant/query",
      headers: tabHeaders(tab),
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
      components: Array<{ type: string; intentToken?: string }>;
    }>();
    const token = draftBody.components.find(
      (component) => component.type === "DraftAction",
    )!.intentToken!;
    await app.inject({
      method: "POST",
      url: "/api/v1/assistant/context",
      headers: tabHeaders(tab),
      payload: { patientId: "p-luca" },
    });
    const rejected = await app.inject({
      method: "POST",
      url: `/api/v1/assistant/intents/${token}/execute`,
      headers: tabHeaders(tab),
      payload: {
        patientId: draftBody.patientContext.patientId,
        encounterId: draftBody.patientContext.encounterId,
        purpose: "direct-care",
        resourceVersion: draftBody.patientContext.resourceVersion,
        explicitlyConfirmed: true,
      },
    });
    expect(rejected.statusCode).toBe(403);
  });
});
