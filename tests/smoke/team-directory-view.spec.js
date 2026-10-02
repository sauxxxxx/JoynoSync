import { expect, test } from "@playwright/test";

test("team directory keeps its scroll position and switches between list and cards", async ({ page }) => {
  await page.goto("/#/login", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Open local QA workspace" }).click();
  await page.waitForURL(/#\/dashboard$/);
  await page.getByRole("button", { name: "Team", exact: true }).click();
  await page.waitForURL(/#\/team$/);

  const directory = page.locator(".team-directory-view");
  const listView = directory.getByRole("button", { name: "List view" });
  const cardView = directory.getByRole("button", { name: "Card view" });

  await expect(listView).toHaveAttribute("aria-pressed", "true");
  await expect(directory.locator("thead th").first()).toHaveCSS("background-color", "rgb(255, 255, 255)");

  await page.addStyleTag({ content: ".team-directory-table-shell{height:100px!important;overflow:auto!important;}" });
  let content = directory.locator(".team-directory-table-shell");
  await content.evaluate((element) => {
    element.scrollTop = Math.min(60, element.scrollHeight - element.clientHeight);
  });
  const listScrollTop = await content.evaluate((element) => element.scrollTop);
  expect(listScrollTop).toBeGreaterThan(0);

  await cardView.click();
  content = directory.locator(".team-directory-table-shell");
  await expect(cardView).toHaveAttribute("aria-pressed", "true");
  await expect(directory.locator(".team-directory-card").first()).toBeVisible();
  expect(await content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});
