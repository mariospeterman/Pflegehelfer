import { expect, test } from "@playwright/test";

test("serves the exact API and PWA source identity", async ({ page }) => {
  const expectedSha = process.env.PFH_BUILD_SHA?.trim().toLowerCase();
  expect(expectedSha).toMatch(/^[0-9a-f]{40,64}$/);

  const response = await page.goto("/api/v1/build-info");
  expect(response?.ok()).toBe(true);
  const build = (await response!.json()) as {
    api: { sourceSha: string | null; buildId: string; dirty: boolean };
    pwa: { sourceSha: string | null; buildId: string; dirty: boolean };
    matchingSource: boolean | null;
  };
  expect(build).toMatchObject({
    api: { sourceSha: expectedSha, dirty: false },
    pwa: { sourceSha: expectedSha, dirty: false },
    matchingSource: true,
  });
  expect(build.api.buildId).toBe(`pfh-${expectedSha!.slice(0, 12)}`);
  expect(build.pwa.buildId).toBe(build.api.buildId);
});
