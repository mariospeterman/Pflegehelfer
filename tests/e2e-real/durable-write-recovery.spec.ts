import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { MedplumClient } from "@medplum/core";
import { expect, test, type Page } from "@playwright/test";
import type { DocumentReference, Resource } from "@medplum/fhirtypes";
import pg from "pg";

const execFileAsync = promisify(execFile);
const { Pool } = pg;

async function eventually<T>(
  read: () => Promise<T | null>,
  timeoutMs = 40_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value !== null) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Timed out waiting for real-stack evidence${lastError instanceof Error ? `: ${lastError.message}` : ""}`,
  );
}

async function login(page: Page): Promise<void> {
  await page.goto("/api/v1/auth/login?returnTo=%2F");
  await expect(
    page.getByRole("heading", { name: "Synthetischer Test-Login" }),
  ).toBeVisible();
  await page.locator('select[name="login_hint"]').selectOption("nora.nurse");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByLabel("Pflegehelfer Gespräch")).toBeVisible();
}

async function chooseAnna(page: Page): Promise<void> {
  const drawer = page.locator("aside.context-panel");
  if (!(await drawer.isVisible()))
    await page
      .getByRole("button", { name: "Kontext und Verlauf öffnen" })
      .click();
  await page
    .locator(".patient-context-list button")
    .filter({ hasText: "Anna Beispiel" })
    .click();
  await expect(page.getByLabel("Aktiver Patientenkontext")).toContainText(
    "Anna Beispiel",
  );
}

test("recovers one durable write after the acceptance response is lost and the API restarts", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "real-stack-write",
    "destructive recovery journey runs exactly once in its isolated namespace",
  );
  const databaseUrl = process.env.PFH_OPERATIONAL_DATABASE_URL;
  const composeProject = process.env.PFH_COMPOSE_PROJECT;
  const fhirBaseUrl = process.env.PFH_FHIR_BASE_URL;
  const medplumClientId =
    process.env.MEDPLUM_CLIENT_ID ??
    process.env.MEDPLUM_DEFAULT_SUPER_ADMIN_CLIENT_ID;
  const medplumClientSecret =
    process.env.MEDPLUM_CLIENT_SECRET ??
    process.env.MEDPLUM_DEFAULT_SUPER_ADMIN_CLIENT_SECRET;
  const providerBaseUrl = process.env.PFH_PROVIDER_SIMULATOR_BASE_URL;
  const providerToken = process.env.PFH_PROVIDER_SIMULATOR_TOKEN;
  expect(databaseUrl).toBeTruthy();
  expect(composeProject).toMatch(/^pfh-e2e-/);
  expect(fhirBaseUrl).toBeTruthy();
  expect(medplumClientId).toBeTruthy();
  expect(medplumClientSecret).toBeTruthy();
  expect(providerBaseUrl).toBeTruthy();
  expect(providerToken).toBeTruthy();

  const database = new Pool({
    connectionString: databaseUrl,
    max: 1,
    query_timeout: 10_000,
    statement_timeout: 10_000,
  });
  try {
    await login(page);
    await chooseAnna(page);
    const composer = page.getByLabel("Nachricht an Pflegehelfer");
    await composer.fill(
      "Notiz: Mobilisation mit Rollator sicher durchgeführt.",
    );
    await page.getByRole("button", { name: "Nachricht senden" }).click();
    const draft = page.locator(".assistant-draft");
    await expect(draft).toBeVisible();
    await expect(draft).toContainText(/Mobilisation|Rollator/i);

    let commandId: string | null = null;
    let serverExecuted = false;
    await page.route(
      "**/api/v1/assistant/intents/*/execute",
      async (route) => {
        commandId = route.request().headers()["x-command-id"] ?? null;
        const executed = await route.fetch();
        serverExecuted = executed.ok();
        await executed.body();
        await route.abort("failed");
      },
      { times: 1 },
    );
    await draft.getByRole("button", { name: "Auswahl bestätigen" }).click();
    await expect.poll(() => serverExecuted).toBe(true);
    expect(commandId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    const accepted = await eventually(async () => {
      const result = await database.query<{
        id: string;
        patient_id: string;
        encounter_id: string;
        state: string;
        source_read_set: unknown;
      }>(
        `SELECT id::text,patient_id,encounter_id,state,source_read_set
           FROM accepted_commands
          WHERE command_key LIKE $1
          ORDER BY accepted_at DESC LIMIT 1`,
        [`%:${commandId}`],
      );
      return result.rows[0] ?? null;
    });
    expect(accepted.patient_id).toBe("p-anna");
    expect(accepted.encounter_id).toBe("enc-anna");
    expect(accepted.source_read_set).toMatchObject({ schemaVersion: 1 });

    const delivered = await eventually(async () => {
      const result = await database.query<{
        accepted_state: string;
        clinical_state: string;
        clinical_payload: { resources?: Resource[] };
        provider_state: string;
        provider_id: string;
        external_reference: string | null;
        readback_hash: string | null;
      }>(
        `SELECT a.state AS accepted_state,c.state AS clinical_state,
                c.payload AS clinical_payload,p.state AS provider_state,
                p.provider_id,r.external_reference,r.readback_hash
           FROM accepted_commands a
           JOIN clinical_projection_outbox c
             ON c.organization_id=a.organization_id
            AND c.accepted_command_id=a.id
           JOIN provider_outbox p
             ON p.organization_id=a.organization_id
            AND p.accepted_command_id=a.id
           LEFT JOIN provider_receipts r
             ON r.organization_id=p.organization_id AND r.outbox_id=p.id
          WHERE a.id=$1`,
        [accepted.id],
      );
      const row = result.rows[0];
      return row?.accepted_state === "delivered" &&
        row.clinical_state === "delivered" &&
        row.provider_state === "delivered" &&
        row.external_reference &&
        row.readback_hash
        ? row
        : null;
    });
    expect(delivered.readback_hash).toMatch(/^[a-f0-9]{64}$/);

    const note = delivered.clinical_payload.resources?.find(
      (resource): resource is DocumentReference =>
        resource.resourceType === "DocumentReference" &&
        resource.subject?.reference?.includes("Patient/") === true,
    );
    expect(note?.id).toBeTruthy();
    const medplum = new MedplumClient({ baseUrl: fhirBaseUrl!, cacheTime: 0 });
    await medplum.startClientLogin(medplumClientId!, medplumClientSecret!);
    const persistedNote = await medplum.readResource(
      "DocumentReference",
      note!.id!,
    );
    expect(persistedNote.id).toBe(note!.id);
    expect(persistedNote.meta?.versionId).toBeTruthy();

    const providerStatus = await fetch(
      `${providerBaseUrl}/v1/providers/${encodeURIComponent(delivered.provider_id)}/commands/${encodeURIComponent(delivered.external_reference!)}`,
      { headers: { authorization: `Bearer ${providerToken}` } },
    );
    expect(providerStatus.ok).toBe(true);
    await expect(providerStatus.json()).resolves.toMatchObject({
      status: "acknowledged",
    });

    await execFileAsync(
      "docker",
      [
        "compose",
        "-p",
        composeProject!,
        "--env-file",
        ".env.demo",
        "restart",
        "pflegehelfer",
      ],
      { timeout: 90_000 },
    );
    await eventually(async () => {
      const response = await fetch(`${process.env.PFH_E2E_BASE_URL}/ready`);
      return response.ok ? true : null;
    });

    await page.reload();
    await expect(page.getByLabel("Pflegehelfer Gespräch")).toBeVisible();
    await expect(page.getByText("Ausgeführt", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Auswahl bestätigen" }),
    ).toHaveCount(0);
    const uniqueness = await database.query<{
      accepted_count: string;
      provider_effect_count: string;
      live_authority_count: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM accepted_commands WHERE id=$1)
           AS accepted_count,
         (SELECT count(*)::text FROM provider_outbox WHERE accepted_command_id=$1)
           AS provider_effect_count,
         (SELECT count(*)::text
            FROM safety_authority authority
            JOIN accepted_commands accepted
              ON accepted.organization_id=authority.organization_id
             AND accepted.proposal_revision_id=authority.proposal_revision_id
           WHERE accepted.id=$1 AND authority.consumed_at IS NULL)
           AS live_authority_count`,
      [accepted.id],
    );
    expect(uniqueness.rows[0]).toEqual({
      accepted_count: "1",
      provider_effect_count: "1",
      live_authority_count: "0",
    });
  } finally {
    await database.end();
  }
});
