import { expect, test, type Page } from "@playwright/test";

// Regression: ISSUE-001 — corrected drafts left every older approval active
// Found by /qa on 2026-09-13
// Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-09-13.md

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

async function ask(page: Page, prompt: string) {
  await page.getByLabel("Nachricht an Pflegehelfer").fill(prompt);
  await page.getByRole("button", { name: "Nachricht senden" }).click();
  await expect(page.getByLabel("Nachricht an Pflegehelfer")).toBeEnabled({
    timeout: 20_000,
  });
}

test("only the latest corrected selection can be approved", async ({
  page,
}) => {
  const drawerButton = page.getByRole("button", {
    name: "Kontext und Verlauf öffnen",
  });
  if (await drawerButton.isVisible()) await drawerButton.click();
  await page
    .locator(".patient-context-list button")
    .filter({ hasText: "Luca Demo" })
    .click();

  await ask(page, "Luca mobilisiert, etwa 200 ml getrunken. Gewicht später.");
  await ask(page, "Korrektur: eher 150 ml. Nora informieren, nicht den Arzt.");
  await ask(page, "Nur Dokumentation und Nachricht, noch nichts abschliessen.");

  await expect(
    page.getByRole("button", { name: "Auswahl bestätigen" }),
  ).toHaveCount(1);
  await expect(
    page.getByText(
      "Korrektur übernommen. Diese frühere Auswahl ist nicht mehr gültig.",
    ),
  ).toHaveCount(2);

  await page.reload();
  await expect(page.getByLabel("Nachricht an Pflegehelfer")).toBeEnabled({
    timeout: 20_000,
  });
  await expect(
    page.getByRole("button", { name: "Auswahl bestätigen" }),
  ).toHaveCount(1);
  await expect(
    page.getByText("nach Aktualisierung erneut autorisiert"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Auswahl bestätigen" }).click();
  await expect(
    page.getByRole("button", { name: "Auswahl bestätigen" }),
  ).toHaveCount(0);
  await expect(page.getByText("Ausgeführt", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Nachricht an Pflegehelfer")).toBeEnabled({
    timeout: 20_000,
  });
  await expect(
    page.getByRole("button", { name: "Auswahl bestätigen" }),
  ).toHaveCount(0);
  await expect(page.getByText("Ausgeführt", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "Korrektur übernommen. Diese frühere Auswahl ist nicht mehr gültig.",
    ),
  ).toHaveCount(2);
});
