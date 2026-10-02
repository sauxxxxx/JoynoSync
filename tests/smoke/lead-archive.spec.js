import { expect, test } from "@playwright/test";

test("owners can open Archived Leads without runtime errors", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => {
    pageErrors.push(String(error?.message || error || "Unknown page error"));
  });
  await page.addInitScript(() => {
    window.sessionStorage.setItem("joyno_local_qa_session_v1", "active");
  });

  await page.goto("/#/lead-archive", { waitUntil: "domcontentloaded" });

  await expect(page.locator(".lead-archive-view")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Archived leads", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Archived" })).toBeVisible();
  await expect(page.getByText("Permanent deletion cannot be undone.")).toBeVisible();
  expect(pageErrors).toEqual([]);
});
