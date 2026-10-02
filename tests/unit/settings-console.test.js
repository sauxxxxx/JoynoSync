import test from "node:test";
import assert from "node:assert/strict";
import { renderSettings } from "../../public/src/views/settings-console.js";

function makeData(role = "Owner") {
  return {
    currentUser: {
      id: "member-1",
      name: "Joy N.",
      email: "joy@example.com",
      role,
      availability: "Online",
      timezone: "Asia/Manila"
    },
    teamMembers: [{ id: "member-1", name: "Joy N.", role, status: "Active" }],
    workspace: {
      name: "Joynosync",
      appLabel: "Joynosync",
      legalName: "Joynosync LLC",
      timezone: "Asia/Manila",
      currency: "USD",
      businessStart: "09:00",
      businessEnd: "18:00",
      businessDays: [1, 2, 3, 4, 5]
    }
  };
}

test("settings console keeps only working personal settings", () => {
  const view = renderSettings(makeData("Member"), { uiTheme: "light" });

  assert.match(view.html, /<h1 id="settings-title">Settings<\/h1>/);
  assert.match(view.html, /id="settings-account"/);
  assert.match(view.html, /id="settings-appearance"/);
  assert.match(view.html, /id="settings-notifications"/);
  assert.match(view.html, /name="notifyMessages"/);
  assert.match(view.html, /name="notifyTasks"/);
  assert.match(view.html, /name="notifyCrm"/);
  assert.match(view.html, /name="notifyCalls"/);
  assert.match(view.html, /class="settings-summary-row"/);
  assert.match(view.html, /data-action="settings-edit-field"/);
  assert.match(view.html, /settings-summary-edit[^>]*aria-hidden="true"[\s\S]*?bi bi-pencil/);
  assert.match(view.html, /id="settings-editor-account-name"[^>]*hidden/);
  assert.match(view.html, /class="settings-inline-label">Full name/);
  assert.match(view.html, /class="settings-inline-control"/);
  assert.match(view.html, /Cancel editing Full name/);
  assert.match(view.html, /Save Full name/);
  assert.match(view.html, /Confirm saving Full name/);
  assert.match(view.html, /data-action="settings-confirm-save"/);
  assert.match(view.html, /data-settings-picker-trigger/);
  assert.match(view.html, /data-settings-picker-option/);
  assert.doesNotMatch(view.html, /<select/);
  assert.doesNotMatch(view.html, /id="settings-workspace"/);
  assert.doesNotMatch(view.html, /name="notifyEmail"|name="notifySms"|New Password|Email Signature|CRM Defaults/);
});

test("owners receive consolidated workspace and operations settings", () => {
  const view = renderSettings(makeData("Owner"), { uiTheme: "dark" });

  assert.match(view.html, /id="workspaceProfileForm"/);
  assert.match(view.html, /id="settings-workspace"/);
  assert.match(view.html, /id="settings-operations"/);
  assert.match(view.html, /Business hours/);
  assert.match(view.html, /Business hours start: 9:00 AM/);
  assert.doesNotMatch(view.html, /type="time"/);
  assert.match(view.html, /name="businessDays"/);
  assert.match(view.html, /settings-choice is-selected[^>]*data-action="ui-theme"[^>]*data-id="dark"/);
});

test("connected settings use a structural skeleton until profile data is ready", () => {
  const view = renderSettings(makeData("Owner"), { uiTheme: "light", settingsProfileLoading: true });

  assert.match(view.html, /settings-console-v2 is-loading/);
  assert.match(view.html, /role="status">Loading settings/);
  assert.match(view.html, /settings-skeleton-row/);
  assert.doesNotMatch(view.html, /Shaun|Joy N\.|joy@example\.com/);
  assert.doesNotMatch(view.html, /data-action="settings-edit-field"/);
});
