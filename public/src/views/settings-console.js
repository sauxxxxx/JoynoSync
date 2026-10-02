import {
  ATTENDANCE_TIMEZONE_OPTIONS,
  PROFILE_AVAILABILITY_OPTIONS,
  WORKDAY_OPTIONS,
  WORKSPACE_CURRENCIES
} from "../config/options.js";
import { normalizeSystemAppLabel, resolveBrandLogoUrl } from "../config/branding.js";
import { escapeHtml } from "../utils/text.js";

function getCurrentMember(data) {
  const currentUser = data?.currentUser && typeof data.currentUser === "object" ? data.currentUser : {};
  const members = Array.isArray(data?.teamMembers) ? data.teamMembers : [];
  return (
    members.find((member) => String(member?.id || "") === String(currentUser.id || "")) ||
    members.find((member) => String(member?.name || "").trim() === String(currentUser.name || "").trim()) ||
    null
  );
}

function getSettingsModel(data, context) {
  const currentUser = data?.currentUser && typeof data.currentUser === "object" ? data.currentUser : {};
  const currentMember = getCurrentMember(data);
  const workspaceSource = data?.workspace && typeof data.workspace === "object" ? data.workspace : {};
  const attendancePolicy = data?.attendancePolicy && typeof data.attendancePolicy === "object" ? data.attendancePolicy : {};
  const fullName = String(currentUser.name || currentMember?.name || "").trim() || "Workspace user";
  const timezone = String(currentUser.timezone || currentMember?.timezone || "Local").trim() || "Local";
  const workspaceTimezone = String(workspaceSource.timezone || attendancePolicy.timezone || "Local").trim() || "Local";
  const workspaceName = String(workspaceSource.name || "Workspace").trim() || "Workspace";
  const businessDays = Array.isArray(workspaceSource.businessDays)
    ? workspaceSource.businessDays
    : Array.isArray(attendancePolicy.workDays)
      ? attendancePolicy.workDays
      : [1, 2, 3, 4, 5];
  const currentRole = String(currentUser.role || currentMember?.role || "Member").trim().toLowerCase();
  const notificationSource = currentUser.notifications && typeof currentUser.notifications === "object"
    ? currentUser.notifications
    : currentMember?.notifications && typeof currentMember.notifications === "object"
      ? currentMember.notifications
      : {};

  return {
    canManageWorkspace: currentRole === "owner" || currentRole === "admin",
    theme: String(context?.uiTheme || "light").trim().toLowerCase() === "dark" ? "dark" : "light",
    profile: {
      fullName,
      email: String(currentUser.email || currentMember?.email || "").trim(),
      phone: String(currentUser.phone || currentMember?.phone || "").trim(),
      title: String(currentUser.title || currentMember?.title || "").trim(),
      availability: String(currentUser.availability || currentMember?.availability || "Online").trim() || "Online",
      timezone,
      avatarUrl: String(currentUser.avatarUrl || currentMember?.avatarUrl || "").trim(),
      initials: fullName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0] || "")
        .join("")
        .toUpperCase()
    },
    notifications: {
      inApp: notificationSource.inApp !== false,
      messages: notificationSource.messages !== false,
      tasks: notificationSource.tasks !== false,
      crm: notificationSource.crm !== false,
      calls: notificationSource.calls !== false
    },
    workspace: {
      name: workspaceName,
      appLabel: normalizeSystemAppLabel(workspaceSource.appLabel),
      legalName: String(workspaceSource.legalName || workspaceName).trim(),
      brandColor: /^#[0-9a-f]{6}$/i.test(String(workspaceSource.brandColor || ""))
        ? String(workspaceSource.brandColor)
        : "#2457d6",
      logoUrl: resolveBrandLogoUrl(workspaceSource.logoUrl),
      timezone: workspaceTimezone,
      currency: String(workspaceSource.currency || "USD").trim() || "USD",
      businessStart: String(workspaceSource.businessStart || attendancePolicy.shiftStart || "09:00"),
      businessEnd: String(workspaceSource.businessEnd || attendancePolicy.shiftEnd || "18:00"),
      businessDays: new Set(businessDays.map(Number))
    }
  };
}

function normalizePickerOptions(options, selectedValue) {
  const normalizedOptions = [...options];
  const hasSelectedValue = normalizedOptions.some((option) =>
    String(typeof option === "object" ? option.value : option) === String(selectedValue)
  );
  if (String(selectedValue || "").trim() && !hasSelectedValue) {
    normalizedOptions.unshift(selectedValue);
  }
  return normalizedOptions.map((option) => ({
    value: String(typeof option === "object" ? option.value : option),
    label: String(typeof option === "object" ? option.label : option)
  }));
}

function settingsPickerMarkup({ name, label, options, selectedValue, kind = "select" }) {
  const normalizedOptions = normalizePickerOptions(options, selectedValue);
  const selected = normalizedOptions.find((option) => option.value === String(selectedValue)) || normalizedOptions[0];
  const pickerId = `settings-picker-${name.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`;
  return `
    <div class="settings-picker ${kind === "time" ? "is-time" : ""}" data-settings-picker>
      <input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(selected?.value || "")}" data-settings-picker-input />
      <button
        class="settings-picker-trigger"
        type="button"
        data-settings-picker-trigger
        aria-haspopup="listbox"
        aria-expanded="false"
        aria-controls="${escapeHtml(pickerId)}"
        aria-label="${escapeHtml(label)}: ${escapeHtml(selected?.label || "Choose an option")}"
      >
        <span data-settings-picker-label>${escapeHtml(selected?.label || "Choose an option")}</span>
        <i class="bi bi-chevron-down" aria-hidden="true"></i>
      </button>
      <div class="settings-picker-menu" id="${escapeHtml(pickerId)}" role="listbox" aria-label="${escapeHtml(label)}" data-settings-picker-menu hidden>
        ${normalizedOptions
          .map((option) => {
            const isSelected = option.value === String(selected?.value || "");
            return `<button class="settings-picker-option ${isSelected ? "is-selected" : ""}" type="button" role="option" aria-selected="${isSelected}" tabindex="-1" data-settings-picker-option data-value="${escapeHtml(option.value)}"><span>${escapeHtml(option.label)}</span><i class="bi bi-check2" aria-hidden="true"></i></button>`;
          })
          .join("")}
      </div>
    </div>
  `;
}

function formatTimeLabel(value) {
  const [hourValue, minuteValue] = String(value || "").split(":").map(Number);
  const hour = Number.isFinite(hourValue) ? hourValue : 0;
  const minute = Number.isFinite(minuteValue) ? minuteValue : 0;
  const period = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${period}`;
}

function businessTimeOptions(selectedValue) {
  const options = Array.from({ length: 96 }, (_, index) => {
    const hour = Math.floor(index / 4);
    const minute = (index % 4) * 15;
    const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    return { value, label: formatTimeLabel(value) };
  });
  if (selectedValue && !options.some((option) => option.value === selectedValue)) {
    options.unshift({ value: selectedValue, label: formatTimeLabel(selectedValue) });
  }
  return options;
}

function avatarMarkup(profile) {
  return profile.avatarUrl
    ? `<img src="${escapeHtml(profile.avatarUrl)}" alt="" />`
    : `<span aria-hidden="true">${escapeHtml(profile.initials || "JU")}</span>`;
}

function settingsNavItem(id, icon, label, current = false) {
  return `
    <button
      class="settings-console-nav-item ${current ? "is-current" : ""}"
      type="button"
      data-action="settings-scroll"
      data-id="${escapeHtml(id)}"
      aria-controls="settings-${escapeHtml(id)}"
      ${current ? 'aria-current="location"' : ""}
    >
      <i class="bi ${escapeHtml(icon)}" aria-hidden="true"></i>
      <span>${escapeHtml(label)}</span>
    </button>
  `;
}

function inlineEditorActions(id, message, settingLabel) {
  const confirmationId = `settings-save-confirm-${id}`;
  return `
    <footer class="settings-inline-actions">
      <p class="settings-save-status" data-settings-save-status aria-live="polite">${escapeHtml(message)}</p>
      <div class="settings-inline-action-group">
        <button
          class="settings-cancel-action"
          type="button"
          data-action="settings-cancel-field"
          data-id="${escapeHtml(id)}"
          title="Cancel"
        >
          <i class="bi bi-x-lg" aria-hidden="true"></i>
          <span class="sr-only">Cancel editing ${escapeHtml(settingLabel)}</span>
        </button>
        <button class="settings-save-action" type="submit" title="Save" aria-expanded="false" aria-controls="${escapeHtml(confirmationId)}">
          <i class="bi bi-check2" aria-hidden="true"></i>
          <span class="sr-only">Save ${escapeHtml(settingLabel)}</span>
        </button>
        <div
          class="settings-save-confirm"
          id="${escapeHtml(confirmationId)}"
          role="dialog"
          aria-label="Confirm saving ${escapeHtml(settingLabel)}"
          data-settings-save-confirm
          hidden
        >
          <p>Save this change?</p>
          <div>
            <button type="button" data-action="settings-confirm-cancel">Cancel</button>
            <button type="button" class="is-confirm" data-action="settings-confirm-save">Save</button>
          </div>
        </div>
      </div>
    </footer>
  `;
}

function inlineSettingRow({ id, label, value, editor, note = "Save this setting to apply the change." }) {
  const displayValue = String(value || "").trim() || "Not set";
  return `
    <div class="settings-summary-row">
      <button
        class="settings-summary-trigger"
        type="button"
        data-action="settings-edit-field"
        data-id="${escapeHtml(id)}"
        aria-controls="settings-editor-${escapeHtml(id)}"
        aria-expanded="false"
        aria-label="Edit ${escapeHtml(label)}"
      >
        <span class="settings-summary-copy">
          <strong>${escapeHtml(label)}</strong>
          <small>${escapeHtml(displayValue)}</small>
        </span>
        <span class="settings-summary-edit" aria-hidden="true">
          <i class="bi bi-pencil" aria-hidden="true"></i>
        </span>
      </button>
      <div
        id="settings-editor-${escapeHtml(id)}"
        class="settings-inline-editor"
        data-settings-inline-editor
        data-id="${escapeHtml(id)}"
        hidden
      >
        <strong class="settings-inline-label">${escapeHtml(label)}</strong>
        <div class="settings-inline-control">${editor}</div>
        ${inlineEditorActions(id, note, label)}
      </div>
    </div>
  `;
}

function renderAccount(model) {
  const profile = model.profile;
  return `
    <form id="myProfileForm" class="settings-editor" data-settings-scope="account">
      <section id="settings-account" class="settings-console-section" aria-labelledby="settings-account-title">
        <header class="settings-section-header">
          <div>
            <h2 id="settings-account-title" tabindex="-1">Account</h2>
            <p>Update the details teammates see across Joynosync.</p>
          </div>
          <button class="settings-avatar-button" type="button" data-profile-avatar-trigger aria-label="Change profile photo">
            <span class="settings-avatar-preview">${avatarMarkup(profile)}</span>
            <i class="bi bi-pencil" aria-hidden="true"></i>
          </button>
        </header>

        <div class="settings-summary-list">
          ${inlineSettingRow({
            id: "account-name",
            label: "Full name",
            value: profile.fullName,
            editor: `<label class="settings-field"><span>Full name <small>Required</small></span><input type="text" name="name" value="${escapeHtml(profile.fullName)}" maxlength="120" autocomplete="name" required /></label>`
          })}
          ${inlineSettingRow({
            id: "account-email",
            label: "Contact email",
            value: profile.email,
            editor: `<label class="settings-field"><span>Contact email</span><input type="email" name="email" value="${escapeHtml(profile.email)}" maxlength="254" autocomplete="email" placeholder="name@company.com" /></label>`
          })}
          ${inlineSettingRow({
            id: "account-phone",
            label: "Phone",
            value: profile.phone,
            editor: `<label class="settings-field"><span>Phone</span><input type="tel" name="phone" value="${escapeHtml(profile.phone)}" maxlength="40" autocomplete="tel" placeholder="+1 555 000 0000" /></label>`
          })}
          ${inlineSettingRow({
            id: "account-title",
            label: "Job title",
            value: profile.title,
            editor: `<label class="settings-field"><span>Job title</span><input type="text" name="title" value="${escapeHtml(profile.title)}" maxlength="80" autocomplete="organization-title" placeholder="Sales manager" /></label>`
          })}
          ${inlineSettingRow({
            id: "account-availability",
            label: "Availability",
            value: profile.availability,
            editor: `<div class="settings-field"><span>Availability</span>${settingsPickerMarkup({ name: "availability", label: "Availability", options: PROFILE_AVAILABILITY_OPTIONS, selectedValue: profile.availability })}</div>`
          })}
          ${inlineSettingRow({
            id: "account-timezone",
            label: "Timezone",
            value: profile.timezone,
            editor: `<div class="settings-field"><span>Timezone</span>${settingsPickerMarkup({ name: "timezone", label: "Timezone", options: ATTENDANCE_TIMEZONE_OPTIONS, selectedValue: profile.timezone })}</div>`
          })}
        </div>
      </section>
    </form>
  `;
}

function renderAppearance(model) {
  return `
    <section id="settings-appearance" class="settings-console-section" aria-labelledby="settings-appearance-title">
      <header class="settings-section-header">
        <div>
          <h2 id="settings-appearance-title" tabindex="-1">Appearance</h2>
          <p>Choose the theme used on this browser.</p>
        </div>
      </header>
      <div class="settings-choice-group" role="group" aria-label="Color theme">
        ${[
          { id: "light", label: "Light", detail: "A bright canvas for daytime work.", icon: "bi-sun" },
          { id: "dark", label: "Dark", detail: "A charcoal canvas with reduced glare.", icon: "bi-moon-stars" }
        ]
          .map(
            (option) => `
              <button
                class="settings-choice ${model.theme === option.id ? "is-selected" : ""}"
                type="button"
                data-action="ui-theme"
                data-id="${option.id}"
                aria-pressed="${model.theme === option.id ? "true" : "false"}"
              >
                <i class="bi ${option.icon}" aria-hidden="true"></i>
                <span><strong>${option.label}</strong><small>${option.detail}</small></span>
                <i class="bi bi-check2 settings-choice-check" aria-hidden="true"></i>
              </button>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function notificationPreferenceRow(name, label, description, checked) {
  return `
    <label class="settings-notification-row">
      <span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(description)}</small></span>
      <input type="checkbox" name="${escapeHtml(name)}" ${checked ? "checked" : ""} />
      <span class="settings-notification-switch" aria-hidden="true"></span>
    </label>
  `;
}

function renderNotificationSettings(model) {
  const preferences = model.notifications;
  return `
    <form id="notificationSettingsForm" class="settings-editor settings-notification-form">
      <section id="settings-notifications" class="settings-console-section" aria-labelledby="settings-notifications-title">
        <header class="settings-section-header">
          <div>
            <h2 id="settings-notifications-title" tabindex="-1">Notifications</h2>
            <p>Choose which updates appear in Joynosync. Email and SMS delivery are not currently offered.</p>
          </div>
        </header>
        <div class="settings-notification-list">
          ${notificationPreferenceRow("notifyInApp", "In-app notifications", "Show updates in the bell and Notification Center.", preferences.inApp)}
          <div class="settings-notification-divider" role="separator"></div>
          ${notificationPreferenceRow("notifyMessages", "Messages", "New messages from active conversations.", preferences.messages)}
          ${notificationPreferenceRow("notifyTasks", "Tasks", "Assignments, comments, due dates, and overdue reminders.", preferences.tasks)}
          ${notificationPreferenceRow("notifyCrm", "Leads and deals", "Assignments, qualified leads, follow-ups, and deal changes.", preferences.crm)}
          ${notificationPreferenceRow("notifyCalls", "Calls", "Missed inbound calls and new voicemail.", preferences.calls)}
        </div>
        <footer class="settings-notification-footer">
          <p data-settings-notification-status aria-live="polite">Changes apply to this account.</p>
          <button type="submit"><span>Save preferences</span><i class="bi bi-check2" aria-hidden="true"></i></button>
        </footer>
      </section>
    </form>
  `;
}

function renderWorkspace(model) {
  if (!model.canManageWorkspace) {
    return "";
  }
  const workspace = model.workspace;
  return `
    <form id="workspaceProfileForm" class="settings-editor" data-settings-scope="workspace">
      <section id="settings-workspace" class="settings-console-section" aria-labelledby="settings-workspace-title">
        <header class="settings-section-header">
          <div>
            <h2 id="settings-workspace-title" tabindex="-1">Workspace</h2>
            <p>Manage the identity shared across your team.</p>
          </div>
          <button class="settings-avatar-button is-workspace" type="button" data-workspace-logo-trigger aria-label="Change workspace logo">
            <span class="settings-avatar-preview"><img src="${escapeHtml(workspace.logoUrl)}" alt="" /></span>
            <i class="bi bi-pencil" aria-hidden="true"></i>
          </button>
        </header>
        <div class="settings-summary-list">
          ${inlineSettingRow({ id: "workspace-name", label: "Workspace name", value: workspace.name, editor: `<label class="settings-field"><span>Workspace name <small>Required</small></span><input type="text" name="workspaceName" value="${escapeHtml(workspace.name)}" maxlength="120" required /></label>` })}
          ${inlineSettingRow({ id: "workspace-label", label: "Display label", value: workspace.appLabel, editor: `<label class="settings-field"><span>Display label</span><input type="text" name="appLabel" value="${escapeHtml(workspace.appLabel)}" maxlength="80" /></label>` })}
          ${inlineSettingRow({ id: "workspace-legal", label: "Legal name", value: workspace.legalName, editor: `<label class="settings-field"><span>Legal name</span><input type="text" name="legalName" value="${escapeHtml(workspace.legalName)}" maxlength="160" /></label>` })}
          ${inlineSettingRow({
            id: "workspace-color",
            label: "Brand color",
            value: workspace.brandColor.toUpperCase(),
            editor: `<label class="settings-field settings-color-control"><span>Brand color</span><span class="settings-color-input"><input type="color" name="brandColor" value="${escapeHtml(workspace.brandColor)}" aria-label="Brand color" /><output>${escapeHtml(workspace.brandColor.toUpperCase())}</output></span></label>`
          })}
        </div>
      </section>

      <section id="settings-operations" class="settings-console-section" aria-labelledby="settings-operations-title">
        <header class="settings-section-header">
          <div>
            <h2 id="settings-operations-title" tabindex="-1">Operations</h2>
            <p>Set the working hours used by attendance and workspace reporting.</p>
          </div>
        </header>
        <div class="settings-summary-list">
          ${inlineSettingRow({ id: "operations-timezone", label: "Workspace timezone", value: workspace.timezone, editor: `<div class="settings-field"><span>Workspace timezone</span>${settingsPickerMarkup({ name: "workspaceTimezone", label: "Workspace timezone", options: ATTENDANCE_TIMEZONE_OPTIONS, selectedValue: workspace.timezone })}</div>` })}
          ${inlineSettingRow({ id: "operations-currency", label: "Currency", value: workspace.currency, editor: `<div class="settings-field"><span>Currency</span>${settingsPickerMarkup({ name: "currency", label: "Currency", options: WORKSPACE_CURRENCIES, selectedValue: workspace.currency })}</div>` })}
          ${inlineSettingRow({
            id: "operations-hours",
            label: "Business hours",
            value: `${workspace.businessStart} \u2013 ${workspace.businessEnd}`,
            note: "Hours are also used as attendance defaults.",
            editor: `<div class="settings-inline-field-pair"><div class="settings-field"><span>Start</span>${settingsPickerMarkup({ name: "businessStart", label: "Business hours start", options: businessTimeOptions(workspace.businessStart), selectedValue: workspace.businessStart, kind: "time" })}</div><span class="settings-inline-separator" aria-hidden="true">to</span><div class="settings-field"><span>End</span>${settingsPickerMarkup({ name: "businessEnd", label: "Business hours end", options: businessTimeOptions(workspace.businessEnd), selectedValue: workspace.businessEnd, kind: "time" })}</div></div>`
          })}
          ${inlineSettingRow({
            id: "operations-days",
            label: "Business days",
            value: WORKDAY_OPTIONS.filter((day) => workspace.businessDays.has(day.value)).map((day) => day.label.slice(0, 3)).join(", "),
            note: "Select at least one working day.",
            editor: `<fieldset class="settings-days-fieldset"><legend>Business days</legend><div class="settings-days-grid">${WORKDAY_OPTIONS.map(
              (day) => `<label class="settings-day-choice"><input type="checkbox" name="businessDays" value="${day.value}" ${workspace.businessDays.has(day.value) ? "checked" : ""} /><span title="${escapeHtml(day.label)}">${escapeHtml(day.label.slice(0, 3))}</span></label>`
            ).join("")}</div></fieldset>`
          })}
        </div>
      </section>
    </form>
  `;
}

function settingsSkeletonRows(count) {
  return Array.from(
    { length: count },
    (_, index) => `
      <div class="settings-skeleton-row">
        <span class="settings-skeleton-bar is-label" style="--settings-skeleton-width:${index % 3 === 0 ? "76px" : index % 3 === 1 ? "102px" : "88px"}"></span>
        <span class="settings-skeleton-bar is-value" style="--settings-skeleton-width:${index % 2 === 0 ? "42%" : "31%"}"></span>
      </div>
    `
  ).join("");
}

function settingsSkeletonSection(rowCount, { avatar = false } = {}) {
  return `
    <section class="settings-console-section settings-skeleton-section">
      <header class="settings-section-header">
        <div>
          <span class="settings-skeleton-bar is-heading"></span>
          <span class="settings-skeleton-bar is-description"></span>
        </div>
        ${avatar ? '<span class="settings-skeleton-avatar"></span>' : ""}
      </header>
      <div class="settings-summary-list">${settingsSkeletonRows(rowCount)}</div>
    </section>
  `;
}

function renderSettingsSkeleton(model) {
  return `
    <section class="view-block settings-console-v2 is-loading" aria-labelledby="settings-title" aria-busy="true">
      <header class="settings-console-header">
        <h1 id="settings-title">Settings</h1>
        <p>Manage your account${model.canManageWorkspace ? " and workspace" : ""} in one place.</p>
      </header>
      <div class="settings-console-layout">
        <aside class="settings-console-sidebar" aria-hidden="true">
          <div class="settings-skeleton-nav">
            <span class="settings-skeleton-bar is-nav-label"></span>
            <span class="settings-skeleton-bar is-nav-item"></span>
            <span class="settings-skeleton-bar is-nav-item is-short"></span>
            <span class="settings-skeleton-bar is-nav-item"></span>
            ${model.canManageWorkspace ? '<span class="settings-skeleton-bar is-nav-label is-workspace"></span><span class="settings-skeleton-bar is-nav-item"></span><span class="settings-skeleton-bar is-nav-item is-short"></span>' : ""}
          </div>
        </aside>
        <div class="settings-console-content" aria-hidden="true">
          ${settingsSkeletonSection(6, { avatar: true })}
          ${settingsSkeletonSection(2)}
          ${model.canManageWorkspace ? settingsSkeletonSection(4, { avatar: true }) + settingsSkeletonSection(4) : ""}
        </div>
      </div>
      <p class="sr-only" role="status">Loading settings</p>
    </section>
  `;
}

export function renderSettings(data, context) {
  const model = getSettingsModel(data, context);
  if (context?.settingsProfileLoading) {
    return {
      title: "Settings",
      subtitle: "Account and workspace preferences",
      showWaitingPanel: false,
      html: renderSettingsSkeleton(model)
    };
  }
  return {
    title: "Settings",
    subtitle: "Account and workspace preferences",
    showWaitingPanel: false,
    html: `
      <section class="view-block settings-console-v2" aria-labelledby="settings-title">
        <header class="settings-console-header">
          <h1 id="settings-title">Settings</h1>
          <p>Manage your account${model.canManageWorkspace ? " and workspace" : ""} in one place.</p>
        </header>
        ${context?.settingsProfileError ? `<div class="settings-load-error" role="alert"><span>${escapeHtml(context.settingsProfileError)}</span><button type="button" data-action="settings-retry-profile">Retry</button></div>` : ""}
        <div class="settings-console-layout">
          <aside class="settings-console-sidebar">
            <nav class="settings-console-nav" aria-label="Settings categories">
              <p>Personal</p>
              ${settingsNavItem("account", "bi-person", "Account", true)}
              ${settingsNavItem("appearance", "bi-circle-half", "Appearance")}
              ${settingsNavItem("notifications", "bi-bell", "Notifications")}
              ${
                model.canManageWorkspace
                  ? `<p>Workspace</p>${settingsNavItem("workspace", "bi-building", "Workspace")}${settingsNavItem("operations", "bi-clock", "Operations")}`
                  : ""
              }
            </nav>
          </aside>
          <div class="settings-console-content">
            ${renderAccount(model)}
            ${renderAppearance(model)}
            ${renderNotificationSettings(model)}
            ${renderWorkspace(model)}
          </div>
        </div>
      </section>
    `
  };
}
