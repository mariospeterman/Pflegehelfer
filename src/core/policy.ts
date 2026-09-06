import type { DemoUser, Patient, Purpose, Role } from "./types.js";

export type Action =
  | "patient:read"
  | "patient:administrative-read"
  | "task:read"
  | "task:update"
  | "task:create"
  | "observation:draft"
  | "observation:approve"
  | "note:draft"
  | "note:approve"
  | "communication:read"
  | "communication:create"
  | "communication:respond"
  | "handover:read"
  | "handover:sign"
  | "handover:acknowledge"
  | "round:read"
  | "round:decide"
  | "intake:read"
  | "intake:update"
  | "provider:operate"
  | "audit:verify"
  | "analytics:aggregate";

const roleActions: Record<Role, ReadonlySet<Action>> = {
  "care-assistant": new Set([
    "patient:read",
    "task:read",
    "task:update",
    "task:create",
    "observation:draft",
    "observation:approve",
    "note:draft",
    "note:approve",
    "communication:read",
    "communication:create",
    "handover:read",
    "handover:acknowledge",
    "round:read",
  ]),
  "registered-nurse": new Set([
    "patient:read",
    "task:read",
    "task:update",
    "task:create",
    "observation:draft",
    "observation:approve",
    "note:draft",
    "note:approve",
    "communication:read",
    "communication:create",
    "communication:respond",
    "handover:read",
    "handover:sign",
    "handover:acknowledge",
    "round:read",
    "intake:read",
    "intake:update",
  ]),
  physician: new Set([
    "patient:read",
    "task:read",
    "task:update",
    "task:create",
    "observation:draft",
    "observation:approve",
    "note:draft",
    "note:approve",
    "communication:read",
    "communication:create",
    "communication:respond",
    "handover:read",
    "round:read",
    "round:decide",
    "intake:read",
    "intake:update",
  ]),
  pharmacy: new Set([
    "patient:read",
    "task:read",
    "task:update",
    "task:create",
    "communication:read",
    "communication:create",
    "communication:respond",
    "handover:read",
    "round:read",
    "round:decide",
    "intake:read",
    "intake:update",
  ]),
  physiotherapy: new Set([
    "patient:read",
    "task:read",
    "task:update",
    "task:create",
    "note:draft",
    "note:approve",
    "communication:read",
    "communication:create",
    "communication:respond",
    "handover:read",
    "round:read",
    "round:decide",
  ]),
  "occupational-therapy": new Set([
    "patient:read",
    "task:read",
    "task:update",
    "task:create",
    "note:draft",
    "note:approve",
    "communication:read",
    "communication:create",
    "communication:respond",
    "handover:read",
    "round:read",
    "round:decide",
  ]),
  transport: new Set(["task:read", "task:update"]),
  service: new Set(["task:read", "task:update"]),
  administration: new Set([
    "patient:administrative-read",
    "task:read",
    "task:update",
    "intake:read",
    "intake:update",
  ]),
  management: new Set(["analytics:aggregate"]),
  hr: new Set([]),
  it: new Set(["provider:operate", "audit:verify"]),
  "quality-safety": new Set(["audit:verify", "analytics:aggregate"]),
};

export interface PolicyDecision {
  allow: boolean;
  reason: string;
}

export function decide(
  user: DemoUser,
  action: Action,
  purpose: Purpose,
  patient?: Patient,
): PolicyDecision {
  if (purpose === "emergency") {
    return {
      allow: false,
      reason:
        "Break-glass ist ohne institutionelle Re-Authentisierung deaktiviert.",
    };
  }
  if (!user.managedDevice && action !== "analytics:aggregate") {
    return { allow: false, reason: "Ein verwaltetes Gerät ist erforderlich." };
  }

  if (!roleActions[user.role].has(action)) {
    return {
      allow: false,
      reason: `Rolle ${user.role} ist für ${action} nicht berechtigt.`,
    };
  }

  if (patient) {
    if (user.role === "administration") {
      const valid =
        purpose === "administration" && user.wardIds.includes(patient.wardId);
      return valid
        ? { allow: true, reason: "Administrative Zuständigkeit bestätigt." }
        : {
            allow: false,
            reason: "Administrative Zuständigkeit oder Zweck fehlt.",
          };
    }

    if (["transport", "service"].includes(user.role)) {
      return {
        allow: false,
        reason: "Diese Rolle erhält keinen klinischen Patientenkontext.",
      };
    }

    if (purpose !== "direct-care") {
      return {
        allow: false,
        reason: "Klinischer Zugriff erfordert den Zweck direkte Versorgung.",
      };
    }

    const wardMatch = user.wardIds.includes(patient.wardId);
    const relationship = user.patientIds.includes(patient.id);
    if (!wardMatch || !relationship) {
      return {
        allow: false,
        reason: "Aktive Stations- und Behandlungsbeziehung fehlt.",
      };
    }
  }

  return {
    allow: true,
    reason: "Rolle, Zweck, Gerät und Kontext sind zulässig.",
  };
}

export function canSeeTask(
  user: DemoUser,
  patient: Patient | undefined,
  taskOwnerRole: Role,
): boolean {
  if (
    user.role === "it" ||
    user.role === "hr" ||
    user.role === "management" ||
    user.role === "quality-safety"
  )
    return false;
  if (user.role === "service")
    return taskOwnerRole === "service" && patient === undefined;
  if (user.role === "transport")
    return (
      taskOwnerRole === "transport" &&
      patient !== undefined &&
      user.patientIds.includes(patient.id)
    );
  if (user.role === "administration") return taskOwnerRole === "administration";
  if (!patient) return taskOwnerRole === user.role;
  return (
    user.wardIds.includes(patient.wardId) &&
    user.patientIds.includes(patient.id)
  );
}

export function minimumPatientView(user: DemoUser, patient: Patient): Patient {
  if (user.role === "administration") {
    return {
      ...patient,
      allergies: [],
      risks: [],
      diagnoses: [],
      careGoals: [],
      medicationSummary: [],
    };
  }
  return patient;
}
