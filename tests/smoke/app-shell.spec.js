import { expect, test } from "@playwright/test";

const smokeRoutes = [
  {
    name: "root",
    hash: "#/",
    expectedPatterns: [/joynosync/i, /sign in/i, /workspace access/i, /dashboard/i]
  },
  {
    name: "dashboard",
    hash: "#/dashboard",
    expectedPatterns: [/dashboard/i, /workspace access/i, /sign in/i]
  },
  {
    name: "leads",
    hash: "#/leads",
    expectedPatterns: [/leads/i, /workspace access/i, /sign in/i]
  },
  {
    name: "profile",
    hash: "#/settings-me",
    expectedPatterns: [/profile/i, /workspace access/i, /sign in/i]
  },
  {
    name: "settings",
    hash: "#/settings",
    expectedPatterns: [/settings/i, /workspace access/i, /sign in/i]
  },
  {
    name: "invite",
    hash: "#/invite?inviteId=smoke-test",
    expectedPatterns: [/invite/i, /workspace invite/i, /accept invite/i, /checking your access/i]
  }
];

async function expectAppToRender(page, expectedPatterns) {
  await page.waitForFunction(() => {
    const app = document.querySelector("#app");
    return Boolean(app && String(app.textContent || "").trim().length > 0);
  });
  const appText = await page.locator("#app").innerText();
  expect(appText.trim().length).toBeGreaterThan(0);
  expect(expectedPatterns.some((pattern) => pattern.test(appText))).toBeTruthy();
}

test.describe("SPA smoke shell", () => {
  for (const route of smokeRoutes) {
    test(`renders ${route.name} without runtime crashes`, async ({ page }) => {
      const pageErrors = [];
      page.on("pageerror", (error) => {
        pageErrors.push(String(error?.message || error || "Unknown page error"));
      });

      await page.goto(`/${route.hash}`);
      await expect(page).toHaveTitle(/Joynosync/i);
      await expect(page.locator("#app")).toBeVisible();
      await expectAppToRender(page, route.expectedPatterns);

      expect(pageErrors).toEqual([]);
    });
  }
});
