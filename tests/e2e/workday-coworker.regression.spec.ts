import { expect, test, type Page } from "@playwright/test";

// Regression: WORKDAY-COWORKER-2026-09-27 — duplicated entry points, conflated
// handover/plan/tasks and detached handover playback broke the shift sequence.
// Found by /qa on 2026-09-27.
// Report: .gstack/qa-reports/QA_REPORT.md

test.beforeEach(async ({ page, request }) => {
  await request.post("/api/v1/demo/reset", {
    headers: {
      "x-demo-user": "u-it",
      "x-command-id": crypto.randomUUID(),
    },
  });
  await page.goto("/");
  await expect(page.getByLabel("Pflegehelfer Gespräch")).toBeVisible();
});

async function openDestination(page: Page, name: string) {
  await page
    .getByRole("button", { name: "Kontext und Verlauf öffnen" })
    .click();
  await page
    .getByRole("button", {
      name: new RegExp(`^${name} Arbeitsbereich öffnen`),
    })
    .click();
}

test("initial conversation has one shift entry and no loading skip-link or duplicate navigation prompts", async ({
  page,
}) => {
  await expect(page.getByRole("link", { name: "Zum Gespräch" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Übergabe", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Meine Aufgaben", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Teamfragen", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Schichtübergabe öffnen" }),
  ).toBeVisible();
});

test("handover, plan and tasks are three distinct workday views", async ({
  page,
}) => {
  await openDestination(page, "Übergabe");
  await expect(
    page.getByRole("heading", { name: "Übergabe patientenweise übernehmen" }),
  ).toBeVisible();

  await openDestination(page, "Pläne");
  await expect(
    page.getByRole("heading", { name: "Dein Arbeitsplan" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Übergabe patientenweise übernehmen" }),
  ).toHaveCount(0);

  await openDestination(page, "Aufgaben");
  await expect(
    page.getByRole("heading", { name: "Deine heutigen Aufgaben" }),
  ).toBeVisible();
});

test("read-aloud is attached to the expanded patient and speaks only the visible frozen handover", async ({
  page,
}) => {
  await openDestination(page, "Übergabe");
  await page.evaluate(() => {
    const state = { spokenText: "", cancelled: false };
    class TestSpeechSynthesisUtterance {
      lang = "";
      voice: SpeechSynthesisVoice | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(readonly text: string) {}
    }
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      configurable: true,
      value: TestSpeechSynthesisUtterance,
    });
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        cancel: () => {
          state.cancelled = true;
        },
        pause: () => undefined,
        resume: () => undefined,
        speak: (utterance: TestSpeechSynthesisUtterance) => {
          state.spokenText = utterance.text;
        },
        getVoices: () => [],
      },
    });
    Object.defineProperty(window, "__pfhWorkdaySpeech", {
      configurable: true,
      value: state,
    });
  });

  const expandedPatient = page.getByRole("button", { expanded: true }).first();
  const patientName = (await expandedPatient.locator("strong").innerText())
    .split(" · ")
    .at(-1)!;
  const row = expandedPatient.locator("xpath=..");
  const readButton = row.getByRole("button", {
    name: new RegExp(`Übergabe von ${patientName} vorlesen`),
  });
  await expect(readButton).toBeVisible();
  await readButton.click();

  const speech = await page.evaluate(
    () =>
      (
        window as unknown as {
          __pfhWorkdaySpeech: { spokenText: string; cancelled: boolean };
        }
      ).__pfhWorkdaySpeech,
  );
  expect(speech.spokenText).toContain(patientName);
  expect(speech.spokenText).toContain("Wichtig zu wissen:");
  expect(speech.spokenText).toContain(
    "Was in der letzten Schicht passiert ist:",
  );
  expect(speech.spokenText).toContain("Wichtige nächste Schritte:");
  expect(speech.cancelled).toBe(true);
});

test("acknowledging one patient uses the returned durable workday without reloading conversation context", async ({
  page,
}) => {
  await openDestination(page, "Übergabe");
  const seen: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/v1/"))
      seen.push(`${request.method()} ${url.pathname}`);
  });
  await page
    .getByRole("button", { name: /^Gelesen und übernehmen:/ })
    .first()
    .click();
  await expect(page.getByText("1/8 Patientenkontexte geprüft")).toBeVisible();
  expect(seen.filter((entry) => entry === "POST /api/v1/workday")).toHaveLength(
    1,
  );
  expect(
    seen.filter((entry) => entry === "GET /api/v1/assistant/conversation"),
  ).toHaveLength(0);
  expect(
    seen.filter((entry) => entry === "POST /api/v1/assistant/context"),
  ).toHaveLength(0);
});

test("today's tasks support interruption, additional work and an explicit write review", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openDestination(page, "Übergabe");
  const acknowledgements = page.getByRole("button", {
    name: /^Gelesen und übernehmen:/,
  });
  for (let acknowledged = 1; acknowledged <= 8; acknowledged += 1) {
    await expect(acknowledgements.first()).toBeEnabled();
    await acknowledgements.first().click();
    await expect(
      page.getByText(`${acknowledged}/8 Patientenkontexte geprüft`),
    ).toBeVisible();
  }

  await openDestination(page, "Aufgaben");
  await page
    .getByRole("button", { name: /Arbeit beginnen: Zimmer 214A/ })
    .click();
  await page
    .getByLabel("Was wurde tatsächlich durchgeführt?")
    .fill("Morgenpflege durchgeführt und Mobilisation sicher begleitet.");
  await page.getByRole("button", { name: "Zusätzliche Arbeit" }).click();
  const additional = page.locator(".additional-work");
  await additional.getByLabel("Patient:in").selectOption("p-luca");
  await additional
    .getByLabel("Anlass / Aufgabe")
    .fill("Zusätzliche Trinkbegleitung");
  await additional
    .getByRole("button", { name: "Aktuelle Arbeit unterbrechen & beginnen" })
    .click();

  await expect(page.getByLabel("Aktive Arbeit")).toContainText(
    "Zusätzliche Trinkbegleitung",
  );
  await page
    .getByLabel("Was wurde tatsächlich durchgeführt?")
    .fill(
      "Zusätzliche Trinkbegleitung durchgeführt und Ergebnis dokumentiert.",
    );
  await page.getByRole("button", { name: "Zusammenfassung prüfen" }).click();
  const review = page.getByLabel("Dokumentation prüfen");
  await expect(review).toContainText(
    "Zusätzliche Trinkbegleitung durchgeführt und Ergebnis dokumentiert.",
  );
  await expect(review).toContainText("Medplum");
  await review
    .getByRole("button", { name: "Geprüft schreiben & abschliessen" })
    .click();
  await expect(
    page.getByRole("button", { name: "Patientenkontext fortsetzen" }),
  ).toBeVisible();
});
