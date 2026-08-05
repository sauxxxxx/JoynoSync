import { expect, test } from "@playwright/test";

test.describe("Integrations page", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.sessionStorage.setItem("joyno_local_qa_session_v1", "active");
    });
  });

  test("appears under System and keeps provider setup out of Calls", async ({ page }) => {
    await page.setViewportSize({ width: 1536, height: 960 });
    await page.goto("/#/integrations", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("button", { name: "Integrations", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Integrations", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "RingCentral", exact: true })).toBeVisible();
    await expect(page.locator('.integration-featured-logo img[alt="RingCentral"]')).toBeVisible();
    await expect(page.getByText("System integration", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Review setup", exact: true })).toBeVisible();
    await expect(page.locator("#alertBanner")).toBeHidden();
    await expect(page.locator(".integrations-page")).not.toHaveClass(/view-block/);
    await expect(page.getByRole("button", { name: "Refresh status", exact: true })).toHaveCount(0);
    await expect(page.getByText("Webhook health", { exact: true })).toBeHidden();
    await expect(page.locator(".integration-featured-card")).toBeVisible();

    for (const name of ["Facebook Lead Ads", "Google Calendar", "Google Sheets", "Slack"]) {
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Coming soon", exact: true })).toHaveCount(4);
    await page.getByPlaceholder("Search integrations...").fill("Slack");
    await expect(page.locator("[data-integration-market-card]:visible")).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Slack", exact: true })).toBeVisible();
    await page.getByPlaceholder("Search integrations...").fill("");
    await expect(page.getByText("Can't find the integration you need?", { exact: true })).toBeVisible();
    const pageBox = await page.locator(".integrations-page").boundingBox();
    expect((pageBox?.y || 0) + (pageBox?.height || 0)).toBeLessThanOrEqual(960);

    await page.getByRole("button", { name: "Review setup", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "Review RingCentral setup" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("heading", { name: "Verify workspace connection" })).toBeVisible();
    await expect(panel.getByText("JWT service connection", { exact: true })).toBeVisible();
    await expect(panel.getByText(/does not carry browser audio/i)).toBeVisible();
    const panelBox = await panel.boundingBox();
    const viewport = page.viewportSize();
    expect(Math.abs((panelBox?.x || 0) + (panelBox?.width || 0) / 2 - (viewport?.width || 0) / 2)).toBeLessThan(4);
    await panel.getByRole("button", { name: /Continue/ }).click();
    await expect(panel.getByRole("heading", { name: "Map agent extensions" })).toBeVisible();
    await panel.getByRole("button", { name: /Continue — 0 of 0 mapped/ }).click();
    await expect(panel.getByRole("heading", { name: "Confirm the call workflow" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Activate RingCentral" })).toBeDisabled();
    await panel.getByRole("button", { name: "Close RingCentral setup" }).click();

    await page.getByRole("button", { name: "Calls", exact: true }).click();
    await expect(page.locator('[data-action="call-refresh"]')).toBeVisible();
    await expect(page.locator('[data-action="call-sync-provider"]')).toHaveCount(0);
  });
});
