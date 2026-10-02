import { expect, test } from "@playwright/test";

test.describe("Lead import workflow", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.sessionStorage.setItem("joyno_local_qa_session_v1", "active");
    });
  });

  test("separates new-lead and exported-lead update modes", async ({ page }) => {
    await page.goto("/#/leads", { waitUntil: "domcontentloaded" });
    const importButton = page.getByRole("button", { name: "Import", exact: true });
    await expect(importButton).toBeVisible();
    await importButton.click();

    await expect(page.getByRole("button", { name: /Add new leads/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Update exported leads/i })).toBeVisible();
    await page.getByRole("button", { name: /Add new leads/i }).click();

    await page.locator("[data-lead-import-file]").setInputFiles({
      name: "joynosync-export.csv",
      mimeType: "text/csv",
      buffer: Buffer.from([
        "Lead ID,Updated At,Lead Name,Email,Status",
        "00000000-0000-4000-8000-000000000001,2026-08-03T00:00:00.000Z,Example Lead,example@example.com,"
      ].join("\n"))
    });

    await expect(page.getByRole("heading", { name: "Import exported leads" })).toBeVisible();
    await expect(page.getByText(/UPDATE BY LEAD ID/i)).toBeVisible();
    await expect(page.getByText("Preserve existing values", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /Column mapping/i }).click();
    await expect(page.getByRole("heading", { name: "Column mapping", exact: true })).toBeVisible();
    const firstMappingPicker = page.getByRole("button", { name: /Map Lead ID\. Currently/i });
    await expect(firstMappingPicker).toBeVisible();
    await firstMappingPicker.click();
    await expect(page.getByRole("listbox", { name: "Source column for Lead ID" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Back to review", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back to review", exact: true }).click();

    await page.locator(".lead-import-notion-behavior-row").filter({ hasText: "Status handling" }).locator("summary").click();
    await expect(page.getByLabel(/Use file Status/i)).toBeChecked();
    await page.getByLabel(/Set every lead to New/i).check();
    await expect(page.getByText("Set every lead to New · 0/3", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Continue to confirm", exact: true }).click();
    await expect(page.getByText("Confirm import", { exact: true })).toBeVisible();
    await expect(page.getByText("Existing leads updated", { exact: true })).toBeVisible();
    await expect(page.getByText("Existing leads reassigned", { exact: true })).toBeVisible();
    await expect(page.getByText("Keep current owners", { exact: true })).toBeVisible();
    await expect(page.getByRole("radio", { name: /Auto-distribute/i })).toBeChecked();
  });

  test("manual lead creation requires a contact identifier", async ({ page }) => {
    await page.goto("/#/leads", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /New Lead/i }).click();
    await page.locator('input[name="name"]').fill("No Contact Lead");
    await page.getByRole("button", { name: "Create lead", exact: true }).click();
    await expect(page.getByText("Add at least an email or phone.", { exact: true })).toBeVisible();
  });

  test("warnings open as a focused review subview", async ({ page }) => {
    await page.goto("/#/leads", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page.locator("[data-lead-import-file]").setInputFiles({
      name: "review-warning.csv",
      mimeType: "text/csv",
      buffer: Buffer.from([
        "Lead Name,Email,Phone,Status",
        "Needs Review,review@example.com,+14155550112,Impossible stage"
      ].join("\n"))
    });

    await expect(page.getByText("1 Need attention", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^Warnings /i }).click();
    await expect(page.getByRole("heading", { name: "Warnings", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Back to review", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Export issues", exact: true })).toBeVisible();
  });

  test("new-lead assignment uses the compact eligible teammate picker", async ({ page }) => {
    await page.goto("/#/leads", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page.locator("[data-lead-import-file]").setInputFiles({
      name: "new-leads.csv",
      mimeType: "text/csv",
      buffer: Buffer.from([
        "Lead Name,Email,Phone",
        "New Example,new@example.com,+14155550111"
      ].join("\n"))
    });

    await page.getByRole("button", { name: "Continue to confirm", exact: true }).click();
    await expect(page.getByText(/teammates? selected/i)).toBeVisible();
    await expect(page.getByText(/ready lead.*round-robin across the selection/i)).toBeVisible();

    await page.getByRole("button", { name: /teammates? selected\. Change teammates/i }).click();
    await expect(page.getByPlaceholder("Search teammates...")).toBeVisible();
    await expect(page.getByRole("button", { name: "Select all", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Clear", exact: true })).toBeVisible();
    await expect(page.getByText("Only active, non-IT teammates are eligible for lead assignment.", { exact: true })).toBeVisible();
    const selectedCard = page.locator(".lead-import-assignee-card.is-selected").first();
    await expect(selectedCard.locator(".lead-import-assignee-check")).toBeVisible();
    await expect(selectedCard.locator(".lead-import-assignee-input")).toHaveCSS("opacity", "0");
  });

  test("processing and completion use the flat Notion status layout", async ({ page }) => {
    await page.goto("/#/leads", { waitUntil: "domcontentloaded" });
    await page.evaluate(async () => {
      const { renderLeadImportProcessingView, renderLeadImportDoneView } = await import("/src/modules/lead-import-status-view.js");
      const overlay = document.getElementById("modalOverlay");
      const card = overlay?.querySelector(".modal-card");
      const title = document.getElementById("modalTitle");
      const form = document.getElementById("modalForm");
      if (!overlay || !card || !title || !form) return;
      overlay.hidden = false;
      card.className = "modal-card is-lead-import";
      card.dataset.importStep = "processing";
      title.innerHTML = "<span>Import exported leads</span><small>Your import continues safely in the background.</small>";
      form.dataset.mode = "lead-import";
      form.innerHTML = renderLeadImportProcessingView({
        status: "processing",
        title: "Importing in background",
        subtitle: "The worker is saving rows to CRM.",
        label: "Processing",
        fileName: "leads.xlsx",
        rowCount: 4,
        processedCount: 2,
        progressPercent: 50,
        createdCount: 0,
        updatedCount: 2,
        skippedCount: 0,
        assignedCount: 2,
        leftUnassignedCount: 0
      });
    });

    await expect(page.getByText("2 of 4 rows processed", { exact: true })).toBeVisible();
    await expect(page.locator(".lead-import-progress-card")).toHaveCount(0);
    await expect(page.locator(".lead-import-notion-metrics")).toBeVisible();

    await page.evaluate(async () => {
      const { renderLeadImportDoneView } = await import("/src/modules/lead-import-status-view.js");
      const { renderLeadImportResultSummary } = await import("/src/modules/lead-import-results.js");
      const card = document.querySelector(".modal-card.is-lead-import");
      const form = document.getElementById("modalForm");
      if (!card || !form) return;
      card.dataset.importStep = "done";
      form.innerHTML = renderLeadImportDoneView({
        fileName: "leads.xlsx",
        summary: { total: 4, created: 0, updated: 4, assigned: 4, skipped: 0, leftUnassigned: 0 },
        resultSummaryHtml: renderLeadImportResultSummary([
          { rowNumber: 2, operation: "updated", leadName: "Elizabeth Stillwagon", ownerName: "Brandon Cole", assigned: true },
          { rowNumber: 3, operation: "updated", leadName: "Robert Smith III", ownerName: "John Lee", assigned: true },
          { rowNumber: 4, operation: "updated", leadName: "Don Schroeder", ownerName: "Sophie Miller", assigned: true },
          { rowNumber: 5, operation: "updated", leadName: "O. M. Sterling", ownerName: "Vanessa Parker", assigned: true }
        ])
      });
    });

    await expect(page.getByText("4 leads were changed across 4 reviewed rows.", { exact: true })).toBeVisible();
    await expect(page.locator(".lead-import-complete-icon")).toBeVisible();
    await expect(page.getByText("Elizabeth Stillwagon", { exact: true })).toBeVisible();
  });
});
