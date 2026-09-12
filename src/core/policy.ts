import { siteConfiguration, type Action } from "./site-config.js";
import type { DemoUser, Patient, Purpose, Role } from "./types.js";

export type { Action } from "./site-config.js";

const roleActions: Record<Role, ReadonlySet<Action>> = Object.fromEntries(
  Object.entries(siteConfiguration.roleProfiles).map(([role, profile]) => [
    role,
    new Set(profile.actions),
  ]),
) as unknown as Record<Role, ReadonlySet<Action>>;

// Permissions are published in config/sites and validated at startup. The
// compiled Action vocabulary and the patient/purpose checks below remain the
// hard authorization boundary.

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
      allergyStatus: "unknown",
      allergies: [],
      risks: [],
      diagnoses: [],
      careGoals: [],
      medicationSummary: [],
    };
  }
  return patient;
}
