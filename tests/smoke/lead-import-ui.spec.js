import { expect, test } from "@playwright/test";

test.describe("Lead import workflow", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.sessionStorage.setItem("joyno_local_qa_session_v1", "active");
    });
  });

  test("separates new-lead and exported-lead update modes", async ({ page }) => {
    await page.goto("/#/leads", { waitUntil: "domcontentloaded" });
    const importButton = page.locator('[data-action="lead-import-open"]');
    await expect(importButton).toBeVisible();
    await importButton.click();

    await expect(page.getByRole("button", { name: /Add new leads/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Update exported leads/i })).toBeVisible();

    await page.locator("[data-lead-import-file]").setInputFiles({
      name: "joynosync-export.csv",
      mimeType: "text/csv",
      buffer: Buffer.from([
        "Lead ID,Updated At,Lead Name,Email,Status",
        "00000000-0000-4000-8000-000000000001,2026-08-03T00:00:00.000Z,Example Lead,example@example.com,"
      ].join("\n"))
    });

    await expect(page.getByText(/Review fields/i)).toBeVisible();
    await expect(page.getByText("Lead ID", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/matching/i).first()).toBeVisible();
    await expect(page.getByText(/Blank fields preserve current values/i)).toBeVisible();
    await expect(page.getByLabel(/Reset blank Status values to New/i)).toBeVisible();
  });

  test("manual lead creation requires a contact identifier", async ({ page }) => {
    await page.goto("/#/leads", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /New Lead/i }).click();
    await page.locator('input[name="name"]').fill("No Contact Lead");
    await page.getByRole("button", { name: "Create lead", exact: true }).click();
    await expect(page.getByText("Add at least an email or phone.", { exact: true })).toBeVisible();
  });
});
