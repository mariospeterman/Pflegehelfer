import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveBuildIdentity } from "./build-identity.mjs";

const identity = resolveBuildIdentity();
const target = resolve(process.cwd(), "dist", "api-build-info.json");
await mkdir(resolve(process.cwd(), "dist"), { recursive: true });
await writeFile(
  target,
  `${JSON.stringify({ surface: "api", ...identity }, null, 2)}\n`,
  "utf8",
);
