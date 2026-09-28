import pg from "pg";
import {
  baselineDemoScenario,
  createScenarioRun,
  parseDemoScenarioRun,
  scenarioDigest,
  scenarioRunContentDigest,
  type DemoScenarioRun,
} from "../core/demo-scenario.js";
import type { WorkflowState } from "../core/service.js";
import { siteConfiguration } from "../core/site-config.js";
import type { DemoWorkspaceSnapshot } from "../core/workspace.js";

const { Pool } = pg;
const organizationId = siteConfiguration.institutionId;

export interface DemoScenarioRunSummary {
  runId: string;
  scenarioId: string;
  scenarioVersion: number;
  label: string;
  sourceRunId: string | null;
  clock: DemoScenarioRun["clock"];
  active: boolean;
  stateDigest: string;
  createdAt: string;
  updatedAt: string;
}

export interface DemoScenarioStore {
  initialize(): Promise<DemoScenarioRun>;
  active(): Promise<DemoScenarioRun>;
  get(runId: string): Promise<DemoScenarioRun | null>;
  list(): Promise<DemoScenarioRunSummary[]>;
  clone(input: {
    source: "baseline" | "current";
    label: string;
    mode: "frozen" | "start-today";
  }): Promise<DemoScenarioRun>;
  updateActiveState(
    state: WorkflowState,
    workspace: DemoWorkspaceSnapshot,
  ): Promise<DemoScenarioRun>;
  importRun(run: DemoScenarioRun): Promise<DemoScenarioRun>;
  close(): Promise<void>;
}

function summary(
  run: DemoScenarioRun,
  active: boolean,
): DemoScenarioRunSummary {
  return {
    runId: run.runId,
    scenarioId: run.scenarioId,
    scenarioVersion: run.scenarioVersion,
    label: run.label,
    sourceRunId: run.sourceRunId,
    clock: structuredClone(run.clock),
    active,
    stateDigest: scenarioRunContentDigest(run),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

export class InMemoryDemoScenarioStore implements DemoScenarioStore {
  private readonly runs = new Map<string, DemoScenarioRun>();
  private activeRunId: string | null = null;

  async initialize(): Promise<DemoScenarioRun> {
    if (this.activeRunId) return this.active();
    const run = createScenarioRun({ label: baselineDemoScenario.label });
    this.runs.set(run.runId, run);
    this.activeRunId = run.runId;
    return structuredClone(run);
  }

  async active(): Promise<DemoScenarioRun> {
    if (!this.activeRunId) return this.initialize();
    const run = this.runs.get(this.activeRunId);
    if (!run) throw new Error("DEMO_SCENARIO_ACTIVE_RUN_MISSING");
    return structuredClone(run);
  }

  get(runId: string): Promise<DemoScenarioRun | null> {
    const run = this.runs.get(runId);
    return Promise.resolve(run ? structuredClone(run) : null);
  }

  async list(): Promise<DemoScenarioRunSummary[]> {
    await this.initialize();
    return [...this.runs.values()]
      .map((run) => summary(run, run.runId === this.activeRunId))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async clone(input: {
    source: "baseline" | "current";
    label: string;
    mode: "frozen" | "start-today";
  }): Promise<DemoScenarioRun> {
    const source = input.source === "current" ? await this.active() : undefined;
    const run = createScenarioRun({
      label: input.label,
      mode: input.mode,
      ...(source ? { sourceRun: source, cloneCurrent: true } : {}),
    });
    this.runs.set(run.runId, run);
    return structuredClone(run);
  }

  async updateActiveState(
    state: WorkflowState,
    workspace: DemoWorkspaceSnapshot,
  ): Promise<DemoScenarioRun> {
    const run = await this.active();
    const next = parseDemoScenarioRun({
      ...run,
      // Scenario data describes fixtures, not executable delivery authority.
      // Pending/acknowledged commands remain solely in the operational outbox.
      state: structuredClone({ ...state, outbox: [] }),
      workspace: structuredClone(workspace),
      updatedAt: new Date().toISOString(),
    });
    this.runs.set(next.runId, next);
    return structuredClone(next);
  }

  importRun(input: DemoScenarioRun): Promise<DemoScenarioRun> {
    const run = parseDemoScenarioRun(input);
    if (this.runs.has(run.runId))
      throw new Error("DEMO_SCENARIO_RUN_ALREADY_EXISTS");
    this.runs.set(run.runId, structuredClone(run));
    return Promise.resolve(structuredClone(run));
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

type ScenarioRow = {
  run_id: string;
  scenario_id: string;
  scenario_version: number;
  label: string;
  source_run_id: string | null;
  clock: unknown;
  state: unknown;
  workspace: unknown;
  state_digest: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
};

function fromRow(row: ScenarioRow): DemoScenarioRun {
  const run = parseDemoScenarioRun({
    schemaVersion: 1,
    runId: row.run_id,
    scenarioId: row.scenario_id,
    scenarioVersion: row.scenario_version,
    label: row.label,
    sourceRunId: row.source_run_id,
    clock: row.clock,
    state: row.state,
    workspace: row.workspace,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  });
  const workspaceIsEmpty = Object.values(run.workspace).every(
    (records) => records.length === 0,
  );
  if (
    scenarioRunContentDigest(run) !== row.state_digest &&
    !(workspaceIsEmpty && scenarioDigest(run.state) === row.state_digest)
  )
    throw new Error("DEMO_SCENARIO_STATE_DIGEST_MISMATCH");
  return run;
}

export class PostgresDemoScenarioStore implements DemoScenarioStore {
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 3,
      statement_timeout: 15_000,
    });
  }

  async initialize(): Promise<DemoScenarioRun> {
    const current = await this.pool.query<ScenarioRow>(
      `SELECT * FROM demo_scenario_runs
       WHERE organization_id=$1 AND active=true LIMIT 1`,
      [organizationId],
    );
    if (current.rows[0]) return fromRow(current.rows[0]);
    const run = createScenarioRun({ label: baselineDemoScenario.label });
    await this.insert(run, true);
    return run;
  }

  async active(): Promise<DemoScenarioRun> {
    const result = await this.pool.query<ScenarioRow>(
      `SELECT * FROM demo_scenario_runs
       WHERE organization_id=$1 AND active=true LIMIT 1`,
      [organizationId],
    );
    if (!result.rows[0]) return this.initialize();
    return fromRow(result.rows[0]);
  }

  async get(runId: string): Promise<DemoScenarioRun | null> {
    const result = await this.pool.query<ScenarioRow>(
      `SELECT * FROM demo_scenario_runs
       WHERE organization_id=$1 AND run_id=$2`,
      [organizationId, runId],
    );
    return result.rows[0] ? fromRow(result.rows[0]) : null;
  }

  async list(): Promise<DemoScenarioRunSummary[]> {
    await this.initialize();
    const result = await this.pool.query<ScenarioRow>(
      `SELECT * FROM demo_scenario_runs
       WHERE organization_id=$1 ORDER BY updated_at DESC, run_id`,
      [organizationId],
    );
    return result.rows.map((row) => summary(fromRow(row), row.active));
  }

  async clone(input: {
    source: "baseline" | "current";
    label: string;
    mode: "frozen" | "start-today";
  }): Promise<DemoScenarioRun> {
    const source = input.source === "current" ? await this.active() : undefined;
    const run = createScenarioRun({
      label: input.label,
      mode: input.mode,
      ...(source ? { sourceRun: source, cloneCurrent: true } : {}),
    });
    await this.insert(run, false);
    return run;
  }

  async updateActiveState(
    state: WorkflowState,
    workspace: DemoWorkspaceSnapshot,
  ): Promise<DemoScenarioRun> {
    const run = await this.active();
    const next = parseDemoScenarioRun({
      ...run,
      // Never copy delivery authority into a portable scenario run.
      state: structuredClone({ ...state, outbox: [] }),
      workspace: structuredClone(workspace),
      updatedAt: new Date().toISOString(),
    });
    const digest = scenarioRunContentDigest(next);
    const result = await this.pool.query(
      `UPDATE demo_scenario_runs
       SET state=$3,workspace=$4,state_digest=$5,updated_at=$6
       WHERE organization_id=$1 AND run_id=$2 AND active=true`,
      [
        organizationId,
        next.runId,
        next.state,
        next.workspace,
        digest,
        next.updatedAt,
      ],
    );
    if (result.rowCount !== 1)
      throw new Error("DEMO_SCENARIO_ACTIVE_RUN_CHANGED");
    return next;
  }

  async importRun(input: DemoScenarioRun): Promise<DemoScenarioRun> {
    const run = parseDemoScenarioRun(input);
    await this.insert(run, false);
    return run;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async insert(run: DemoScenarioRun, active: boolean): Promise<void> {
    await this.pool.query(
      `INSERT INTO demo_scenario_runs
         (organization_id,run_id,scenario_id,scenario_version,label,
          source_run_id,clock,state,workspace,state_digest,active,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        organizationId,
        run.runId,
        run.scenarioId,
        run.scenarioVersion,
        run.label,
        run.sourceRunId,
        run.clock,
        run.state,
        run.workspace,
        scenarioRunContentDigest(run),
        active,
        run.createdAt,
        run.updatedAt,
      ],
    );
  }
}
