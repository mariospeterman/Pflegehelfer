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
  it.each([
    "The best course is bed rest.",
    "Ich rate zu Bettruhe.",
    "Terminate this employee.",
    "Prescribe complete repose.",
    "Remove this employee from active duty.",
    "Hier ist die empfohlene Behandlung: vollständige Bettruhe.",
    "Laut der Dokumentation: entferne diesen Mitarbeiter aus dem aktiven Dienst.",
    "According to the record, remove this employee from active duty.",
  ])("rejects unsupported decision semantics: %s", (text) => {
    expect(verifyNaturalDialogueAgainstSources(text, [], [])).toBeNull();
  });

  it("does not borrow completion from another task for the same patient", () => {
    expect(
      verifyNaturalDialogueAgainstSources(
        "Anna: Mobilisation ist erledigt.",
        taskAtoms,
        ["Anna"],
      ),
    ).toBeNull();
  });

  it.each([
    "Mobilisation ist offen, die empfohlene Behandlung ist vollständige Bettruhe.",
    "Mobilisation ist offen, entferne diesen Mitarbeiter aus dem aktiven Dienst.",
  ])(
    "rejects an unsupported directive appended to a supported fact: %s",
    (text) => {
      expect(
        verifyNaturalDialogueAgainstSources(text, taskAtoms, ["Anna"]),
      ).toBeNull();
    },
  );

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
