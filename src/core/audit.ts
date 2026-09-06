import { createHash, randomUUID } from "node:crypto";
import type { AuditEntry, DemoUser, Purpose } from "./types.js";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonical(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

export function verifyAuditEntries(entries: readonly AuditEntry[]): boolean {
  let previousHash = "GENESIS";
  for (const entry of entries) {
    if (entry.previousHash !== previousHash) return false;
    const { hash: _hash, ...body } = entry;
    void _hash;
    const expected = createHash("sha256").update(canonical(body)).digest("hex");
    if (expected !== entry.hash) return false;
    previousHash = entry.hash;
  }
  return true;
}

export class AuditChain {
  private entries: AuditEntry[] = [];

  append(input: {
    actor: DemoUser;
    actorType?: "human" | "system";
    action: string;
    patientId: string | null;
    purpose: Purpose;
    outcome: AuditEntry["outcome"];
    detail?: AuditEntry["detail"];
    occurredAt?: string;
  }): AuditEntry {
    const previousHash = this.entries.at(-1)?.hash ?? "GENESIS";
    const body = {
      id: randomUUID(),
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      actorId: input.actor.id,
      actorRole: input.actor.role,
      actorType: input.actorType ?? "human",
      action: input.action,
      patientId: input.patientId,
      purpose: input.purpose,
      outcome: input.outcome,
      detail: input.detail ?? {},
      previousHash,
    };
    const entry: AuditEntry = {
      ...body,
      hash: createHash("sha256").update(canonical(body)).digest("hex"),
    };
    this.entries.push(entry);
    return entry;
  }

  verify(): boolean {
    return verifyAuditEntries(this.entries);
  }

  snapshot(): AuditEntry[] {
    return structuredClone(this.entries);
  }

  restore(entries: readonly AuditEntry[]): void {
    if (!verifyAuditEntries(entries))
      throw new Error("Audit checkpoint failed hash-chain validation.");
    this.entries = structuredClone([...entries]);
  }
}
