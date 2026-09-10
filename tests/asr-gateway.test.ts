import { afterEach, describe, expect, it, vi } from "vitest";
import { AsrGateway } from "../src/ai/asr-gateway.js";

afterEach(() => vi.unstubAllGlobals());

describe("local ASR privacy boundary", () => {
  it("rejects browser speech outside the explicit synthetic demo", () => {
    expect(
      () =>
        new AsrGateway({
          PFH_ASR_MODE: "browser-demo",
          PFH_DEMO_MODE: "false",
        }),
    ).toThrow(/synthetic demo/);
  });

  it("rejects public endpoints masquerading as local ASR", () => {
    expect(
      () =>
        new AsrGateway({
          PFH_ASR_MODE: "local-openai",
          PFH_ASR_BASE_URL: "https://attacker.invalid/v1",
        }),
    ).toThrow(/LOCAL_AI_ENDPOINT_NOT_ALLOWED/);
  });

  it("requires an immutable ASR model digest outside demo mode", () => {
    expect(
      () =>
        new AsrGateway({
          PFH_ASR_MODE: "local-openai",
          PFH_ASR_BASE_URL: "http://127.0.0.1:9000/v1",
          PFH_DEMO_MODE: "false",
        }),
    ).toThrow(/PFH_ASR_MODEL_DIGEST/);
  });

  it("configures hosted transcription only for an explicitly consented synthetic demo", () => {
    expect(
      () =>
        new AsrGateway({
          PFH_ASR_MODE: "hosted-test",
          PFH_DEMO_MODE: "true",
          PFH_LLM_DATA_CLASSIFICATION: "synthetic-only",
        }),
    ).toThrow(/explicit external-AI consent/);
    expect(
      new AsrGateway({
        PFH_ASR_MODE: "hosted-test",
        PFH_DEMO_MODE: "true",
        PFH_LLM_DATA_CLASSIFICATION: "synthetic-only",
        PFH_ALLOW_EXTERNAL_AI: "true",
        OPENAI_API_KEY: "x",
      }).status(),
    ).toMatchObject({
      mode: "hosted-test",
      model: "gpt-4o-transcribe",
      ready: true,
      dataBoundary: "synthetic-hosted",
    });
  });
  it("refuses hosted audio without server-derived synthetic provenance", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const bytes = new Uint8Array([1, 2, 3]);
    const gateway = new AsrGateway({
      PFH_ASR_MODE: "hosted-test",
      PFH_DEMO_MODE: "true",
      PFH_LLM_DATA_CLASSIFICATION: "synthetic-only",
      PFH_ALLOW_EXTERNAL_AI: "true",
      OPENAI_API_KEY: "x",
    });
    await expect(gateway.transcribe(bytes, "audio/webm")).rejects.toMatchObject(
      {
        code: "AUTH_DENIED",
      },
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect([...bytes]).toEqual([0, 0, 0]);
  });
  it("fails closed and clears the caller buffer when no local runtime is configured", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    await expect(
      new AsrGateway({ PFH_ASR_MODE: "disabled" }).transcribe(
        bytes,
        "audio/webm",
      ),
    ).rejects.toMatchObject({ code: "EXTERNAL_VENDOR_GATE" });
    expect([...bytes]).toEqual([0, 0, 0]);
  });

  it("uses the OpenAI-compatible transcription contract and clears audio", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(init?.redirect).toBe("error");
      expect(init?.body).toBeInstanceOf(FormData);
      const form = init?.body as FormData;
      expect(form.get("model")).toBe("asr-test");
      expect(form.get("language")).toBe("de");
      expect(form.get("response_format")).toBe("verbose_json");
      return Promise.resolve(
        new Response(JSON.stringify({ text: "Blutdruck 128 zu 76" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const bytes = new Uint8Array([5, 6, 7]);
    const gateway = new AsrGateway({
      PFH_ASR_MODE: "local-openai",
      PFH_ASR_BASE_URL: "http://127.0.0.1:9000/v1",
      PFH_ASR_MODEL: "asr-test",
      PFH_DEMO_MODE: "true",
    });
    await expect(
      gateway.transcribe(bytes, "audio/webm"),
    ).resolves.toMatchObject({
      text: "Blutdruck 128 zu 76",
      confidence: null,
      confidenceState: "unknown",
      audioRetained: false,
      criticalEntities: [
        expect.objectContaining({ kind: "measurement", text: "128 zu 76" }),
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:9000/v1/audio/transcriptions",
      expect.any(Object),
    );
    expect([...bytes]).toEqual([0, 0, 0]);
  });
});
