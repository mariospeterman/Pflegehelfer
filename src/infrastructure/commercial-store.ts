import pg from "pg";
import type {
  OrganizationCommercialConfig,
  OrganizationUsageReceipt,
} from "../core/organization-economics.js";
import {
  organizationCommercialConfigSchema,
  organizationUsageReceiptSchema,
} from "../core/organization-economics.js";

const { Pool } = pg;

export interface CommercialStore {
  readonly mode: "in-memory" | "postgresql";
  initialize(seed: OrganizationCommercialConfig): Promise<void>;
  getConfiguration(
    organizationId: string,
  ): Promise<OrganizationCommercialConfig>;
  updateConfiguration(
    configuration: OrganizationCommercialConfig,
    expectedVersion: number,
  ): Promise<OrganizationCommercialConfig>;
  recordUsage(receipt: OrganizationUsageReceipt): Promise<boolean>;
  listUsage(
    organizationId: string,
    period: string,
  ): Promise<OrganizationUsageReceipt[]>;
  close(): Promise<void>;
}

export class InMemoryCommercialStore implements CommercialStore {
  readonly mode = "in-memory" as const;
  private configurations = new Map<string, OrganizationCommercialConfig>();
  private receipts = new Map<string, OrganizationUsageReceipt>();

  initialize(seed: OrganizationCommercialConfig): Promise<void> {
    const parsed = organizationCommercialConfigSchema.parse(seed);
    if (!this.configurations.has(parsed.organizationId))
      this.configurations.set(parsed.organizationId, structuredClone(parsed));
    return Promise.resolve();
  }

  getConfiguration(organizationId: string) {
    const value = this.configurations.get(organizationId);
    if (!value)
      return Promise.reject(new Error("COMMERCIAL_CONFIGURATION_NOT_FOUND"));
    return Promise.resolve(structuredClone(value));
  }

  async updateConfiguration(
    configuration: OrganizationCommercialConfig,
    expectedVersion: number,
  ) {
    const parsed = organizationCommercialConfigSchema.parse(configuration);
    const current = await this.getConfiguration(parsed.organizationId);
    if (current.version !== expectedVersion)
      throw new Error("COMMERCIAL_CONFIGURATION_VERSION_CONFLICT");
    const next = { ...parsed, version: expectedVersion + 1 };
    this.configurations.set(parsed.organizationId, structuredClone(next));
    return next;
  }

  recordUsage(receipt: OrganizationUsageReceipt): Promise<boolean> {
    const parsed = organizationUsageReceiptSchema.parse(receipt);
    const key = `${parsed.organizationId}:${parsed.provider}:${parsed.receiptId}`;
    if (this.receipts.has(key)) return Promise.resolve(false);
    this.receipts.set(key, structuredClone(parsed));
    return Promise.resolve(true);
  }

  listUsage(organizationId: string, period: string) {
    return Promise.resolve(
      [...this.receipts.values()]
        .filter(
          (receipt) =>
            receipt.organizationId === organizationId &&
            receipt.occurredAt.slice(0, 7) === period,
        )
        .map((receipt) => structuredClone(receipt)),
    );
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

export class PostgresCommercialStore implements CommercialStore {
  readonly mode = "postgresql" as const;
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 4,
      statement_timeout: 15_000,
    });
  }

  async initialize(seed: OrganizationCommercialConfig): Promise<void> {
    const parsed = organizationCommercialConfigSchema.parse(seed);
    await this.pool.query(
      `INSERT INTO organization_commercial_config
         (organization_id,version,effective_from,configuration)
       VALUES ($1,$2,$3,$4::jsonb)
       ON CONFLICT (organization_id) DO NOTHING`,
      [
        parsed.organizationId,
        parsed.version,
        parsed.effectiveFrom,
        JSON.stringify(parsed),
      ],
    );
  }

  async getConfiguration(organizationId: string) {
    const result = await this.pool.query<{ configuration: unknown }>(
      `SELECT configuration FROM organization_commercial_config
       WHERE organization_id=$1`,
      [organizationId],
    );
    if (!result.rows[0]) throw new Error("COMMERCIAL_CONFIGURATION_NOT_FOUND");
    return organizationCommercialConfigSchema.parse(
      result.rows[0].configuration,
    );
  }

  async updateConfiguration(
    configuration: OrganizationCommercialConfig,
    expectedVersion: number,
  ) {
    const parsed = organizationCommercialConfigSchema.parse(configuration);
    const next = { ...parsed, version: expectedVersion + 1 };
    const result = await this.pool.query<{ configuration: unknown }>(
      `UPDATE organization_commercial_config
       SET version=$3,effective_from=$4,configuration=$5::jsonb,updated_at=now()
       WHERE organization_id=$1 AND version=$2
       RETURNING configuration`,
      [
        parsed.organizationId,
        expectedVersion,
        next.version,
        next.effectiveFrom,
        JSON.stringify(next),
      ],
    );
    if (!result.rows[0])
      throw new Error("COMMERCIAL_CONFIGURATION_VERSION_CONFLICT");
    return organizationCommercialConfigSchema.parse(
      result.rows[0].configuration,
    );
  }

  async recordUsage(receipt: OrganizationUsageReceipt): Promise<boolean> {
    const parsed = organizationUsageReceiptSchema.parse(receipt);
    const result = await this.pool.query(
      `INSERT INTO organization_usage_ledger
         (organization_id,provider,receipt_id,occurred_at,receipt)
       VALUES ($1,$2,$3,$4,$5::jsonb)
       ON CONFLICT (organization_id,provider,receipt_id) DO NOTHING`,
      [
        parsed.organizationId,
        parsed.provider,
        parsed.receiptId,
        parsed.occurredAt,
        JSON.stringify(parsed),
      ],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async listUsage(organizationId: string, period: string) {
    const start = `${period}-01T00:00:00.000Z`;
    const [year, month] = period.split("-").map(Number);
    if (year === undefined || month === undefined)
      throw new Error("COMMERCIAL_STATEMENT_PERIOD_INVALID");
    const end = new Date(Date.UTC(year, month, 1)).toISOString();
    const result = await this.pool.query<{ receipt: unknown }>(
      `SELECT receipt FROM organization_usage_ledger
       WHERE organization_id=$1 AND occurred_at >= $2 AND occurred_at < $3
       ORDER BY occurred_at,receipt_id`,
      [organizationId, start, end],
    );
    return result.rows.map(({ receipt }) =>
      organizationUsageReceiptSchema.parse(receipt),
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
