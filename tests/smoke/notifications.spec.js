import { expect, test } from "@playwright/test";

test("notification center and preferences use the compact desktop workflow", async ({ page }) => {
  await page.goto("/#/login", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Open local QA workspace" }).click();
  await page.waitForURL(/#\/dashboard$/);

  await page.goto("/#/notifications");
  const center = page.locator(".notification-center");
  await expect(center.getByRole("heading", { level: 1 })).toHaveText("Notifications");
  await expect(center.getByRole("navigation", { name: "Notification filters" })).toBeVisible();
  await expect(center.getByRole("button", { name: "Mark all as read" })).toBeDisabled();
  await expect(center).toContainText("Notifications about your work will appear here.");
  await expect(center).toHaveCSS("background-color", "rgb(255, 255, 255)");

  await page.goto("/#/settings");
  const settings = page.locator(".settings-console-v2");
  await settings.getByRole("button", { name: "Notifications", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "Notifications" })).toBeFocused();
  await expect(settings).toContainText("Email and SMS delivery are not currently offered.");
  await expect(settings.getByRole("checkbox")).toHaveCount(5);
});
