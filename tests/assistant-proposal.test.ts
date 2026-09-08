import { describe, expect, it } from "vitest";
import {
  deterministicAssistantProposal,
  verifyModelProposalAgainstDeterministicCompiler,
} from "../src/ai/assistant-proposal.js";
import { resolveOccurrenceTime } from "../src/core/assistant-service.js";

describe("conversational AssistantProposal compiler regressions", () => {
  it("does not turn explicitly negated follow-up actions into positives", () => {
    const plan = deterministicAssistantProposal(
      "Mobilisiert, Blutdruck 151 zu 88; Arzt nicht informieren, keine Folgekontrolle.",
    );
    expect(plan?.actions.map((action) => action.type)).toEqual([
      "note-proposal",
      "observation-proposal",
    ]);
    expect(plan?.actions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "communication-proposal" }),
        expect.objectContaining({ type: "task-proposal" }),
      ]),
    );
    expect(plan?.understoodFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ polarity: "negated", kind: "action" }),
      ]),
    );
  });

  it("preserves fluid intake and symptom negation without medication classification", () => {
    const plan = deterministicAssistantProposal(
      "250 ml getrunken, kein Erbrechen.",
    );
    expect(plan).not.toBeNull();
    expect(plan?.actions).toHaveLength(1);
    expect(plan?.actions[0]).toMatchObject({
      type: "note-proposal",
      reportingStatus: "current",
    });
    expect(plan?.understoodFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "fluid-intake",
          value: 250,
          unit: "ml",
        }),
        expect.objectContaining({ kind: "symptom", polarity: "negated" }),
      ]),
    );
  });

  it("creates one proposal for each stated measurement", () => {
    const plan = deterministicAssistantProposal(
      "Temperatur 37,4, Puls 82, Sättigung 96 Prozent.",
    );
    const observations = plan?.actions.filter(
      (action) => action.type === "observation-proposal",
    );
    expect(observations).toHaveLength(3);
    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "temperature",
          value: 37.4,
          unit: "°C",
        }),
        expect.objectContaining({ code: "pulse", value: 82, unit: "/min" }),
        expect.objectContaining({
          code: "oxygen-saturation",
          value: 96,
          unit: "%",
        }),
      ]),
    );
  });

  it("keeps historical medication reports as documentation, never a medication command", () => {
    const plan = deterministicAssistantProposal(
      "Die Ärztin hat gestern die Dosis geändert.",
    );
    expect(plan?.actions).toEqual([
      expect.objectContaining({
        type: "note-proposal",
        reportingStatus: "historical",
      }),
    ]);
  });

  it("does not mark refused work completed or billable", () => {
    const plan = deterministicAssistantProposal(
      "Nicht durchgeführt; Patient wollte schlafen.",
    );
    expect(plan?.actions).toEqual([
      expect.objectContaining({
        type: "note-proposal",
        completionStatus: "not-performed",
        billable: false,
      }),
    ]);
  });

  it("uses the corrected half-hour expression and asks what it applies to", () => {
    const plan = deterministicAssistantProposal(
      "In einer halben Stunde, nicht in einer Stunde.",
    );
    expect(plan?.temporal).toMatchObject({ dueInMinutes: 30 });
    expect(plan?.clarificationQuestions).toContain(
      "Wofür gilt die Zeitangabe von 30 Minuten?",
    );
    expect(plan?.actions).toHaveLength(0);
  });

  it("requires explicit patient resolution for a corrected name", () => {
    const plan = deterministicAssistantProposal("Anna? Nein, Luca.");
    expect(plan?.actions).toHaveLength(0);
    expect(plan?.clarificationQuestions[0]).toMatch(/Luca.*Patientenkontext/);
    expect(plan?.corrections).toEqual([
      expect.objectContaining({
        replacedText: "Anna",
        replacementText: "Luca",
      }),
    ]);
  });

  it("separates occurrence wording from recording time", () => {
    const plan = deterministicAssistantProposal("Das war gestern um 18 Uhr.");
    expect(plan?.temporal.occurrenceText).toBe("gestern um 18 Uhr");
    expect(plan?.inputTimestamp).toMatch(/Z$/);
    expect(plan?.actions[0]).toMatchObject({
      type: "note-proposal",
      reportingStatus: "historical",
      occurrenceText: "gestern um 18 Uhr",
    });
  });

  it("resolves an explicit historical clock time in the Swiss facility timezone", () => {
    expect(
      resolveOccurrenceTime("gestern um 18 Uhr", "2026-09-06T08:30:00.000Z"),
    ).toBe("2026-09-05T16:00:00.000Z");
    expect(
      resolveOccurrenceTime("gestern Abend", "2026-09-06T08:30:00.000Z"),
    ).toBeNull();
    expect(
      resolveOccurrenceTime("um 08:00 Uhr", "2026-09-06T08:30:00.000Z"),
    ).toBe("2026-09-06T06:00:00.000Z");
  });

  it("carries historical time across coordinated observations", () => {
    for (const prompt of [
      "Gestern um 18 Uhr Blutdruck 151 zu 88, Puls 82.",
      "Gestern um 18 Uhr Blutdruck 151 zu 88 und Puls 82.",
    ]) {
      const observations = deterministicAssistantProposal(
        prompt,
      )?.actions.filter((action) => action.type === "observation-proposal");
      expect(observations).toHaveLength(2);
      expect(observations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "blood-pressure",
            reportingStatus: "historical",
            occurrenceText: "Gestern um 18 Uhr",
          }),
          expect.objectContaining({
            code: "pulse",
            reportingStatus: "historical",
            occurrenceText: "Gestern um 18 Uhr",
          }),
        ]),
      );
    }
  });

  it("requires clarification rather than writing a future same-day measurement", () => {
    const plan = deterministicAssistantProposal("Heute um 18 Uhr Puls 82.", {
      inputTimestamp: "2026-09-06T06:30:00.000Z",
    });
    expect(plan?.actions).toHaveLength(0);
    expect(plan?.observations).toEqual([
      expect.objectContaining({ actionId: null, code: "pulse", value: 82 }),
    ]);
    expect(plan?.clarificationQuestions[0]).toMatch(/liegt nach/);
  });

  it("lets a model propose grounded meaning but rejects unsafe executable values", () => {
    const prompt =
      "Mobilisiert, Blutdruck 151 zu 88, Arzt informieren und Kontrolle in 30 Minuten.";
    const compiled = deterministicAssistantProposal(prompt);
    if (!compiled) throw new Error("expected plan");
    const reordered = {
      ...structuredClone(compiled),
      actions: [...compiled.actions].reverse(),
      summary: "Kompakte Anzeige",
    };
    expect(
      verifyModelProposalAgainstDeterministicCompiler(
        prompt,
        reordered,
        compiled,
      ).actions,
    ).toEqual(reordered.actions);

    const invented = structuredClone(reordered);
    const task = invented.actions.find(
      (action) => action.type === "task-proposal",
    );
    if (!task || task.type !== "task-proposal")
      throw new Error("expected task");
    task.title = "Insulin geben";
    expect(() =>
      verifyModelProposalAgainstDeterministicCompiler(
        prompt,
        invented,
        compiled,
      ),
    ).toThrow("CLINICAL_PLAN_UNGROUNDED_CLINICAL_CONTENT");
  });

  it.each([
    ["note-proposal", "Mobilisiert."],
    ["observation-proposal", "Puls 82."],
    ["communication-proposal", "Arzt informieren in 30 Minuten."],
    ["task-proposal", "Kontrolle in 30 Minuten."],
    ["workflow-proposal", "Anna pausieren, ich gehe zu Zimmer 207."],
  ] as const)("rejects duplicate grounded %s actions", (type, prompt) => {
    const compiled = deterministicAssistantProposal(prompt);
    if (!compiled) throw new Error("expected proposal");
    const candidate = structuredClone(compiled);
    const original = candidate.actions.find((action) => action.type === type);
    if (!original) throw new Error(`expected ${type}`);
    candidate.actions.push({
      ...structuredClone(original),
      id: `action-${candidate.actions.length + 1}`,
    });
    expect(() =>
      verifyModelProposalAgainstDeterministicCompiler(
        prompt,
        candidate,
        compiled,
      ),
    ).toThrow("CLINICAL_PLAN_DUPLICATE_ACTION");
  });

  it("accepts independently grounded model meaning beyond the fallback grammar", () => {
    const prompt = "RR systolisch 128, diastolisch 76.";
    expect(
      deterministicAssistantProposal(prompt)?.actions.some(
        (action) => action.type === "observation-proposal",
      ),
    ).toBe(false);
    const template = deterministicAssistantProposal("Blutdruck 128 zu 76.");
    if (!template) throw new Error("expected proposal template");
    const candidate = structuredClone(template);
    candidate.actions = candidate.actions.filter(
      (action) => action.type === "observation-proposal",
    );
    const groundedSpan = { start: 0, end: prompt.length, quote: prompt };
    for (const action of candidate.actions) action.sourceSpan = groundedSpan;
    for (const fact of candidate.understoodFacts)
      fact.sourceSpan = groundedSpan;
    for (const observation of candidate.observations) {
      observation.sourceSpan = groundedSpan;
      observation.actionId = candidate.actions[0]!.id;
    }
    for (const evidence of candidate.evidence)
      evidence.sourceSpan = groundedSpan;
    candidate.summary = "Blutdruckmessung verstanden";
    expect(
      verifyModelProposalAgainstDeterministicCompiler(prompt, candidate, null)
        .actions,
    ).toEqual([
      expect.objectContaining({
        type: "observation-proposal",
        value: 128,
        secondaryValue: 76,
      }),
    ]);
  });

  it("rejects substring-grounded numbers and invented task semantics", () => {
    const pulsePrompt = "Puls 182.";
    const pulse = deterministicAssistantProposal(pulsePrompt);
    if (!pulse) throw new Error("expected pulse proposal");
    const pulseAction = pulse.actions.find(
      (action) => action.type === "observation-proposal",
    );
    if (!pulseAction || pulseAction.type !== "observation-proposal")
      throw new Error("expected pulse action");
    pulseAction.value = 82;
    expect(() =>
      verifyModelProposalAgainstDeterministicCompiler(
        pulsePrompt,
        pulse,
        deterministicAssistantProposal(pulsePrompt),
      ),
    ).toThrow("CLINICAL_PLAN_OBSERVATION_NOT_GROUNDED");

    const taskPrompt = "Kontrolle in 30 Minuten.";
    const task = deterministicAssistantProposal(taskPrompt);
    if (!task) throw new Error("expected task proposal");
    const taskAction = task.actions.find(
      (action) => action.type === "task-proposal",
    );
    if (!taskAction || taskAction.type !== "task-proposal")
      throw new Error("expected task action");
    taskAction.title = "Sturzprophylaxe durchführen";
    taskAction.reason = "Neues Sturzrisiko";
    expect(() =>
      verifyModelProposalAgainstDeterministicCompiler(
        taskPrompt,
        task,
        deterministicAssistantProposal(taskPrompt),
      ),
    ).toThrow("CLINICAL_PLAN_TASK_CONTENT_NOT_GROUNDED");
  });

  it("does not turn completed historical communication or control into future work", () => {
    expect(
      deterministicAssistantProposal(
        "Kontrolle in 30 Minuten wurde gestern erledigt.",
      )?.actions.some((action) => action.type === "task-proposal"),
    ).toBe(false);
    expect(
      deterministicAssistantProposal(
        "Arzt in 30 Minuten informieren wurde gestern erledigt.",
      )?.actions.some((action) => action.type === "communication-proposal"),
    ).toBe(false);
  });

  it("binds a follow-up task to its own clause instead of an unrelated vital", () => {
    const plan = deterministicAssistantProposal(
      "Blutdruck 151 zu 88 dokumentiert; Blutzucker-Kontrolle in 30 Minuten.",
    );
    expect(
      plan?.actions.find((action) => action.type === "task-proposal"),
    ).toEqual(
      expect.objectContaining({
        title: "Vereinbarte Folgekontrolle durchführen",
      }),
    );
  });

  it("rejects model changes to observation time semantics and units", () => {
    const prompt = "Gestern um 18 Uhr Blutdruck 151 zu 88.";
    const historical = deterministicAssistantProposal(prompt);
    if (!historical) throw new Error("expected historical observation");
    const action = historical.actions.find(
      (item) => item.type === "observation-proposal",
    );
    if (!action || action.type !== "observation-proposal")
      throw new Error("expected observation");
    action.reportingStatus = "current";
    action.occurrenceText = null;
    expect(() =>
      verifyModelProposalAgainstDeterministicCompiler(
        prompt,
        historical,
        deterministicAssistantProposal(prompt),
      ),
    ).toThrow("CLINICAL_PLAN_OBSERVATION_NOT_GROUNDED");
  });

  it("does not create a deadline from explicitly negated hours", () => {
    expect(
      deterministicAssistantProposal("Arzt informieren nicht in 2 Stunden.")
        ?.temporal.dueInMinutes,
    ).toBeNull();
    expect(
      deterministicAssistantProposal(
        "Kontrolle soll nicht in einer Stunde erfolgen.",
      )?.temporal.dueInMinutes,
    ).toBeNull();
  });

  it("understands natural multi-fact care without inventing follow-up actions", () => {
    const plan = deterministicAssistantProposal(
      "Luca mobilisiert, fast alles gegessen, ca. 200 ml getrunken.",
    );
    expect(plan?.workPerformed).toEqual([
      expect.objectContaining({
        activity: "Mobilisation",
        status: "performed",
      }),
    ]);
    expect(plan?.understoodFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "fluid-intake",
          value: 200,
          certainty: "uncertain",
        }),
        expect.objectContaining({ kind: "other", certainty: "uncertain" }),
      ]),
    );
    expect(plan?.actions).toEqual([
      expect.objectContaining({
        type: "note-proposal",
        completionStatus: "completed",
      }),
    ]);
    expect(plan?.communications).toHaveLength(0);
  });

  it("keeps partial work and deferred work separate", () => {
    const plan = deterministicAssistantProposal(
      "Nur Morgenpflege erledigt, Mobilisation später.",
    );
    expect(plan?.workPerformed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          activity: "Morgenpflege",
          status: "performed",
        }),
        expect.objectContaining({
          activity: "Mobilisation",
          status: "planned-later",
        }),
      ]),
    );
    expect(plan?.taskChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskLabel: "Morgenpflege",
          change: "complete",
          executable: false,
        }),
        expect.objectContaining({
          taskLabel: "Mobilisation",
          change: "defer",
          executable: false,
        }),
      ]),
    );
    expect(plan?.actions[0]).toMatchObject({
      type: "note-proposal",
      completionStatus: "partial",
    });
  });

  it("acknowledges explicit no-action wording without creating a write", () => {
    const plan = deterministicAssistantProposal(
      "Arzt nicht informieren, keine weitere Kontrolle.",
    );
    expect(plan?.actions).toHaveLength(0);
    expect(plan?.communications).toEqual([
      expect.objectContaining({
        requested: false,
        recipientLabel: "Ärztlicher Dienst",
      }),
    ]);
    expect(
      plan?.understoodFacts.every((fact) => fact.polarity === "negated"),
    ).toBe(true);
  });

  it("represents an interruption as one atomic reviewable workflow change", () => {
    const plan = deterministicAssistantProposal(
      "Anna pausieren, ich gehe zu Zimmer 207.",
    );
    expect(plan?.actions).toEqual([
      expect.objectContaining({
        type: "workflow-proposal",
        operation: "pause-current-and-start-room",
        targetRoom: "207",
      }),
    ]);
    expect(plan?.workflowActions.map((item) => item.operation)).toEqual([
      "pause-current",
      "start-unplanned-room",
    ]);
  });

  it("keeps only the corrected blood pressure executable", () => {
    const plan = deterministicAssistantProposal(
      "Blutdruck nicht 151 zu 88, sondern 128 zu 76.",
    );
    expect(
      plan?.actions.filter((action) => action.type === "observation-proposal"),
    ).toEqual([
      expect.objectContaining({
        value: 128,
        secondaryValue: 76,
        certainty: "certain",
      }),
    ]);
    expect(plan?.corrections).toEqual([
      expect.objectContaining({
        replacedText: "151/88",
        replacementText: "128/76",
      }),
    ]);
  });

  it.each([
    ["Puls nicht 82, sondern 72.", "pulse", 72],
    ["Temperatur nicht 37,8 sondern 37,2.", "temperature", 37.2],
    ["Sättigung nicht 91, sondern 96 Prozent.", "oxygen-saturation", 96],
  ])(
    "keeps only a natural corrected scalar executable: %s",
    (prompt, code, value) => {
      const plan = deterministicAssistantProposal(prompt);
      expect(plan?.actions).toEqual([
        expect.objectContaining({
          type: "observation-proposal",
          code,
          value,
        }),
      ]);
      expect(plan?.corrections).toHaveLength(1);
    },
  );

  it.each([
    ["Temperatur ungefähr 37,8.", "temperature", 37.8],
    ["Puls vielleicht 82.", "pulse", 82],
    ["Gewicht möglicherweise 71,4 kg.", "weight", 71.4],
  ])(
    "preserves an uncertain scalar without making it executable: %s",
    (prompt, code, value) => {
      const plan = deterministicAssistantProposal(prompt);
      expect(plan?.observations).toContainEqual(
        expect.objectContaining({
          code,
          value,
          certainty: "uncertain",
          actionId: null,
        }),
      );
      expect(plan?.actions).toHaveLength(0);
      expect(plan?.clarificationQuestions).toHaveLength(1);
    },
  );

  it("asks one clarification instead of executing an approximate vital", () => {
    const plan = deterministicAssistantProposal("Temperatur ca. 37,4.");
    expect(
      plan?.actions.some((action) => action.type === "observation-proposal"),
    ).toBe(false);
    expect(plan?.observations).toEqual([
      expect.objectContaining({ actionId: null, certainty: "uncertain" }),
    ]);
    expect(plan?.ambiguities).toHaveLength(1);
  });

  it("fails closed when a historical vital has no precise occurrence time", () => {
    const plan = deterministicAssistantProposal("Früher Blutdruck 151 zu 88.");
    expect(
      plan?.actions.some((action) => action.type === "observation-proposal"),
    ).toBe(false);
    expect(plan?.ambiguities[0]).toMatch(/Wann genau/);
  });

  it("binds time per clause and ignores a negated deadline", () => {
    const plan = deterministicAssistantProposal(
      "Gestern um 18 Uhr Blutdruck 151 zu 88; heute Puls 82.",
    );
    const observations = plan?.actions.filter(
      (action) => action.type === "observation-proposal",
    );
    expect(observations).toEqual([
      expect.objectContaining({
        code: "blood-pressure",
        reportingStatus: "historical",
        occurrenceText: "Gestern um 18 Uhr",
      }),
      expect.objectContaining({
        code: "pulse",
        reportingStatus: "current",
        occurrenceText: null,
      }),
    ]);
    expect(
      deterministicAssistantProposal(
        "Arzt informieren, aber nicht in 30 Minuten.",
      )?.temporal.dueInMinutes,
    ).toBeNull();
  });

  it("records explicitly omitted care as not performed, never completed", () => {
    const plan = deterministicAssistantProposal("Nicht mobilisiert.");
    expect(plan?.workPerformed).toEqual([
      expect.objectContaining({ status: "not-performed" }),
    ]);
    expect(plan?.actions).toEqual([
      expect.objectContaining({
        type: "note-proposal",
        completionStatus: "not-performed",
      }),
    ]);
  });

  it("limits negation to the comma-separated statement", () => {
    const vital = deterministicAssistantProposal(
      "Kein Schwindel, Blutdruck 128 zu 76.",
    );
    expect(vital?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "observation-proposal",
          value: 128,
          secondaryValue: 76,
        }),
      ]),
    );

    const work = deterministicAssistantProposal(
      "Keine Schmerzen, mobilisiert.",
    );
    expect(work?.workPerformed).toEqual([
      expect.objectContaining({ status: "performed" }),
    ]);
    for (const wording of [
      "Keine Schmerzen,mobilisiert.",
      "Keine Schmerzen und mobilisiert.",
    ])
      expect(
        deterministicAssistantProposal(wording)?.workPerformed[0]?.status,
      ).toBe("performed");
  });

  it("does not let a model override an explicit no-write statement", () => {
    const prompt = "Nichts dokumentieren.";
    const compiled = deterministicAssistantProposal(prompt);
    if (!compiled) throw new Error("expected refusal proposal");
    const actionTemplate = deterministicAssistantProposal(
      "Mobilisation durchgeführt.",
    );
    if (!actionTemplate) throw new Error("expected action template");
    const invented = structuredClone(compiled);
    const sourceSpan = { start: 0, end: prompt.length, quote: prompt };
    const action = actionTemplate.actions[0]!;
    action.sourceSpan = sourceSpan;
    if (action.type === "note-proposal") action.structuredText = prompt;
    invented.actions = [action];
    expect(() =>
      verifyModelProposalAgainstDeterministicCompiler(
        prompt,
        invented,
        compiled,
      ),
    ).toThrow("CLINICAL_PLAN_EXPLICIT_NO_WRITE");
  });

  it("preserves explicitly partial mobilisation", () => {
    const plan = deterministicAssistantProposal(
      "Mobilisation teilweise durchgeführt.",
    );
    expect(plan?.workPerformed).toEqual([
      expect.objectContaining({ activity: "Mobilisation", status: "partial" }),
    ]);
    expect(plan?.taskChanges).toEqual([
      expect.objectContaining({ change: "partial", executable: false }),
    ]);
    expect(plan?.actions[0]).toMatchObject({
      type: "note-proposal",
      completionStatus: "partial",
    });
  });

  it("does not invert explicitly negated urgency", () => {
    const plan = deterministicAssistantProposal(
      "Arzt informieren, aber nicht dringend.",
    );
    expect(plan?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "communication-proposal",
          priority: "routine",
        }),
      ]),
    );
  });

  it.each([
    "Notiz: Miss Blutzucker.",
    "Zieh die Kompressionsstrümpfe an.",
    "Führe die Inhalation durch.",
    "Lass den Patienten nüchtern.",
    "Versorge das Stoma.",
    "Lagere den Bewohner um.",
    "Leere die Drainage.",
    "Saugen Sie die Trachealkanüle ab.",
    "Notiz: Injiziere Heparin.",
    "Notiz: Verteile die Tabletten.",
    "Notiz: Spüle die PEG-Sonde.",
  ])("routes treatment command fail-closed: %s", (prompt) => {
    expect(deterministicAssistantProposal(prompt)).toBeNull();
  });

  it.each([
    "Arzt keinesfalls in 30 Minuten informieren.",
    "Arzt nie in 30 Minuten informieren.",
  ])("does not invert strong physician negation: %s", (prompt) => {
    const plan = deterministicAssistantProposal(prompt);
    expect(
      plan?.actions.some((action) => action.type === "communication-proposal"),
    ).toBe(false);
  });

  it.each([
    "Keinesfalls in 30 Minuten nachmessen.",
    "Nie in 30 Minuten nachmessen.",
  ])("does not invert strong task negation: %s", (prompt) => {
    const plan = deterministicAssistantProposal(prompt);
    expect(
      plan?.actions.some((action) => action.type === "task-proposal"),
    ).toBe(false);
  });

  it.each([
    "Anna nicht pausieren, ich gehe zu Zimmer 207.",
    "Anna keinesfalls pausieren, ich gehe zu Zimmer 207.",
    "Gestern sollte ich Anna pausieren und zu Zimmer 207 gehen.",
  ])(
    "does not execute negated or historical workflow wording: %s",
    (prompt) => {
      const plan = deterministicAssistantProposal(prompt);
      expect(
        plan?.actions.some((action) => action.type === "workflow-proposal"),
      ).toBe(false);
    },
  );

  it.each(["Mobilisiert? Nein.", "Morgenpflege durchgeführt? Nein."])(
    "records a trailing spoken correction as not performed: %s",
    (prompt) => {
      const plan = deterministicAssistantProposal(prompt);
      expect(plan?.workPerformed[0]?.status).toBe("not-performed");
      expect(plan?.actions).toEqual([
        expect.objectContaining({
          type: "note-proposal",
          completionStatus: "not-performed",
        }),
      ]);
    },
  );

  it.each([
    ["Puls 82, nein 72.", "pulse", 72, null],
    ["Temperatur 37,4, nein 37,8.", "temperature", 37.8, null],
    ["Sättigung 92, nein 96 Prozent.", "oxygen-saturation", 96, null],
    ["Blutdruck 151 zu 88, nein 128 zu 76.", "blood-pressure", 128, 76],
  ] as const)(
    "keeps only the explicitly corrected vital executable: %s",
    (prompt, code, value, secondaryValue) => {
      const observations = deterministicAssistantProposal(
        prompt,
      )?.actions.filter((action) => action.type === "observation-proposal");
      expect(observations).toEqual([
        expect.objectContaining({ code, value, secondaryValue }),
      ]);
    },
  );

  it("deduplicates an identical repeated vital write", () => {
    const observations = deterministicAssistantProposal(
      "Puls 82, Puls 82.",
    )?.actions.filter((action) => action.type === "observation-proposal");
    expect(observations).toHaveLength(1);
  });

  it("keeps a symptom negation scoped away from a contextual vital", () => {
    const observations = deterministicAssistantProposal(
      "Kein Schwindel bei Blutdruck 128 zu 76.",
    )?.actions.filter((action) => action.type === "observation-proposal");
    expect(observations).toEqual([
      expect.objectContaining({
        code: "blood-pressure",
        value: 128,
        secondaryValue: 76,
      }),
    ]);
  });

  it("keeps every corrected value in a multi-vital statement", () => {
    const observations = deterministicAssistantProposal(
      "Puls 82, nein 72 und Temperatur 37,4, nein 37,8.",
    )?.actions.filter((action) => action.type === "observation-proposal");
    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "pulse", value: 72 }),
        expect.objectContaining({ code: "temperature", value: 37.8 }),
      ]),
    );
    expect(observations).toHaveLength(2);
  });

  it("does not let a model restore an explicitly retracted vital", () => {
    const prompt = "Mobilisiert, Puls 82, nein 72.";
    const compiled = deterministicAssistantProposal(prompt);
    if (!compiled) throw new Error("expected corrected proposal");
    const candidate = structuredClone(compiled);
    const observation = candidate.actions.find(
      (action) => action.type === "observation-proposal",
    );
    if (!observation || observation.type !== "observation-proposal")
      throw new Error("expected observation");
    const oldValueStart = prompt.indexOf("Puls 82");
    observation.value = 82;
    observation.sourceSpan = {
      start: oldValueStart,
      end: oldValueStart + "Puls 82".length,
      quote: "Puls 82",
    };
    expect(() =>
      verifyModelProposalAgainstDeterministicCompiler(
        prompt,
        candidate,
        compiled,
      ),
    ).toThrow("CLINICAL_PLAN_CORRECTION_MISMATCH");
  });

  it.each([
    ["Gestern um 18 Uhr Puls 82, nein 72.", "pulse", 72],
    [
      "Gestern um 18 Uhr Blutdruck 151 zu 88, nein 128 zu 76.",
      "blood-pressure",
      128,
    ],
  ] as const)(
    "preserves occurrence time on a corrected historical vital: %s",
    (prompt, code, value) => {
      expect(
        deterministicAssistantProposal(prompt)?.actions.find(
          (action) => action.type === "observation-proposal",
        ),
      ).toEqual(
        expect.objectContaining({
          code,
          value,
          reportingStatus: "historical",
          occurrenceText: "Gestern um 18 Uhr",
        }),
      );
    },
  );
});
