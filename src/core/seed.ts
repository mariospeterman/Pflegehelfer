import { baselineDemoScenario } from "./demo-scenario.js";

/**
 * Compatibility exports for the existing service and tests. The editable
 * synthetic baseline is authored once in config/demo-scenarios and validated
 * by demo-scenario.ts before any resource is materialized.
 */
export const DEMO_NOW = baselineDemoScenario.clock.anchor;
export const users = baselineDemoScenario.state.users;
export const patients = baselineDemoScenario.state.patients;
export const tasks = baselineDemoScenario.state.tasks;
export const observations = baselineDemoScenario.state.observations;
export const notes = baselineDemoScenario.state.notes;
export const communications = baselineDemoScenario.state.communications;
export const intake = baselineDemoScenario.state.intake;
export const roundActions = baselineDemoScenario.state.roundActions;
export const providerHealth = baselineDemoScenario.state.providerHealth;
