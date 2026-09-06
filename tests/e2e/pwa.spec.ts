import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page, request }) => {
  await request.post("/api/v1/demo/reset", {
    headers: {
      "x-demo-user": "u-it",
      "x-command-id": crypto.randomUUID(),
    },
  });
  await page.goto("/");
});

async function chooseRole(page: Page, user: string) {
  await page.getByLabel("Demo-Rolle wechseln").selectOption(user);
}

async function openFocus(
  page: Page,
  name: "Meine Schicht" | "Patient" | "Team" | "Synchronisation",
) {
  const target = {
    "Meine Schicht": "today",
    Patient: "patient",
    Team: "inbox",
    Synchronisation: "sync",
  }[name];
  await page.locator(`[data-nav="${target}"]:visible`).click();
  if (name === "Patient") {
    const selector = page.getByLabel("Patient auswählen");
    if ((await selector.isVisible()) && (await selector.inputValue()) === "")
      await selector.selectOption("p-anna");
    else if (!(await selector.isVisible())) {
      const anna = page.getByRole("button", { name: /214A Anna Beispiel/ });
      if (await anna.isVisible()) await anna.click();
    }
  }
}

async function choosePatient(page: Page, id: "p-anna" | "p-luca") {
  const select = page.locator('select[aria-label="Patient auswählen"]:visible');
  const button = page
    .locator(".patient-context-list button:visible")
    .filter({ hasText: id === "p-anna" ? "214A" : "207" });
  await expect(select.or(button)).toBeVisible();
  if (await select.isVisible()) await select.selectOption(id);
  else await button.click();
}

test("conversation-first shell is responsive, accessible and patient-aware", async ({
  page,
}, testInfo) => {
  await expect(page.getByLabel("Pflegehelfer Gespräch")).toBeVisible();
  await expect(page.getByLabel("Nachricht an Pflegehelfer")).toBeVisible();
  await expect(page.getByText("Guten Morgen, Lea.")).toBeVisible();
  await expect(page.getByText("Blutdruck kontrollieren")).toBeVisible();
  await expect(page.getByText("Aktuell", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Patient auswählen")).toHaveValue("");
  await expect(page.locator(".patient-safety-context:visible")).toHaveCount(0);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  await openFocus(page, "Patient");
  await expect(
    page.getByRole("heading", { name: "Anna Beispiel" }),
  ).toBeVisible();
  await expect(
    page.locator("article.patient-banner").getByText(/Fall SH-260901-001/),
  ).toBeVisible();
  const safetyContext = page.locator(
    '.patient-safety-context:visible[aria-label="Permanenter Patienten-Sicherheitskontext"]',
  );
  await expect(safetyContext).toBeVisible();
  await expect(safetyContext).toContainText("18.03.1941");
  await expect(safetyContext).toContainText("Penicillin");
  await expect(page.getByText("Heute relevant")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Dokumentieren" }),
  ).toBeVisible();

  expect(
    await page
      .locator("html")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => document.activeElement !== document.body),
  ).toBe(true);

  if (["mobile-360", "mobile-390", "tablet"].includes(testInfo.project.name)) {
    const bpTask = page
      .locator("article.task-card")
      .filter({ hasText: "Blutdruck kontrollieren" });
    await bpTask.getByRole("button", { name: "Annehmen" }).click();
    const toastClose = page.getByRole("button", { name: "Meldung schliessen" });
    await expect(toastClose).toBeVisible();
    const toastBox = await toastClose.boundingBox();
    expect(toastBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(toastBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    await toastClose.click();
    await expect(page.getByLabel("Demo-Rolle wechseln")).toBeVisible();
    const touchTargets = await page
      .locator(
        ".mobile-context-tabs button:visible, .role-control select:visible, .mobile-patient-select select:visible, .quick-prompts button:visible, .in-chat-tabs button:visible, .assistant-action-review button:visible",
      )
      .evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return { width: box.width, height: box.height };
        }),
      );
    expect(touchTargets.length).toBeGreaterThan(0);
    for (const target of touchTargets) {
      expect(target.height).toBeGreaterThanOrEqual(44);
      expect(target.width).toBeGreaterThanOrEqual(44);
    }
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const stickyBox = await safetyContext.boundingBox();
    expect(stickyBox?.y ?? 0).toBeGreaterThanOrEqual(64);
  }
});

test("role isolation keeps clinical context out of HR, management, IT and service", async ({
  page,
}) => {
  await chooseRole(page, "u-hr");
  await expect(page.getByText("Getrennte HR-Grenze")).toBeVisible();
  await openFocus(page, "Patient");
  await expect(
    page.getByText("Kein klinischer Kontext für diese Rolle"),
  ).toBeVisible();
  await expect(page.getByText("Anna Beispiel")).toHaveCount(0);

  await chooseRole(page, "u-manager");
  await expect(page.getByText("Aggregierte Prozessansicht")).toBeVisible();
  await expect(page.getByText("Anna Beispiel")).toHaveCount(0);

  await chooseRole(page, "u-it");
  await openFocus(page, "Synchronisation");
  await expect(
    page.getByText("Provider-Verbindungen & Simulatoren"),
  ).toBeVisible();
  await expect(page.getByText("Anna Beispiel")).toHaveCount(0);

  await chooseRole(page, "u-service");
  await expect(page.getByText("Defekte Leselampe Zimmer 214")).toBeVisible();
  await expect(page.getByText("Anna Beispiel")).toHaveCount(0);

  await chooseRole(page, "u-admin");
  await choosePatient(page, "p-anna");
  await expect(
    page
      .locator(".patient-safety-context:visible")
      .getByText("Klinische Warnhinweise in dieser Rolle nicht freigegeben"),
  ).toBeVisible();
  await openFocus(page, "Team");
  await expect(
    page.getByRole("button", { name: /Frage, Kommentar/ }),
  ).toHaveCount(0);
  await expect(page.getByText("Keine bekannten Warnhinweise")).toHaveCount(0);
});

test("patient actions are projected from the active clinical role", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "role projection runs once");
  await chooseRole(page, "u-pharmacy");
  await openFocus(page, "Patient");
  await expect(
    page.getByRole("button", { name: "Dokumentieren", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Vitalwert", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Aufgabe", exact: true }).click();
  const pharmacyEditor = page.getByRole("dialog", {
    name: "Arbeit im Gespräch erfassen",
  });
  await expect(
    pharmacyEditor.getByRole("button", { name: "Notiz", exact: true }),
  ).toHaveCount(0);
  await expect(
    pharmacyEditor.getByRole("button", { name: "Vital", exact: true }),
  ).toHaveCount(0);
  await expect(
    pharmacyEditor.getByRole("button", { name: "Visite", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await chooseRole(page, "u-physio");
  await openFocus(page, "Patient");
  await expect(
    page.getByRole("button", { name: "Dokumentieren", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Vitalwert", exact: true }),
  ).toHaveCount(0);
});

test("offline state is explicit and every clinical mutation is disabled", async ({
  page,
  context,
}) => {
  await openFocus(page, "Patient");
  await page.getByRole("button", { name: "Dokumentieren" }).click();
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByText("Offline", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sicheren Entwurf erstellen" }),
  ).toBeDisabled();
  // Staff may prepare text while disconnected, but no query or clinical
  // action can cross the gateway until connectivity returns.
  await expect(
    page.getByRole("button", { name: "Nachricht senden" }),
  ).toBeDisabled();
  await context.setOffline(false);
});

test("one natural-language bedside update creates the reviewed four-part bundle", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "compound journey runs once");
  await chooseRole(page, "u-nurse");
  await openFocus(page, "Patient");
  const text =
    "Bin mit Anna fertig. Mobilisiert, Blutdruck 151 zu 88, etwas Schwindel. Arzt informieren und Kontrolle in 30 Minuten.";
  await page.getByLabel("Nachricht an Pflegehelfer").fill(text);
  await page.getByRole("button", { name: "Nachricht senden" }).click();
  await expect(
    page.getByText("Gebündelter Pflegeeintrag · Anna Beispiel"),
  ).toBeVisible();
  await expect(page.getByText(/151\/88 mmHg/)).toBeVisible();
  await page
    .getByRole("button", { name: "Änderungen gemeinsam prüfen" })
    .click();
  const review = page.getByLabel("Assistenzvorschlag prüfen");
  await expect(review).toBeFocused();
  await expect(review).toContainText("SH-260901-001");
  await expect(review).toContainText(text);
  await review
    .getByRole("button", { name: "Geprüfte Auswahl anlegen" })
    .click();
  await expect(
    page.getByText(/Geprüft: Die ausgewählten Aktionen/),
  ).toBeVisible();
  await expect(page.getByText(text).last()).toBeVisible();
  await expect(page.getByText("151/88 mmHg", { exact: true })).toBeVisible();
  const snapshotResponse = await page.request.get("/api/v1/snapshot", {
    headers: { "x-demo-user": "u-nurse" },
  });
  const snapshot = (await snapshotResponse.json()) as {
    notes: Array<{ structuredText: string; status: string }>;
    observations: Array<{ value: number; status: string }>;
    communications: Array<{ request: string; state: string }>;
    tasks: Array<{ title: string; state: string }>;
  };
  expect(
    snapshot.notes.some(
      (note) => note.structuredText === text && note.status === "draft",
    ),
  ).toBe(true);
  expect(
    snapshot.observations.some(
      (observation) =>
        observation.value === 151 && observation.status === "draft",
    ),
  ).toBe(true);
  expect(
    snapshot.communications.some(
      (message) =>
        message.request ===
          "Aktuellen Pflegezustand und Blutdruck beurteilen" &&
        message.state === "sent",
    ),
  ).toBe(true);
  expect(
    snapshot.tasks.some(
      (task) =>
        task.title === "Blutdruck erneut kontrollieren" && task.state === "new",
    ),
  ).toBe(true);

  await openFocus(page, "Team");
  await expect(
    page
      .locator('[data-genui-component="ClinicalContextProjection"]')
      .getByText("Aktuellen Pflegezustand und Blutdruck beurteilen", {
        exact: true,
      }),
  ).toBeVisible();
  await openFocus(page, "Meine Schicht");
  await expect(
    page.getByText("Blutdruck erneut kontrollieren", { exact: true }),
  ).toBeVisible();
});

test("fixed in-conversation forms cover notes, vitals, tasks and named team mentions", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "form journey runs once");
  await chooseRole(page, "u-nurse");
  await openFocus(page, "Patient");
  const launcher = page.getByRole("button", {
    name: "Dokumentieren",
    exact: true,
  });
  await launcher.click();
  const dialog = page.getByRole("dialog", {
    name: "Arbeit im Gespräch erfassen",
  });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(launcher).toBeFocused();
  await launcher.click();
  await dialog
    .getByLabel("Beobachtung / Diktat")
    .fill("Mobilisation 30 m mit Rollator, rechts gesichert.");
  await dialog
    .getByRole("button", { name: "Sicheren Entwurf erstellen" })
    .click();
  const note = page
    .locator("article.note")
    .filter({ hasText: "Mobilisation 30 m" });
  await expect(note.getByText("Entwurf")).toBeVisible();
  page.once("dialog", (confirmation) => confirmation.accept());
  await note.getByRole("button", { name: "Prüfen & freigeben" }).click();
  await expect(note.getByText("Noch nicht synchronisiert")).toBeVisible();

  await launcher.click();
  await dialog.getByRole("button", { name: "@ Team" }).click();
  await dialog.getByLabel("An / @Erwähnung").selectOption("u-physician");
  await dialog.getByLabel("Anfrage").fill("Bitte Schwindel heute beurteilen");
  await dialog.getByLabel("Kontext / Kommentar").fill("Neu nach Mobilisation");
  await dialog.getByRole("button", { name: "Anfrage senden" }).click();
  await openFocus(page, "Team");
  const namedMessage = page
    .locator("article.message")
    .filter({ hasText: "Bitte Schwindel heute beurteilen" });
  await expect(namedMessage.getByText("@Dr. David Keller")).toBeVisible();
  await expect(namedMessage.getByText("Neu nach Mobilisation")).toBeVisible();
});

test("team question is acknowledged, answered, followed up and closed", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "team journey runs once");
  await chooseRole(page, "u-physician");
  await openFocus(page, "Team");
  const message = page
    .locator("article.message")
    .filter({ hasText: "Neuer Schwindel" });
  await message.getByRole("button", { name: "Quittieren" }).click();
  await message
    .getByLabel("Antwort")
    .fill("Orthostase messen; keine Verordnung in Pflegehelfer.");
  await message.getByRole("button", { name: "Antworten" }).click();
  await expect(message.getByText("Beantwortet")).toBeVisible();

  await chooseRole(page, "u-nurse");
  await expect(page.getByText("Folgeauftrag aus Antwort")).toBeVisible();
  await openFocus(page, "Team");
  await page
    .locator("article.message")
    .filter({ hasText: "Neuer Schwindel" })
    .getByRole("button", { name: "Schliessen" })
    .click();
  await expect(
    page.getByText("Kommunikationsschleife geschlossen."),
  ).toBeVisible();
});

test("only the exact named recipient receives the live actionable notification", async ({
  browser,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "two-client delivery runs once",
  );
  const davidContext = await browser.newContext({
    baseURL: "http://127.0.0.1:4173",
    serviceWorkers: "block",
  });
  const elifContext = await browser.newContext({
    baseURL: "http://127.0.0.1:4173",
    serviceWorkers: "block",
  });
  try {
    const david = await davidContext.newPage();
    const elif = await elifContext.newPage();
    await Promise.all([david.goto("/"), elif.goto("/")]);
    await chooseRole(david, "u-physician");
    await chooseRole(elif, "u-physician-evening");
    await Promise.all([
      expect(
        david
          .getByLabel("Arbeitskontext")
          .getByText("Dr. David Keller", { exact: true }),
      ).toBeVisible(),
      expect(
        elif
          .getByLabel("Arbeitskontext")
          .getByText("Dr. Elif Aydin", { exact: true }),
      ).toBeVisible(),
    ]);
    const created = await request.post("/api/v1/communications", {
      headers: {
        "x-demo-user": "u-nurse",
        "x-command-id": crypto.randomUUID(),
      },
      data: {
        patientId: "p-anna",
        request: "Gezielte Live-Rückfrage",
        reason: "Nur David soll eine Handlungsbenachrichtigung erhalten",
        recipientRole: "physician",
        recipientId: "u-physician",
        priority: "elevated",
        dueAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      },
    });
    expect(created.ok()).toBe(true);
    await expect(
      david.getByText("Neue adressierte Team-Anfrage", { exact: false }),
    ).toBeVisible({ timeout: 7000 });
    await expect(
      elif.getByText("Neue adressierte Team-Anfrage", { exact: false }),
    ).toHaveCount(0);
    await expect(
      david.getByText("Neue adressierte Team-Anfrage", { exact: false }),
    ).not.toContainText("Anna");
    await openFocus(david, "Team");
    const message = david
      .locator("article.message")
      .filter({ hasText: "Gezielte Live-Rückfrage" });
    await expect(
      message.getByRole("button", { name: "Quittieren" }),
    ).toBeVisible();
    await openFocus(elif, "Team");
    await expect(
      elif
        .locator("article.message")
        .filter({ hasText: "Gezielte Live-Rückfrage" })
        .getByRole("button", { name: "Quittieren" }),
    ).toHaveCount(0);
  } finally {
    await Promise.all([davidContext.close(), elifContext.close()]);
  }
});

test("intake discrepancy and physician round become traceable stream work", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "intake and rounds run once");
  await chooseRole(page, "u-pharmacy");
  await openFocus(page, "Patient");
  const intake = page.locator("article.intake").filter({
    hasText: "Medikationsabgleich",
  });
  page.once("dialog", (dialog) =>
    dialog.accept("Austrittsverordnung und Hausmedikation abgeglichen."),
  );
  await intake.getByRole("button", { name: "Klärung dokumentieren" }).click();
  await expect(page.getByText(/nachvollziehbar geklärt/)).toBeVisible();

  await chooseRole(page, "u-physician");
  await openFocus(page, "Patient");
  await page.getByRole("button", { name: "Visite", exact: true }).click();
  const round = page.getByRole("dialog", {
    name: "Arbeit im Gespräch erfassen",
  });
  await round.getByLabel("Sicherer Folgetyp").selectOption("therapy-followup");
  await round.getByLabel("Zuständig").selectOption("physiotherapy");
  await round.getByRole("button", { name: "Beschluss freigeben" }).click();
  await expect(
    page.getByText("Therapieeinheit nachverfolgen", { exact: true }).first(),
  ).toBeVisible();
  await chooseRole(page, "u-physio");
  await expect(
    page.getByText("Therapieeinheit nachverfolgen", { exact: true }).first(),
  ).toBeVisible();
});

test("handover remains a signed and independently accepted stream event", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "handover journey runs once");
  await chooseRole(page, "u-nurse");
  const outgoing = page
    .locator("article.handover-sheet")
    .filter({ hasText: "Früh → Spät" });
  await outgoing.getByRole("button", { name: "Übergabe signieren" }).click();
  await expect(outgoing.getByText("Signiert", { exact: true })).toBeVisible();
  await chooseRole(page, "u-nurse-evening");
  const incoming = page
    .locator("article.handover-sheet")
    .filter({ hasText: "Früh → Spät" });
  await incoming.getByRole("button", { name: "Übergabe übernehmen" }).click();
  await expect(incoming.getByText("Quittiert", { exact: true })).toBeVisible();
});

test("nurse-call alarm becomes spontaneous work without replacing the primary system", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "alarm journey runs once");
  await chooseRole(page, "u-it");
  await openFocus(page, "Synchronisation");
  await page
    .getByRole("button", { name: "Nurse-call Ereignis spiegeln" })
    .click();
  await chooseRole(page, "u-assistant");
  const alarm = page
    .locator("article.task-card")
    .filter({ hasText: "Klingel" });
  await expect(alarm.getByText("Sekundärer Spiegel")).toBeVisible();
  await expect(
    alarm.getByText("Primäre Rufanlage bleibt autoritativ"),
  ).toBeVisible();
  await expect(alarm.getByText(/Eskalation \d{2}:\d{2}/)).toBeVisible();
  await alarm.getByRole("button", { name: "Annehmen" }).click();
  await alarm.getByRole("button", { name: "Starten" }).click();
  page.once("dialog", (dialog) =>
    dialog.accept("Vor Ort geprüft; Patient sicher."),
  );
  await alarm.getByRole("button", { name: "Abschliessen" }).click();
  await expect(
    page.getByText("Aufgabe mit Nachweis abgeschlossen."),
  ).toBeVisible();

  await chooseRole(page, "u-it");
  await openFocus(page, "Synchronisation");
  await page
    .getByRole("button", { name: "Nurse-call Ereignis spiegeln" })
    .click();
  await page
    .getByRole("button", { name: "Ruf-Eskalation +3 Min simulieren" })
    .click();
  await chooseRole(page, "u-nurse");
  const escalatedAlarm = page
    .locator("article.task-card")
    .filter({ hasText: "Klingel" })
    .last();
  await expect(escalatedAlarm).toContainText("Eskaliert");
  await escalatedAlarm.getByRole("button", { name: "Annehmen" }).click();
  await escalatedAlarm.getByRole("button", { name: "Starten" }).click();
  page.once("dialog", (dialog) =>
    dialog.accept("Eskalation übernommen; vor Ort geprüft."),
  );
  await escalatedAlarm.getByRole("button", { name: "Abschliessen" }).click();
  await expect(
    page.getByText("Aufgabe mit Nachweis abgeschlossen."),
  ).toBeVisible();
  await expect(escalatedAlarm).toHaveCount(0);
});

test("provider outage, pending state and conflict reconciliation remain visible", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "provider journey runs once");
  await chooseRole(page, "u-nurse");
  await openFocus(page, "Patient");
  await page
    .getByRole("button", { name: "Dokumentieren", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Arbeit im Gespräch erfassen",
  });
  const text = "Konflikttest: Mobilisation 20 m begleitet und toleriert.";
  await dialog.getByLabel("Beobachtung / Diktat").fill(text);
  await dialog
    .getByRole("button", { name: "Sicheren Entwurf erstellen" })
    .click();
  const note = page.locator("article.note").filter({ hasText: text });
  page.once("dialog", (confirmation) => confirmation.accept());
  await note.getByRole("button", { name: "Prüfen & freigeben" }).click();

  await chooseRole(page, "u-it");
  await openFocus(page, "Synchronisation");
  await page.getByLabel("wicare Simulationsmodus").selectOption("conflict");
  await page.getByRole("button", { name: "Outbox verarbeiten" }).click();
  await chooseRole(page, "u-nurse");
  await openFocus(page, "Patient");
  const conflict = page.locator("article.reconciliation");
  await expect(conflict.locator(".local-summary")).toHaveText(text);
  await expect(conflict.getByText(/synthetischer Parallelstand/)).toBeVisible();
  await conflict
    .getByRole("button", {
      name: "Beide Inhalte geprüft · lokalen Stand neu senden",
    })
    .click();
  await expect(page.getByText(/Inhalts- und Versionsvergleich/)).toBeVisible();
});

test("role session epoch blocks stale mutation notices and patient leakage", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "role race runs once");
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const seen = new Promise<void>((resolve) => (started = resolve));
  await page.route("**/api/v1/tasks/t-bp-anna/accept", async (route) => {
    started();
    await gate;
    await route.continue();
  });
  const task = page
    .locator("article.task-card")
    .filter({ hasText: "Blutdruck kontrollieren" });
  await task.getByRole("button", { name: "Annehmen" }).click();
  await seen;
  await chooseRole(page, "u-hr");
  await expect(page.getByText("Getrennte HR-Grenze")).toBeVisible();
  release();
  await page.waitForResponse((response) =>
    response.url().includes("t-bp-anna/accept"),
  );
  await expect(page.getByText("Aufgabe angenommen.")).toHaveCount(0);
  await expect(page.getByText("Anna Beispiel")).toHaveCount(0);
});

test("patient switching archives stale drafts and locks in-flight work", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "context safety runs once");
  await chooseRole(page, "u-nurse");
  await openFocus(page, "Patient");
  const text =
    "Bin mit Anna fertig. Blutdruck 151 zu 88, etwas Schwindel. Arzt informieren und Kontrolle in 30 Minuten.";
  await page.getByLabel("Nachricht an Pflegehelfer").fill(text);
  await page.getByRole("button", { name: "Nachricht senden" }).click();
  await page
    .getByRole("button", { name: "Änderungen gemeinsam prüfen" })
    .click();
  await expect(page.getByLabel("Assistenzvorschlag prüfen")).toBeVisible();
  await choosePatient(page, "p-luca");
  await expect(page.getByLabel("Assistenzvorschlag prüfen")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Änderungen gemeinsam prüfen" }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      /frühere Vorschlag wurde beim Kontextwechsel sicher geschlossen/,
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Nachricht an Pflegehelfer")).toHaveValue("");
  await expect(
    page.locator(".user-message").filter({ hasText: text }),
  ).toBeVisible();
  await expect(
    page.getByText(/Patientenkontext bewusst gewählt · 207 · Luca Demo/),
  ).toBeVisible();
  await choosePatient(page, "p-anna");
  await expect(
    page.locator(".user-message").filter({ hasText: text }),
  ).toBeVisible();
  await expect(page.getByLabel("Assistenzvorschlag prüfen")).toHaveCount(0);

  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const seen = new Promise<void>((resolve) => {
    started = resolve;
  });
  let requestedPatient: string | null = null;
  await page.route("**/api/v1/assistant/query", async (route) => {
    requestedPatient = (route.request().postDataJSON() as { patientId: string })
      .patientId;
    started();
    await gate;
    await route.continue().catch(() => undefined);
  });
  await page.getByLabel("Nachricht an Pflegehelfer").fill("Patientenprofil");
  await page.getByRole("button", { name: "Nachricht senden" }).click();
  await seen;
  expect(requestedPatient).toBe("p-anna");
  const lucaControl = page.getByRole("button", { name: /207 Luca Demo/ });
  await expect(lucaControl).toBeDisabled();
  release();
  await expect(
    page.locator(".user-message").filter({ hasText: "Patientenprofil" }),
  ).toBeVisible();
  await expect(lucaControl).toBeEnabled();
  await choosePatient(page, "p-luca");
  await expect(
    page.locator(".user-message").filter({ hasText: "Patientenprofil" }),
  ).toBeVisible();
});

test("local voice lifecycle stops tracks and never uploads after patient change", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "voice lifecycle runs once");
  let transcriptionRequests = 0;
  await page.route("**/api/v1/ai/status", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        asr: { mode: "local-openai", ready: true, message: "Lokaler Test-ASR" },
      }),
    }),
  );
  await page.route("**/api/v1/assistant/transcribe**", (route) => {
    transcriptionRequests += 1;
    return route.abort();
  });
  await page.addInitScript(() => {
    const state = { trackStops: 0 };
    Object.assign(window, { __voiceState: state });
    const stream = {
      getTracks: () => [
        {
          stop: () => {
            state.trackStops += 1;
          },
        },
      ],
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: () => Promise.resolve(stream) },
    });
    class FakeMediaRecorder {
      state = "inactive";
      mimeType = "audio/webm";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        queueMicrotask(() => this.onstop?.());
      }
    }
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: FakeMediaRecorder,
    });
  });
  await page.reload();
  await openFocus(page, "Patient");
  await page.getByRole("button", { name: "Sprachnachricht aufnehmen" }).click();
  await expect(
    page.getByRole("button", { name: "Aufnahme stoppen" }),
  ).toBeVisible();
  await choosePatient(page, "p-luca");
  await page.waitForTimeout(100);
  expect(transcriptionRequests).toBe(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __voiceState: { trackStops: number } })
          .__voiceState.trackStops,
    ),
  ).toBeGreaterThan(0);
});

test("installed production PWA boots only its safe shell offline", async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "service worker runs once");
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4173",
    serviceWorkers: "allow",
  });
  try {
    const page = await context.newPage();
    await page.goto("/");
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (navigator.serviceWorker.controller) return;
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => resolve(),
          { once: true },
        ),
      );
    });
    expect(await page.evaluate(() => caches.has("pflegehelfer-shell-v2"))).toBe(
      true,
    );
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByText("Sicherer Offline-/Fehlerzustand"),
    ).toBeVisible();
    await expect(
      page.getByText("Es werden keine klinischen Daten angezeigt."),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
