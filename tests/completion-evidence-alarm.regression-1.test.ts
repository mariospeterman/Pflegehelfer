import { describe, expect, it } from "vitest";
import {
  completionEvidenceIsGrounded,
  deterministicAssistantProposal,
} from "../src/ai/assistant-proposal.js";

describe("ISSUE-006 alarm episode completion evidence", () => {
  const evidence =
    "Luca wach angetroffen, Klingel versehentlich betätigt. Wasser bereitgestellt.";

  it("accepts natural completed care that is grounded in a German alarm title", () => {
    const proposal = deterministicAssistantProposal(evidence);

    expect(proposal?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "note-proposal",
          completionStatus: "completed",
        }),
      ]),
    );
    expect(
      completionEvidenceIsGrounded(
        evidence,
        "Simulierter Klingelruf · Zimmer 207",
      ),
    ).toBe(true);
  });

  it("keeps migrated Nurse-call labels compatible without fuzzy matching unrelated work", () => {
    expect(
      completionEvidenceIsGrounded(
        evidence,
        "Simulierter Nurse-call · Zimmer 207",
      ),
    ).toBe(true);
    expect(
      completionEvidenceIsGrounded(evidence, "Morgenpflege · Mobilisation"),
    ).toBe(false);
  });

  it("still rejects a room observation with no completed care", () => {
    expect(
      completionEvidenceIsGrounded(
        "Luca ist wach in Zimmer 207.",
        "Simulierter Klingelruf · Zimmer 207",
      ),
    ).toBe(false);
  });
});
