import { expect, test } from "@playwright/test";

test("dashboard presents a focused, interactive workspace overview", async ({ page }) => {
  await page.goto("/#/login", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Open local QA workspace" }).click();
  await page.waitForURL(/#\/dashboard$/);

  const dashboard = page.locator(".dashboard-notion");
  await expect(dashboard.getByRole("heading", { level: 1 })).toHaveText("Dashboard");
  await expect(dashboard.locator(".dashboard-notion-header p")).toHaveText(
    "Sales performance and work requiring attention"
  );
  await expect(dashboard.locator(".dashboard-notion-metric")).toHaveCount(5);

  const compare = dashboard.getByRole("button", { name: "Compare" });
  await expect(compare).toHaveAttribute("aria-pressed", "true");
  await compare.click();
  await expect(compare).toHaveAttribute("aria-pressed", "false");

  await dashboard.getByRole("button", { name: /Overdue follow-ups/ }).click();
  await page.waitForURL(/#\/leads$/);
  await expect(page.getByRole("button", { name: /^Overdue/ })).toHaveAttribute("aria-pressed", "true");
});
