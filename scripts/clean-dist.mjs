import { rm } from "node:fs/promises";
import { resolve } from "node:path";

// Build output only. Keeping cleanup inside the build prevents removed source
// configuration or modules from surviving as executable stale artifacts.
await rm(resolve(process.cwd(), "dist"), { recursive: true, force: true });
