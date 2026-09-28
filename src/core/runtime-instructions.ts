import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { providerIdSchema } from "./provider-integration/contract.js";
import type { Role } from "./types.js";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const idSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/);
const safeReferenceSchema = z
  .string()
  .min(1)
  .max(240)
  .superRefine((value, context) => {
    if (
      isAbsolute(value) ||
      value.includes("\\") ||
      value.split("/").includes("..") ||
      value.split("/").includes(".") ||
      /^[a-z][a-z0-9+.-]*:/i.test(value)
    )
      context.addIssue({
        code: "custom",
        message:
          "References must be fixed-root relative paths without traversal or URLs.",
      });
  });

const hashedReferenceSchema = z
  .object({
    path: safeReferenceSchema,
    sha256: sha256Schema,
  })
  .strict();

const guidanceReferenceSchema = hashedReferenceSchema.extend({
  id: idSchema,
  source: z.enum(["pack", "shared"]).default("pack"),
});

const roleGuidanceReferenceSchema = guidanceReferenceSchema.extend({
  label: z.string().trim().min(1).max(100),
  capabilityRole: idSchema,
  workflowIds: z.array(idSchema).min(1).max(16),
});

const workflowGuidanceReferenceSchema = guidanceReferenceSchema.extend({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(240),
  workflowId: idSchema,
  eligibleRoleProfiles: z.array(idSchema).min(1).max(40),
});

const providerGuidanceReferenceSchema = guidanceReferenceSchema.extend({
  instanceId: idSchema,
  adapterType: providerIdSchema,
});

const runtimeGuidanceCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    roles: z.array(roleGuidanceReferenceSchema).max(100),
    workflows: z.array(workflowGuidanceReferenceSchema).max(100),
  })
  .strict()
  .superRefine((catalog, context) => {
    for (const [property, entries] of [
      ["roles", catalog.roles],
      ["workflows", catalog.workflows],
    ] as const) {
      const ids = entries.map(({ id }) => id);
      if (new Set(ids).size !== ids.length)
        context.addIssue({
          code: "custom",
          path: [property],
          message: `${property} catalog ids must be unique.`,
        });
      for (const [index, entry] of entries.entries())
        if (entry.source !== "shared" || !entry.path.startsWith("shared/"))
          context.addIssue({
            code: "custom",
            path: [property, index, "path"],
            message: "Catalog guidance must stay under config/shared.",
          });
    }
  });

export const runtimeSitePackManifestSchema = z
  .object({
    schemaVersion: z.literal(2),
    packId: idSchema,
    institutionId: idSchema,
    siteId: idSchema,
    publication: z
      .object({
        version: z.number().int().positive(),
        status: z.literal("published"),
        approvedBy: z.string().trim().min(3).max(120),
        publishedAt: z.string().datetime({ offset: true }),
      })
      .strict(),
    guidanceCatalog: hashedReferenceSchema,
    baseGuidance: hashedReferenceSchema,
    siteConfiguration: hashedReferenceSchema,
    siteGuidance: guidanceReferenceSchema,
    departments: z
      .array(
        guidanceReferenceSchema.extend({
          label: z.string().trim().min(1).max(120),
        }),
      )
      .min(1)
      .max(40),
    stations: z
      .array(
        guidanceReferenceSchema.extend({
          label: z.string().trim().min(1).max(120),
          departmentId: idSchema,
        }),
      )
      .max(100),
    roles: z.array(roleGuidanceReferenceSchema).max(100),
    workflows: z.array(workflowGuidanceReferenceSchema).max(100),
    providers: z.array(providerGuidanceReferenceSchema).max(40),
  })
  .strict()
  .superRefine((manifest, context) => {
    for (const reference of [
      manifest.siteGuidance,
      ...manifest.departments,
      ...manifest.stations,
      ...manifest.roles,
      ...manifest.workflows,
      ...manifest.providers,
    ])
      if (
        reference.source === "shared" &&
        !reference.path.startsWith("shared/")
      )
        context.addIssue({
          code: "custom",
          path: [],
          message: "Shared guidance must stay under config/shared.",
        });
    for (const [property, entries] of [
      ["departments", manifest.departments],
      ["stations", manifest.stations],
      ["roles", manifest.roles],
      ["workflows", manifest.workflows],
      ["providers", manifest.providers],
    ] as const) {
      const ids = entries.map((entry) => entry.id);
      if (new Set(ids).size !== ids.length)
        context.addIssue({
          code: "custom",
          path: [property],
          message: `${property} ids must be unique.`,
        });
    }
    const paths = [
      manifest.baseGuidance.path,
      manifest.siteConfiguration.path,
      manifest.siteGuidance.path,
      ...manifest.departments.map(({ path }) => path),
      ...manifest.stations.map(({ path }) => path),
      ...manifest.roles.map(({ path }) => path),
      ...manifest.workflows.map(({ path }) => path),
      ...manifest.providers.map(({ path }) => path),
    ];
    if (new Set(paths).size !== paths.length)
      context.addIssue({
        code: "custom",
        path: [],
        message:
          "Every approved file must have exactly one manifest reference.",
      });
    const departmentIds = new Set(manifest.departments.map(({ id }) => id));
    for (const [index, station] of manifest.stations.entries())
      if (!departmentIds.has(station.departmentId))
        context.addIssue({
          code: "custom",
          path: ["stations", index, "departmentId"],
          message: "Station must reference an approved department.",
        });
    const providerInstanceIds = manifest.providers.map(
      ({ instanceId }) => instanceId,
    );
    if (new Set(providerInstanceIds).size !== providerInstanceIds.length)
      context.addIssue({
        code: "custom",
        path: ["providers"],
        message: "Provider instance ids must be unique.",
      });
  });

type HashedReference = z.infer<typeof hashedReferenceSchema>;

export type RuntimeInstructionKind =
  "base" | "site" | "department" | "station" | "role" | "workflow" | "provider";

export interface RuntimeInstruction {
  id: string;
  kind: RuntimeInstructionKind;
  path: string;
  sha256: string;
  body: string;
}

export interface RuntimeRoleProfile {
  id: string;
  label: string;
  capabilityRole: string;
  workflowIds: readonly string[];
  instructionId: string;
}

export interface RuntimeWorkflowSkill {
  id: string;
  name: string;
  description: string;
  workflowId: string;
  eligibleRoleProfiles: readonly string[];
  instructionId: string;
}

export interface RuntimeProviderInstance {
  id: string;
  instanceId: string;
  adapterType: z.infer<typeof providerIdSchema>;
  instructionId: string;
}

export interface RuntimeSitePackSnapshot {
  sourceFormat: "directory-v2" | "legacy-json-v1";
  sourcePath: string;
  packId: string;
  institutionId: string;
  siteId: string;
  version: number;
  status: "published" | "legacy-imported";
  packDigest: string;
  siteConfigurationInput: unknown;
  instructions: Readonly<Record<string, RuntimeInstruction>>;
  departments: Readonly<Record<string, string>>;
  stations: Readonly<
    Record<string, { instructionId: string; departmentId: string }>
  >;
  roles: Readonly<Record<string, RuntimeRoleProfile>>;
  workflows: Readonly<Record<string, RuntimeWorkflowSkill>>;
  providers: Readonly<Record<string, RuntimeProviderInstance>>;
}

export interface ResolvedRuntimeGuidance {
  packId: string;
  packVersion: number;
  packDigest: string;
  institutionId: string;
  siteId: string;
  departmentId: string;
  stationId: string | null;
  roleProfile: RuntimeRoleProfile & { capabilityRole: Role };
  workflowId: string;
  instructions: readonly RuntimeInstruction[];
  availableSkills: readonly Omit<RuntimeWorkflowSkill, "instructionId">[];
  provenance: {
    instructionIds: readonly string[];
    instructionHashes: Readonly<Record<string, string>>;
  };
}

const defaultConfigRoot = fileURLToPath(
  new URL("../../config", import.meta.url),
);
const MAX_MANIFEST_BYTES = 128 * 1024;
const MAX_CONFIGURATION_BYTES = 768 * 1024;
const MAX_INSTRUCTION_BYTES = 64 * 1024;
const MAX_PACK_BYTES = 2 * 1024 * 1024;

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function decodeUtf8(buffer: Buffer, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error(`SITE_PACK_INVALID_UTF8: ${label}`);
  }
}

function assertInsideRoot(path: string, trustedRoot: string): void {
  const child = relative(trustedRoot, path);
  if (
    child === "" ||
    (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child))
  )
    return;
  throw new Error("SITE_PACK_PATH_OUTSIDE_TRUSTED_ROOT");
}

function checkedRealPath(
  path: string,
  trustedRoot: string,
  kind: "file" | "directory",
): string {
  if (lstatSync(path).isSymbolicLink())
    throw new Error("SITE_PACK_SYMLINK_REJECTED");
  const real = realpathSync(path);
  assertInsideRoot(real, trustedRoot);
  const stat = statSync(real);
  if (
    (kind === "file" && !stat.isFile()) ||
    (kind === "directory" && !stat.isDirectory())
  )
    throw new Error(`SITE_PACK_EXPECTED_${kind.toUpperCase()}`);
  return real;
}

function readBoundedFile(path: string, limit: number, label: string): Buffer {
  const size = statSync(path).size;
  if (size > limit) throw new Error(`SITE_PACK_FILE_TOO_LARGE: ${label}`);
  return readFileSync(path);
}

function assertSafeMarkdown(body: string, label: string): void {
  if (/<\/?[a-z][^>]*>/i.test(body) || /^\s*(?:import|export)\s/m.test(body))
    throw new Error(`SITE_PACK_EXECUTABLE_MARKUP_REJECTED: ${label}`);
  if (/\bignore\s+(?:all\s+)?(?:previous|system|policy|safety)\b/i.test(body))
    throw new Error(`SITE_PACK_POLICY_OVERRIDE_REJECTED: ${label}`);
  if (/!\[[^\]]*\]\(\s*(?:https?:|data:|file:)/i.test(body))
    throw new Error(`SITE_PACK_REMOTE_INCLUDE_REJECTED: ${label}`);
}

function readReference(
  root: string,
  packDirectory: string,
  reference: HashedReference,
  scope: "root" | "pack",
  limit: number,
): { path: string; relativePath: string; buffer: Buffer; hash: string } {
  const parsedPath = safeReferenceSchema.parse(reference.path);
  const base = scope === "root" ? root : packDirectory;
  const candidate = resolve(base, parsedPath);
  const real = checkedRealPath(candidate, root, "file");
  const buffer = readBoundedFile(real, limit, parsedPath);
  const hash = sha256(buffer);
  if (hash !== reference.sha256)
    throw new Error(`SITE_PACK_HASH_MISMATCH: ${parsedPath}`);
  return { path: real, relativePath: relative(root, real), buffer, hash };
}

function frozen<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>))
      frozen(child);
  }
  return value;
}

function entriesById<T extends { id: string }>(
  entries: readonly T[],
): Record<string, T> {
  return Object.fromEntries(entries.map((entry) => [entry.id, entry]));
}

export function loadRuntimeSitePack(
  requestedPath: string,
  options: { trustedRoot?: string } = {},
): RuntimeSitePackSnapshot {
  const configuredRoot =
    options.trustedRoot ?? process.env.PFH_SITE_PACK_ROOT ?? defaultConfigRoot;
  if (lstatSync(configuredRoot).isSymbolicLink())
    throw new Error("SITE_PACK_ROOT_SYMLINK_REJECTED");
  const trustedRoot = realpathSync(configuredRoot);
  const sourcePath = checkedRealPath(
    resolve(requestedPath),
    trustedRoot,
    statSync(resolve(requestedPath)).isDirectory() ? "directory" : "file",
  );

  if (statSync(sourcePath).isFile()) {
    const buffer = readBoundedFile(
      sourcePath,
      MAX_CONFIGURATION_BYTES,
      sourcePath,
    );
    const input = JSON.parse(decodeUtf8(buffer, sourcePath)) as unknown;
    const parsed = z
      .object({
        schemaVersion: z.literal(1),
        institutionId: idSchema,
        siteId: idSchema,
      })
      .passthrough()
      .parse(input);
    return frozen({
      sourceFormat: "legacy-json-v1",
      sourcePath,
      packId: `legacy-${parsed.siteId}`,
      institutionId: parsed.institutionId,
      siteId: parsed.siteId,
      version: 1,
      status: "legacy-imported",
      packDigest: sha256(buffer),
      siteConfigurationInput: input,
      instructions: {},
      departments: {},
      stations: {},
      roles: {},
      workflows: {},
      providers: {},
    });
  }

  const manifestPath = checkedRealPath(
    resolve(sourcePath, "site.json"),
    trustedRoot,
    "file",
  );
  const manifestBuffer = readBoundedFile(
    manifestPath,
    MAX_MANIFEST_BYTES,
    "site.json",
  );
  const manifest = runtimeSitePackManifestSchema.parse(
    JSON.parse(decodeUtf8(manifestBuffer, "site.json")) as unknown,
  );
  const configuration = readReference(
    trustedRoot,
    sourcePath,
    manifest.siteConfiguration,
    "root",
    MAX_CONFIGURATION_BYTES,
  );
  const catalogFile = readReference(
    trustedRoot,
    sourcePath,
    manifest.guidanceCatalog,
    "root",
    MAX_CONFIGURATION_BYTES,
  );
  const catalog = runtimeGuidanceCatalogSchema.parse(
    JSON.parse(
      decodeUtf8(catalogFile.buffer, manifest.guidanceCatalog.path),
    ) as unknown,
  );
  const roles = [...catalog.roles, ...manifest.roles];
  const workflows = [...catalog.workflows, ...manifest.workflows];
  for (const [kind, entries] of [
    ["role", roles],
    ["workflow", workflows],
  ] as const) {
    const ids = entries.map(({ id }) => id);
    if (new Set(ids).size !== ids.length)
      throw new Error(`SITE_PACK_DUPLICATE_${kind.toUpperCase()}_ID`);
  }
  const base = readReference(
    trustedRoot,
    sourcePath,
    manifest.baseGuidance,
    "root",
    MAX_INSTRUCTION_BYTES,
  );
  const baseBody = decodeUtf8(base.buffer, manifest.baseGuidance.path);
  assertSafeMarkdown(baseBody, manifest.baseGuidance.path);

  const instructions: Record<string, RuntimeInstruction> = {
    base: {
      id: "base",
      kind: "base",
      path: base.relativePath,
      sha256: base.hash,
      body: baseBody,
    },
  };
  let totalBytes =
    manifestBuffer.byteLength +
    configuration.buffer.byteLength +
    catalogFile.buffer.byteLength +
    base.buffer.byteLength;
  const addGuidance = (
    reference: z.infer<typeof guidanceReferenceSchema>,
    kind: RuntimeInstructionKind,
  ): void => {
    if (instructions[reference.id])
      throw new Error(`SITE_PACK_DUPLICATE_INSTRUCTION_ID: ${reference.id}`);
    const loaded = readReference(
      trustedRoot,
      sourcePath,
      reference,
      reference.source === "shared" ? "root" : "pack",
      MAX_INSTRUCTION_BYTES,
    );
    const body = decodeUtf8(loaded.buffer, reference.path);
    assertSafeMarkdown(body, reference.path);
    totalBytes += loaded.buffer.byteLength;
    instructions[reference.id] = {
      id: reference.id,
      kind,
      path: loaded.relativePath,
      sha256: loaded.hash,
      body,
    };
  };
  addGuidance(manifest.siteGuidance, "site");
  for (const item of manifest.departments) addGuidance(item, "department");
  for (const item of manifest.stations) addGuidance(item, "station");
  for (const item of roles) addGuidance(item, "role");
  for (const item of workflows) addGuidance(item, "workflow");
  for (const item of manifest.providers) addGuidance(item, "provider");
  if (totalBytes > MAX_PACK_BYTES)
    throw new Error("SITE_PACK_TOTAL_SIZE_EXCEEDED");

  const digestInput = [
    `manifest:${sha256(manifestBuffer)}`,
    `configuration:${configuration.hash}`,
    `catalog:${catalogFile.hash}`,
    ...Object.values(instructions)
      .map(({ id, sha256: hash }) => `${id}:${hash}`)
      .sort(),
  ].join("\n");
  return frozen({
    sourceFormat: "directory-v2",
    sourcePath,
    packId: manifest.packId,
    institutionId: manifest.institutionId,
    siteId: manifest.siteId,
    version: manifest.publication.version,
    status: manifest.publication.status,
    packDigest: sha256(digestInput),
    siteConfigurationInput: JSON.parse(
      decodeUtf8(configuration.buffer, manifest.siteConfiguration.path),
    ) as unknown,
    instructions,
    departments: Object.fromEntries(
      manifest.departments.map(({ id }) => [id, id]),
    ),
    stations: Object.fromEntries(
      manifest.stations.map(({ id, departmentId }) => [
        id,
        { instructionId: id, departmentId },
      ]),
    ),
    roles: entriesById(
      roles.map(({ id, label, capabilityRole, workflowIds }) => ({
        id,
        label,
        capabilityRole,
        workflowIds,
        instructionId: id,
      })),
    ),
    workflows: entriesById(
      workflows.map(
        ({ id, name, description, workflowId, eligibleRoleProfiles }) => ({
          id,
          name,
          description,
          workflowId,
          eligibleRoleProfiles,
          instructionId: id,
        }),
      ),
    ),
    providers: entriesById(
      manifest.providers.map(({ id, instanceId, adapterType }) => ({
        id,
        instanceId,
        adapterType,
        instructionId: id,
      })),
    ),
  });
}

export function validateRuntimeSitePackBindings(
  snapshot: RuntimeSitePackSnapshot,
  configuration: {
    institutionId: string;
    siteId: string;
    department: { id: string };
    roleProfiles: Record<
      string,
      { workflowId: string; actions: readonly string[] }
    >;
    workflows: Record<string, { eligibleRoles: readonly string[] }>;
    staffAssignments: readonly {
      actorId: string;
      role: string;
      roleProfileId?: string | undefined;
      stationId?: string | undefined;
    }[];
  },
  implementedRoles: ReadonlySet<string>,
): void {
  if (
    snapshot.institutionId !== configuration.institutionId ||
    snapshot.siteId !== configuration.siteId
  )
    throw new Error("SITE_PACK_CONFIGURATION_SCOPE_MISMATCH");
  if (snapshot.sourceFormat === "legacy-json-v1") return;
  if (!snapshot.departments[configuration.department.id])
    throw new Error("SITE_PACK_ACTIVE_DEPARTMENT_UNDECLARED");
  for (const role of Object.values(snapshot.roles)) {
    if (!implementedRoles.has(role.capabilityRole))
      throw new Error(
        `SITE_PACK_UNKNOWN_CAPABILITY_ROLE: ${role.capabilityRole}`,
      );
    const profile = configuration.roleProfiles[role.capabilityRole];
    if (!profile)
      throw new Error(
        `SITE_PACK_ROLE_PROFILE_UNAVAILABLE: ${role.capabilityRole}`,
      );
    for (const workflowId of role.workflowIds) {
      const workflow = configuration.workflows[workflowId];
      if (!workflow?.eligibleRoles.includes(role.capabilityRole))
        throw new Error(
          `SITE_PACK_ROLE_WORKFLOW_MISMATCH: ${role.id}/${workflowId}`,
        );
    }
  }
  for (const skill of Object.values(snapshot.workflows)) {
    if (!configuration.workflows[skill.workflowId])
      throw new Error(`SITE_PACK_UNKNOWN_WORKFLOW: ${skill.workflowId}`);
    for (const roleId of skill.eligibleRoleProfiles) {
      const role = snapshot.roles[roleId];
      if (!role || !role.workflowIds.includes(skill.workflowId))
        throw new Error(`SITE_PACK_SKILL_ROLE_MISMATCH: ${skill.id}/${roleId}`);
    }
  }
  for (const assignment of configuration.staffAssignments) {
    const role = assignment.roleProfileId
      ? snapshot.roles[assignment.roleProfileId]
      : undefined;
    if (!role || role.capabilityRole !== assignment.role)
      throw new Error(
        `SITE_PACK_ACTOR_ROLE_PROFILE_MISMATCH: ${assignment.actorId}`,
      );
    const station = assignment.stationId
      ? snapshot.stations[assignment.stationId]
      : undefined;
    if (!station || station.departmentId !== configuration.department.id)
      throw new Error(
        `SITE_PACK_ACTOR_STATION_MISMATCH: ${assignment.actorId}`,
      );
  }
}

export function resolveRuntimeGuidance(
  snapshot: RuntimeSitePackSnapshot,
  input: {
    departmentId: string;
    stationId?: string;
    roleProfileId: string;
    workflowId: string;
    workflowSkillId?: string;
  },
): ResolvedRuntimeGuidance {
  if (snapshot.status !== "published")
    throw new Error("SITE_PACK_NOT_PUBLISHED");
  const departmentInstructionId = snapshot.departments[input.departmentId];
  if (!departmentInstructionId)
    throw new Error("SITE_PACK_DEPARTMENT_NOT_APPROVED");
  const station = input.stationId
    ? snapshot.stations[input.stationId]
    : undefined;
  if (
    input.stationId &&
    (!station || station.departmentId !== input.departmentId)
  )
    throw new Error("SITE_PACK_STATION_SCOPE_MISMATCH");
  const role = snapshot.roles[input.roleProfileId];
  if (!role || !role.workflowIds.includes(input.workflowId))
    throw new Error("SITE_PACK_ROLE_WORKFLOW_NOT_APPROVED");
  const skills = Object.values(snapshot.workflows).filter(
    (skill) =>
      skill.workflowId === input.workflowId &&
      skill.eligibleRoleProfiles.includes(input.roleProfileId),
  );
  const selectedSkill = input.workflowSkillId
    ? skills.find(({ id }) => id === input.workflowSkillId)
    : undefined;
  if (input.workflowSkillId && !selectedSkill)
    throw new Error("SITE_PACK_WORKFLOW_SKILL_NOT_APPROVED");
  const instructionIds = [
    "base",
    "site",
    departmentInstructionId,
    ...(station ? [station.instructionId] : []),
    role.instructionId,
    ...(selectedSkill ? [selectedSkill.instructionId] : []),
  ];
  const instructions = instructionIds.map((id) => {
    const instruction = snapshot.instructions[id];
    if (!instruction) throw new Error(`SITE_PACK_INSTRUCTION_MISSING: ${id}`);
    return instruction;
  });
  return frozen({
    packId: snapshot.packId,
    packVersion: snapshot.version,
    packDigest: snapshot.packDigest,
    institutionId: snapshot.institutionId,
    siteId: snapshot.siteId,
    departmentId: input.departmentId,
    stationId: input.stationId ?? null,
    roleProfile: role as RuntimeRoleProfile & { capabilityRole: Role },
    workflowId: input.workflowId,
    instructions,
    availableSkills: skills.map(
      ({ id, name, description, workflowId, eligibleRoleProfiles }) => ({
        id,
        name,
        description,
        workflowId,
        eligibleRoleProfiles,
      }),
    ),
    provenance: {
      instructionIds,
      instructionHashes: Object.fromEntries(
        instructions.map(({ id, sha256: hash }) => [id, hash]),
      ),
    },
  });
}

export function loadApprovedWorkflowSkill(
  snapshot: RuntimeSitePackSnapshot,
  input: {
    roleProfileId: string;
    workflowId: string;
    workflowSkillId: string;
  },
): RuntimeInstruction {
  const skill = snapshot.workflows[input.workflowSkillId];
  if (
    !skill ||
    skill.workflowId !== input.workflowId ||
    !skill.eligibleRoleProfiles.includes(input.roleProfileId)
  )
    throw new Error("SITE_PACK_WORKFLOW_SKILL_NOT_APPROVED");
  const instruction = snapshot.instructions[skill.instructionId];
  if (!instruction) throw new Error("SITE_PACK_WORKFLOW_SKILL_MISSING");
  return instruction;
}

export const defaultDirectorySitePackPath = fileURLToPath(
  new URL("../../config/sites/packs/tertianum-kronenhof", import.meta.url),
);

/** Process-lifetime immutable snapshot. A different publication starts a new process. */
export const activeRuntimeSitePackPath =
  process.env.PFH_SITE_PACK_PATH ?? defaultDirectorySitePackPath;
export const runtimeSitePack = loadRuntimeSitePack(activeRuntimeSitePackPath);
