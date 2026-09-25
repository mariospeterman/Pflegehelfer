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

test("general workday action opens the complete handover and starts the day only after every patient is checked", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Übergabe", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Übergabe patientenweise übernehmen" }),
  ).toBeVisible();
  await expect(page.getByText("0/8 Patientenkontexte geprüft")).toBeVisible();
  await expect(page.locator(".user-message")).toHaveCount(0);

  const patients = [
    "Anna Beispiel",
    "Luca Demo",
    "Ruth Fiktiv",
    "Peter Beispiel",
    "Sofia Muster",
    "Emil Demo",
    "Mei Muster",
    "Jonas Fiktiv",
  ];
  await expect(
    page.getByRole("button", { name: /Gelesen und übernehmen:/ }),
  ).toHaveCount(patients.length);
  for (const [index, patient] of patients.entries()) {
    await page
      .getByRole("button", {
        name: new RegExp(`Gelesen und übernehmen:.*${patient}`),
      })
      .click();
    if (index < patients.length - 1)
      await expect(
        page.getByRole("button", {
          name: new RegExp(`Übergabe geprüft:.*${patient}`),
        }),
      ).toBeVisible();
  }

  await expect(
    page.getByRole("heading", { name: "Dein sicherer Arbeitsplan" }),
  ).toBeVisible();
  await expect(page.getByText("8/8 Patientenkontexte geprüft")).toBeVisible();
  await expect(
    page.getByText(
      /Übergabe vollständig geprüft. Dein Arbeitstag ist gestartet/,
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Arbeit beginnen:/ }),
  ).toHaveCount(8);
});

test("synthetic reset restores populated Library, Projects and Team fixtures", async ({
  page,
}) => {
  await openDestination(page, "Bibliothek");
  await expect(
    page.getByText("Fruehdienst-Checkliste-SYNTHETISCHE-DEMO.txt"),
  ).toBeVisible();

  await openDestination(page, "Projekte");
  await expect(page.getByText("Morgenmobilisation koordinieren")).toBeVisible();
  await expect(
    page.getByText(/3 Mitglied\(er\) · 1 Verknüpfung\(en\) · Version 1/),
  ).toBeVisible();

  await openDestination(page, "Team & @Fragen");
  await expect(
    page.getByText(/Frühdienst ist vollständig besetzt/),
  ).toBeVisible();
  await expect(page.getByText("@Lea Bernasconi")).toBeVisible();
});
