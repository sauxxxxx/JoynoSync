import { expect, test } from "@playwright/test";

test("task composer keeps essentials visible and progressively discloses advanced fields", async ({ page }) => {
  await page.goto("/#/login", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Open local QA workspace" }).click();
  await page.waitForURL(/#\/dashboard$/);
  await page.goto("/#/kanban");

  await page.locator(".kanban-n-add").click();

  const modal = page.locator(".modal-card.is-task-compose");
  await expect(modal).toBeVisible();
  await expect(modal.locator("#modalTitle")).toHaveText("New task");
  await expect(modal.getByPlaceholder("Untitled task")).toBeFocused();
  await expect(modal.locator(".task-essential-properties .task-chip-field")).toHaveCount(2);
  await expect(modal.locator("[data-task-advanced-body]")).toBeHidden();

  await modal.locator("[data-task-deadline-trigger]").click();
  const picker = modal.locator("[data-task-deadline-picker]");
  await expect(picker).toBeVisible();
  await expect(picker.locator(".task-cal-day.is-selected")).toHaveCSS("background-color", "rgb(32, 33, 36)");
  await modal.locator("[data-task-deadline-trigger]").click();

  await modal.getByRole("button", { name: "More options" }).click();
  await expect(modal.locator("[data-task-advanced-body]")).toBeVisible();
  await expect(modal.getByText("Repeat", { exact: true })).toBeVisible();
  await expect(modal.getByText("SLA", { exact: true })).toBeVisible();
  await expect(modal.getByText("Notes", { exact: true })).toBeVisible();
  await expect(modal.locator("[data-task-call-fields]")).toBeHidden();

  await modal.getByRole("button", { name: "More options" }).click();
  await modal.getByRole("button", { name: "Choose task type" }).click();
  await modal.locator("[data-action='task-chip-type-select'][data-id='Call']").click();
  await expect(modal.locator("[data-task-advanced-body]")).toBeVisible();
  await expect(modal.locator("[data-task-call-fields]")).toBeVisible();
});
