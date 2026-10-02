import { expect, test } from "@playwright/test";

test("work navigation exposes one Tasks workspace and keeps legacy links compatible", async ({ page }) => {
  await page.goto("/#/login", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Open local QA workspace" }).click();
  await page.waitForURL(/#\/dashboard$/);

  const sidebar = page.locator(".sidebar");
  await expect(sidebar.locator("[data-route='kanban']")).toHaveText(/Tasks/);
  await expect(sidebar.locator("[data-route='my-work']")).toHaveCount(0);
  await expect(sidebar.locator("[data-route='table']")).toHaveCount(0);
  await expect(sidebar.locator("[data-route='projects']")).toHaveCount(0);

  await sidebar.locator("[data-route='kanban']").click();
  await expect(page).toHaveURL(/#\/kanban$/);
  await expect(page.locator(".kanban-n-page-head h1")).toHaveText("Tasks");
  await expect(page.getByRole("navigation", { name: "Task views" })).toContainText("Table");

  await page.goto("/#/my-work");
  await expect(page.locator(".kanban-n-page-head h1")).toHaveText("Tasks");

  await page.goto("/#/table");
  await expect(page.locator(".kanban-n-page-head h1")).toHaveText("Tasks");

  await page.goto("/#/calendar");
  const calendar = page.locator(".calendar-hybrid");
  const viewContent = page.locator("#viewContent");
  const workspace = page.locator(".workspace");
  const topbar = page.locator(".topbar");
  await expect(calendar).toBeVisible();
  await expect(viewContent).toHaveCSS("padding", "0px");
  await expect(viewContent).toHaveCSS("overflow-y", "hidden");
  const viewBox = await viewContent.boundingBox();
  const calendarBox = await calendar.boundingBox();
  const workspaceBox = await workspace.boundingBox();
  const topbarBox = await topbar.boundingBox();
  expect(viewBox).not.toBeNull();
  expect(calendarBox).not.toBeNull();
  expect(workspaceBox).not.toBeNull();
  expect(topbarBox).not.toBeNull();
  expect(Math.abs(viewBox.y - (topbarBox.y + topbarBox.height))).toBeLessThanOrEqual(1);
  expect(Math.abs(viewBox.y + viewBox.height - (workspaceBox.y + workspaceBox.height))).toBeLessThanOrEqual(1);
  expect(Math.abs(calendarBox.x - viewBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(calendarBox.y - viewBox.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(calendarBox.width - viewBox.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(calendarBox.height - viewBox.height)).toBeLessThanOrEqual(1);
  await expect(calendar.locator(".calendar-week-column.is-selected")).toHaveCSS(
    "background-color",
    "rgb(250, 250, 248)"
  );
  await calendar.getByRole("tab", { name: "Agenda" }).click();
  await expect(calendar.getByRole("button", { name: "Add Task" })).toHaveCSS(
    "background-color",
    "rgb(47, 52, 55)"
  );

  await page.goto("/#/projects");
  await expect(page.locator(".kanban-n-page-head h1")).toHaveText("Tasks");
});
