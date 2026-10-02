import { expect, test } from "@playwright/test";

test("lead details keeps copy and attempt workflows in the Notion drawer", async ({ page }) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("joyno_local_qa_session_v1", "active");
  });
  await page.goto("/#/leads", { waitUntil: "domcontentloaded" });

  const firstLeadRow = page.locator(".crm-leads-list tbody tr[data-lead-open]").first();
  await expect(firstLeadRow).toBeVisible();
  await firstLeadRow.click();

  const drawer = page.locator(".lead-notion-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Next step", { exact: true })).toBeVisible();
  await expect(drawer.getByText("Contact & Lead Details", { exact: true })).toBeVisible();
  await expect(drawer.getByText("Outreach & Attempts", { exact: true })).toBeVisible();

  const nameHeading = drawer.locator(".lead-notion-title-row h4");
  const nameCopy = drawer.locator('.lead-notion-title-row [data-action="lead-copy-name-interest"]');
  await expect(nameHeading).toBeVisible();
  await expect(nameCopy).toBeVisible();
  await expect(nameCopy).toHaveAttribute("data-text", /\S+/);
  await expect(drawer.locator('[data-action="crm-copy-phone"]').first()).toBeAttached();

  await drawer.getByRole("button", { name: "Log attempt" }).first().click();
  await expect(page.getByRole("heading", { name: /Log Attempt:/ })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Reason" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Call no answer" })).toHaveCount(1);

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Outreach & Attempts", { exact: true })).toBeVisible();
});
