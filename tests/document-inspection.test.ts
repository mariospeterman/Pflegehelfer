import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDocumentInspectionGateway } from "../src/infrastructure/document-inspection.js";

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

describe("document inspection", () => {
  it("reads bounded UTF-8 text locally and binds the extracted digest", async () => {
    const gateway = new LocalDocumentInspectionGateway();
    const bytes = new TextEncoder().encode("Synthetischer Pflegeplan");
    const expectedSha256 = createHash("sha256").update(bytes).digest("hex");
    const result = await gateway.inspect({
      bytes,
      fileName: "plan.txt",
      mediaType: "text/plain",
      expectedSha256,
    });
    expect(result).toMatchObject({
      state: "available",
      engine: "plain-text",
      extractedText: "Synthetischer Pflegeplan",
    });
    expect(result.extractedTextSha256).toBe(
      createHash("sha256").update("Synthetischer Pflegeplan").digest("hex"),
    );
  });

  it("does not pretend PDF OCR is available without an isolated parser", async () => {
    const gateway = new LocalDocumentInspectionGateway();
    const bytes = new TextEncoder().encode("%PDF- synthetic");
    const result = await gateway.inspect({
      bytes,
      fileName: "scan.pdf",
      mediaType: "application/pdf",
      expectedSha256: createHash("sha256").update(bytes).digest("hex"),
    });
    expect(result).toMatchObject({ state: "unavailable", engine: "none" });
  });

  it("uses Docling's stable file API without forwarding document instructions", async () => {
    let requestBody = "";
    const server = createServer((request, response) => {
      request.on("data", (chunk: Buffer) => {
        requestBody += chunk.toString("latin1");
      });
      request.on("end", () => {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            document: {
              md_content: "# Bericht\nKein Sturz beobachtet.",
              text_content: "",
              json_content: { pages: { "1": {} } },
            },
            status: "success",
            processing_time: 0.2,
            errors: [],
          }),
        );
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("NO_ADDRESS");
    const gateway = new LocalDocumentInspectionGateway({
      baseUrl: `http://127.0.0.1:${address.port}`,
    });
    const bytes = new TextEncoder().encode("%PDF- synthetic");
    const result = await gateway.inspect({
      bytes,
      fileName: "bericht.pdf",
      mediaType: "application/pdf",
      expectedSha256: createHash("sha256").update(bytes).digest("hex"),
    });
    expect(result).toMatchObject({
      state: "available",
      engine: "docling",
      pageCount: 1,
      extractedText: "# Bericht\nKein Sturz beobachtet.",
    });
    expect(requestBody).toContain('name="do_ocr"');
    expect(requestBody).toContain('name="image_export_mode"');
    expect(requestBody).toContain("iso:de");
    expect(requestBody).toContain("iso:fr");
    expect(requestBody).toContain("iso:it");
    expect(requestBody).not.toContain("execute this instruction");
  });

  it("does not publish zero as a page count", async () => {
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          document: {
            md_content: "Extrahierter Inhalt",
            text_content: "",
            json_content: { pages: {} },
          },
          status: "success",
          errors: [],
        }),
      );
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("NO_ADDRESS");
    const gateway = new LocalDocumentInspectionGateway({
      baseUrl: `http://127.0.0.1:${address.port}`,
      timeoutMs: Number.NaN,
    });
    const bytes = new TextEncoder().encode("%PDF- synthetic");
    const result = await gateway.inspect({
      bytes,
      fileName: "leer.pdf",
      mediaType: "application/pdf",
      expectedSha256: createHash("sha256").update(bytes).digest("hex"),
    });
    expect(result).toMatchObject({ state: "available", pageCount: null });
  });

  it("rejects content whose digest does not match the reviewed upload", async () => {
    const gateway = new LocalDocumentInspectionGateway();
    await expect(
      gateway.inspect({
        bytes: new TextEncoder().encode("changed"),
        fileName: "plan.txt",
        mediaType: "text/plain",
        expectedSha256: "0".repeat(64),
      }),
    ).rejects.toThrow("DOCUMENT_INSPECTION_DIGEST_MISMATCH");
  });

  it("rejects public parser egress unless its exact origin is reviewed", () => {
    expect(
      () =>
        new LocalDocumentInspectionGateway({
          baseUrl: "https://parser.example.invalid",
        }),
    ).toThrow("DOCUMENT_INSPECTION_ORIGIN_NOT_ALLOWED");
    expect(
      () =>
        new LocalDocumentInspectionGateway({
          baseUrl: "https://parser.example.invalid",
          allowedOrigins: ["https://parser.example.invalid"],
        }),
    ).not.toThrow();
  });

  it("never follows redirects while attachment bytes are in flight", async () => {
    let redirectedRequestSeen = false;
    const server = createServer((request, response) => {
      if (request.url === "/redirected") {
        redirectedRequestSeen = true;
        response.end();
        return;
      }
      response.statusCode = 307;
      response.setHeader("location", "/redirected");
      response.end();
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("NO_ADDRESS");
    const gateway = new LocalDocumentInspectionGateway({
      baseUrl: `http://127.0.0.1:${address.port}`,
    });
    const bytes = new TextEncoder().encode("%PDF- synthetic");
    const result = await gateway.inspect({
      bytes,
      fileName: "redirect.pdf",
      mediaType: "application/pdf",
      expectedSha256: createHash("sha256").update(bytes).digest("hex"),
    });
    expect(result.state).toBe("failed");
    expect(redirectedRequestSeen).toBe(false);
  });
});
