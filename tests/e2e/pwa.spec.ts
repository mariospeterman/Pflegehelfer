import { expect, test, type Page } from "@playwright/test";

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

async function openDrawer(page: Page) {
  const button = page.getByRole("button", {
    name: "Kontext und Verlauf öffnen",
  });
  if (await button.isVisible()) await button.click();
}

async function choosePatient(page: Page, name = "Anna Beispiel") {
  await openDrawer(page);
  await page
    .locator(".patient-context-list button")
    .filter({ hasText: name })
    .click();
  await expect(page.getByLabel("Aktiver Patientenkontext")).toContainText(name);
}

async function ask(page: Page, prompt: string) {
  const composer = page.getByLabel("Nachricht an Pflegehelfer");
  await composer.fill(prompt);
  await page.getByRole("button", { name: "Nachricht senden" }).click();
}

test("is one responsive conversation with drawer context and no module dashboard", async ({
  page,
}, testInfo) => {
  await expect(
    page.locator(".header-identity strong").getByText("Pflegehelfer"),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Übergabe patientenweise übernehmen" }),
  ).toBeVisible();
  await expect(
    page.getByText("Alle Personen und klinischen Daten sind frei erfunden."),
  ).toBeAttached();
  await expect(page.getByText("Kein Patient aktiv")).toBeVisible();
  await expect(page.locator('[data-nav="today"]')).toHaveCount(0);
  await expect(page.getByText("Meine Schicht", { exact: true })).toHaveCount(0);
  await expect(page.locator(".mobile-context-tabs")).toHaveCount(0);

  await choosePatient(page);
  await expect(page.getByLabel("Aktiver Patientenkontext")).toContainText(
    "18.03.1941",
  );
  await expect(page.getByLabel("Aktiver Patientenkontext")).toContainText(
    "Penicillin",
  );
  expect(
    await page
      .locator("html")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);

  if (["mobile-360", "mobile-390", "tablet"].includes(testInfo.project.name)) {
    await expect(page.locator(".context-panel")).toBeHidden();
    await openDrawer(page);
    await expect(page.locator(".context-panel")).toBeVisible();
    const targets = await page
      .locator(
        ".context-panel button:visible, .assistant-composer button:visible",
      )
      .evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().height),
      );
    expect(targets.length).toBeGreaterThan(2);
    for (const height of targets) expect(height).toBeGreaterThanOrEqual(44);
  }
});

test("streams source-linked GenUI and restores the same thread and patient after refresh", async ({
  page,
}) => {
  await choosePatient(page);
  const stream = page.waitForResponse((response) =>
    response.url().includes("/api/v1/assistant/query/stream"),
  );
  await ask(page, "Letzte Vitalwerte");
  const response = await stream;
  expect(response.headers()["content-type"]).toContain("application/x-ndjson");
  await expect(page.locator(".vital-trend-card").first()).toBeVisible();
  await expect(page.locator(".assistant-evidence code").first()).toBeAttached();
  await page.reload();
  await expect(page.getByLabel("Aktiver Patientenkontext")).toContainText(
    "Anna Beispiel",
  );
  await expect(page.locator(".vital-trend-card").first()).toBeVisible();
});

test("one bedside sentence yields granular review and explicit execution", async ({
  page,
}) => {
  await choosePatient(page);
  await ask(
    page,
    "Mobilisiert, Blutdruck 151 zu 88, Arzt in 10 Minuten informieren und Kontrolle in 30 Minuten dokumentieren.",
  );
  const draft = page.locator(".assistant-draft");
  await expect(draft).toBeVisible();
  await expect(draft.locator("input[type=checkbox]")).toHaveCount(4);
  await expect(draft).toContainText("Anna Beispiel");
  await expect(draft).toContainText("151/88 mmHg");
  await draft.getByRole("button", { name: "Auswahl bestätigen" }).click();
  await expect(page.getByText("Ausgeführt", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      /klinische Entwürfe angelegt und warten auf die normale Freigabe/i,
    ),
  ).toBeVisible();
});

test("patient switch closes executable proposals and keeps a visible context event", async ({
  page,
}) => {
  await choosePatient(page);
  await ask(page, "Notiz: Mobilisation mit Rollator sicher durchgeführt.");
  await expect(page.locator(".assistant-draft")).toBeVisible();
  await openDrawer(page);
  await page
    .locator(".patient-context-list button")
    .filter({ hasText: "Luca Demo" })
    .click();
  await expect(page.getByLabel("Aktiver Patientenkontext")).toContainText(
    "Luca Demo",
  );
  await expect(
    page.getByText(/Patientenkontext bewusst gewählt.*Luca Demo/),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Die frühere offene Änderung wurde beim Kontextwechsel sicher geschlossen.",
    ),
  ).toBeVisible();
});

test("physician role starts its own coworker journey without a nursing dashboard", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "role journey runs once");
  await page.locator(".role-switcher select").selectOption("u-physician");
  await expect(
    page.getByText("Guten Morgen — Fragen und Visitenpunkte sind gebündelt."),
  ).toBeVisible();
  await expect(
    page.getByText("Anfragen → Evidenz → Entscheidung → Rückmeldung"),
  ).toBeVisible();
  await expect(page.getByText("Meine Schicht", { exact: true })).toHaveCount(0);
});

test("offline state is explicit and blocks chat submission", async ({
  page,
  context,
}) => {
  await choosePatient(page);
  await page.getByLabel("Nachricht an Pflegehelfer").fill("Letzte Vitalwerte");
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByText("Offline", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Nachricht senden" }),
  ).toBeDisabled();
  await context.setOffline(false);
});

test("keyboard focus and accessible landmarks remain usable", async ({
  page,
}) => {
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).not.toHaveJSProperty("tagName", "BODY");
  await expect(page.getByRole("main")).toHaveCount(1);
  const menu = page.getByRole("button", {
    name: "Kontext und Verlauf öffnen",
  });
  if (await menu.isVisible()) {
    await menu.focus();
    await page.keyboard.press("Enter");
  }
  await expect(
    page.getByRole("navigation", { name: "Arbeitskontext" }),
  ).toBeVisible();
  await expect(page.getByLabel("Sprachnachricht aufnehmen")).toHaveAttribute(
    "type",
    "button",
  );
});
