import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("Medplum Node runtime", () => {
  it("loads when Node does not provide the experimental WebSocket global", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--no-experimental-websocket",
        "--import",
        "tsx",
        "--eval",
        "import('./src/infrastructure/medplum-workspace.ts')",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
  });
});
