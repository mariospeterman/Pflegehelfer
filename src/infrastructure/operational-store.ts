import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { workflowForRole, type WorkflowDefinition } from "../core/workflows.js";
import type { AuditEntry, Role } from "../core/types.js";

const { Pool } = pg;
const organizationId = "org-demo";
const departmentId = "rehab-2";

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
  appendAudit(entry: AuditEntry): Promise<void>;
  health(): Promise<boolean>;
  resetDemoState(): Promise<void>;
  close(): Promise<void>;
}

interface MemorySession extends WorkingSessionView {
  turns: StoredConversationTurn[];
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
  }
  async getOrStartSession(
    actorId: string,
    role: Role,
  ): Promise<WorkingSessionView> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
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
        const expiresAt = new Date(Date.now() + 12 * 60 * 60_000);
        await client.query(
          `INSERT INTO assistant_threads
             (organization_id,id,actor_id,effective_role,department_id,expires_at)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [organizationId, threadId, actorId, role, departmentId, expiresAt],
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
          new Date(Date.now() + 12 * 60 * 60_000),
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
