import { expect, test } from "@playwright/test";

const attendanceSmokeEmail = String(process.env.JOYNO_SMOKE_ATTENDANCE_EMAIL || "").trim();
const attendanceSmokePassword = String(process.env.JOYNO_SMOKE_ATTENDANCE_PASSWORD || "");

const hasAttendanceSmokeCredentials = Boolean(attendanceSmokeEmail && attendanceSmokePassword);

async function waitForAttendanceView(page) {
  await page.waitForFunction(() => Boolean(document.querySelector(".attendance-view")));
  await expect(page.locator(".attendance-view")).toBeVisible();
}

async function signInToAttendance(page) {
  await page.goto("/#/attendance");
  await expect(page).toHaveTitle(/Joynosync/i);

  const loginForm = page.locator("#loginPasswordForm");
  if (await loginForm.isVisible().catch(() => false)) {
    await page.locator("#loginEmailInput").fill(attendanceSmokeEmail);
    await page.locator("#loginPasswordInput").fill(attendanceSmokePassword);
    await loginForm.getByRole("button", { name: /sign in with email/i }).click();
  }

  await waitForAttendanceView(page);
}

function attendancePrimaryButton(page) {
  return page.locator('.attendance-view [data-action="attendance-primary"]').first();
}

function attendanceClockOutButton(page) {
  return page.locator('.attendance-view [data-action="attendance-clock-out"]').first();
}

async function confirmCurrentModal(page) {
  const confirmButton = page.locator('#modalForm [data-action="confirm-accept"]').first();
  await expect(confirmButton).toBeVisible();
  await confirmButton.click();
}

async function closeCurrentModal(page) {
  const closeButton = page.locator('#modalForm [data-action="close-modal"], #modalForm [data-action="confirm-cancel"]').first();
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
  }
  await expect(page.locator("#modalOverlay")).toBeHidden();
}

async function normalizeAttendanceToClockedOut(page) {
  const primaryButton = attendancePrimaryButton(page);
  const clockOutButton = attendanceClockOutButton(page);
  await expect(primaryButton).toBeVisible();

  if (await clockOutButton.isEnabled().catch(() => false)) {
    await clockOutButton.click();
    await confirmCurrentModal(page);
    await expect(primaryButton).toContainText(/clock in/i);
    return;
  }

  await expect(primaryButton).toContainText(/clock in/i);
}

async function navigateAwayAndBack(page) {
  await page.goto("/#/dashboard");
  await page.waitForTimeout(300);
  await page.goto("/#/attendance");
  await waitForAttendanceView(page);
}

async function clockInForSmoke(page) {
  const primaryButton = attendancePrimaryButton(page);
  await expect(primaryButton).toContainText(/clock in/i);
  await primaryButton.click();
  await expect(attendanceClockOutButton(page)).toBeEnabled();
  await expect(primaryButton).not.toContainText(/clock in/i);
}

async function clockOutForSmoke(page) {
  const primaryButton = attendancePrimaryButton(page);
  const clockOutButton = attendanceClockOutButton(page);
  if (!(await clockOutButton.isEnabled().catch(() => false))) {
    return;
  }
  await clockOutButton.click();
  await confirmCurrentModal(page);
  await expect(primaryButton).toContainText(/clock in/i);
}

test.describe.configure({ mode: "serial" });

test.describe("Attendance live smoke", () => {
  test.skip(!hasAttendanceSmokeCredentials, "Set JOYNO_SMOKE_ATTENDANCE_EMAIL and JOYNO_SMOKE_ATTENDANCE_PASSWORD to run live attendance smoke tests.");

  test("clock in and clock out still work after route re-entry", async ({ page }) => {
    test.setTimeout(90_000);

    await signInToAttendance(page);
    await normalizeAttendanceToClockedOut(page);

    await clockInForSmoke(page);
    await navigateAwayAndBack(page);

    await expect(attendanceClockOutButton(page)).toBeEnabled();
    await clockOutForSmoke(page);
  });

  test("start and end break when a break option is available", async ({ page }) => {
    test.setTimeout(90_000);

    await signInToAttendance(page);
    await normalizeAttendanceToClockedOut(page);
    await clockInForSmoke(page);

    const primaryButton = attendancePrimaryButton(page);
    await primaryButton.click();

    const availableBreakOptions = page.locator('#modalForm input[name="breakTypeId"]:enabled');
    const availableCount = await availableBreakOptions.count();

    if (!availableCount) {
      test.info().annotations.push({
        type: "note",
        description: "No break option was available in the current attendance policy window, so break transition assertions were skipped."
      });
      await closeCurrentModal(page);
      await clockOutForSmoke(page);
      return;
    }

    await availableBreakOptions.first().check();
    await page.locator('#modalForm button[type="submit"]').click();
    await expect(primaryButton).toContainText(/end break/i);

    await navigateAwayAndBack(page);
    await expect(attendancePrimaryButton(page)).toContainText(/end break/i);

    await attendancePrimaryButton(page).click();
    await expect(attendancePrimaryButton(page)).toContainText(/start break/i);

    await clockOutForSmoke(page);
  });
});
