import { describe, expect, it } from "vitest";
import {
  canonicalClaimTokens,
  verifyNaturalDialogueAgainstSources,
  type SourceBoundAtom,
} from "../src/core/source-claim-binding.js";

const taskAtoms: SourceBoundAtom[] = [
  {
    text: "Anna · Morgenpflege: erledigt.",
    entityLabels: ["Morgenpflege"],
    subjectLabels: ["Anna"],
  },
  {
    text: "Anna · Mobilisation: offen.",
    entityLabels: ["Mobilisation"],
    subjectLabels: ["Anna"],
  },
];

describe("production source-claim binding", () => {
  it("does not borrow completion from another task for the same patient", () => {
    expect(
      verifyNaturalDialogueAgainstSources(
        "Anna: Mobilisation ist erledigt.",
        taskAtoms,
        ["Anna"],
      ),
    ).toBeNull();
  });

  it("accepts faithful locally negated completion wording", () => {
    expect(canonicalClaimTokens("Mobilisation ist nicht erledigt.")).toContain(
      "state:open",
    );
    expect(
      canonicalClaimTokens("Mobilisation ist nicht erledigt."),
    ).not.toContain("state:completed");
    expect(
      verifyNaturalDialogueAgainstSources(
        "Anna: Mobilisation ist nicht erledigt.",
        taskAtoms,
        ["Anna"],
      ),
    ).toBe("Anna: Mobilisation ist nicht erledigt.");
  });

  it("keeps the correctly bound completed task as a control", () => {
    expect(
      verifyNaturalDialogueAgainstSources(
        "Anna: Morgenpflege ist erledigt.",
        taskAtoms,
        ["Anna"],
      ),
    ).toBe("Anna: Morgenpflege ist erledigt.");
  });

  it("rejects the whole factual answer when any clause contradicts its row", () => {
    expect(
      verifyNaturalDialogueAgainstSources(
        "Anna: Morgenpflege ist erledigt. Die Mobilisation ist ebenfalls erledigt.",
        taskAtoms,
        ["Anna"],
      ),
    ).toBeNull();
  });
});
