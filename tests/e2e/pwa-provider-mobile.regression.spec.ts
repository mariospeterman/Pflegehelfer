import { expect, test } from "@playwright/test";

test.beforeEach(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-390", "mobile UI probe");
  await request.post("/api/v1/demo/reset", {
    headers: {
      "x-demo-user": "u-it",
      "x-command-id": crypto.randomUUID(),
    },
  });
});

test("keeps compact patient tabs legible instead of compressing their labels", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Kontext und Verlauf öffnen" })
    .click();
  await page
    .locator(".patient-context-list button")
    .filter({ hasText: "Anna Beispiel" })
    .click();

  const tabs = page.locator(".patient-workspace-tabs");
  await expect(tabs).toBeVisible();
  expect(
    await tabs
      .locator("button")
      .evaluateAll((buttons) =>
        buttons.every((button) => getComputedStyle(button).flexShrink === "0"),
      ),
  ).toBe(true);
  expect(
    await tabs.evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(true);
});

test("renders authorized provider health as a usable view instead of raw JSON", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Kontext und Verlauf öffnen" })
    .click();
  await page.getByLabel("Demo-Rolle").selectOption("u-nurse");
  await page
    .getByRole("button", { name: "Kontext und Verlauf öffnen" })
    .click();
  await page
    .getByRole("button", { name: "Anbieter Arbeitsbereich öffnen" })
    .click();

  await expect(page.getByLabel("Anbieterdiagnostik")).toBeVisible();
  await expect(page.locator(".provider-list article")).toHaveCount(5);
  await expect(page.getByLabel("Anbieterdiagnostik")).toContainText(
    "SIMULATED",
  );
  await expect(page.getByLabel("Anbieterdiagnostik")).toContainText("WiCare");
  await expect(page.locator(".provider-workspace pre")).toHaveCount(0);
});
