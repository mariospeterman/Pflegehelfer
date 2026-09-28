import { expect, test } from "@playwright/test";

// Regression: ISSUE-004 — one vital point expanded into an empty full-width chart
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

test("a single vital uses the compact table without a fake trend", async ({
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
  await page
    .getByLabel("Nachricht an Pflegehelfer")
    .fill("Zeige mir die letzten Vitalwerte.");
  await page.getByRole("button", { name: "Nachricht senden" }).click();

  const card = page.locator(".vital-trend-card").last();
  await expect(card).toContainText("37.4 °C", { timeout: 20_000 });
  await expect(card.locator(".vital-chart")).toHaveCount(0);
  await expect(card.locator("tbody tr")).toHaveCount(1);
  expect((await card.boundingBox())?.height).toBeLessThan(320);
});
