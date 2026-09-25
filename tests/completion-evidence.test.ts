import { describe, expect, it } from "vitest";
import {
  completionEvidenceIsGrounded,
  deterministicAssistantProposal,
} from "../src/ai/assistant-proposal.js";

describe("direct completion evidence boundary", () => {
  it("does not crash or invent an action for short acknowledgements", () => {
    expect(deterministicAssistantProposal("ok")).toBeNull();
    expect(completionEvidenceIsGrounded("ok", "Mobilisation")).toBe(false);
  });

  it("requires evidence to match the exact work item", () => {
    expect(
      completionEvidenceIsGrounded(
        "Mobilisation mit Rollator sicher durchgeführt.",
        "Mobilisation mit Rollator",
      ),
    ).toBe(true);
    expect(
      completionEvidenceIsGrounded(
        "Mobilisation mit Rollator sicher durchgeführt.",
        "Blutdruck kontrollieren",
      ),
    ).toBe(false);
  });

  it("routes measurements, negation, partial and historical work to review", () => {
    expect(
      completionEvidenceIsGrounded(
        "Blutdruck 240/130 gemessen.",
        "Blutdruck kontrollieren",
      ),
    ).toBe(false);
    expect(
      completionEvidenceIsGrounded(
        "Mobilisation nicht durchgeführt.",
        "Mobilisation",
      ),
    ).toBe(false);
    expect(
      completionEvidenceIsGrounded(
        "Mobilisation teilweise durchgeführt.",
        "Mobilisation",
      ),
    ).toBe(false);
    expect(
      completionEvidenceIsGrounded(
        "Mobilisation wurde gestern durchgeführt.",
        "Mobilisation",
      ),
    ).toBe(false);
  });
});
