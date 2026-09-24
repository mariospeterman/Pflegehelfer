import { expect, test } from "@playwright/test";

test("binds one browser context during a concurrent startup load", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "startup race runs once");

  await request.post("/api/v1/demo/reset", {
    headers: {
      "x-demo-user": "u-it",
      "x-command-id": crypto.randomUUID(),
    },
  });

  let contextBindings = 0;
  await page.route("**/api/v1/assistant/context", async (route) => {
    contextBindings += 1;
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.continue();
  });

  await page.goto("/");
  await expect(page.getByLabel("Pflegehelfer Gespräch")).toBeVisible();
  await expect.poll(() => contextBindings).toBe(1);
});
