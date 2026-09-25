import { expect, test } from "@playwright/test";

// Regression: ISSUE-002 — the fixed composer covered the clinical approval
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

test("the current approval remains above the fixed composer", async ({
  page,
}) => {
  const drawerButton = page.getByRole("button", {
    name: "Kontext und Verlauf öffnen",
  });
  if (await drawerButton.isVisible()) await drawerButton.click();
  await page
    .locator(".patient-context-list button")
    .filter({ hasText: "Anna Beispiel" })
    .click();

  await page
    .getByLabel("Nachricht an Pflegehelfer")
    .fill(
      "Mobilisiert, Blutdruck 151 zu 88, Nora informieren und Kontrolle in 30 Minuten dokumentieren.",
    );
  await page.getByRole("button", { name: "Nachricht senden" }).click();

  const approval = page.getByRole("button", { name: "Auswahl bestätigen" });
  await expect(approval).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(async () => {
      const approvalBox = await approval.boundingBox();
      const promptBox = await page
        .locator(".clinical-composer-wrap")
        .boundingBox();
      if (!approvalBox || !promptBox) return false;
      return approvalBox.y + approvalBox.height <= promptBox.y;
    })
    .toBe(true);
});
