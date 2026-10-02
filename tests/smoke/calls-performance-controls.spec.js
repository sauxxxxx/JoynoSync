import { expect, test } from "@playwright/test";

test("calls performance keeps supervisor date and filter controls available", async ({ page }) => {
  await page.goto("/#/login", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Open local QA workspace" }).click();
  await page.waitForURL(/#\/dashboard$/);
  await page.goto("/#/comms-calls");
  await page.getByRole("button", { name: "Performance", exact: true }).click();

  const workspace = page.locator(".calls-performance-shell");
  const sidebar = workspace.locator(".calls-performance-sidebar");
  const performanceBody = page.locator(".calls-workspace-body.calls-performance-body");
  await expect(page.locator("#viewContent")).toHaveCSS("padding-top", "0px");
  await expect(performanceBody).toHaveCSS("overflow-y", "auto");
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByText("Date", { exact: true })).toBeVisible();
  await expect(sidebar.getByText("Filters", { exact: true })).toBeVisible();
  await expect(sidebar.getByLabel("Agent")).toBeVisible();
  await expect(sidebar.getByLabel("Department")).toBeVisible();
  await expect(sidebar.getByLabel("Outcome")).toBeVisible();

  await sidebar.getByRole("button", { name: "This Week" }).click();
  await expect(workspace.getByRole("button", { name: "Previous week" })).toBeVisible();
  await expect(workspace.getByRole("button", { name: "Reset" })).toBeEnabled();

  await workspace.getByRole("button", { name: "Reset" }).click();
  await expect(workspace.getByRole("button", { name: "Previous today" })).toBeVisible();
  await expect(workspace.getByRole("button", { name: "Reset" })).toBeDisabled();

  await performanceBody.evaluate((element) => {
    element.scrollTop = Math.min(160, element.scrollHeight - element.clientHeight);
  });
  expect(await performanceBody.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});
