import { afterEach, describe, expect, it, vi } from "vitest";
import { TtsGateway } from "../src/ai/tts-gateway.js";

afterEach(() => vi.unstubAllGlobals());

describe("TTS privacy and acceptance boundary", () => {
  it("does not claim an untested browser voice is accepted", () => {
    expect(
      new TtsGateway({
        PFH_TTS_MODE: "browser-demo",
        PFH_DEMO_MODE: "true",
      }).status(),
    ).toMatchObject({
      ready: true,
      configured: true,
      acceptance: "ready-for-test",
      dataBoundary: "synthetic-browser",
    });
  });

  it("rejects browser speech and public local endpoints in production", () => {
    expect(
      () =>
        new TtsGateway({
          PFH_TTS_MODE: "browser-demo",
          PFH_DEMO_MODE: "false",
        }),
    ).toThrow(/synthetic demo/);
    expect(
      () =>
        new TtsGateway({
          PFH_TTS_MODE: "local-openai",
          PFH_TTS_BASE_URL: "https://attacker.invalid/v1",
        }),
    ).toThrow(/LOCAL_AI_ENDPOINT_NOT_ALLOWED/);
  });

  it("uses the compatible speech endpoint and accepts only after real audio", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      expect(JSON.parse(String(init?.body))).toEqual({
        model: "tts-test",
        voice: "test-voice",
        input: "Synthetischer Test.",
        response_format: "mp3",
      });
      return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
    });
    vi.stubGlobal("fetch", fetchMock);
    const gateway = new TtsGateway({
      PFH_TTS_MODE: "local-openai",
      PFH_TTS_BASE_URL: "http://127.0.0.1:9001/v1",
      PFH_TTS_MODEL: "tts-test",
      PFH_TTS_VOICE: "test-voice",
      PFH_DEMO_MODE: "true",
    });
    expect(gateway.status().acceptance).toBe("ready-for-test");
    await expect(
      gateway.synthesize("Synthetischer Test.", "synthetic-demo"),
    ).resolves.toMatchObject({
      audioRetained: false,
      contentType: "audio/mpeg",
    });
    expect(gateway.status()).toMatchObject({
      ready: true,
      acceptance: "accepted",
    });
  });

  it("never sends institution-local text to hosted TTS", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const gateway = new TtsGateway({
      PFH_TTS_MODE: "hosted-test",
      PFH_DEMO_MODE: "true",
      PFH_LLM_DATA_CLASSIFICATION: "synthetic-only",
      PFH_ALLOW_EXTERNAL_AI: "true",
      OPENAI_API_KEY: "x",
    });
    await expect(
      gateway.synthesize("Patiententext", "institution-local"),
    ).rejects.toMatchObject({ code: "AUTH_DENIED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
