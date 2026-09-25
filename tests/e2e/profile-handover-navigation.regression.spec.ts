import { expect, test } from "@playwright/test";

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

test("compact subject picker and profile return paths preserve the conversation", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: /Aktiver Kontext: Mein Assistent/ })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Arbeitskontext wählen" }),
  ).toBeVisible();
  await expect(page.locator("aside.context-panel")).toHaveCount(0);

  await page
    .locator(".scope-picker-list button")
    .filter({ hasText: "Anna Beispiel" })
    .click();
  await expect(page.getByLabel("Aktiver Patientenkontext")).toContainText(
    "Anna Beispiel",
  );

  await page
    .getByRole("button", {
      name: "Vollständiges Profil von Anna Beispiel öffnen",
    })
    .click();
  const patientProfile = page.locator(".patient-profile-card");
  await expect(patientProfile).toContainText("Diagnosen / Behandlungsanlass");
  await expect(patientProfile).toContainText("Aktuelle Pflegeziele");
  await expect(patientProfile).toContainText("Medikationskontext");
  await expect(patientProfile).toContainText("WiCare");
  await patientProfile
    .getByRole("button", { name: "Zurück zum Gespräch" })
    .click();
  await expect(page.getByLabel("Nachricht an Pflegehelfer")).toBeVisible();

  await page
    .getByRole("button", { name: /Eigenes Profil öffnen: Lea Bernasconi/ })
    .click();
  const ownProfile = page.locator(".own-profile-card");
  await expect(ownProfile).toContainText(
    "Assistentin Gesundheit und Soziales EBA",
  );
  await expect(ownProfile).toContainText("Zuständigkeiten");
  await ownProfile.getByRole("button", { name: "Zurück zum Gespräch" }).click();
  await expect(page.getByLabel("Nachricht an Pflegehelfer")).toBeVisible();
});

test("current workday exposes a realistic three-part handover", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Kontext und Verlauf öffnen" })
    .click();
  await page
    .getByRole("button", { name: "Aktuellen Arbeitstag öffnen" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Übergabe patientenweise übernehmen" }),
  ).toBeVisible();

  const anna = page
    .locator(".handover-row")
    .filter({ hasText: "Anna Beispiel" });
  const annaTrigger = anna.locator(".workday-patient");
  if ((await annaTrigger.getAttribute("aria-expanded")) !== "true")
    await annaTrigger.click();
  await expect(anna).toContainText("Wichtig zu wissen");
  await expect(anna).toContainText("Was in der letzten Schicht passiert ist");
  await expect(anna).toContainText("Wichtige nächste Schritte");
  await expect(anna).toContainText("Schwindel angegeben");
});

test("authorized staff directory opens a realistic service profile", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Kontext und Verlauf öffnen" })
    .click();
  await page
    .getByRole("button", { name: "Team & @Fragen Arbeitsbereich öffnen" })
    .click();
  const nora = page
    .locator(".staff-directory button")
    .filter({ hasText: "Nora Frei" });
  await nora.click();
  const profile = page.getByLabel("Mitarbeitendenprofil");
  await expect(profile).toContainText("Dipl. Pflegefachfrau HF");
  await expect(profile).toContainText("Schichtkoordination");
  await expect(profile).toContainText(
    "nora.frei@pflegezentrum.example.invalid",
  );
  await expect(profile).toContainText(
    "Keine privaten Chats, Präsenz- oder HR-Daten",
  );
});
