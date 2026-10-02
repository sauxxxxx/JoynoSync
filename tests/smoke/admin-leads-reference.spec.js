import { expect, test } from "@playwright/test";

test("admin Leads uses the reference workspace structure and functional presets", async ({ page }) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("joyno_local_qa_session_v1", "active");
  });
  await page.goto("/#/leads", { waitUntil: "domcontentloaded" });

  const adminView = page.locator(".crm-leads-list.is-admin-view");
  await expect(adminView).toBeVisible();
  await expect(page.locator(".sidebar")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator(".topbar")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator(".view-content")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator("#globalSearch")).toHaveAttribute(
    "placeholder",
    "Search leads by name, email, phone, interest..."
  );
  await expect(adminView.locator(".crm-lead-header-shell + .lead-admin-viewbar")).toBeVisible();
  await expect(adminView.getByRole("button", { name: "Assign owner" })).toBeVisible();
  await expect(adminView.getByRole("button", { name: "Today", exact: true })).toBeVisible();
  await expect(adminView.getByRole("button", { name: "Configure table" })).toBeVisible();
  await adminView.getByRole("button", { name: "Open filters" }).click();
  const leadFilterForm = page.locator("#leadFilterForm");
  await expect(leadFilterForm).toBeVisible();
  await expect(leadFilterForm.locator("select")).toHaveCount(0);
  await expect(leadFilterForm.locator("[data-lead-filter-dropdown]")).toHaveCount(5);
  const ownerDropdown = leadFilterForm.locator("[data-lead-filter-dropdown].is-owner");
  await ownerDropdown.locator("summary").click();
  await expect(ownerDropdown).toContainText("Nadia Stone");
  await expect(ownerDropdown).toContainText("Ken Li");
  await expect(ownerDropdown).not.toContainText("Joy N.");
  await expect(ownerDropdown).not.toContainText("Sven Muller");
  await ownerDropdown.locator("[data-lead-owner-filter-search]").fill("Ken");
  await expect(ownerDropdown.locator("[data-lead-filter-option]:visible")).toHaveCount(1);
  await ownerDropdown.locator("[data-lead-filter-option]:visible").click();
  await expect(ownerDropdown.locator("input[name='ownerFilter']")).toHaveValue("member_03");
  await leadFilterForm.getByRole("button", { name: "Close" }).click();
  await adminView.getByRole("button", { name: "Assign owner" }).click();
  await expect(page.getByRole("heading", { name: "Reassign leads" })).toBeVisible();
  await expect(page.locator('input[name="leadOrder"]')).toHaveValue("newest_created");
  await expect(page.locator(".modal-card.is-lead-ownership select")).toHaveCount(0);
  await expect(page.locator(".modal-card.is-lead-ownership [data-lead-custom-select]")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Unassign instead" })).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();

  await adminView.getByRole("button", { name: "Export" }).click();
  await expect(page.getByRole("heading", { name: "Export leads" })).toBeVisible();
  await expect(page.locator(".modal-card.is-lead-export select")).toHaveCount(0);
  await expect(page.locator(".modal-card.is-lead-export [data-lead-custom-select]")).toHaveCount(3);
  await expect(page.locator('input[name="leadExportOwner"]')).toHaveValue("all");
  await page.getByText("Leads created in date range", { exact: true }).click();
  const fromControl = page.locator('[data-lead-export-date-edge="from"]');
  const toControl = page.locator('[data-lead-export-date-edge="to"]');
  await fromControl.getByRole("button", { name: "Select date" }).click();
  const fromDay = fromControl.locator("[data-lead-export-date-day]").nth(20);
  const selectedDate = await fromDay.getAttribute("data-lead-export-date-day");
  await fromDay.click();
  await expect(page.locator('input[name="leadExportFrom"]')).toHaveValue(selectedDate);
  await expect(toControl).toHaveClass(/is-open/);
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(adminView.locator(".lead-admin-progress-dots i").first()).toHaveCount(1);
  const firstPhoneCell = adminView.locator("tbody .crm-phone-cell").first();
  const firstPhoneActions = firstPhoneCell.locator(".crm-phone-actions");
  await expect(firstPhoneCell.locator(".crm-phone-value")).not.toHaveText("");
  await expect(firstPhoneCell.locator(".crm-phone-call-btn")).toHaveCount(0);
  await expect(firstPhoneActions).toHaveCSS("opacity", "0");
  await firstPhoneCell.hover();
  await expect(firstPhoneActions).toHaveCSS("opacity", "1");
  await expect(firstPhoneCell.locator(".crm-phone-copy-btn")).toBeVisible();

  await adminView.locator("summary").filter({ hasText: "Saved views" }).click();
  await adminView.getByRole("menuitem", { name: "Follow-up" }).click();
  await expect(adminView.getByRole("button", { name: "Follow-up", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  await adminView.locator('input[name="leadSelect"]').first().check();
  await adminView.getByRole("button", { name: "Reassign" }).click();
  await expect(page.getByRole("heading", { name: "Reassign selected leads" })).toBeVisible();
  await expect(page.getByText("Start a new sales cycle", { exact: true })).toBeVisible();
  await expect(page.locator('input[name="restartWorkflow"]')).not.toBeChecked();
});
