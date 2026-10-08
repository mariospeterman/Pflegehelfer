import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const script = new URL("../scripts/validate-build-sha.mjs", import.meta.url);

describe("Docker build identity input", () => {
  it("accepts and normalizes an exact source SHA", () => {
    const result = execFileSync(process.execPath, [script.pathname], {
      encoding: "utf8",
      env: { ...process.env, PFH_BUILD_SHA: "A".repeat(40) },
    });
    expect(result).toContain("validated aaaaaaaaaaaa");
  });

  it("rejects a malformed claimed source SHA", () => {
    const result = spawnSync(process.execPath, [script.pathname], {
      encoding: "utf8",
      env: { ...process.env, PFH_BUILD_SHA: "not-a-source-sha" },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "PFH_BUILD_SHA must be an exact 40-64 character hexadecimal source SHA",
    );
  });
});
