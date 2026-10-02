import { expect, test } from "@playwright/test";

test("settings uses one focused console and preserves unsaved account edits", async ({ page }) => {
  await page.goto("/#/login", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Open local QA workspace" }).click();
  await page.waitForURL(/#\/dashboard$/);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.waitForURL(/#\/settings$/);

  const settings = page.locator(".settings-console-v2");
  await expect(settings.getByRole("heading", { level: 1 })).toHaveText("Settings");
  await expect(settings.getByRole("heading", { name: "Account" })).toBeVisible();
  await expect(settings.getByRole("heading", { name: "Workspace" })).toBeAttached();
  await expect(settings.getByRole("heading", { name: "Notifications" })).toBeAttached();
  await expect(settings).not.toContainText("CRM Defaults");

  await settings.getByRole("button", { name: "Change profile photo" }).click();
  const photoDialog = page.getByRole("dialog", { name: "Profile photo" });
  await expect(photoDialog).toBeVisible();
  await expect(photoDialog).toContainText("Choose a square JPG, PNG, or WebP image.");
  await expect(photoDialog.getByText("joy@joyno.example", { exact: true })).toHaveCount(0);
  await expect(photoDialog.getByText("Choose image", { exact: true })).toBeVisible();
  await expect(photoDialog.getByRole("button", { name: "Save", exact: true })).toHaveCSS("background-color", "rgb(47, 52, 55)");
  await expect(photoDialog.getByRole("button", { name: "Close dialog" })).toBeFocused();
  await photoDialog.getByRole("button", { name: "Close dialog" }).click();
  await expect(photoDialog).toBeHidden();

  const nameEditButton = settings.getByRole("button", { name: "Edit Full name" });
  const nameEditIcon = nameEditButton.locator(".settings-summary-edit");
  const nameRow = settings.locator(".settings-summary-row").first();
  await expect(nameEditIcon).toHaveCSS("opacity", "0");
  await nameEditButton.hover();
  await expect(nameEditIcon).toHaveCSS("opacity", "1");
  await nameEditButton.click();
  await expect(nameRow).toHaveClass(/is-editing/);
  await expect(nameRow.locator(".settings-summary-trigger")).toBeHidden();
  await expect(nameRow.getByRole("button", { name: "Save Full name" })).toBeVisible();
  await expect(nameRow.getByRole("button", { name: "Cancel editing Full name" })).toBeVisible();
  const nameInput = settings.getByRole("textbox", { name: /Full name/ });
  await expect(nameInput).toBeFocused();
  await expect(nameInput).toHaveCSS("border-color", "rgb(120, 119, 116)");
  await nameInput.fill("Joy N. QA");
  await expect(nameRow.locator("[data-settings-save-status]")).toHaveText("Unsaved changes");

  await nameRow.getByRole("button", { name: "Save Full name" }).click();
  const saveConfirmation = nameRow.getByRole("dialog", { name: "Confirm saving Full name" });
  await expect(saveConfirmation).toBeVisible();
  await expect(saveConfirmation).toContainText("Save this change?");
  await saveConfirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(saveConfirmation).toBeHidden();

  await nameInput.fill("   ");
  await nameRow.getByRole("button", { name: "Save Full name" }).click();
  await saveConfirmation.getByRole("button", { name: "Save" }).click();
  await expect(nameRow.locator(".settings-save-action")).toHaveClass(/is-loading/);
  await expect(nameRow.locator(".settings-save-spinner")).toBeVisible();
  await expect(settings.getByRole("alert")).toContainText("Full name is required.");
  await expect(nameRow.locator(".settings-save-action")).not.toHaveClass(/is-loading/);
  await nameInput.fill("Joy N. QA");
  await expect(settings.getByText("Full name is required.")).toHaveCount(0);

  const darkTheme = settings.getByRole("button", { name: /^Dark/ });
  await darkTheme.click();
  await expect(darkTheme).toHaveAttribute("aria-pressed", "true");
  await expect(nameInput).toHaveValue("Joy N. QA");

  await settings.getByRole("button", { name: /^Light/ }).click();
  await nameRow.getByRole("button", { name: "Cancel editing Full name" }).click();
  await expect(nameInput).toBeHidden();
  await expect(settings.getByText("Joy N.", { exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "Operations", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "Operations" })).toBeFocused();

  await settings.getByRole("button", { name: "Notifications", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "Notifications" })).toBeFocused();
  const messagePreference = settings.getByRole("checkbox", { name: /Messages/ });
  await messagePreference.uncheck();
  await expect(settings.getByRole("button", { name: "Save preferences" })).toBeVisible();
  await settings.getByRole("button", { name: "Save preferences" }).click();
  await expect(settings.locator("[data-settings-notification-status]")).toHaveText("Preferences saved.");

  await settings.getByRole("button", { name: "Edit Currency" }).click();
  const currencyPicker = settings.getByRole("button", { name: /^Currency:/ });
  await expect(currencyPicker).toBeFocused();
  await currencyPicker.click();
  const currencyMenu = settings.getByRole("listbox", { name: "Currency" });
  await expect(currencyMenu).toBeVisible();
  await expect(currencyPicker.locator("..")).toHaveClass(/is-upward/);
  const triggerBox = await currencyPicker.boundingBox();
  const menuBox = await currencyMenu.boundingBox();
  expect(triggerBox).not.toBeNull();
  expect(menuBox).not.toBeNull();
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(triggerBox.y + 1);
  await settings.getByRole("option", { name: /EUR/ }).click();
  await expect(currencyPicker).toContainText("EUR");
  await expect(currencyMenu).toBeHidden();
});
