import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const target = resolve(process.cwd(), "dist", "config");
await mkdir(target, { recursive: true });
await cp(resolve(process.cwd(), "config"), target, { recursive: true });
