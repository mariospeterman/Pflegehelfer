import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { workflowForRole, type WorkflowDefinition } from "../core/workflows.js";
import { DomainError, type AuditEntry, type Role } from "../core/types.js";
import type {
  WorkdayCommand,
  WorkdayView,
  WorkEpisodeView,
} from "../core/workday.js";
import { siteConfiguration } from "../core/site-config.js";

export type {
  WorkdayCommand,
  WorkdayView,
  WorkEpisodeView,
} from "../core/workday.js";

const { Pool } = pg;
const organizationId = siteConfiguration.institutionId;
const departmentId = siteConfiguration.department.id;
const sessionTtlMs = siteConfiguration.sessionTtlHours * 60 * 60_000;

function facilityDateKey(value = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: siteConfiguration.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function workdayConfiguration(actorId: string, role: Role) {
  const assignment = siteConfiguration.staffAssignments.find(
    (candidate) => candidate.actorId === actorId && candidate.role === role,
  );
  if (!assignment)
    throw new DomainError(
      "AUTH_DENIED",
      "Für diese Identität und Rolle ist keine Schichtzuweisung konfiguriert.",
      403,
    );
  const shiftId = assignment.shiftId;
  const shift = siteConfiguration.shifts[shiftId]!;
  return {
    shiftId,
    shift,
    patientIds: assignment.patientIds,
    shiftKey: `${siteConfiguration.siteId}-${facilityDateKey()}-${shiftId}`,
  };
}

export interface StoredConversationTurn {
  id: string;
  prompt: string;
  response: unknown;
  createdAt: string;
  inputModality: "typed" | "voice";
}

export interface WorkingSessionView {
  id: string;
  organizationId: string;
  departmentId: string;
  actorId: string;
  effectiveRole: Role;
  workflowTemplateId: string;
  workflowVersion: number;
  workflowName: string;
  definition: WorkflowDefinition;
  threadId: string;
  currentStepId: string;
  contextRevision: number;
  patientId: string | null;
  rowVersion: number;
  status: "active" | "paused" | "completed";
  startedAt: string;
}

export interface OperationalStore {
  initialize(): Promise<void>;
  getOrStartSession(actorId: string, role: Role): Promise<WorkingSessionView>;
  changePatientContext(
    actorId: string,
    role: Role,
    patientId: string | null,
  ): Promise<WorkingSessionView>;
  loadConversation(
    actorId: string,
    role: Role,
  ): Promise<StoredConversationTurn[]>;
  appendConversationTurn(
    actorId: string,
    role: Role,
    turn: StoredConversationTurn,
  ): Promise<void>;
  clearConversation(actorId: string, role: Role): Promise<void>;
  getWorkday(actorId: string, role: Role): Promise<WorkdayView>;
  applyWorkdayCommand(
    actorId: string,
    role: Role,
    command: WorkdayCommand,
  ): Promise<WorkdayView>;
  appendAudit(entry: AuditEntry): Promise<void>;
  health(): Promise<boolean>;
  resetDemoState(): Promise<void>;
  close(): Promise<void>;
}

interface MemorySession extends WorkingSessionView {
  turns: StoredConversationTurn[];
  handoverId: string;
  acknowledgedPatientIds: string[];
  handoverStatus: "open" | "transferred" | "acknowledged";
  episodes: WorkEpisodeView[];
}

export class InMemoryOperationalStore implements OperationalStore {
  private readonly sessions = new Map<string, MemorySession>();
  initialize(): Promise<void> {
    return Promise.resolve();
  }
  getOrStartSession(actorId: string, role: Role): Promise<WorkingSessionView> {
    let session = this.sessions.get(actorId);
    if (!session) {
      const workflow = workflowForRole(role);
      session = {
        id: randomUUID(),
        organizationId,
        departmentId,
        actorId,
        effectiveRole: role,
        workflowTemplateId: workflow.id,
        workflowVersion: workflow.version,
        workflowName: workflow.name,
        definition: workflow.definition,
        threadId: randomUUID(),
        currentStepId: workflow.definition.steps[0]!.id,
        contextRevision: 0,
        patientId: null,
        rowVersion: 1,
        status: "active",
        startedAt: new Date().toISOString(),
        turns: [],
        handoverId: randomUUID(),
        acknowledgedPatientIds: [],
        handoverStatus: "open",
        episodes: [],
      };
      this.sessions.set(actorId, session);
    }
    return Promise.resolve(structuredClone(session));
  }
  async changePatientContext(
    actorId: string,
    role: Role,
    patientId: string | null,
  ): Promise<WorkingSessionView> {
    const session =
      this.sessions.get(actorId) ??
      ((await this.getOrStartSession(actorId, role)) as MemorySession);
    const stored = this.sessions.get(actorId) ?? session;
    stored.patientId = patientId;
    stored.contextRevision += 1;
    stored.rowVersion += 1;
    return structuredClone(stored);
  }
  async loadConversation(
    actorId: string,
    role: Role,
  ): Promise<StoredConversationTurn[]> {
    const session =
      this.sessions.get(actorId) ??
      ((await this.getOrStartSession(actorId, role)) as MemorySession);
    return structuredClone(session.turns ?? []);
  }
  async appendConversationTurn(
    actorId: string,
    role: Role,
    turn: StoredConversationTurn,
  ): Promise<void> {
    await this.getOrStartSession(actorId, role);
    const session = this.sessions.get(actorId)!;
    session.turns = [...session.turns, structuredClone(turn)].slice(-80);
  }
  async clearConversation(actorId: string, role: Role): Promise<void> {
    await this.getOrStartSession(actorId, role);
    this.sessions.get(actorId)!.turns = [];
  }
  async getWorkday(actorId: string, role: Role): Promise<WorkdayView> {
    await this.getOrStartSession(actorId, role);
    return memoryWorkdayView(this.sessions.get(actorId)!);
  }
  async applyWorkdayCommand(
    actorId: string,
    role: Role,
    command: WorkdayCommand,
  ): Promise<WorkdayView> {
    await this.getOrStartSession(actorId, role);
    const session = this.sessions.get(actorId)!;
    const configuredWorkday = workdayConfiguration(actorId, role);
    if (command.type === "acknowledge-handover") {
      if (command.version !== 1) throw new Error("HANDOVER_VERSION_STALE");
      if (!session.acknowledgedPatientIds.includes(command.patientId))
        session.acknowledgedPatientIds.push(command.patientId);
      if (
        session.acknowledgedPatientIds.length ===
        configuredWorkday.patientIds.length
      )
        session.currentStepId = "prioritize";
    } else if (command.type === "start-episode") {
      if (session.episodes.some((episode) => episode.state === "active"))
        throw new Error("ACTIVE_EPISODE_REQUIRES_PAUSE");
      const assignment =
        command.kind === "planned" &&
        configuredWorkday.patientIds.includes(command.patientId)
          ? siteConfiguration.nursingAssignments.find(
              (item) => item.patientId === command.patientId,
            )
          : null;
      if (command.kind === "planned" && !assignment)
        throw new Error("PLANNED_ASSIGNMENT_NOT_FOUND");
      session.episodes.push({
        id: randomUUID(),
        patientId: command.patientId,
        encounterId: command.encounterId,
        kind: command.kind,
        title: assignment?.title ?? command.title,
        state: "active",
        startedAt: new Date().toISOString(),
        completedAt: null,
      });
      session.currentStepId = "work";
      session.patientId = command.patientId;
      session.contextRevision += 1;
    } else if (command.type === "interrupt-and-start") {
      const active = session.episodes.find(
        (episode) =>
          episode.id === command.episodeId && episode.state === "active",
      );
      if (!active) throw new Error("EPISODE_STATE_CONFLICT");
      active.state = "paused";
      session.episodes.push({
        id: randomUUID(),
        patientId: command.patientId,
        encounterId: command.encounterId,
        kind: "spontaneous",
        title: command.title,
        state: "active",
        startedAt: new Date().toISOString(),
        completedAt: null,
      });
      session.currentStepId = "work";
      session.patientId = command.patientId;
      session.contextRevision += 1;
    } else {
      const episode =
        command.type === "close-shift"
          ? null
          : session.episodes.find((item) => item.id === command.episodeId);
      if (command.type !== "close-shift" && !episode)
        throw new Error("EPISODE_NOT_FOUND");
      if (command.type === "pause-episode" && episode) episode.state = "paused";
      if (command.type === "resume-episode" && episode) {
        if (session.episodes.some((item) => item.state === "active"))
          throw new Error("ACTIVE_EPISODE_REQUIRES_PAUSE");
        episode.state = "active";
        session.patientId = episode.patientId;
        session.contextRevision += 1;
      }
      if (command.type === "complete-episode" && episode) {
        if (command.evidence.trim().length < 3)
          throw new Error("COMPLETION_EVIDENCE_REQUIRED");
        episode.state = "completed";
        episode.completedAt = new Date().toISOString();
      }
      if (command.type === "close-shift") {
        if (session.episodes.some((item) => item.state === "active"))
          throw new Error("ACTIVE_EPISODE_REQUIRES_PAUSE");
        if (session.episodes.some((item) => item.state === "paused"))
          throw new Error("PAUSED_EPISODE_REQUIRES_RESOLUTION");
        const unresolvedPatients = configuredWorkday.patientIds.filter(
          (patientId) =>
            !session.episodes.some(
              (item) =>
                item.patientId === patientId &&
                item.kind === "planned" &&
                ["completed", "deferred"].includes(item.state),
            ),
        );
        if (unresolvedPatients.length > 0)
          throw new Error("PLANNED_RESPONSIBILITY_REQUIRES_RESOLUTION");
        session.handoverStatus = "transferred";
        session.currentStepId = "complete";
        session.status = "completed";
      }
    }
    session.rowVersion += 1;
    return memoryWorkdayView(session);
  }
  appendAudit(entry: AuditEntry): Promise<void> {
    void entry;
    return Promise.resolve();
  }
  health(): Promise<boolean> {
    return Promise.resolve(true);
  }
  resetDemoState(): Promise<void> {
    this.sessions.clear();
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

export class PostgresOperationalStore implements OperationalStore {
  private readonly pool: pg.Pool;
  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 10,
      statement_timeout: 15_000,
    });
  }
  async initialize(): Promise<void> {
    const sql = await readFile(
      resolve(process.cwd(), "db/migrations/001_operational_kernel.sql"),
      "utf8",
    );
    await this.pool.query(sql);
    await this.pool.query(
      `INSERT INTO organizations (id,name) VALUES ($1,$2)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name`,
      [organizationId, siteConfiguration.displayName],
    );
    await this.pool.query(
      `INSERT INTO departments (organization_id,id,name) VALUES ($1,$2,$3)
       ON CONFLICT (organization_id,id) DO UPDATE SET name=EXCLUDED.name`,
      [
        organizationId,
        siteConfiguration.department.id,
        siteConfiguration.department.displayName,
      ],
    );
  }
  async getOrStartSession(
    actorId: string,
    role: Role,
  ): Promise<WorkingSessionView> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // The PWA loads the working session and workday concurrently. Serialize
      // creation for one actor so both requests either create or reuse the same
      // active session instead of racing the partial unique index.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`${organizationId}:${actorId}`],
      );
      await client.query(
        `UPDATE working_sessions s
         SET status='paused', updated_at=now()
         FROM assistant_threads t
         WHERE s.organization_id=$1 AND s.actor_id=$2 AND s.status='active'
           AND t.organization_id=s.organization_id AND t.id=s.assistant_thread_id
           AND (t.expires_at <= now() OR s.effective_role <> $3)`,
        [organizationId, actorId, role],
      );
      const workflow = workflowForRole(role);
      await client.query(
        `INSERT INTO workflow_templates (organization_id,id,name,eligible_roles,active_version)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (organization_id,id) DO UPDATE SET name=EXCLUDED.name, eligible_roles=EXCLUDED.eligible_roles`,
        [
          organizationId,
          workflow.id,
          workflow.name,
          workflow.eligibleRoles,
          workflow.version,
        ],
      );
      await client.query(
        `INSERT INTO workflow_template_versions
           (organization_id,template_id,version,status,definition,definition_hash,published_at,published_by)
         VALUES ($1,$2,$3,'published',$4,$5,now(),'system-bootstrap')
         ON CONFLICT (organization_id,template_id,version) DO NOTHING`,
        [
          organizationId,
          workflow.id,
          workflow.version,
          workflow.definition,
          workflow.definitionHash,
        ],
      );
      await client.query(
        `UPDATE workflow_templates SET active_version=$3
         WHERE organization_id=$1 AND id=$2 AND active_version IS DISTINCT FROM $3`,
        [organizationId, workflow.id, workflow.version],
      );
      const existing = await client.query(
        `SELECT s.*, t.context_revision, t.patient_id, v.definition, w.name AS workflow_name
         FROM working_sessions s
         JOIN assistant_threads t ON t.organization_id=s.organization_id AND t.id=s.assistant_thread_id
         JOIN workflow_template_versions v ON v.organization_id=s.organization_id AND v.template_id=s.workflow_template_id AND v.version=s.workflow_version
         JOIN workflow_templates w ON w.organization_id=s.organization_id AND w.id=s.workflow_template_id
         WHERE s.organization_id=$1 AND s.actor_id=$2 AND s.effective_role=$3
           AND s.status='active' AND t.expires_at > now()
         FOR UPDATE OF s`,
        [organizationId, actorId, role],
      );
      let row = existing.rows[0] as Record<string, unknown> | undefined;
      if (!row) {
        const threadId = randomUUID();
        const sessionId = randomUUID();
        const expiresAt = new Date(Date.now() + sessionTtlMs);
        const configuredWorkday = workdayConfiguration(actorId, role);
        await client.query(
          `INSERT INTO assistant_threads
             (organization_id,id,actor_id,effective_role,department_id,expires_at)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [organizationId, threadId, actorId, role, departmentId, expiresAt],
        );
        await client.query(
          `INSERT INTO handover_snapshots
             (organization_id,id,department_id,shift_key,version,patient_ids,cutoff_at,source_hash,status,created_by)
           VALUES ($1,$2,$3,$4,1,$5,now(),$6,'open','system-bootstrap')
           ON CONFLICT (organization_id,department_id,shift_key,version) DO NOTHING`,
          [
            organizationId,
            randomUUID(),
            departmentId,
            configuredWorkday.shiftKey,
            configuredWorkday.patientIds,
            "7e6fc6ac91f113aaa07597b01cb655f68feea8a405651a67ce384ca38344969e",
          ],
        );
        await client.query(
          `INSERT INTO working_sessions
             (organization_id,id,actor_id,effective_role,department_id,workflow_template_id,workflow_version,assistant_thread_id,current_step_id,status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active')`,
          [
            organizationId,
            sessionId,
            actorId,
            role,
            departmentId,
            workflow.id,
            workflow.version,
            threadId,
            workflow.definition.steps[0]!.id,
          ],
        );
        await client.query(
          `INSERT INTO workflow_step_instances (organization_id,session_id,step_id,ordinal,status)
           VALUES ($1,$2,$3,1,'open')`,
          [organizationId, sessionId, workflow.definition.steps[0]!.id],
        );
        await client.query(
          `INSERT INTO domain_events (organization_id,aggregate_type,aggregate_id,event_type,audience,payload)
           VALUES ($1,'working-session',$2,'WorkflowSessionStarted',$3,$4)`,
          [
            organizationId,
            sessionId,
            { actorId },
            {
              threadId,
              workflowTemplateId: workflow.id,
              workflowVersion: workflow.version,
            },
          ],
        );
        row = (
          await client.query(
            `SELECT s.*, t.context_revision, t.patient_id, v.definition, w.name AS workflow_name
           FROM working_sessions s
           JOIN assistant_threads t ON t.organization_id=s.organization_id AND t.id=s.assistant_thread_id
           JOIN workflow_template_versions v ON v.organization_id=s.organization_id AND v.template_id=s.workflow_template_id AND v.version=s.workflow_version
           JOIN workflow_templates w ON w.organization_id=s.organization_id AND w.id=s.workflow_template_id
           WHERE s.organization_id=$1 AND s.id=$2`,
            [organizationId, sessionId],
          )
        ).rows[0] as Record<string, unknown>;
      }
      await client.query("COMMIT");
      return this.toView(row);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async changePatientContext(
    actorId: string,
    role: Role,
    patientId: string | null,
  ): Promise<WorkingSessionView> {
    const session = await this.getOrStartSession(actorId, role);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const changed = await client.query<{ context_revision: number }>(
        `UPDATE assistant_threads SET patient_id=$3, context_revision=context_revision+1, updated_at=now()
         WHERE organization_id=$1 AND id=$2
         RETURNING context_revision`,
        [organizationId, session.threadId, patientId],
      );
      const contextRevision = Number(changed.rows[0]?.context_revision);
      await client.query(
        `INSERT INTO assistant_messages
           (organization_id,thread_id,sequence,id,kind,patient_id,context_revision,content)
         SELECT organization_id,id,next_sequence,$3,'context',$4,$5,$6
         FROM assistant_threads WHERE organization_id=$1 AND id=$2`,
        [
          organizationId,
          session.threadId,
          randomUUID(),
          patientId,
          contextRevision,
          { patientId },
        ],
      );
      await client.query(
        `UPDATE assistant_threads SET next_sequence=next_sequence+1 WHERE organization_id=$1 AND id=$2`,
        [organizationId, session.threadId],
      );
      await client.query(
        `UPDATE working_sessions SET row_version=row_version+1, updated_at=now() WHERE organization_id=$1 AND id=$2`,
        [organizationId, session.id],
      );
      await client.query(
        `INSERT INTO domain_events (organization_id,aggregate_type,aggregate_id,event_type,audience,payload)
         VALUES ($1,'assistant-thread',$2,'ContextChanged',$3,$4)`,
        [
          organizationId,
          session.threadId,
          { actorId },
          { patientId, contextRevision },
        ],
      );
      await client.query("COMMIT");
      return await this.getOrStartSession(actorId, role);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async loadConversation(
    actorId: string,
    role: Role,
  ): Promise<StoredConversationTurn[]> {
    const session = await this.getOrStartSession(actorId, role);
    const result = await this.pool.query(
      `SELECT content, created_at FROM (
         SELECT content, created_at, sequence FROM assistant_messages
         WHERE organization_id=$1 AND thread_id=$2 AND kind='assistant'
         ORDER BY sequence DESC LIMIT 80
       ) recent ORDER BY sequence ASC`,
      [organizationId, session.threadId],
    );
    return result.rows.map(
      (row: { content: StoredConversationTurn; created_at: Date }) => ({
        ...row.content,
        createdAt: row.content.createdAt ?? row.created_at.toISOString(),
      }),
    );
  }
  async appendConversationTurn(
    actorId: string,
    role: Role,
    turn: StoredConversationTurn,
  ): Promise<void> {
    const session = await this.getOrStartSession(actorId, role);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const thread = await client.query(
        `SELECT next_sequence,context_revision,patient_id FROM assistant_threads
         WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [organizationId, session.threadId],
      );
      const row = thread.rows[0] as {
        next_sequence: string;
        context_revision: number;
        patient_id: string | null;
      };
      await client.query(
        `INSERT INTO assistant_messages
           (organization_id,thread_id,sequence,id,kind,patient_id,context_revision,input_modality,content)
         VALUES ($1,$2,$3,$4,'assistant',$5,$6,$7,$8)`,
        [
          organizationId,
          session.threadId,
          row.next_sequence,
          turn.id,
          row.patient_id,
          row.context_revision,
          turn.inputModality,
          turn,
        ],
      );
      await client.query(
        `UPDATE assistant_threads SET next_sequence=next_sequence+1,updated_at=now()
         WHERE organization_id=$1 AND id=$2`,
        [organizationId, session.threadId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async clearConversation(actorId: string, role: Role): Promise<void> {
    const session = await this.getOrStartSession(actorId, role);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const nextThreadId = randomUUID();
      await client.query(
        `INSERT INTO assistant_threads
           (organization_id,id,actor_id,effective_role,department_id,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          organizationId,
          nextThreadId,
          actorId,
          role,
          departmentId,
          new Date(Date.now() + sessionTtlMs),
        ],
      );
      await client.query(
        `UPDATE working_sessions
         SET assistant_thread_id=$3,row_version=row_version+1,updated_at=now()
         WHERE organization_id=$1 AND id=$2`,
        [organizationId, session.id, nextThreadId],
      );
      await client.query(
        `INSERT INTO domain_events
           (organization_id,aggregate_type,aggregate_id,event_type,audience,payload)
         VALUES ($1,'working-session',$2,'ConversationSegmentStarted',$3,$4)`,
        [
          organizationId,
          session.id,
          { actorId },
          { previousThreadId: session.threadId, nextThreadId },
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async getWorkday(actorId: string, role: Role): Promise<WorkdayView> {
    const session = await this.getOrStartSession(actorId, role);
    const configuredWorkday = workdayConfiguration(actorId, role);
    await this.pool.query(
      `INSERT INTO handover_snapshots
         (organization_id,id,department_id,shift_key,version,patient_ids,cutoff_at,source_hash,status,created_by)
       VALUES ($1,$2,$3,$4,1,$5,now(),$6,'open','system-bootstrap')
       ON CONFLICT (organization_id,department_id,shift_key,version) DO NOTHING`,
      [
        organizationId,
        randomUUID(),
        session.departmentId,
        configuredWorkday.shiftKey,
        configuredWorkday.patientIds,
        "7e6fc6ac91f113aaa07597b01cb655f68feea8a405651a67ce384ca38344969e",
      ],
    );
    const handoverResult = await this.pool.query(
      `SELECT * FROM handover_snapshots
       WHERE organization_id=$1 AND department_id=$2 AND shift_key=$3
       ORDER BY created_at DESC LIMIT 1`,
      [organizationId, session.departmentId, configuredWorkday.shiftKey],
    );
    const handover = handoverResult.rows[0] as {
      id: string;
      version: number;
      shift_key: string;
      patient_ids: string[];
      status: "open" | "transferred" | "acknowledged";
    };
    const acknowledgements = await this.pool.query<{ patient_id: string }>(
      `SELECT patient_id FROM handover_acknowledgements
       WHERE organization_id=$1 AND handover_id=$2 AND actor_id=$3 AND status='acknowledged'`,
      [organizationId, handover.id, actorId],
    );
    const episodeResult = await this.pool.query(
      `SELECT * FROM work_episodes WHERE organization_id=$1 AND session_id=$2
       ORDER BY started_at ASC`,
      [organizationId, session.id],
    );
    return buildWorkdayView(
      session,
      handover,
      acknowledgements.rows.map((row) => row.patient_id),
      episodeResult.rows.map(toEpisodeView),
    );
  }
  private async setThreadPatientContext(
    client: pg.PoolClient,
    session: WorkingSessionView,
    actorId: string,
    patientId: string,
  ): Promise<void> {
    const changed = await client.query<{
      context_revision: number;
      message_sequence: string;
    }>(
      `UPDATE assistant_threads
       SET patient_id=$3, context_revision=context_revision+1,
           next_sequence=next_sequence+1, updated_at=now()
       WHERE organization_id=$1 AND id=$2 AND patient_id IS DISTINCT FROM $3
       RETURNING context_revision, (next_sequence-1)::text AS message_sequence`,
      [organizationId, session.threadId, patientId],
    );
    const context = changed.rows[0];
    if (!context) return;
    await client.query(
      `INSERT INTO assistant_messages
         (organization_id,thread_id,sequence,id,kind,patient_id,context_revision,content)
       VALUES ($1,$2,$3,$4,'context',$5,$6,$7)`,
      [
        organizationId,
        session.threadId,
        context.message_sequence,
        randomUUID(),
        patientId,
        context.context_revision,
        { patientId },
      ],
    );
    await client.query(
      `INSERT INTO domain_events
         (organization_id,aggregate_type,aggregate_id,event_type,audience,payload)
       VALUES ($1,'assistant-thread',$2,'ContextChanged',$3,$4)`,
      [
        organizationId,
        session.threadId,
        { actorId },
        { patientId, contextRevision: context.context_revision },
      ],
    );
  }
  async applyWorkdayCommand(
    actorId: string,
    role: Role,
    command: WorkdayCommand,
  ): Promise<WorkdayView> {
    if (!["care-assistant", "registered-nurse"].includes(role))
      throw new Error("WORKDAY_ROLE_DENIED");
    const session = await this.getOrStartSession(actorId, role);
    const configuredWorkday = workdayConfiguration(actorId, role);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `SELECT id FROM working_sessions WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [organizationId, session.id],
      );
      if (command.type === "acknowledge-handover") {
        const handover = await client.query(
          `SELECT * FROM handover_snapshots WHERE organization_id=$1 AND department_id=$2 AND shift_key=$3
           ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
          [organizationId, session.departmentId, configuredWorkday.shiftKey],
        );
        const row = handover.rows[0] as {
          id: string;
          version: number;
          patient_ids: string[];
        };
        if (
          row.version !== command.version ||
          !row.patient_ids.includes(command.patientId)
        )
          throw new Error("HANDOVER_VERSION_STALE");
        await client.query(
          `INSERT INTO handover_acknowledgements
             (organization_id,handover_id,patient_id,version,actor_id,status)
           VALUES ($1,$2,$3,$4,$5,'acknowledged') ON CONFLICT DO NOTHING`,
          [organizationId, row.id, command.patientId, command.version, actorId],
        );
        const count = await client.query<{ count: string }>(
          `SELECT count(*) FROM handover_acknowledgements
           WHERE organization_id=$1 AND handover_id=$2 AND actor_id=$3 AND status='acknowledged'`,
          [organizationId, row.id, actorId],
        );
        if (Number(count.rows[0]?.count) >= row.patient_ids.length)
          await client.query(
            `UPDATE working_sessions SET current_step_id='prioritize',row_version=row_version+1,updated_at=now()
             WHERE organization_id=$1 AND id=$2`,
            [organizationId, session.id],
          );
      } else if (command.type === "start-episode") {
        const assignment =
          command.kind === "planned" &&
          configuredWorkday.patientIds.includes(command.patientId)
            ? siteConfiguration.nursingAssignments.find(
                (item) => item.patientId === command.patientId,
              )
            : null;
        if (command.kind === "planned" && !assignment)
          throw new Error("PLANNED_ASSIGNMENT_NOT_FOUND");
        const active = await client.query(
          `SELECT id FROM work_episodes WHERE organization_id=$1 AND actor_id=$2 AND state='active' FOR UPDATE`,
          [organizationId, actorId],
        );
        if (active.rowCount) throw new Error("ACTIVE_EPISODE_REQUIRES_PAUSE");
        const episodeId = randomUUID();
        await client.query(
          `INSERT INTO work_episodes
             (organization_id,id,session_id,actor_id,patient_id,encounter_id,kind,title,state)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')`,
          [
            organizationId,
            episodeId,
            session.id,
            actorId,
            command.patientId,
            command.encounterId,
            command.kind,
            assignment?.title ?? command.title,
          ],
        );
        await client.query(
          `INSERT INTO work_episode_segments (organization_id,episode_id,ordinal,started_at)
           VALUES ($1,$2,1,now())`,
          [organizationId, episodeId],
        );
        await this.setThreadPatientContext(
          client,
          session,
          actorId,
          command.patientId,
        );
        await client.query(
          `UPDATE working_sessions SET current_step_id='work',row_version=row_version+1,updated_at=now()
           WHERE organization_id=$1 AND id=$2`,
          [organizationId, session.id],
        );
      } else if (command.type === "interrupt-and-start") {
        const changed = await client.query(
          `UPDATE work_episodes SET state='paused',row_version=row_version+1
           WHERE organization_id=$1 AND id=$2 AND actor_id=$3 AND state='active' RETURNING id`,
          [organizationId, command.episodeId, actorId],
        );
        if (!changed.rowCount) throw new Error("EPISODE_STATE_CONFLICT");
        await client.query(
          `UPDATE work_episode_segments SET ended_at=now(),end_reason='interruption'
           WHERE organization_id=$1 AND episode_id=$2 AND ordinal=(SELECT max(ordinal) FROM work_episode_segments WHERE organization_id=$1 AND episode_id=$2) AND ended_at IS NULL`,
          [organizationId, command.episodeId],
        );
        const episodeId = randomUUID();
        await client.query(
          `INSERT INTO work_episodes
             (organization_id,id,session_id,actor_id,patient_id,encounter_id,kind,title,state)
           VALUES ($1,$2,$3,$4,$5,$6,'spontaneous',$7,'active')`,
          [
            organizationId,
            episodeId,
            session.id,
            actorId,
            command.patientId,
            command.encounterId,
            command.title,
          ],
        );
        await client.query(
          `INSERT INTO work_episode_segments (organization_id,episode_id,ordinal,started_at)
           VALUES ($1,$2,1,now())`,
          [organizationId, episodeId],
        );
        await this.setThreadPatientContext(
          client,
          session,
          actorId,
          command.patientId,
        );
        await client.query(
          `UPDATE working_sessions SET current_step_id='work',row_version=row_version+1,updated_at=now()
           WHERE organization_id=$1 AND id=$2`,
          [organizationId, session.id],
        );
      } else if (command.type === "pause-episode") {
        const changed = await client.query(
          `UPDATE work_episodes SET state='paused',row_version=row_version+1
           WHERE organization_id=$1 AND id=$2 AND actor_id=$3 AND state='active' RETURNING id`,
          [organizationId, command.episodeId, actorId],
        );
        if (!changed.rowCount) throw new Error("EPISODE_STATE_CONFLICT");
        await client.query(
          `UPDATE work_episode_segments SET ended_at=now(),end_reason=$3
           WHERE organization_id=$1 AND episode_id=$2 AND ordinal=(SELECT max(ordinal) FROM work_episode_segments WHERE organization_id=$1 AND episode_id=$2) AND ended_at IS NULL`,
          [organizationId, command.episodeId, command.reason],
        );
      } else if (command.type === "resume-episode") {
        const active = await client.query(
          `SELECT id FROM work_episodes WHERE organization_id=$1 AND actor_id=$2 AND state='active' FOR UPDATE`,
          [organizationId, actorId],
        );
        if (active.rowCount) throw new Error("ACTIVE_EPISODE_REQUIRES_PAUSE");
        const changed = await client.query<{ patient_id: string }>(
          `UPDATE work_episodes SET state='active',row_version=row_version+1
           WHERE organization_id=$1 AND id=$2 AND actor_id=$3 AND state='paused' RETURNING id,patient_id`,
          [organizationId, command.episodeId, actorId],
        );
        const resumed = changed.rows[0];
        if (!resumed) throw new Error("EPISODE_STATE_CONFLICT");
        await this.setThreadPatientContext(
          client,
          session,
          actorId,
          resumed.patient_id,
        );
        await client.query(
          `UPDATE working_sessions SET current_step_id='work',row_version=row_version+1,updated_at=now()
           WHERE organization_id=$1 AND id=$2`,
          [organizationId, session.id],
        );
        await client.query(
          `INSERT INTO work_episode_segments (organization_id,episode_id,ordinal,started_at)
           SELECT $1,$2,COALESCE(max(ordinal),0)+1,now() FROM work_episode_segments WHERE organization_id=$1 AND episode_id=$2`,
          [organizationId, command.episodeId],
        );
      } else if (command.type === "complete-episode") {
        if (command.evidence.trim().length < 3)
          throw new Error("COMPLETION_EVIDENCE_REQUIRED");
        const episode = await client.query(
          `UPDATE work_episodes SET state='completed',completed_at=now(),completion_evidence=$4,row_version=row_version+1
           WHERE organization_id=$1 AND id=$2 AND actor_id=$3 AND state IN ('active','paused') RETURNING *`,
          [organizationId, command.episodeId, actorId, command.evidence.trim()],
        );
        if (!episode.rowCount) throw new Error("EPISODE_STATE_CONFLICT");
        await client.query(
          `UPDATE work_episode_segments SET ended_at=COALESCE(ended_at,now()),end_reason=COALESCE(end_reason,'complete')
           WHERE organization_id=$1 AND episode_id=$2 AND ended_at IS NULL`,
          [organizationId, command.episodeId],
        );
        const row = episode.rows[0] as { id: string; patient_id: string };
        await client.query(
          `INSERT INTO service_evidence
             (organization_id,id,episode_id,actor_id,patient_id,actual_started_at,actual_ended_at,interruption_seconds,review_status)
           SELECT $1,$2,$3,$4,$5,min(started_at),max(ended_at),
             GREATEST(0, EXTRACT(EPOCH FROM (max(ended_at)-min(started_at)))::integer -
               COALESCE(sum(EXTRACT(EPOCH FROM (ended_at-started_at)))::integer,0)),
             'draft'
           FROM work_episode_segments
           WHERE organization_id=$1 AND episode_id=$3 AND ended_at IS NOT NULL
           ON CONFLICT (organization_id,episode_id) DO NOTHING`,
          [organizationId, randomUUID(), row.id, actorId, row.patient_id],
        );
      } else if (command.type === "close-shift") {
        const active = await client.query(
          `SELECT id FROM work_episodes WHERE organization_id=$1 AND actor_id=$2 AND state='active'`,
          [organizationId, actorId],
        );
        if (active.rowCount) throw new Error("ACTIVE_EPISODE_REQUIRES_PAUSE");
        const paused = await client.query(
          `SELECT id FROM work_episodes WHERE organization_id=$1 AND session_id=$2 AND state='paused'`,
          [organizationId, session.id],
        );
        if (paused.rowCount)
          throw new Error("PAUSED_EPISODE_REQUIRES_RESOLUTION");
        const unresolved = await client.query(
          `SELECT patient_id
           FROM unnest((SELECT patient_ids FROM handover_snapshots
                        WHERE organization_id=$1 AND department_id=$2 AND shift_key=$4
                        ORDER BY created_at DESC LIMIT 1)) AS patient_id
           WHERE NOT EXISTS (
             SELECT 1 FROM work_episodes
             WHERE organization_id=$1 AND session_id=$3
               AND work_episodes.patient_id=patient_id
               AND kind='planned'
               AND state IN ('completed','deferred')
           )`,
          [
            organizationId,
            session.departmentId,
            session.id,
            configuredWorkday.shiftKey,
          ],
        );
        if (unresolved.rowCount)
          throw new Error("PLANNED_RESPONSIBILITY_REQUIRES_RESOLUTION");
        await client.query(
          `UPDATE handover_snapshots SET status='transferred',receiving_actor_id=$3
           WHERE organization_id=$1 AND department_id=$2 AND shift_key=$4 AND status='open'`,
          [
            organizationId,
            session.departmentId,
            configuredWorkday.shift.nextResponsibleActorId,
            configuredWorkday.shiftKey,
          ],
        );
        await client.query(
          `UPDATE working_sessions SET current_step_id='complete',status='completed',completed_at=now(),row_version=row_version+1
           WHERE organization_id=$1 AND id=$2`,
          [organizationId, session.id],
        );
      }
      await client.query(
        `INSERT INTO domain_events (organization_id,aggregate_type,aggregate_id,event_type,audience,payload)
         VALUES ($1,'working-session',$2,$3,$4,$5)`,
        [
          organizationId,
          session.id,
          `Workday:${command.type}`,
          { actorId },
          { command: command.type },
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return this.getWorkday(actorId, role);
  }
  async appendAudit(entry: AuditEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_entries
         (organization_id,actor_id,actor_role,action,outcome,patient_id,purpose,detail,previous_hash,entry_hash,occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        organizationId,
        entry.actorId,
        entry.actorRole,
        entry.action,
        entry.outcome,
        entry.patientId,
        entry.purpose,
        entry.detail,
        entry.previousHash,
        entry.hash,
        entry.occurredAt,
      ],
    );
  }
  async health(): Promise<boolean> {
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }
  async resetDemoState(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM service_evidence WHERE organization_id=$1`,
        [organizationId],
      );
      await client.query(
        `DELETE FROM work_episode_segments WHERE organization_id=$1`,
        [organizationId],
      );
      await client.query(`DELETE FROM work_episodes WHERE organization_id=$1`, [
        organizationId,
      ]);
      await client.query(
        `DELETE FROM handover_acknowledgements WHERE organization_id=$1`,
        [organizationId],
      );
      await client.query(
        `DELETE FROM handover_snapshots WHERE organization_id=$1`,
        [organizationId],
      );
      await client.query(
        `DELETE FROM workflow_step_instances WHERE organization_id=$1`,
        [organizationId],
      );
      await client.query(
        `DELETE FROM working_sessions WHERE organization_id=$1`,
        [organizationId],
      );
      await client.query(
        `DELETE FROM assistant_messages WHERE organization_id=$1`,
        [organizationId],
      );
      await client.query(
        `DELETE FROM assistant_threads WHERE organization_id=$1`,
        [organizationId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
  private toView(row: Record<string, unknown>): WorkingSessionView {
    return {
      id: String(row.id),
      organizationId: String(row.organization_id),
      departmentId: String(row.department_id),
      actorId: String(row.actor_id),
      effectiveRole: String(row.effective_role) as Role,
      workflowTemplateId: String(row.workflow_template_id),
      workflowVersion: Number(row.workflow_version),
      workflowName: String(row.workflow_name),
      definition: row.definition as WorkflowDefinition,
      threadId: String(row.assistant_thread_id),
      currentStepId: String(row.current_step_id),
      contextRevision: Number(row.context_revision),
      patientId: typeof row.patient_id === "string" ? row.patient_id : null,
      rowVersion: Number(row.row_version),
      status: String(row.status) as WorkingSessionView["status"],
      startedAt:
        row.started_at instanceof Date
          ? row.started_at.toISOString()
          : String(row.started_at),
    };
  }
}

function toEpisodeView(row: Record<string, unknown>): WorkEpisodeView {
  return {
    id: String(row.id),
    patientId: String(row.patient_id),
    encounterId: String(row.encounter_id),
    kind: String(row.kind) as WorkEpisodeView["kind"],
    title: String(row.title),
    state: String(row.state) as WorkEpisodeView["state"],
    startedAt:
      row.started_at instanceof Date
        ? row.started_at.toISOString()
        : String(row.started_at),
    completedAt:
      row.completed_at instanceof Date
        ? row.completed_at.toISOString()
        : typeof row.completed_at === "string"
          ? row.completed_at
          : null,
  };
}

function buildWorkdayView(
  session: WorkingSessionView,
  handover: {
    id: string;
    version: number;
    shift_key: string;
    patient_ids: string[];
    status: "open" | "transferred" | "acknowledged";
  },
  acknowledgedPatientIds: string[],
  episodes: WorkEpisodeView[],
): WorkdayView {
  const activeEpisode =
    episodes.find((episode) => episode.state === "active") ?? null;
  const resumableEpisode =
    [...episodes].reverse().find((episode) => episode.state === "paused") ??
    null;
  const allAcknowledged = handover.patient_ids.every((id) =>
    acknowledgedPatientIds.includes(id),
  );
  const stage =
    session.status === "completed" ||
    session.currentStepId === "complete" ||
    handover.status === "transferred"
      ? "closed"
      : !allAcknowledged
        ? "handover"
        : activeEpisode || resumableEpisode || episodes.length > 0
          ? "patient-work"
          : "plan";
  return {
    sessionId: session.id,
    stage,
    handover: {
      id: handover.id,
      version: Number(handover.version),
      shiftKey: handover.shift_key,
      patientIds: handover.patient_ids,
      acknowledgedPatientIds,
      status: handover.status,
    },
    plan: handover.patient_ids.map((patientId) => {
      const episode = [...episodes]
        .reverse()
        .find(
          (item) => item.patientId === patientId && item.kind === "planned",
        );
      const assignment = siteConfiguration.nursingAssignments.find(
        (item) => item.patientId === patientId,
      );
      return {
        patientId,
        title: assignment?.title ?? "Individueller Pflegeauftrag",
        reason: assignment
          ? `${assignment.window} · ${assignment.reason}`
          : "Gemäss freigegebenem Pflegeplan",
        status:
          episode?.state === "deferred"
            ? "paused"
            : (episode?.state ?? "planned"),
      };
    }),
    episodes,
    activeEpisode,
    resumableEpisode,
    // The operational store cannot infer provider delivery from episode
    // completion. The API overlays this with the clinical outbox/receipt state.
    providerState: "external-gated",
  };
}

function memoryWorkdayView(session: MemorySession): WorkdayView {
  const configuredWorkday = workdayConfiguration(
    session.actorId,
    session.effectiveRole,
  );
  return buildWorkdayView(
    session,
    {
      id: session.handoverId,
      version: 1,
      shift_key: configuredWorkday.shiftKey,
      patient_ids: configuredWorkday.patientIds,
      status: session.handoverStatus,
    },
    session.acknowledgedPatientIds,
    session.episodes,
  );
}
