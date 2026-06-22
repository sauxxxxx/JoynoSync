import {
  ATTENDANCE_TIMEZONE_OPTIONS,
  PIPELINE_STAGE_OPTIONS,
  PROFILE_AVAILABILITY_OPTIONS,
  PROFILE_LANGUAGE_OPTIONS,
  PROFILE_PERMISSION_ACTIONS,
  PROFILE_PERMISSION_MODULES,
  PROFILE_SCOPE_OPTIONS,
  WORKDAY_OPTIONS,
  WORKSPACE_CURRENCIES,
  WORKSPACE_DATE_FORMATS,
  WORKSPACE_WEEK_START_OPTIONS
} from "../config/options.js";
import { normalizeSystemAppLabel, resolveBrandLogoUrl, SYSTEM_APP_NAME } from "../config/branding.js";
import {
  canManageTeamMembersByRole,
  isTeamMemberPendingInvite,
  normalizeTeamMemberStatus,
  resolveCurrentUserRole as resolveCurrentUserRoleCore
} from "../modules/profile-core.js";
import { escapeHtml } from "../utils/text.js";

function memberInitials(nameValue) {
  const name = String(nameValue || "").trim();
  if (!name) {
    return "TM";
  }
  const parts = name.split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return "TM";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase();
}

function normalizeScope(value) {
  const next = String(value || "").trim().toLowerCase();
  return PROFILE_SCOPE_OPTIONS.includes(next) ? next : "own";
}

function normalizePermissions(member) {
  const role = String(member?.role || "").trim().toLowerCase();
  const source = member?.permissions && typeof member.permissions === "object" ? member.permissions : {};
  const template = {};

  PROFILE_PERMISSION_MODULES.forEach((module) => {
    const current = source[module.id] && typeof source[module.id] === "object" ? source[module.id] : {};
    template[module.id] = {};
    PROFILE_PERMISSION_ACTIONS.forEach((action) => {
      if (Object.prototype.hasOwnProperty.call(current, action)) {
        template[module.id][action] = Boolean(current[action]);
        return;
      }
      if (role === "owner") {
        template[module.id][action] = true;
        return;
      }
      if (role === "manager") {
        template[module.id][action] = action !== "delete";
        return;
      }
      if (role === "member") {
        template[module.id][action] = action === "view" || action === "create" || action === "edit";
        return;
      }
      template[module.id][action] = action === "view";
    });
  });

  return template;
}

function normalizeSettingsBrandColor(value) {
  const color = String(value || "").trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? color : "#2457d6";
}

function canAccessWorkspaceProfile(data) {
  return canManageTeamMembersByRole(resolveCurrentUserRoleCore(data));
}

function isCurrentUserOwner(data) {
  return String(resolveCurrentUserRoleCore(data) || "")
    .trim()
    .toLowerCase() === "owner";
}

function canManageOwnerTeamMember(member, data) {
  const targetRole = String(member?.role || "")
    .trim()
    .toLowerCase();
  return targetRole !== "owner" || isCurrentUserOwner(data);
}

function getAssignableTeamRoles(member, data) {
  if (isCurrentUserOwner(data)) {
    return ["Owner", "Admin", "Manager", "Member", "Guest"];
  }
  const targetRole = String(member?.role || "").trim();
  if (targetRole === "Owner") {
    return ["Owner"];
  }
  return ["Admin", "Manager", "Member", "Guest"];
}

function getWorkspaceTimezoneOptions(selectedValue) {
  const normalizedSelected = String(selectedValue || "").trim() || "Local";
  return ATTENDANCE_TIMEZONE_OPTIONS.includes(normalizedSelected)
    ? ATTENDANCE_TIMEZONE_OPTIONS
    : [normalizedSelected, ...ATTENDANCE_TIMEZONE_OPTIONS];
}

function formatWorkspaceBusinessDays(days) {
  const values = new Set(
    (Array.isArray(days) ? days : [])
      .map((day) => Number(day))
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
  );
  const labels = WORKDAY_OPTIONS.filter((day) => values.has(day.value)).map((day) => day.label);
  return labels.length ? labels.join(" / ") : "Mon / Tue / Wed / Thu / Fri";
}

function renderSettingsRouteSwitch(data, activeRoute) {
  const items = [{ route: "settings-me", label: "Profile" }];
  if (canAccessWorkspaceProfile(data)) {
    items.push({ route: "settings-workspace", label: "Workspace" });
  }
  items.push({ route: "settings", label: "Settings" });
  return `
    <div class="settings-route-switch" role="tablist" aria-label="Settings sections">
      ${items
        .map((item) => {
          const isActive = activeRoute === item.route;
          return `
            <button
              class="settings-route-btn ${isActive ? "is-active" : ""}"
              type="button"
              role="tab"
              aria-selected="${isActive ? "true" : "false"}"
              ${isActive ? 'aria-current="page"' : ""}
              data-route="${item.route}"
            >
              <span>${item.label}</span>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

const WORKSPACE_BRAND_PRESETS = [
  { value: "#2457d6", label: "Cobalt" },
  { value: "#0f7b6c", label: "Evergreen" },
  { value: "#d4691f", label: "Copper" },
  { value: "#7b43d1", label: "Orchid" },
  { value: "#d14d6b", label: "Rose" },
  { value: "#1f2937", label: "Graphite" }
];

const WORKSPACE_HOUR_PRESETS = [
  { label: "9-6 Core", start: "09:00", end: "18:00" },
  { label: "8-5 Early", start: "08:00", end: "17:00" },
  { label: "10-7 Late", start: "10:00", end: "19:00" }
];

const WORKSPACE_SLA_PRESETS = [4, 8, 24, 48];
const WORKSPACE_FOLLOW_UP_PRESETS = [0, 1, 2, 3, 7];

function workspaceStageClass(value) {
  const normalized = String(value || "Prospecting")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
  return `stage-${normalized || "prospecting"}`;
}

function formatWorkspaceHourRange(start, end) {
  return `${String(start || "09:00")} - ${String(end || "18:00")}`;
}

function formatWorkspaceCountLabel(value, unit) {
  const count = Math.max(0, Number(value) || 0);
  return `${count} ${count === 1 ? unit : `${unit}s`}`;
}

function buildWorkspaceOwnerOptions(data, selectedOwner) {
  const options = [];
  const seen = new Set();
  const members = Array.isArray(data?.teamMembers) ? data.teamMembers : [];

  members.forEach((member) => {
    const name = String(member?.name || "").trim();
    if (!name) {
      return;
    }
    if (normalizeTeamMemberStatus(member?.status) === "Inactive") {
      return;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    const role = String(member?.role || "Member").trim() || "Member";
    options.push({
      value: name,
      label: `${name} (${role})`
    });
  });

  const normalizedSelected = String(selectedOwner || "").trim();
  if (normalizedSelected && !seen.has(normalizedSelected.toLowerCase())) {
    options.unshift({
      value: normalizedSelected,
      label: `${normalizedSelected} (Current)`
    });
  }

  return options;
}

function profileAvailabilityClass(value) {
  const normalized = String(value || "Online").trim().toLowerCase();
  if (normalized === "away" || normalized === "busy") {
    return "is-busy";
  }
  if (normalized === "offline") {
    return "is-offline";
  }
  return "is-online";
}

function formatProfileDateLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "Not updated yet";
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return "Not updated yet";
  }
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function normalizeTeamMemberIdentity(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function teamMemberMatchesRecord(member, recordId, recordName) {
  const memberId = normalizeTeamMemberIdentity(member?.id);
  const nextRecordId = normalizeTeamMemberIdentity(recordId);
  if (memberId && nextRecordId && memberId === nextRecordId) {
    return true;
  }
  const memberName = normalizeTeamMemberIdentity(member?.name);
  const nextRecordName = normalizeTeamMemberIdentity(recordName);
  return Boolean(memberName && nextRecordName && memberName === nextRecordName);
}

function teamMemberLastActiveLabel(member) {
  const lastLogin = Date.parse(String(member?.lastLoginAt || ""));
  if (Number.isFinite(lastLogin)) {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(lastLogin));
  }
  const inviteSent = Date.parse(String(member?.inviteLastSentAt || member?.invitedAt || ""));
  if (normalizeTeamMemberStatus(member?.status) === "Pending Invite" && Number.isFinite(inviteSent)) {
    return `Invited ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(inviteSent))}`;
  }
  return "Never";
}

function teamMemberRoleBadge(value) {
  const role = String(value || "Member").trim() || "Member";
  const roleClass = role.toLowerCase().replaceAll(" ", "-");
  return `<span class="status-chip role-${roleClass}">${escapeHtml(role)}</span>`;
}

function teamMemberStatusBadge(value) {
  const status = normalizeTeamMemberStatus(value || "Active");
  const tone = status.toLowerCase().replaceAll(" ", "-");
  return `<span class="team-status-chip is-${tone}">${escapeHtml(status)}</span>`;
}

function formatTeamMemberMoney(value, currency = "USD") {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "No pipeline value";
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: String(currency || "USD").trim() || "USD",
      maximumFractionDigits: 0
    }).format(numeric);
  } catch {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0
    }).format(numeric);
  }
}

function formatTeamMemberShortDate(value, emptyLabel = "No date") {
  const raw = String(value || "").trim();
  if (!raw) {
    return emptyLabel;
  }
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    return emptyLabel;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(new Date(parsed));
}

function formatTeamMemberDateTime(value, emptyLabel = "No activity yet") {
  const raw = String(value || "").trim();
  if (!raw) {
    return emptyLabel;
  }
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    return emptyLabel;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(parsed));
}

function teamMemberInfoText(icon, text, className = "lead-profile-inline-meta-item") {
  const safeText = String(text || "").trim();
  if (!safeText) {
    return "";
  }
  return `
    <span class="${escapeHtml(className)}">
      <i class="bi ${escapeHtml(icon)}" aria-hidden="true"></i>
      <span>${escapeHtml(safeText)}</span>
    </span>
  `;
}

function teamMemberTaskStatusClass(value) {
  return String(value || "New")
    .trim()
    .toLowerCase()
    .replaceAll(" ", "-") || "new";
}

function teamMemberDealStageClass(value) {
  const normalized = String(value || "Prospecting").trim().toLowerCase();
  if (normalized === "closed won" || normalized === "won") {
    return "stage-won";
  }
  if (normalized === "closed lost" || normalized === "lost") {
    return "stage-lost";
  }
  return `stage-${normalized.replaceAll(" ", "-") || "prospecting"}`;
}

function buildTeamMemberLeadRows(leads, options = {}) {
  const limit = Math.max(0, Number(options.limit || 5) || 0);
  const emptyLabel = String(options.emptyLabel || "No active leads assigned right now.").trim();
  if (!Array.isArray(leads) || !leads.length) {
    return `<p class='lead-profile-empty'>${escapeHtml(emptyLabel)}</p>`;
  }
  const rows = limit > 0 ? leads.slice(0, limit) : leads;
  return rows
    .map((lead) => {
      const companyLabel = String(lead.company || "").trim();
      const sourceLabel = String(lead.source || "").trim();
      const statusKey = teamMemberTaskStatusClass(lead.status || "New");
      const followUpLabel = String(lead.nextFollowUp || "").trim()
        ? `Follow-up ${formatTeamMemberShortDate(lead.nextFollowUp)}`
        : "No follow-up set";
      return `
        <article class="lead-profile-list-row team-member-profile-row" data-lead-open="${escapeHtml(lead.id)}">
          <div class="lead-profile-list-main">
            <p class="lead-profile-list-title">${escapeHtml(lead.name || "Lead")}</p>
            <p class="lead-profile-list-meta">
              ${teamMemberInfoText("bi-building", companyLabel || "No company")}
              ${teamMemberInfoText("bi-calendar3", followUpLabel)}
            </p>
            ${sourceLabel ? `<p class="lead-profile-list-body">${escapeHtml(sourceLabel)}</p>` : ""}
          </div>
          <span class="status-chip status-${escapeHtml(statusKey)}">${escapeHtml(lead.status || "New")}</span>
        </article>
      `;
    })
    .join("");
}

function buildTeamMemberDealRows(deals, options = {}) {
  const limit = Math.max(0, Number(options.limit || 5) || 0);
  const emptyLabel = String(options.emptyLabel || "No open deals owned right now.").trim();
  if (!Array.isArray(deals) || !deals.length) {
    return `<p class='lead-profile-empty'>${escapeHtml(emptyLabel)}</p>`;
  }
  const rows = limit > 0 ? deals.slice(0, limit) : deals;
  return rows
    .map((deal) => {
      const accountLabel = String(deal.account || "").trim();
      const stageLabel = String(deal.stage || "Prospecting").trim();
      const normalizedStageLabel =
        stageLabel === "Won" ? "Closed Won" : stageLabel === "Lost" ? "Closed Lost" : stageLabel || "Prospecting";
      const closeLabel = String(deal.closeDate || "").trim()
        ? `Closes ${formatTeamMemberShortDate(deal.closeDate)}`
        : "No close date";
      const valueLabel = formatTeamMemberMoney(deal.value, deal.currency || "USD");
      return `
        <article class="lead-profile-list-row" data-deal-open="${escapeHtml(deal.id)}">
          <div class="lead-profile-list-main">
            <p class="lead-profile-list-title">${escapeHtml(deal.name || "Deal")}</p>
            <p class="lead-profile-list-meta">
              ${teamMemberInfoText("bi-building", accountLabel || "No account")}
              ${teamMemberInfoText("bi-calendar3", closeLabel)}
            </p>
            <p class="lead-profile-list-body">${escapeHtml(valueLabel)}</p>
          </div>
          <span class="status-chip ${escapeHtml(teamMemberDealStageClass(stageLabel))}">${escapeHtml(normalizedStageLabel)}</span>
        </article>
      `;
    })
    .join("");
}

function buildTeamMemberTaskRows(tasks, options = {}) {
  const limit = Math.max(0, Number(options.limit || 6) || 0);
  const emptyLabel = String(options.emptyLabel || "No open tasks assigned right now.").trim();
  if (!Array.isArray(tasks) || !tasks.length) {
    return `<p class='lead-profile-empty'>${escapeHtml(emptyLabel)}</p>`;
  }
  const rows = limit > 0 ? tasks.slice(0, limit) : tasks;
  return rows
    .map((task) => {
      const dueLabel = String(task.dueDate || "").trim() ? formatTeamMemberShortDate(task.dueDate) : "No due date";
      const relatedLabel = String(task.projectName || task.accountName || task.linkLabel || "").trim();
      return `
        <article class="lead-profile-list-row lead-profile-task-row" data-task-open="${escapeHtml(task.id)}">
          <div class="lead-profile-list-main">
            <p class="lead-profile-list-title">${escapeHtml(task.title || "Task")}</p>
            <p class="lead-profile-list-meta">
              ${teamMemberInfoText("bi-calendar3", `Due ${dueLabel}`)}
              ${relatedLabel ? teamMemberInfoText("bi-link-45deg", relatedLabel) : ""}
            </p>
          </div>
          <span class="status-chip status-${escapeHtml(teamMemberTaskStatusClass(task.status || "New"))}">${escapeHtml(task.status || "New")}</span>
        </article>
      `;
    })
    .join("");
}

function buildTeamMemberLeadTableRows(leads) {
  if (!Array.isArray(leads) || !leads.length) {
    return "<tr><td class='task-meta' colspan='5'>No active leads assigned right now.</td></tr>";
  }
  return leads
    .map((lead) => {
      const followUpLabel = String(lead.nextFollowUp || "").trim() ? formatTeamMemberShortDate(lead.nextFollowUp) : "None";
      const statusKey = teamMemberTaskStatusClass(lead.status || "New");
      return `
        <tr data-lead-open="${escapeHtml(lead.id)}">
          <td><strong>${escapeHtml(lead.name || "Lead")}</strong></td>
          <td>${escapeHtml(lead.company || "No company")}</td>
          <td><span class="status-chip status-${escapeHtml(statusKey)}">${escapeHtml(lead.status || "New")}</span></td>
          <td>${escapeHtml(followUpLabel)}</td>
          <td>${escapeHtml(lead.source || "Direct")}</td>
        </tr>
      `;
    })
    .join("");
}

function buildTeamMemberDealTableRows(deals) {
  if (!Array.isArray(deals) || !deals.length) {
    return "<tr><td class='task-meta' colspan='5'>No open deals owned right now.</td></tr>";
  }
  return deals
    .map((deal) => {
      const stageLabel = String(deal.stage || "Prospecting").trim();
      const normalizedStageLabel =
        stageLabel === "Won" ? "Closed Won" : stageLabel === "Lost" ? "Closed Lost" : stageLabel || "Prospecting";
      const closeLabel = String(deal.closeDate || "").trim() ? formatTeamMemberShortDate(deal.closeDate) : "No close date";
      return `
        <tr data-deal-open="${escapeHtml(deal.id)}">
          <td><strong>${escapeHtml(deal.name || "Deal")}</strong></td>
          <td>${escapeHtml(deal.account || "No account")}</td>
          <td><span class="status-chip ${escapeHtml(teamMemberDealStageClass(stageLabel))}">${escapeHtml(normalizedStageLabel)}</span></td>
          <td>${escapeHtml(formatTeamMemberMoney(deal.value, deal.currency || "USD"))}</td>
          <td>${escapeHtml(closeLabel)}</td>
        </tr>
      `;
    })
    .join("");
}

function buildTeamMemberTaskTableRows(tasks) {
  if (!Array.isArray(tasks) || !tasks.length) {
    return "<tr><td class='task-meta' colspan='5'>No open tasks assigned right now.</td></tr>";
  }
  return tasks
    .map((task) => {
      const dueLabel = String(task.dueDate || "").trim() ? formatTeamMemberShortDate(task.dueDate) : "No due date";
      const relatedLabel = String(task.projectName || task.accountName || task.linkLabel || "").trim() || "General";
      const priorityLabel = String(task.priority || "Low").trim() || "Low";
      return `
        <tr data-task-open="${escapeHtml(task.id)}">
          <td><strong>${escapeHtml(task.title || "Task")}</strong></td>
          <td><span class="status-chip status-${escapeHtml(teamMemberTaskStatusClass(task.status || "New"))}">${escapeHtml(task.status || "New")}</span></td>
          <td>${escapeHtml(dueLabel)}</td>
          <td>${escapeHtml(relatedLabel)}</td>
          <td>${escapeHtml(priorityLabel)}</td>
        </tr>
      `;
    })
    .join("");
}

function buildTeamMemberActivityRows(items, options = {}) {
  const limit = Math.max(0, Number(options.limit || 8) || 0);
  const emptyLabel = String(options.emptyLabel || "No recent activity yet.").trim();
  if (!Array.isArray(items) || !items.length) {
    return `<p class='lead-profile-empty'>${escapeHtml(emptyLabel)}</p>`;
  }
  const rows = limit > 0 ? items.slice(0, limit) : items;
  return `
    <div class="team-member-activity-list">
      ${rows
        .map(
          (item) => `
            <article class="team-member-activity-row">
              <span class="team-member-activity-icon" aria-hidden="true"><i class="bi ${escapeHtml(item.icon || "bi-clock-history")}"></i></span>
              <div class="team-member-activity-main">
                <p class="team-member-activity-title">${escapeHtml(item.title || "Activity")}</p>
                <p class="team-member-activity-meta">${escapeHtml(item.meta || "")}</p>
              </div>
              <time class="team-member-activity-time">${escapeHtml(formatTeamMemberDateTime(item.timestamp || ""))}</time>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function collectTeamMemberActivity(member, leads, deals, tasks) {
  const activity = [];
  const pushActivity = (timestamp, title, meta, icon) => {
    const rawTimestamp = String(timestamp || "").trim();
    const parsed = Date.parse(rawTimestamp);
    if (!rawTimestamp || !Number.isFinite(parsed)) {
      return;
    }
    activity.push({
      timestamp: rawTimestamp,
      parsed,
      title,
      meta,
      icon
    });
  };

  pushActivity(member?.lastLoginAt, "Signed in to the workspace", member?.email || "Workspace access confirmed", "bi-box-arrow-in-right");
  pushActivity(
    member?.inviteLastSentAt || member?.invitedAt,
    isTeamMemberPendingInvite(member?.status) ? "Invite is active" : "Invite was sent",
    member?.email || "Invitation delivered to member email",
    "bi-envelope-paper"
  );
  pushActivity(
    member?.updatedAt,
    "Member profile updated",
    member?.updatedBy ? `Updated by ${member.updatedBy}` : "Workspace settings changed",
    "bi-shield-check"
  );

  (Array.isArray(leads) ? leads : []).forEach((lead) => {
    pushActivity(
      lead?.updatedAt || lead?.createdAt,
      "Lead ownership updated",
      `${lead?.name || "Lead"}${lead?.status ? ` · ${lead.status}` : ""}`,
      "bi-person-lines-fill"
    );
  });

  (Array.isArray(deals) ? deals : []).forEach((deal) => {
    pushActivity(
      deal?.updatedAt || deal?.createdAt,
      "Deal pipeline updated",
      `${deal?.name || "Deal"}${deal?.stage ? ` · ${deal.stage}` : ""}`,
      "bi-briefcase"
    );
  });

  (Array.isArray(tasks) ? tasks : []).forEach((task) => {
    pushActivity(
      task?.updatedAt || task?.createdAt,
      task?.status === "Completed" ? "Task completed" : "Task updated",
      `${task?.title || "Task"}${task?.status ? ` · ${task.status}` : ""}`,
      "bi-check2-square"
    );
  });

  return activity.sort((left, right) => right.parsed - left.parsed);
}

function renderSettingsViewMeta(items) {
  const values = (Array.isArray(items) ? items : [])
    .map((item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        return {
          value: String(item.value || "").trim(),
          className: String(item.className || "")
            .trim()
            .replace(/[^a-z0-9_-]+/gi, " ")
            .trim()
        };
      }
      return {
        value: String(item || "").trim(),
        className: ""
      };
    })
    .filter((item) => item.value);
  if (!values.length) {
    return "";
  }
  return `
    <div class="settings-view-meta">
      ${values
        .map(
          (item) =>
            `<span${item.className ? ` class="${escapeHtml(item.className)}"` : ""}>${escapeHtml(item.value)}</span>`
        )
        .join("")}
    </div>
  `;
}

function renderSettingsViewGrid(items, extraClass = "") {
  const className = String(extraClass || "").trim();
  return `
    <div class="settings-view-grid${className ? ` ${className}` : ""}">
      ${(Array.isArray(items) ? items : [])
        .map((item) => {
          const label = String(item?.label || "").trim();
          const rawValue = item?.value;
          const normalizedValue = rawValue === 0 ? "0" : String(rawValue || "").trim();
          const displayValue = normalizedValue || String(item?.emptyLabel || "Not set").trim() || "Not set";
          return `
            <div class="settings-view-item">
              <span>${escapeHtml(label)}</span>
              <strong>${escapeHtml(displayValue)}</strong>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderSettingsSkeletonBar(width = "100%", extraClass = "") {
  const safeWidth = String(width || "100%").trim() || "100%";
  const className = String(extraClass || "").trim();
  return `<span class="settings-skeleton-bar${className ? ` ${className}` : ""}" style="width:${escapeHtml(safeWidth)}" aria-hidden="true"></span>`;
}

function shouldRenderProfileSkeleton(data, context = {}) {
  const currentUser = data?.currentUser && typeof data.currentUser === "object" ? data.currentUser : {};
  const currentMember = getCurrentMember(data);
  const hasIdentity = Boolean(
    String(currentUser.name || "").trim() ||
      String(currentUser.email || "").trim() ||
      String(currentMember?.id || "").trim()
  );
  return Boolean(
    context?.authBootstrapPending ||
      context?.authAccessState === "loading" ||
      (context?.supabaseConfigured && context?.signedInUser && !hasIdentity)
  );
}

function renderProfileSkeleton(data) {
  return {
    title: "Profile",
    subtitle: "Your identity across the workspace",
    showWaitingPanel: false,
    html: `
      <section class="view-block settings-page settings-profile-view profile-hub-view is-loading" aria-busy="true">
        <div class="settings-page-head">${renderSettingsRouteSwitch(data, "settings-me")}</div>
        <section class="profile-hub-hero profile-hub-skeleton-hero">
          <div class="profile-hub-hero-main">
            <span class="settings-skeleton-avatar" aria-hidden="true"></span>
            <div class="profile-hub-hero-copy settings-profile-skeleton-copy">
              ${renderSettingsSkeletonBar("72px", "is-chip")}
              ${renderSettingsSkeletonBar("240px", "is-title")}
              ${renderSettingsSkeletonBar("220px")}
              ${renderSettingsSkeletonBar("180px")}
              <div class="settings-view-meta settings-profile-skeleton-meta">
                ${renderSettingsSkeletonBar("78px", "is-chip")}
                ${renderSettingsSkeletonBar("96px", "is-chip")}
                ${renderSettingsSkeletonBar("82px", "is-chip")}
              </div>
            </div>
          </div>
          <div class="profile-hub-hero-actions">
            <span class="settings-skeleton-button" aria-hidden="true"></span>
            <span class="settings-skeleton-button" aria-hidden="true"></span>
          </div>
        </section>

        <nav class="profile-hub-tabs profile-hub-tabs-skeleton" aria-hidden="true">
          ${[0, 1, 2, 3, 4]
            .map(() => `<span class="settings-skeleton-bar is-chip" style="width:96px"></span>`)
            .join("")}
        </nav>

        <div class="profile-hub-shell">
          <aside class="profile-hub-sidebar">
            <article class="profile-hub-sidecard">
              <span class="settings-skeleton-avatar" aria-hidden="true"></span>
              ${renderSettingsSkeletonBar("160px", "is-title")}
              ${renderSettingsSkeletonBar("180px")}
              ${renderSettingsSkeletonBar("72px", "is-chip")}
              <div class="profile-hub-side-list">
                ${[0, 1, 2, 3, 4]
                  .map(
                    () => `
                      <div class="profile-hub-side-row">
                        ${renderSettingsSkeletonBar("74px", "is-label")}
                        ${renderSettingsSkeletonBar("110px")}
                      </div>
                    `
                  )
                  .join("")}
              </div>
              <div class="profile-hub-side-actions">
                <span class="settings-skeleton-button" aria-hidden="true"></span>
                <span class="settings-skeleton-button" aria-hidden="true"></span>
              </div>
            </article>
          </aside>
          <div class="profile-hub-main profile-hub-stack">
            <section class="profile-hub-stat-grid">
              ${[0, 1, 2, 3]
                .map(
                  () => `
                    <article class="profile-hub-stat-card settings-view-item-skeleton">
                      ${renderSettingsSkeletonBar("68px", "is-label")}
                      ${renderSettingsSkeletonBar("84%")}
                    </article>
                  `
                )
                .join("")}
            </section>
            <section class="profile-hub-card">
              <div class="profile-hub-panel-head">
                <div>
                  ${renderSettingsSkeletonBar("90px", "is-label")}
                  ${renderSettingsSkeletonBar("220px", "is-title")}
                </div>
              </div>
              <div class="settings-view-grid settings-view-grid-wide profile-hub-detail-grid">
                ${[0, 1, 2, 3, 4, 5]
                  .map(
                    () => `
                      <div class="settings-view-item settings-view-item-skeleton">
                        ${renderSettingsSkeletonBar("76px", "is-label")}
                        ${renderSettingsSkeletonBar("82%")}
                      </div>
                    `
                  )
                  .join("")}
              </div>
            </section>
            <section class="profile-hub-card">
              <div class="profile-hub-panel-head">
                <div>
                  ${renderSettingsSkeletonBar("84px", "is-label")}
                  ${renderSettingsSkeletonBar("200px", "is-title")}
                </div>
              </div>
              <div class="team-member-activity-list">
                ${[0, 1, 2]
                  .map(
                    () => `
                      <article class="team-member-activity-row">
                        <span class="settings-skeleton-avatar" aria-hidden="true"></span>
                        <div class="team-member-activity-main">
                          ${renderSettingsSkeletonBar("180px")}
                          ${renderSettingsSkeletonBar("120px", "is-label")}
                        </div>
                        ${renderSettingsSkeletonBar("88px", "is-label")}
                      </article>
                    `
                  )
                  .join("")}
              </div>
            </section>
          </div>
        </div>
      </section>
    `
  };
}

function getCurrentMember(data) {
  const currentUser = data.currentUser && typeof data.currentUser === "object" ? data.currentUser : {};
  return (
    (data.teamMembers || []).find((member) => String(member.id || "") === String(currentUser.id || "")) ||
    (data.teamMembers || []).find((member) => String(member.name || "").trim() === String(currentUser.name || "").trim()) ||
    null
  );
}

function getProfilePageModel(data) {
  const currentUser = data.currentUser && typeof data.currentUser === "object" ? data.currentUser : {};
  const currentMember = getCurrentMember(data);
  const fullName = String(currentUser.name || currentMember?.name || "").trim() || "Workspace User";
  return {
    currentUser,
    currentMember,
    fullName,
    emailValue: String(currentUser.email || currentMember?.email || "").trim(),
    phoneValue: String(currentUser.phone || currentMember?.phone || "").trim(),
    titleValue: String(currentUser.title || currentMember?.title || "").trim(),
    roleValue: String(currentUser.role || currentMember?.role || "Member").trim() || "Member",
    teamValue: String(currentMember?.team || "").trim(),
    availability: String(currentUser.availability || currentMember?.availability || "Online").trim() || "Online",
    timezone: String(currentUser.timezone || currentMember?.timezone || "Local").trim() || "Local",
    language: String(currentUser.language || currentMember?.language || "English").trim() || "English",
    managerValue: String(currentMember?.manager || "").trim(),
    avatarUrl: String(currentUser.avatarUrl || currentMember?.avatarUrl || "").trim(),
    initials: memberInitials(fullName)
  };
}

function getWorkspacePageModel(data) {
  const attendancePolicy = data.attendancePolicy && typeof data.attendancePolicy === "object" ? data.attendancePolicy : {};
  const businessDays = Array.isArray(data.workspace?.businessDays) ? data.workspace.businessDays : attendancePolicy.workDays || [1, 2, 3, 4, 5];
  const workspace = {
    id: String(data.workspace?.id || "").trim(),
    name: String(data.workspace?.name || "Workspace"),
    legalName: String(data.workspace?.legalName || data.workspace?.name || "Workspace LLC"),
    logoUrl: String(data.workspace?.logoUrl || ""),
    brandColor: normalizeSettingsBrandColor(data.workspace?.brandColor || "#2f68df"),
    appLabel: normalizeSystemAppLabel(data.workspace?.appLabel),
    timezone: String(data.workspace?.timezone || attendancePolicy.timezone || "Local"),
    dateFormat: String(data.workspace?.dateFormat || "YYYY-MM-DD"),
    currency: String(data.workspace?.currency || "USD"),
    weekStart: String(data.workspace?.weekStart || "Mon"),
    businessStart: String(data.workspace?.businessStart || attendancePolicy.shiftStart || "09:00"),
    businessEnd: String(data.workspace?.businessEnd || attendancePolicy.shiftEnd || "18:00"),
    businessDays,
    website: String(data.workspace?.website || ""),
    supportEmail: String(data.workspace?.supportEmail || ""),
    supportPhone: String(data.workspace?.supportPhone || ""),
    businessAddress: String(data.workspace?.businessAddress || ""),
    crmDefaultStage: String(data.workspace?.crmDefaultStage || "Prospecting"),
    crmDefaultOwner: String(data.workspace?.crmDefaultOwner || ""),
    crmSlaHours: Math.max(0, Number(data.workspace?.crmSlaHours || 24) || 24),
    crmFollowUpDays: Math.max(0, Number(data.workspace?.crmFollowUpDays || 2) || 2),
    createdAt: String(data.workspace?.createdAt || "").trim()
  };
  const activeMembers = (Array.isArray(data.teamMembers) ? data.teamMembers : []).filter(
    (member) => normalizeTeamMemberStatus(member?.status) === "Active"
  );
  const primaryAdmin =
    activeMembers.find((member) => {
      const role = String(member?.role || "").trim().toLowerCase();
      return role === "owner" || role === "admin";
    }) || null;

  return {
    workspace,
    logoUrl: resolveBrandLogoUrl(workspace.logoUrl),
    businessDaysLabel: formatWorkspaceBusinessDays(workspace.businessDays),
    businessHoursLabel: formatWorkspaceHourRange(workspace.businessStart, workspace.businessEnd),
    teamCountLabel: formatWorkspaceCountLabel(activeMembers.length, "member"),
    primaryAdminLabel: String(primaryAdmin?.name || "").trim(),
    createdAtLabel: formatProfileDateLabel(workspace.createdAt)
  };
}

function collectProfileOwnedCollections(data, profile) {
  const member = profile?.currentMember;
  if (!member) {
    return {
      ownedLeads: [],
      openDeals: [],
      assignedTasks: [],
      openTasks: [],
      ownedAccounts: []
    };
  }
  const ownedLeads = (Array.isArray(data?.leads) ? data.leads : []).filter(
    (lead) =>
      !lead?.archived &&
      String(lead?.status || "").trim() !== "Archived" &&
      teamMemberMatchesRecord(member, lead?.ownerId, lead?.owner)
  );
  const openDeals = (Array.isArray(data?.deals) ? data.deals : []).filter((deal) => {
    if (deal?.archived || !teamMemberMatchesRecord(member, deal?.ownerId, deal?.owner)) {
      return false;
    }
    const stage = String(deal?.stage || "").trim().toLowerCase();
    return !["won", "lost", "closed won", "closed lost"].includes(stage);
  });
  const assignedTasks = (Array.isArray(data?.tasks) ? data.tasks : []).filter((task) =>
    teamMemberMatchesRecord(member, task?.assigneeId, task?.assignee)
  );
  const openTasks = assignedTasks.filter((task) => String(task?.status || "").trim() !== "Completed");
  const ownedAccounts = (Array.isArray(data?.accounts) ? data.accounts : []).filter(
    (account) => !account?.archived && teamMemberMatchesRecord(member, account?.ownerId, account?.owner)
  );
  return {
    ownedLeads,
    openDeals,
    assignedTasks,
    openTasks,
    ownedAccounts
  };
}

function renderProfileHubTabButton(id, label, icon, activeTab) {
  const isActive = activeTab === id;
  return `
    <button
      type="button"
      class="profile-hub-tab ${isActive ? "is-active" : ""}"
      role="tab"
      aria-selected="${isActive ? "true" : "false"}"
      data-action="profile-view-tab"
      data-id="${escapeHtml(id)}"
    >
      <i class="bi ${escapeHtml(icon)}" aria-hidden="true"></i>
      <span>${escapeHtml(label)}</span>
    </button>
  `;
}

function formatProfileRelativeTime(value, emptyLabel = "Just now") {
  const raw = String(value || "").trim();
  if (!raw) {
    return emptyLabel;
  }
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    return emptyLabel;
  }
  const diffMs = Date.now() - parsed;
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  if (diffMs < minuteMs) {
    return "Just now";
  }
  if (diffMs < hourMs) {
    const mins = Math.max(1, Math.round(diffMs / minuteMs));
    return `${mins} min${mins === 1 ? "" : "s"} ago`;
  }
  if (diffMs < dayMs) {
    const hours = Math.max(1, Math.round(diffMs / hourMs));
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.max(1, Math.round(diffMs / dayMs));
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function buildProfileHubActivityTimeline(items, options = {}) {
  const limit = Math.max(0, Number(options.limit || 5) || 0);
  const emptyLabel = String(options.emptyLabel || "No recent account activity yet.").trim();
  if (!Array.isArray(items) || !items.length) {
    return `<p class="lead-profile-empty">${escapeHtml(emptyLabel)}</p>`;
  }
  const rows = limit > 0 ? items.slice(0, limit) : items;
  return `
    <div class="profile-hub-activity-list">
      ${rows
        .map(
          (item) => `
            <article class="profile-hub-activity-item">
              <span class="profile-hub-activity-marker" aria-hidden="true"><i class="bi ${escapeHtml(item.icon || "bi-clock-history")}"></i></span>
              <div class="profile-hub-activity-body">
                <strong>${escapeHtml(item.title || "Activity")}</strong>
                <span>${escapeHtml(item.meta || "")}</span>
              </div>
              <time class="profile-hub-activity-time">${escapeHtml(formatProfileRelativeTime(item.timestamp || ""))}</time>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

export function renderWorkspaceProfile(data, context) {
  if (!canAccessWorkspaceProfile(data)) {
    return {
      title: "Workspace",
      subtitle: "Admins only",
      showWaitingPanel: false,
      html: `
        <section class="view-block settings-page settings-workspace-view">
          <div class="settings-page-head">${renderSettingsRouteSwitch(data, "settings-me")}</div>
          <div class="settings-access-card">
            <div class="settings-access-card-icon">
              <i class="bi bi-shield-lock" aria-hidden="true"></i>
            </div>
            <div class="settings-access-card-copy">
              <h4>Workspace access is restricted</h4>
              <p>Only workspace Owners and Admins can open the workspace profile.</p>
            </div>
            <div class="settings-form-actions">
              <button type="button" class="table-ops-columns-btn" data-route="settings-me">
                <i class="bi bi-person-circle" aria-hidden="true"></i>
                <span>Open Profile</span>
              </button>
            </div>
          </div>
        </section>
      `
    };
  }

  void context;
  const model = getWorkspacePageModel(data);
  const workspace = model.workspace;

  return {
    title: "Workspace",
    subtitle: "Workspace identity across your account",
    showWaitingPanel: false,
    html: `
      <section class="view-block settings-page settings-workspace-view">
        <div class="settings-page-head">${renderSettingsRouteSwitch(data, "settings-workspace")}</div>
        <section class="settings-view-hero">
          <div class="workspace-profile-identity-head">
            <button
              type="button"
              class="workspace-profile-logo-button"
              data-action="workspace-logo-edit"
              data-workspace-logo-trigger
              aria-label="${escapeHtml(workspace.logoUrl ? "Change workspace logo" : "Add workspace logo")}"
            >
              <span class="workspace-profile-logo-preview" data-workspace-logo-preview aria-hidden="true" style="--workspace-brand:${escapeHtml(workspace.brandColor)}">
                <img src="${escapeHtml(model.logoUrl)}" alt="${escapeHtml(workspace.appLabel)}" />
              </span>
              <span class="workspace-profile-logo-edit-badge" aria-hidden="true">
                <i class="bi bi-pencil" aria-hidden="true"></i>
              </span>
            </button>
            <div class="workspace-profile-identity-copy">
              <h5>${escapeHtml(workspace.name)}</h5>
              <p class="workspace-profile-identity-legal">${escapeHtml(workspace.legalName || `${workspace.name} LLC`)}</p>
              ${renderSettingsViewMeta([
                workspace.website || "",
                workspace.supportEmail || "",
                `${model.businessDaysLabel} | ${model.businessHoursLabel}`
              ])}
            </div>
          </div>
          <div class="settings-view-actions">
            <button type="button" class="table-ops-columns-btn" data-route="settings">
              <i class="bi bi-gear" aria-hidden="true"></i>
              <span>Manage in Settings</span>
            </button>
          </div>
        </section>

        <section class="settings-flat-section">
          <div class="settings-flat-section-copy">
            <h4>Workspace Details</h4>
            <p>The shared identity your team sees throughout the app.</p>
          </div>
          <div class="settings-flat-section-body">
            ${renderSettingsViewGrid([
              { label: "Display Label", value: workspace.appLabel },
              { label: "Legal Name", value: workspace.legalName },
              { label: "Website", value: workspace.website, emptyLabel: "No website" },
              { label: "Business Address", value: workspace.businessAddress, emptyLabel: "No address set" }
            ])}
          </div>
        </section>

        <section class="settings-flat-section">
          <div class="settings-flat-section-copy">
            <h4>Support &amp; Operations</h4>
            <p>Reference details for support channels, operating rhythm, and workspace ownership.</p>
          </div>
          <div class="settings-flat-section-body">
            ${renderSettingsViewGrid([
              { label: "Support Email", value: workspace.supportEmail, emptyLabel: "No support email" },
              { label: "Support Phone", value: workspace.supportPhone, emptyLabel: "No support phone" },
              { label: "Timezone", value: workspace.timezone },
              { label: "Business Hours", value: model.businessHoursLabel },
              { label: "Business Days", value: model.businessDaysLabel },
              { label: "Currency", value: workspace.currency },
              { label: "Week Starts", value: workspace.weekStart },
              { label: "Date Format", value: workspace.dateFormat },
              { label: "Primary Admin", value: model.primaryAdminLabel, emptyLabel: "No admin assigned" },
              { label: "Active Team", value: model.teamCountLabel },
              { label: "Created", value: model.createdAtLabel }
            ], "settings-view-grid-wide")}
          </div>
        </section>
      </section>
    `
  };
}

export function renderLoginView(data, context) {
  const workspaceName = String(data.workspace?.name || SYSTEM_APP_NAME).trim() || SYSTEM_APP_NAME;
  const brandLabel = normalizeSystemAppLabel(data.workspace?.appLabel);
  const brandLogoUrl = resolveBrandLogoUrl(data.workspace?.logoUrl);
  const signedInUser = context.signedInUser && typeof context.signedInUser === "object" ? context.signedInUser : null;
  const signedInEmail = String(signedInUser?.email || "").trim();
  const draftEmail = String(context.loginEmailDraft || signedInEmail || "").trim().toLowerCase();
  const passwordDraft = String(context.loginPasswordDraft || "").trim();
  const otpDraft = String(context.loginOtpDraft || "").trim();
  const otpSentTo = String(context.loginOtpSentTo || "").trim().toLowerCase();
  const pendingPasswordSetupEmail = String(context.loginPendingPasswordSetupEmail || "").trim().toLowerCase();
  const passwordSetupDraft = String(context.loginPasswordSetupDraft || "").trim();
  const passwordSetupConfirmDraft = String(context.loginPasswordSetupConfirmDraft || "").trim();
  const loginViewMode = String(context.loginViewMode || "").trim().toLowerCase() === "signup" ? "signup" : "signin";
  const loginEmailLookupStatus =
    context.loginEmailLookupStatus && typeof context.loginEmailLookupStatus === "object"
      ? context.loginEmailLookupStatus
      : { loading: false, email: "", recognized: false, active: false, pending: false, error: "" };
  const authActionPending = String(context.authActionPending || "").trim();
  const authAccessState = String(context.authAccessState || "").trim();
  const accessMessage = String(context.authAccessMessage || "").trim();
  const postLoginRouteLabel = String(context.postLoginRouteLabel || "").trim();
  const isGooglePending = authActionPending === "google-sign-in";
  const isPasswordPending = authActionPending === "email-password";
  const isOtpSendPending = authActionPending === "login-send-otp";
  const isOtpVerifyPending = authActionPending === "login-verify-otp";
  const isPasswordSetupPending = authActionPending === "login-setup-password";
  const isAnyEmailPending = isPasswordPending || isOtpSendPending || isOtpVerifyPending || isPasswordSetupPending;
  const isSyncingAccess = Boolean(signedInUser) && authAccessState === "loading";
  const isBlocked = Boolean(signedInUser) && authAccessState === "blocked";
  const isSessionChecking = Boolean(context.authBootstrapPending && !signedInUser);
  const lookupEmail = String(loginEmailLookupStatus.email || "").trim().toLowerCase();
  const isLookupMatch = Boolean(draftEmail && lookupEmail && draftEmail === lookupEmail);
  const isActiveWorkspaceEmail = Boolean(!signedInUser && isLookupMatch && loginEmailLookupStatus.active);
  const isPendingInviteEmail = Boolean(!signedInUser && isLookupMatch && loginEmailLookupStatus.pending);
  const nextRouteCopy = postLoginRouteLabel
    ? `After sign-in, you'll return to ${postLoginRouteLabel}.`
    : `After sign-in, you'll land in ${workspaceName}.`;
  const panelStage = pendingPasswordSetupEmail ? "setup" : otpSentTo ? "otp" : loginViewMode === "signup" ? "signup" : "signin";
  const isSignupMode = panelStage !== "signin";
  const disablePrimaryForms = isGooglePending || isAnyEmailPending;
  const cardClassName = `auth-login-card${isSignupMode ? " is-signup-mode" : ""}`;
  let panelTitle = isSignupMode ? "Create your account" : "Welcome back";
  let panelSubtitle = isSignupMode
    ? `Use the invited email for ${workspaceName} to verify access and finish setup.`
    : `Sign in to continue to ${workspaceName}.`;

  let panelBody = "";

  if (isSyncingAccess) {
    panelTitle = "Checking workspace access";
    panelSubtitle = "We are confirming your membership and preparing the right workspace.";
    panelBody = `
      <div class="auth-login-status is-info">
        <div class="auth-login-status-icon"><span class="invite-accept-spinner" aria-hidden="true"></span></div>
        <div>
          <p class="auth-login-status-title">Checking workspace access</p>
          <p>We're confirming ${escapeHtml(signedInEmail || "your account")} and preparing your workspace.</p>
        </div>
      </div>
      <div class="auth-login-note">
        <p>${escapeHtml(nextRouteCopy)}</p>
      </div>
    `;
  } else if (isBlocked) {
    panelTitle = "Workspace access is not active";
    panelSubtitle = "This account signed in successfully, but there is no active workspace membership yet.";
    panelBody = `
      <div class="auth-login-status is-danger">
        <div class="auth-login-status-icon"><i class="bi bi-shield-lock" aria-hidden="true"></i></div>
        <div>
          <p class="auth-login-status-title">Workspace access is not active</p>
          <p>${escapeHtml(accessMessage || `No active workspace membership was found for ${signedInEmail}.`)}</p>
        </div>
      </div>
      <div class="auth-login-account">
        <span class="auth-login-account-label">Signed in account</span>
        <strong>${escapeHtml(signedInEmail || "Unknown account")}</strong>
      </div>
      <div class="auth-login-actions auth-login-actions-compact">
        <button class="btn btn-light" type="button" data-action="auth-sign-out">Sign Out</button>
      </div>
    `;
  } else if (isSessionChecking) {
    panelTitle = "Checking your session";
    panelSubtitle = "Hang on while we confirm whether you are already signed in.";
    panelBody = `
      <div class="auth-login-status is-info">
        <div class="auth-login-status-icon"><span class="invite-accept-spinner" aria-hidden="true"></span></div>
        <div>
          <p class="auth-login-status-title">Checking your session</p>
          <p>Hang on while we confirm whether you're already signed in.</p>
        </div>
      </div>
    `;
  } else if (panelStage === "setup") {
    panelTitle = "Create your password";
    panelSubtitle = "Your email is verified. Finish setup once, then use email and password the next time you log in.";
    panelBody = `
      <div class="auth-login-status is-success">
        <div class="auth-login-status-icon"><i class="bi bi-shield-check" aria-hidden="true"></i></div>
        <div>
          <p class="auth-login-status-title">Email verified</p>
          <p>Create your password for <strong>${escapeHtml(pendingPasswordSetupEmail)}</strong>. After that, email sign-in will use your password instead of a code.</p>
        </div>
      </div>
      <div class="auth-login-account">
        <span class="auth-login-account-label">Verified Email</span>
        <strong>${escapeHtml(pendingPasswordSetupEmail)}</strong>
      </div>
      <form id="loginPasswordSetupForm" class="auth-login-form">
        ${renderAuthPasswordField({
          fieldId: "loginPasswordSetupInput",
          label: "Create password",
          name: "password",
          value: passwordSetupDraft,
          placeholder: "At least 8 characters",
          autocomplete: "new-password",
          extraAttributes: 'data-login-password-setup-input="password"',
          disabled: isPasswordSetupPending
        })}
        ${renderAuthPasswordField({
          fieldId: "loginPasswordSetupConfirmInput",
          label: "Confirm password",
          name: "confirmPassword",
          value: passwordSetupConfirmDraft,
          placeholder: "Repeat your password",
          autocomplete: "new-password",
          extraAttributes: 'data-login-password-setup-input="confirm"',
          disabled: isPasswordSetupPending
        })}
        <button class="btn btn-light auth-login-magic" type="submit" ${isPasswordSetupPending ? "disabled" : ""}>
          ${isPasswordSetupPending ? "Saving Password..." : "Save Password and Continue"}
        </button>
      </form>
      <div class="auth-login-secondary-row">
        <button class="auth-login-link" type="button" data-action="auth-sign-out" ${isPasswordSetupPending ? "disabled" : ""}>
          Start over with a different account
        </button>
      </div>
      <div class="auth-login-note">
        <p>${escapeHtml(nextRouteCopy)}</p>
      </div>
    `;
  } else if (panelStage === "otp") {
    panelTitle = "Verify your email";
    panelSubtitle = "Enter the code we sent to the invited email, then you will create your password.";
    panelBody = `
      <div class="auth-login-status is-success">
        <div class="auth-login-status-icon"><i class="bi bi-envelope-check" aria-hidden="true"></i></div>
        <div>
          <p class="auth-login-status-title">Check your inbox</p>
          <p>We sent a one-time code to <strong>${escapeHtml(otpSentTo)}</strong>. Enter it below to verify this email.</p>
        </div>
      </div>
      <form id="loginOtpVerifyForm" class="auth-login-form">
        <label class="auth-login-field" for="loginOtpInput">
          <span>Verification code</span>
          <input
            id="loginOtpInput"
            class="auth-login-input auth-login-code-input"
            name="token"
            type="text"
            value="${escapeHtml(otpDraft)}"
            placeholder="123456"
            inputmode="numeric"
            autocomplete="one-time-code"
            data-login-otp-input
            required
            ${isOtpVerifyPending ? "disabled" : ""}
          />
        </label>
        <button class="btn btn-light auth-login-magic" type="submit" ${isOtpVerifyPending ? "disabled" : ""}>
          ${isOtpVerifyPending ? "Verifying..." : "Verify Code"}
        </button>
      </form>
      <div class="auth-login-secondary-row">
        <button class="auth-login-link" type="button" data-action="login-resend-otp" ${isOtpSendPending || isOtpVerifyPending ? "disabled" : ""}>
          ${isOtpSendPending ? "Sending another code..." : "Resend code"}
        </button>
        <button class="auth-login-link" type="button" data-action="login-cancel-otp" ${isOtpSendPending || isOtpVerifyPending ? "disabled" : ""}>
          Back to signup
        </button>
      </div>
      <div class="auth-login-note">
        <p>Use the code to verify your invited email, then set or reset your password.</p>
        <p>${escapeHtml(nextRouteCopy)}</p>
      </div>
    `;
  } else if (panelStage === "signup") {
    panelBody = `
      ${
        isPendingInviteEmail
          ? `
            <div class="auth-login-status is-info">
              <div class="auth-login-status-icon"><i class="bi bi-envelope-open" aria-hidden="true"></i></div>
              <div>
                <p class="auth-login-status-title">Invite found</p>
                <p><strong>${escapeHtml(draftEmail)}</strong> is ready for account setup. We will send a verification code next.</p>
              </div>
            </div>
          `
          : ""
      }
      ${
        isLookupMatch && loginEmailLookupStatus.error
          ? `
            <div class="auth-login-status is-danger">
              <div class="auth-login-status-icon"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i></div>
              <div>
                <p class="auth-login-status-title">We couldn't verify that invite yet</p>
                <p>${escapeHtml(loginEmailLookupStatus.error)}</p>
              </div>
            </div>
          `
          : ""
      }
      <form id="loginSignupStartForm" class="auth-login-form">
          <label class="auth-login-field" for="loginSignupEmailInput">
            <span>Invited email address</span>
            <input
              id="loginSignupEmailInput"
              class="auth-login-input"
              name="email"
              type="text"
              value="${escapeHtml(draftEmail)}"
              placeholder="name@company.com"
              inputmode="email"
              autocomplete="email"
              autocapitalize="none"
              spellcheck="false"
              data-login-email-input
              required
              ${disablePrimaryForms ? "disabled" : ""}
            />
          </label>
        <button class="btn btn-light auth-login-magic" type="submit" ${disablePrimaryForms ? "disabled" : ""}>
          ${isOtpSendPending ? "Sending Code..." : isLookupMatch && loginEmailLookupStatus.error ? "Try Again" : "Send Verification Code"}
        </button>
      </form>
      <div class="auth-login-secondary-row">
        <p class="auth-login-switch-copy">Already have an account?</p>
        <button class="auth-login-link" type="button" data-action="login-switch-signin" ${disablePrimaryForms ? "disabled" : ""}>
          Log in
        </button>
      </div>
      <div class="auth-login-note">
        <p>Only invited workspace emails can create an account here.</p>
      </div>
    `;
  } else {
    panelBody = `
      <div class="auth-login-actions">
        <button class="btn btn-accent auth-login-google" type="button" data-action="auth-sign-in" ${disablePrimaryForms ? "disabled" : ""}>
          <i class="bi bi-google" aria-hidden="true"></i>
          <span>${isGooglePending ? "Opening Google..." : "Continue with Google"}</span>
        </button>
        <div class="auth-login-divider" aria-hidden="true">
          <span></span>
          <small>or</small>
          <span></span>
        </div>
        <form id="loginPasswordForm" class="auth-login-form">
          <label class="auth-login-field" for="loginEmailInput">
            <span>Email address</span>
            <input
              id="loginEmailInput"
              class="auth-login-input"
              name="email"
              type="text"
              value="${escapeHtml(draftEmail)}"
              placeholder="name@company.com"
              inputmode="email"
              autocomplete="email"
              autocapitalize="none"
              spellcheck="false"
              data-login-email-input
              required
              ${disablePrimaryForms ? "disabled" : ""}
            />
          </label>
          ${renderAuthPasswordField({
            fieldId: "loginPasswordInput",
            label: "Password",
            name: "password",
            value: passwordDraft,
            placeholder: "Enter your password",
            autocomplete: "current-password",
            extraAttributes: "data-login-password-input",
            disabled: disablePrimaryForms
          })}
          <button class="btn btn-light auth-login-magic" type="submit" ${disablePrimaryForms ? "disabled" : ""}>
            ${isPasswordPending ? "Signing In..." : "Sign in with Email"}
          </button>
        </form>
        <div class="auth-login-secondary-row">
          <p class="auth-login-switch-copy">Doesn't have an account?</p>
          <button class="auth-login-link" type="button" data-action="login-switch-signup" ${disablePrimaryForms ? "disabled" : ""}>
            Sign up
          </button>
        </div>
      </div>
      <div class="auth-login-note">
        <p>Use the same email your workspace invited.</p>
      </div>
    `;
  }

  return {
    title: isSignupMode ? "Set Up Account" : "Sign In",
    subtitle: "Workspace access",
    showWaitingPanel: false,
    html: `
      <section class="auth-login-view">
        <div class="auth-login-shell">
          <article class="${cardClassName}">
            <div class="auth-login-brand-panel">
              <div class="auth-login-brand-wave auth-login-brand-wave-a" aria-hidden="true"></div>
              <div class="auth-login-brand-wave auth-login-brand-wave-b" aria-hidden="true"></div>
              <div class="auth-login-brand-wave auth-login-brand-wave-c" aria-hidden="true"></div>
              <div class="auth-login-brand-inner">
                <div class="auth-login-brand-lockup">
                  <div class="auth-login-brand-mark">
                    <img src="${escapeHtml(brandLogoUrl)}" alt="${escapeHtml(brandLabel)}" />
                  </div>
                  <div class="auth-login-brand-copy">
                    <strong>${escapeHtml(brandLabel)}</strong>
                  </div>
                </div>
              </div>
            </div>

            <div class="auth-login-form-panel">
              <div class="auth-login-card-head">
                <h3>${escapeHtml(panelTitle)}</h3>
                <p>${escapeHtml(panelSubtitle)}</p>
              </div>
              ${panelBody}
            </div>
          </article>
        </div>
      </section>
    `
  };
}

function renderAuthPasswordField({
  fieldId,
  label,
  name,
  value,
  placeholder,
  autocomplete,
  extraAttributes = "",
  disabled = false
}) {
  return `
    <label class="auth-login-field" for="${escapeHtml(fieldId)}">
      <span>${escapeHtml(label)}</span>
      <div class="auth-password-shell">
        <input
          id="${escapeHtml(fieldId)}"
          class="auth-login-input has-password-toggle"
          name="${escapeHtml(name)}"
          type="password"
          value="${escapeHtml(value)}"
          placeholder="${escapeHtml(placeholder)}"
          autocomplete="${escapeHtml(autocomplete)}"
          ${extraAttributes}
          required
          ${disabled ? "disabled" : ""}
        />
        <button
          class="auth-password-toggle"
          type="button"
          data-action="auth-toggle-password-visibility"
          data-password-toggle-target="${escapeHtml(fieldId)}"
          aria-label="Show password"
          title="Show password"
          ${disabled ? "disabled" : ""}
        >
          <i class="bi bi-eye" aria-hidden="true"></i>
        </button>
      </div>
    </label>
  `;
}

export function renderInviteAcceptance(_data, context) {
  const invite = context.inviteContext && typeof context.inviteContext === "object" ? context.inviteContext : null;
  const inviteId = String(invite?.inviteId || "").trim();
  const token = String(invite?.token || "").trim();
  const email = String(invite?.email || "").trim();
  const name = String(invite?.name || "").trim();
  const role = String(invite?.role || "Member").trim() || "Member";
  const team = String(invite?.team || "General").trim() || "General";
  const workspace = String(invite?.workspace || "Workspace").trim() || "Workspace";
  const invitedBy = String(invite?.invitedBy || "Admin").trim() || "Admin";
  const inviteLookupStatus =
    context.inviteLookupStatus && typeof context.inviteLookupStatus === "object"
      ? context.inviteLookupStatus
      : { loading: false, error: "" };
  const signedInEmail = String(context.signedInUser?.email || "").trim().toLowerCase();
  const invitedEmail = String(email || "").trim().toLowerCase();
  const isSignedIn = Boolean(signedInEmail);
  const wrongEmail = isSignedIn && invitedEmail && signedInEmail !== invitedEmail;
  const isProcessing = isSignedIn && !wrongEmail && context.authAccessState === "loading";
  const routeMessage = String(context.inviteRouteMessage || "").trim();
  const routeLink = String(context.inviteRouteLink || "").trim();
  const inviteOtpDraft = String(context.inviteOtpDraft || "").trim();
  const inviteOtpSentTo = String(context.inviteOtpSentTo || "").trim().toLowerCase();
  const invitePendingPasswordSetupEmail = String(context.invitePendingPasswordSetupEmail || "").trim().toLowerCase();
  const invitePasswordSetupDraft = String(context.invitePasswordSetupDraft || "").trim();
  const invitePasswordSetupConfirmDraft = String(context.invitePasswordSetupConfirmDraft || "").trim();
  const authActionPending = String(context.authActionPending || "").trim();
  const isInviteOtpSendPending = authActionPending === "invite-send-otp";
  const isInviteOtpVerifyPending = authActionPending === "invite-verify-otp";
  const isInvitePasswordSetupPending = authActionPending === "invite-setup-password";
  const hasValidInvite = Boolean(token && invitedEmail);
  const isLookupLoading = Boolean(inviteId && !hasValidInvite && inviteLookupStatus.loading);
  const lookupError = String(!hasValidInvite && inviteId ? inviteLookupStatus.error || routeMessage : "").trim();
  const processingMarkup = `
    <div class="invite-accept-processing">
      <span class="invite-accept-spinner" aria-hidden="true"></span>
      <div>
        <p class="invite-accept-processing-title">Signing you in...</p>
        <p class="task-meta">Completing your workspace access. You will be redirected automatically.</p>
      </div>
    </div>
  `;

  let bodyMarkup = `
    <p>This invite is not valid. Ask your workspace administrator for a new invite link.</p>
    <div class="empty-state-actions">
      <button class="btn btn-light" type="button" data-action="invite-sign-out">Back</button>
    </div>
  `;

  if (isLookupLoading) {
    bodyMarkup = `
      <p>Loading your workspace invite.</p>
      <div class="invite-accept-processing">
        <span class="invite-accept-spinner" aria-hidden="true"></span>
        <div>
          <p class="invite-accept-processing-title">Checking invite details...</p>
          <p class="task-meta">This usually takes a second.</p>
        </div>
      </div>
    `;
  } else if (hasValidInvite) {
    bodyMarkup = `
      <p>Accept your invite to join <strong>${escapeHtml(workspace)}</strong>.</p>
      <div class="profile-audit-grid invite-accept-grid">
        <p><span>Invited Email</span><strong>${escapeHtml(email)}</strong></p>
        <p><span>Role</span><strong>${escapeHtml(role)}</strong></p>
        <p><span>Team</span><strong>${escapeHtml(team)}</strong></p>
        <p><span>Invited By</span><strong>${escapeHtml(invitedBy)}</strong></p>
      </div>
      ${
        routeMessage
          ? `<p class="invite-accept-message">${escapeHtml(routeMessage)}</p>`
          : ""
      }
      ${
        routeLink
          ? `
            <div class="invite-accept-link-shell">
              <p class="task-meta">Invite link</p>
              <div class="invite-accept-link-row">
                <input type="text" readonly value="${escapeHtml(routeLink)}" aria-label="Invite link" />
                <button class="btn btn-light" type="button" data-action="invite-copy-link">Copy Link</button>
              </div>
            </div>
          `
          : ""
      }
      ${
        wrongEmail
          ? `
            <div class="empty-state-actions">
              <button class="btn btn-light" type="button" data-action="invite-sign-out">Sign Out</button>
            </div>
          `
          : invitePendingPasswordSetupEmail
            ? `
              <div class="auth-login-status is-success">
                <div class="auth-login-status-icon"><i class="bi bi-shield-check" aria-hidden="true"></i></div>
                <div>
                  <p class="auth-login-status-title">Email verified</p>
                  <p>Create a password for <strong>${escapeHtml(invitePendingPasswordSetupEmail)}</strong>. After this, you can sign in with email and password.</p>
                </div>
              </div>
              <form id="invitePasswordSetupForm" class="auth-login-form invite-accept-form">
                ${renderAuthPasswordField({
                  fieldId: "invitePasswordSetupInput",
                  label: "Create password",
                  name: "password",
                  value: invitePasswordSetupDraft,
                  placeholder: "At least 8 characters",
                  autocomplete: "new-password",
                  extraAttributes: 'data-invite-password-setup-input="password"',
                  disabled: isInvitePasswordSetupPending
                })}
                ${renderAuthPasswordField({
                  fieldId: "invitePasswordSetupConfirmInput",
                  label: "Confirm password",
                  name: "confirmPassword",
                  value: invitePasswordSetupConfirmDraft,
                  placeholder: "Repeat your password",
                  autocomplete: "new-password",
                  extraAttributes: 'data-invite-password-setup-input="confirm"',
                  disabled: isInvitePasswordSetupPending
                })}
                <button class="btn btn-light auth-login-magic" type="submit" ${isInvitePasswordSetupPending ? "disabled" : ""}>
                  ${isInvitePasswordSetupPending ? "Saving Password..." : "Save Password and Join Workspace"}
                </button>
              </form>
              <div class="auth-login-secondary-row">
                <button class="auth-login-link" type="button" data-action="invite-sign-out" ${isInvitePasswordSetupPending ? "disabled" : ""}>
                  Start over with a different account
                </button>
              </div>
            `
            : inviteOtpSentTo
              ? `
                <div class="auth-login-status is-success">
                  <div class="auth-login-status-icon"><i class="bi bi-envelope-check" aria-hidden="true"></i></div>
                  <div>
                    <p class="auth-login-status-title">Check your inbox</p>
                    <p>We sent a one-time code to <strong>${escapeHtml(inviteOtpSentTo)}</strong>. Enter it below to verify your invite email.</p>
                  </div>
                </div>
                <form id="inviteOtpVerifyForm" class="auth-login-form invite-accept-form">
                  <label class="auth-login-field" for="inviteOtpInput">
                    <span>Verification code</span>
                    <input
                      id="inviteOtpInput"
                      class="auth-login-input auth-login-code-input"
                      name="token"
                      type="text"
                      value="${escapeHtml(inviteOtpDraft)}"
                      placeholder="123456"
                      inputmode="numeric"
                      autocomplete="one-time-code"
                      data-invite-otp-input
                      required
                      ${isInviteOtpVerifyPending ? "disabled" : ""}
                    />
                  </label>
                  <button class="btn btn-light auth-login-magic" type="submit" ${isInviteOtpVerifyPending ? "disabled" : ""}>
                    ${isInviteOtpVerifyPending ? "Verifying..." : "Verify Code"}
                  </button>
                </form>
                <div class="auth-login-secondary-row">
                  <button class="auth-login-link" type="button" data-action="invite-resend-otp" ${isInviteOtpSendPending || isInviteOtpVerifyPending ? "disabled" : ""}>
                    ${isInviteOtpSendPending ? "Sending another code..." : "Resend code"}
                  </button>
                  <button class="auth-login-link" type="button" data-action="invite-cancel-otp" ${isInviteOtpSendPending || isInviteOtpVerifyPending ? "disabled" : ""}>
                    Back
                  </button>
                </div>
              `
          : isProcessing
            ? processingMarkup
            : `
              <div class="empty-state-actions invite-accept-actions">
                <button class="btn btn-accent" type="button" data-action="invite-google-sign-in">Continue with Google</button>
                <button class="btn btn-light" type="button" data-action="invite-send-otp" ${isInviteOtpSendPending ? "disabled" : ""}>
                  ${isInviteOtpSendPending ? "Sending code..." : "Continue with Email"}
                </button>
              </div>
            `
      }
    `;
  } else if (lookupError) {
    bodyMarkup = `
      <p>${escapeHtml(lookupError)}</p>
      <div class="empty-state-actions">
        <button class="btn btn-light" type="button" data-action="invite-sign-out">Back</button>
      </div>
    `;
  }

  return {
    title: "Accept Invite",
    subtitle: "Join workspace",
    showWaitingPanel: false,
    html: `
      <section class="view-block invite-accept-view">
        <div class="empty-state-card invite-accept-card">
          <div class="empty-state-icon"><i class="bi bi-person-check" aria-hidden="true"></i></div>
          <h3>${escapeHtml(name || email || "Workspace Invite")}</h3>
          ${bodyMarkup}
        </div>
      </section>
    `
  };
}

export function renderMyProfile(data, _context = {}) {
  if (shouldRenderProfileSkeleton(data, _context)) {
    return renderProfileSkeleton(data);
  }
  const profile = getProfilePageModel(data);
  const currentUser = profile.currentUser && typeof profile.currentUser === "object" ? profile.currentUser : {};
  const currentMember = profile.currentMember;
  const workspaceModel = getWorkspacePageModel(data);
  const workspace = workspaceModel.workspace;
  const security = currentUser.security && typeof currentUser.security === "object" ? currentUser.security : {};
  const notifications =
    currentUser.notifications && typeof currentUser.notifications === "object" ? currentUser.notifications : {};
  const communication =
    currentUser.communication && typeof currentUser.communication === "object" ? currentUser.communication : {};
  const currentTheme = String(_context?.uiTheme || "light").trim().toLowerCase() === "dark" ? "dark" : "light";
  const validTabs = new Set(["overview", "details", "activity", "security", "preferences"]);
  const requestedTab = String(_context.profileViewTab || "overview").trim().toLowerCase();
  const activeTab = validTabs.has(requestedTab) ? requestedTab : "overview";
  const collections = collectProfileOwnedCollections(data, profile);
  const activityItems = currentMember
    ? collectTeamMemberActivity(currentMember, collections.ownedLeads, collections.openDeals, collections.assignedTasks)
    : [];
  const availabilityKey = String(profile.availability || "Online")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
  const heroSubtitle =
    [String(profile.titleValue || "").trim(), String(profile.teamValue || "").trim()].filter(Boolean).join(" / ") ||
    String(profile.teamValue || "").trim() ||
    profile.roleValue;
  const notificationChannels = [];
  if (notifications.inApp !== false) {
    notificationChannels.push("In-app");
  }
  if (notifications.email !== false) {
    notificationChannels.push("Email");
  }
  if (notifications.sms) {
    notificationChannels.push("SMS");
  }
  const notificationSummary = notificationChannels.length ? notificationChannels.join(" • ") : "No channels enabled";
  const senderName =
    String(communication.senderName || currentMember?.communication?.senderName || profile.fullName).trim() || profile.fullName;
  const signatureValue = String(communication.signature || currentMember?.communication?.signature || "").trim();
  const securitySessions = Math.max(1, Number(security.activeSessions || 1) || 1);
  const passwordUpdatedLabel = formatProfileDateLabel(security.lastPasswordChange);
  const lastSeenLabel = formatTeamMemberDateTime(currentMember?.lastLoginAt || currentUser.lastLoginAt || "");
  const workspaceActionLabel = canAccessWorkspaceProfile(data) ? "Workspace Profile" : "Manage in Settings";
  const workspaceActionRoute = canAccessWorkspaceProfile(data) ? "settings-workspace" : "settings";
  const overviewPanelMarkup = `
    <section class="profile-hub-stack">
      <section class="profile-hub-stat-grid">
        <article class="profile-hub-stat-card">
          <span class="profile-hub-stat-icon"><i class="bi bi-envelope" aria-hidden="true"></i></span>
          <div class="profile-hub-stat-copy">
            <span>Email</span>
            <strong>${escapeHtml(profile.emailValue || "No email set")}</strong>
          </div>
        </article>
        <article class="profile-hub-stat-card">
          <span class="profile-hub-stat-icon"><i class="bi bi-telephone" aria-hidden="true"></i></span>
          <div class="profile-hub-stat-copy">
            <span>Phone</span>
            <strong>${escapeHtml(profile.phoneValue || "No phone set")}</strong>
          </div>
        </article>
        <article class="profile-hub-stat-card">
          <span class="profile-hub-stat-icon"><i class="bi bi-broadcast-pin" aria-hidden="true"></i></span>
          <div class="profile-hub-stat-copy">
            <span>Status</span>
            <strong>${escapeHtml(profile.availability)}</strong>
          </div>
        </article>
        <article class="profile-hub-stat-card">
          <span class="profile-hub-stat-icon"><i class="bi bi-shield-check" aria-hidden="true"></i></span>
          <div class="profile-hub-stat-copy">
            <span>Role</span>
            <strong>${escapeHtml(profile.roleValue)}</strong>
          </div>
        </article>
      </section>

      <section class="profile-hub-card">
        <header class="profile-hub-panel-head">
          <div>
            <p class="lead-profile-section-title">Workspace profile</p>
            <h4>Role and workspace details</h4>
          </div>
        </header>
        ${renderSettingsViewGrid(
          [
            { label: "Role", value: profile.roleValue },
            { label: "Team", value: profile.teamValue, emptyLabel: "No team assigned" },
            { label: "Manager", value: profile.managerValue, emptyLabel: "No manager assigned" },
            { label: "Timezone", value: profile.timezone },
            { label: "Workspace", value: workspace.appLabel },
            { label: "Working Hours", value: workspaceModel.businessHoursLabel }
          ],
          "settings-view-grid-wide profile-hub-detail-grid"
        )}
      </section>

      <section class="profile-hub-card">
        <header class="profile-hub-panel-head">
          <div>
            <p class="lead-profile-section-title">Recent activity</p>
            <h4>A timeline of your recent account activity</h4>
          </div>
          <button type="button" class="mini-btn mini-btn-primary" data-action="profile-view-tab" data-id="activity">View all</button>
        </header>
        ${buildTeamMemberActivityRows(activityItems, { limit: 6, emptyLabel: "No account activity yet." })}
      </section>
    </section>
  `;
  const detailsPanelMarkup = `
    <section class="profile-hub-stack">
      <section class="profile-hub-card">
        <header class="profile-hub-panel-head">
          <div>
            <p class="lead-profile-section-title">Contact details</p>
            <h4>Identity shown across the workspace</h4>
          </div>
        </header>
        ${renderSettingsViewGrid(
          [
            { label: "Full Name", value: profile.fullName },
            { label: "Email", value: profile.emailValue, emptyLabel: "No email set" },
            { label: "Phone", value: profile.phoneValue, emptyLabel: "No phone set" },
            { label: "Job Title", value: profile.titleValue, emptyLabel: "No title set" },
            { label: "Availability", value: profile.availability },
            { label: "Language", value: profile.language }
          ],
          "settings-view-grid-wide profile-hub-detail-grid"
        )}
      </section>
      <section class="profile-hub-card">
        <header class="profile-hub-panel-head">
          <div>
            <p class="lead-profile-section-title">Coverage</p>
            <h4>Owned records and queue footprint</h4>
          </div>
        </header>
        ${renderSettingsViewGrid(
          [
            { label: "Active Leads", value: String(collections.ownedLeads.length) },
            { label: "Open Deals", value: String(collections.openDeals.length) },
            { label: "Open Tasks", value: String(collections.openTasks.length) },
            { label: "Accounts", value: String(collections.ownedAccounts.length) },
            { label: "Theme", value: currentTheme === "dark" ? "Dark" : "Light" },
            { label: "Shift", value: String(currentMember?.shift || workspaceModel.businessHoursLabel).trim() }
          ],
          "settings-view-grid-wide profile-hub-detail-grid"
        )}
      </section>
    </section>
  `;
  const activityPanelMarkup = `
    <section class="profile-hub-stack">
      <section class="profile-hub-card">
        <header class="profile-hub-panel-head">
          <div>
            <p class="lead-profile-section-title">Activity</p>
            <h4>Recent updates tied to your account</h4>
          </div>
        </header>
        ${buildTeamMemberActivityRows(activityItems, { limit: 0, emptyLabel: "No recent account activity yet." })}
      </section>
    </section>
  `;
  const securityPanelMarkup = `
    <section class="profile-hub-stack">
      <section class="profile-hub-stat-grid">
        <article class="profile-hub-stat-card">
          <span class="profile-hub-stat-icon"><i class="bi bi-laptop" aria-hidden="true"></i></span>
          <div class="profile-hub-stat-copy">
            <span>Active Sessions</span>
            <strong>${escapeHtml(String(securitySessions))}</strong>
          </div>
        </article>
        <article class="profile-hub-stat-card">
          <span class="profile-hub-stat-icon"><i class="bi bi-key" aria-hidden="true"></i></span>
          <div class="profile-hub-stat-copy">
            <span>Password Updated</span>
            <strong>${escapeHtml(passwordUpdatedLabel)}</strong>
          </div>
        </article>
        <article class="profile-hub-stat-card">
          <span class="profile-hub-stat-icon"><i class="bi bi-box-arrow-in-right" aria-hidden="true"></i></span>
          <div class="profile-hub-stat-copy">
            <span>Last Sign In</span>
            <strong>${escapeHtml(lastSeenLabel)}</strong>
          </div>
        </article>
      </section>
      <section class="profile-hub-card">
        <header class="profile-hub-panel-head">
          <div>
            <p class="lead-profile-section-title">Security</p>
            <h4>Password and session controls</h4>
          </div>
        </header>
        ${renderSettingsViewGrid(
          [
            { label: "Workspace Access", value: currentUser?.role || profile.roleValue },
            { label: "Last Password Change", value: passwordUpdatedLabel },
            { label: "Active Sessions", value: String(securitySessions) },
            { label: "Last Login", value: lastSeenLabel }
          ],
          "settings-view-grid-wide profile-hub-detail-grid"
        )}
        <div class="profile-hub-panel-actions">
          <button class="table-ops-columns-btn" type="button" data-action="profile-end-sessions">
            <i class="bi bi-shield-lock" aria-hidden="true"></i>
            <span>End Other Sessions</span>
          </button>
          <button class="table-ops-columns-btn" type="button" data-route="settings">
            <i class="bi bi-gear" aria-hidden="true"></i>
            <span>Open Security Settings</span>
          </button>
        </div>
      </section>
    </section>
  `;
  const preferencesPanelMarkup = `
    <section class="profile-hub-stack">
      <section class="profile-hub-card">
        <header class="profile-hub-panel-head">
          <div>
            <p class="lead-profile-section-title">Preferences</p>
            <h4>Appearance, alerts, and communication defaults</h4>
          </div>
        </header>
        ${renderSettingsViewGrid(
          [
            { label: "Theme", value: currentTheme === "dark" ? "Dark" : "Light" },
            { label: "Notification Channels", value: notificationSummary },
            { label: "Sender Name", value: senderName },
            { label: "Email Signature", value: signatureValue ? "Custom signature saved" : "No custom signature" },
            { label: "CRM Default Owner", value: workspace.crmDefaultOwner, emptyLabel: "No default owner" },
            { label: "Default Follow-up", value: `${workspace.crmFollowUpDays} day${workspace.crmFollowUpDays === 1 ? "" : "s"}` }
          ],
          "settings-view-grid-wide profile-hub-detail-grid"
        )}
        <div class="profile-hub-panel-actions">
          <button class="table-ops-columns-btn" type="button" data-route="settings">
            <i class="bi bi-sliders2" aria-hidden="true"></i>
            <span>Manage Preferences</span>
          </button>
        </div>
      </section>
    </section>
  `;
  const profileHubWorkspaceActionLabel = "Manage in Settings";
  const profileHubWorkspaceActionRoute = "settings";
  const profileHubNotificationSummary = notificationChannels.length ? notificationChannels.join(" / ") : "No channels enabled";
  const profileHubFormatFieldValue = (value, emptyLabel = "Not set") => {
    const raw = String(value || "").trim();
    return raw || emptyLabel;
  };
  const profileHubRenderInfoGrid = (items) => `
    <div class="profile-hub-info-grid">
      ${items
        .map(
          (item) => `
            <article class="profile-hub-info-item">
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(profileHubFormatFieldValue(item.value, item.emptyLabel || "Not set"))}</strong>
            </article>
          `
        )
        .join("")}
    </div>
  `;
  const profileHubSideRows = [
    { icon: "bi-envelope", label: "Email", value: profile.emailValue, emptyLabel: "No email set" },
    { icon: "bi-at", label: "Username", value: profile.emailValue, emptyLabel: "No username set" },
    { icon: "bi-shield-check", label: "Role", value: profile.roleValue },
    { icon: "bi-people", label: "Team", value: profile.teamValue, emptyLabel: "No team assigned" },
    { icon: "bi-globe2", label: "Timezone", value: profile.timezone },
    { icon: "bi-translate", label: "Language", value: profile.language }
  ];
  const profileHubSummaryCardsMarkup = `
    <section class="profile-hub-summary-grid">
      <article class="profile-hub-summary-card">
        <span class="profile-hub-summary-icon"><i class="bi bi-envelope" aria-hidden="true"></i></span>
        <div class="profile-hub-summary-copy">
          <span>Email</span>
          <strong>${escapeHtml(profile.emailValue || "No email set")}</strong>
        </div>
      </article>
      <article class="profile-hub-summary-card">
        <span class="profile-hub-summary-icon"><i class="bi bi-telephone" aria-hidden="true"></i></span>
        <div class="profile-hub-summary-copy">
          <span>Phone</span>
          <strong>${escapeHtml(profile.phoneValue || "No phone set")}</strong>
        </div>
      </article>
      <article class="profile-hub-summary-card">
        <span class="profile-hub-summary-icon"><i class="bi bi-broadcast" aria-hidden="true"></i></span>
        <div class="profile-hub-summary-copy">
          <span>Status</span>
          <strong>${escapeHtml(profile.availability)}</strong>
        </div>
      </article>
      <article class="profile-hub-summary-card">
        <span class="profile-hub-summary-icon"><i class="bi bi-shield-check" aria-hidden="true"></i></span>
        <div class="profile-hub-summary-copy">
          <span>Role</span>
          <strong>${escapeHtml(profile.roleValue)}</strong>
        </div>
      </article>
    </section>
  `;
  const profileHubOverviewPanelMarkup = `
    <section class="profile-hub-main-stack">
      ${profileHubSummaryCardsMarkup}
      <section class="profile-hub-card profile-hub-workspace-card">
        <header class="profile-hub-panel-head">
          <div>
            <p class="lead-profile-section-title">Workspace Info</p>
            <p class="profile-hub-panel-subcopy">Your role and workspace details</p>
          </div>
        </header>
        <div class="profile-hub-workspace-grid">
          <div class="profile-hub-workspace-copy">
            <div class="profile-hub-workspace-row">
              <span>Role</span>
              <strong>${escapeHtml(profile.roleValue)}</strong>
            </div>
            <div class="profile-hub-workspace-row">
              <span>Team</span>
              <strong>${escapeHtml(profile.teamValue || "No team assigned")}</strong>
            </div>
            <div class="profile-hub-workspace-row">
              <span>Manager</span>
              <strong>${escapeHtml(profile.managerValue || "No manager assigned")}</strong>
            </div>
            <div class="profile-hub-workspace-row">
              <span>Timezone</span>
              <strong>${escapeHtml(profile.timezone)}</strong>
            </div>
          </div>
          <div class="profile-hub-workspace-art" aria-hidden="true">
            <i class="bi bi-buildings"></i>
          </div>
        </div>
      </section>
      <section class="profile-hub-card">
        <header class="profile-hub-panel-head">
          <div>
            <p class="lead-profile-section-title">Recent Activity</p>
            <p class="profile-hub-panel-subcopy">A timeline of your recent account activity</p>
          </div>
          <button type="button" class="profile-hub-inline-btn" data-action="profile-view-tab" data-id="activity">View All</button>
        </header>
        ${buildProfileHubActivityTimeline(activityItems, { limit: 5, emptyLabel: "No account activity yet." })}
      </section>
    </section>
  `;
  const profileHubDetailsPanelMarkup = `
    <section class="profile-hub-main-stack">
      ${profileHubSummaryCardsMarkup}
      <section class="profile-hub-card">
        <header class="profile-hub-panel-head">
          <div>
            <p class="lead-profile-section-title">Details</p>
            <p class="profile-hub-panel-subcopy">Identity shown across the workspace</p>
          </div>
        </header>
        ${profileHubRenderInfoGrid([
          { label: "Full Name", value: profile.fullName },
          { label: "Email", value: profile.emailValue, emptyLabel: "No email set" },
          { label: "Phone", value: profile.phoneValue, emptyLabel: "No phone set" },
          { label: "Job Title", value: profile.titleValue, emptyLabel: "No title set" },
          { label: "Language", value: profile.language },
          { label: "Availability", value: profile.availability }
        ])}
      </section>
      <section class="profile-hub-card">
        <header class="profile-hub-panel-head">
          <div>
            <p class="lead-profile-section-title">Workspace Details</p>
            <p class="profile-hub-panel-subcopy">Coverage and ownership across the workspace</p>
          </div>
        </header>
        ${profileHubRenderInfoGrid([
          { label: "Workspace", value: workspace.appLabel },
          { label: "Working Hours", value: workspaceModel.businessHoursLabel },
          { label: "Active Leads", value: String(collections.ownedLeads.length) },
          { label: "Open Deals", value: String(collections.openDeals.length) },
          { label: "Open Tasks", value: String(collections.openTasks.length) },
          { label: "Accounts", value: String(collections.ownedAccounts.length) }
        ])}
      </section>
    </section>
  `;
  const profileHubActivityPanelMarkup = `
    <section class="profile-hub-main-stack">
      <section class="profile-hub-card">
        <header class="profile-hub-panel-head">
          <div>
            <p class="lead-profile-section-title">Activity</p>
            <p class="profile-hub-panel-subcopy">Recent updates tied to your account</p>
          </div>
        </header>
        ${buildProfileHubActivityTimeline(activityItems, { limit: 0, emptyLabel: "No recent account activity yet." })}
      </section>
    </section>
  `;
  const profileHubSecurityPanelMarkup = `
    <section class="profile-hub-main-stack">
      <section class="profile-hub-summary-grid profile-hub-summary-grid-security">
        <article class="profile-hub-summary-card">
          <span class="profile-hub-summary-icon"><i class="bi bi-laptop" aria-hidden="true"></i></span>
          <div class="profile-hub-summary-copy">
            <span>Active Sessions</span>
            <strong>${escapeHtml(String(securitySessions))}</strong>
          </div>
        </article>
        <article class="profile-hub-summary-card">
          <span class="profile-hub-summary-icon"><i class="bi bi-key" aria-hidden="true"></i></span>
          <div class="profile-hub-summary-copy">
            <span>Password Updated</span>
            <strong>${escapeHtml(passwordUpdatedLabel)}</strong>
          </div>
        </article>
        <article class="profile-hub-summary-card">
          <span class="profile-hub-summary-icon"><i class="bi bi-box-arrow-in-right" aria-hidden="true"></i></span>
          <div class="profile-hub-summary-copy">
            <span>Last Sign In</span>
            <strong>${escapeHtml(lastSeenLabel)}</strong>
          </div>
        </article>
      </section>
      <section class="profile-hub-card">
        <header class="profile-hub-panel-head">
          <div>
            <p class="lead-profile-section-title">Security</p>
            <p class="profile-hub-panel-subcopy">Password and session controls</p>
          </div>
        </header>
        ${profileHubRenderInfoGrid([
          { label: "Workspace Access", value: currentUser?.role || profile.roleValue },
          { label: "Last Password Change", value: passwordUpdatedLabel },
          { label: "Active Sessions", value: String(securitySessions) },
          { label: "Last Login", value: lastSeenLabel }
        ])}
        <div class="profile-hub-panel-actions">
          <button class="profile-hub-side-btn is-primary" type="button" data-route="settings">
            <i class="bi bi-key" aria-hidden="true"></i>
            <span>Change Password</span>
          </button>
          <button class="profile-hub-side-btn" type="button" data-action="profile-end-sessions">
            <i class="bi bi-shield-lock" aria-hidden="true"></i>
            <span>End Other Sessions</span>
          </button>
        </div>
      </section>
    </section>
  `;
  const profileHubPreferencesPanelMarkup = `
    <section class="profile-hub-main-stack">
      <section class="profile-hub-card">
        <header class="profile-hub-panel-head">
          <div>
            <p class="lead-profile-section-title">Preferences</p>
            <p class="profile-hub-panel-subcopy">Appearance, alerts, and communication defaults</p>
          </div>
        </header>
        ${profileHubRenderInfoGrid([
          { label: "Theme", value: currentTheme === "dark" ? "Dark" : "Light" },
          { label: "Notification Channels", value: profileHubNotificationSummary },
          { label: "Sender Name", value: senderName },
          { label: "Email Signature", value: signatureValue ? "Custom signature saved" : "No custom signature" },
          { label: "CRM Default Owner", value: workspace.crmDefaultOwner, emptyLabel: "No default owner" },
          { label: "Default Follow-up", value: `${workspace.crmFollowUpDays} day${workspace.crmFollowUpDays === 1 ? "" : "s"}` }
        ])}
        <div class="profile-hub-panel-actions">
          <button class="profile-hub-side-btn is-primary" type="button" data-route="settings">
            <i class="bi bi-sliders2" aria-hidden="true"></i>
            <span>Manage Preferences</span>
          </button>
        </div>
      </section>
    </section>
  `;
  const profileHubHeroMarkup = `
    <section class="profile-hub-hero" style="--profile-hub-brand:${escapeHtml(workspace.brandColor)}">
      <div class="profile-hub-hero-main">
        <button
          type="button"
          class="profile-hub-avatar-button"
          data-action="profile-avatar-edit"
          data-profile-avatar-trigger
          aria-label="${escapeHtml(profile.avatarUrl ? "Change profile photo" : "Add profile photo")}"
        >
          <span class="profile-hub-avatar-preview" data-profile-avatar-preview aria-hidden="true">
            ${
              profile.avatarUrl
                ? `<img src="${escapeHtml(profile.avatarUrl)}" alt="${escapeHtml(profile.fullName)}" />`
                : `<span class="profile-hub-avatar-fallback">${escapeHtml(profile.initials)}</span>`
            }
          </span>
          <span class="profile-hub-avatar-edit-badge" aria-hidden="true">
            <i class="bi bi-camera-fill" aria-hidden="true"></i>
          </span>
        </button>
        <div class="profile-hub-hero-copy">
          <h2 data-profile-identity-name>${escapeHtml(profile.fullName)}</h2>
          <p class="profile-hub-hero-email" data-profile-identity-email>${escapeHtml(profile.emailValue || "No email set")}</p>
          ${
            heroSubtitle
              ? `<p class="profile-hub-hero-subtitle" data-profile-identity-title>${escapeHtml(heroSubtitle)}</p>`
              : ""
          }
          <div class="profile-hub-badges">
            <span class="profile-hub-badge is-role-${escapeHtml(profile.roleValue.toLowerCase().replace(/\s+/g, "-"))}">
              <i class="bi bi-crown-fill" aria-hidden="true"></i>
              <span>${escapeHtml(profile.roleValue)}</span>
            </span>
            ${
              profile.teamValue
                ? `<span class="profile-hub-badge is-team"><i class="bi bi-people-fill" aria-hidden="true"></i><span>${escapeHtml(profile.teamValue)}</span></span>`
                : ""
            }
            <span class="profile-hub-badge is-${escapeHtml(availabilityKey)}"><i class="bi bi-circle-fill" aria-hidden="true"></i><span>${escapeHtml(profile.availability)}</span></span>
          </div>
        </div>
      </div>
      <div class="profile-hub-hero-actions">
        <button type="button" class="profile-hub-hero-btn is-primary" data-route="settings">
          <i class="bi bi-pencil-square" aria-hidden="true"></i>
          <span>Edit Profile</span>
        </button>
        <button type="button" class="profile-hub-hero-btn is-secondary" data-route="${escapeHtml(profileHubWorkspaceActionRoute)}">
          <i class="bi bi-gear-fill" aria-hidden="true"></i>
          <span>${escapeHtml(profileHubWorkspaceActionLabel)}</span>
        </button>
      </div>
    </section>
  `;
  const profileHubSideCardMarkup = `
    <article class="profile-hub-sidecard">
      <div class="profile-hub-sidecard-top">
        <span class="profile-hub-side-avatar" aria-hidden="true">
          ${
            profile.avatarUrl
              ? `<img src="${escapeHtml(profile.avatarUrl)}" alt="${escapeHtml(profile.fullName)}" />`
              : `<span class="profile-hub-avatar-fallback">${escapeHtml(profile.initials)}</span>`
          }
        </span>
        <div class="profile-hub-side-copy">
          <p class="profile-hub-side-kicker">Profile Card</p>
          <h3>${escapeHtml(profile.fullName)}</h3>
          <p class="profile-hub-side-role">${escapeHtml(profile.roleValue)}</p>
          <span class="profile-hub-side-status is-${escapeHtml(availabilityKey)}"><i class="bi bi-circle-fill" aria-hidden="true"></i><span>${escapeHtml(profile.availability)}</span></span>
        </div>
      </div>
      <div class="profile-hub-side-list">
        ${profileHubSideRows
          .map(
            (row) => `
              <div class="profile-hub-side-row">
                <span class="profile-hub-side-row-label"><i class="bi ${escapeHtml(row.icon)}" aria-hidden="true"></i><span>${escapeHtml(row.label)}</span></span>
                <strong class="profile-hub-side-row-value">${escapeHtml(profileHubFormatFieldValue(row.value, row.emptyLabel || "Not set"))}</strong>
              </div>
            `
          )
          .join("")}
      </div>
      <div class="profile-hub-side-actions">
        <button type="button" class="profile-hub-side-btn is-primary" data-route="settings">
          <i class="bi bi-pencil-square" aria-hidden="true"></i>
          <span>Edit Profile</span>
        </button>
        <button type="button" class="profile-hub-side-btn" data-route="settings">
          <i class="bi bi-key" aria-hidden="true"></i>
          <span>Change Password</span>
        </button>
      </div>
    </article>
  `;
  const activePanelMarkup =
    {
      overview: profileHubOverviewPanelMarkup,
      details: profileHubDetailsPanelMarkup,
      activity: profileHubActivityPanelMarkup,
      security: profileHubSecurityPanelMarkup,
      preferences: profileHubPreferencesPanelMarkup
    }[activeTab] || profileHubOverviewPanelMarkup;
  return {
    title: "Profile",
    subtitle: "Your identity across the workspace",
    showWaitingPanel: false,
    html: `
      <section class="view-block settings-page settings-profile-view profile-hub-view">
        <div class="settings-page-head">${renderSettingsRouteSwitch(data, "settings-me")}</div>
        ${profileHubHeroMarkup}

        <nav class="profile-hub-tabs" aria-label="Profile sections" role="tablist">
          ${renderProfileHubTabButton("overview", "Overview", "bi-grid-1x2", activeTab)}
          ${renderProfileHubTabButton("details", "Details", "bi-person-vcard", activeTab)}
          ${renderProfileHubTabButton("activity", "Activity", "bi-arrow-repeat", activeTab)}
          ${renderProfileHubTabButton("security", "Security", "bi-shield-lock", activeTab)}
          ${renderProfileHubTabButton("preferences", "Preferences", "bi-sliders2", activeTab)}
        </nav>

        <div class="profile-hub-shell">
          <aside class="profile-hub-sidebar">
            ${profileHubSideCardMarkup}
          </aside>

          <div class="profile-hub-main">
            ${activePanelMarkup}
          </div>
        </div>
      </section>
    `
  };
}

export function renderTeamMemberProfile(data, context) {
  const members = Array.isArray(data.teamMembers) ? data.teamMembers : [];
  const selectedId = String(context.selectedTeamMemberId || "").trim();
  const member = members.find((item) => item.id === selectedId) || members[0] || null;

  if (!member) {
    return {
      title: "Team Member Profile",
      subtitle: "No team members available",
      showWaitingPanel: false,
      html: `
        <section class="view-block settings-profile-view">
          <p class="task-meta">No team members found. Invite a member in Team Management first.</p>
          <div class="form-actions">
            <button type="button" class="btn btn-accent" data-route="team">Open Team</button>
          </div>
        </section>
      `
    };
  }

  const managerOptions = [
    { value: "", label: "No manager" },
    ...members.filter((item) => item.id !== member.id).map((item) => ({ value: item.name, label: item.name }))
  ];
  const scopeValue = normalizeScope(member.scope);
  const permissions = normalizePermissions(member);
  const isInvited = isTeamMemberPendingInvite(member.status);
  const statusToggleLabel = normalizeTeamMemberStatus(member.status) === "Inactive" ? "Reactivate" : "Deactivate";
  const roleOptions = getAssignableTeamRoles(member, data);
  const canManageTeam = canManageTeamMembersByRole(data.currentUser?.role);
  const ownerLocked = canManageTeam && !canManageOwnerTeamMember(member, data);
  const canEditMember = canManageTeam && !ownerLocked;
  const controlDisabledAttr = canEditMember ? "" : "disabled";
  const memberAvatarUrl = String(member.avatarUrl || "").trim();
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const validTabs = new Set(["overview", "leads", "deals", "tasks", "activity", "settings"]);
  const requestedTab = String(context.teamMemberProfileTab || "overview").trim().toLowerCase();
  const activeTab = validTabs.has(requestedTab) ? requestedTab : "overview";

  const assignedLeads = (Array.isArray(data.leads) ? data.leads : [])
    .filter(
      (lead) =>
        !lead?.archived &&
        String(lead?.status || "").trim() !== "Archived" &&
        teamMemberMatchesRecord(member, lead?.ownerId, lead?.owner)
    )
    .sort((left, right) => {
      const leftDue = String(left?.nextFollowUp || "9999-12-31");
      const rightDue = String(right?.nextFollowUp || "9999-12-31");
      return rightDue === leftDue
        ? String(right?.updatedAt || right?.createdAt || "").localeCompare(String(left?.updatedAt || left?.createdAt || ""))
        : leftDue.localeCompare(rightDue);
    });

  const openDeals = (Array.isArray(data.deals) ? data.deals : [])
    .filter((deal) => {
      if (deal?.archived || !teamMemberMatchesRecord(member, deal?.ownerId, deal?.owner)) {
        return false;
      }
      const stage = String(deal?.stage || "").trim().toLowerCase();
      return !["won", "lost", "closed won", "closed lost"].includes(stage);
    })
    .sort((left, right) => {
      const leftClose = String(left?.closeDate || "9999-12-31");
      const rightClose = String(right?.closeDate || "9999-12-31");
      return rightClose === leftClose
        ? String(right?.updatedAt || right?.createdAt || "").localeCompare(String(left?.updatedAt || left?.createdAt || ""))
        : leftClose.localeCompare(rightClose);
    });

  const assignedTasks = (Array.isArray(data.tasks) ? data.tasks : [])
    .filter((task) => teamMemberMatchesRecord(member, task?.assigneeId, task?.assignee))
    .sort((left, right) => {
      const leftDue = String(left?.dueDate || "9999-12-31");
      const rightDue = String(right?.dueDate || "9999-12-31");
      return rightDue === leftDue
        ? String(right?.updatedAt || right?.createdAt || "").localeCompare(String(left?.updatedAt || left?.createdAt || ""))
        : leftDue.localeCompare(rightDue);
    });

  const openTasks = assignedTasks.filter((task) => String(task?.status || "").trim() !== "Completed");
  const completedTaskCount = Math.max(0, assignedTasks.length - openTasks.length);
  const ownedAccounts = (Array.isArray(data.accounts) ? data.accounts : [])
    .filter((account) => !account?.archived && teamMemberMatchesRecord(member, account?.ownerId, account?.owner));
  const profileHeroSubtitle = [
    String(member.title || "").trim(),
    String(member.team || "").trim()
  ].filter(Boolean).join(" / ") || String(member.team || "").trim() || "Unassigned";
  const activityItems = collectTeamMemberActivity(member, assignedLeads, openDeals, assignedTasks);
  const managementNote = !canManageTeam
    ? "You can view this member profile, but only users with team-management access can edit settings."
    : ownerLocked
      ? "Only workspace owners can edit another owner account."
      : isInvited
        ? "Invite is still pending. Use the controls below to resend, copy, or cancel the invitation."
        : "Update this member's workspace details, access scope, and permissions.";
  const inviteActions = isInvited && canEditMember
    ? `
      <button type="button" class="btn btn-light" data-action="team-resend-invite" data-id="${escapeHtml(member.id)}">Resend Invite</button>
      <button type="button" class="btn btn-light" data-action="team-copy-invite-link" data-id="${escapeHtml(member.id)}">Copy Invite Link</button>
      <button type="button" class="btn btn-light" data-action="team-cancel-invite" data-id="${escapeHtml(member.id)}">Cancel Invite</button>
    `
    : "";
  const activeActions = !isInvited && canEditMember
    ? `
      ${normalizeTeamMemberStatus(member.status) === "Active" ? `<button type="button" class="btn btn-light" data-action="team-reset-access" data-id="${escapeHtml(member.id)}">Reset Access</button>` : ""}
      <button type="button" class="btn btn-light" data-action="${normalizeTeamMemberStatus(member.status) === "Inactive" ? "team-reactivate" : "team-deactivate"}" data-id="${escapeHtml(member.id)}">${statusToggleLabel}</button>
    `
    : "";
  const tabButton = (id, label, count = "") => {
    const isActive = activeTab === id;
    return `
      <button
        type="button"
        class="team-member-profile-tab ${isActive ? "is-active" : ""}"
        id="team-member-profile-tab-${escapeHtml(id)}"
        role="tab"
        data-action="team-member-profile-tab"
        data-id="${escapeHtml(id)}"
        data-team-member-view-tab="${escapeHtml(id)}"
        aria-selected="${isActive ? "true" : "false"}"
        aria-controls="team-member-profile-panel-${escapeHtml(id)}"
        tabindex="${isActive ? "0" : "-1"}"
      >
        <span>${escapeHtml(label)}</span>
        ${count === "" ? "" : `<span class="team-member-profile-tab-count">${escapeHtml(String(count))}</span>`}
      </button>
    `;
  };
  const sidebarStatsMarkup = `
    <div class="team-member-profile-sidebar-section team-member-profile-sidebar-section-stats">
      <div class="team-member-profile-stat-grid">
        <article class="team-member-profile-stat">
          <span>Leads</span>
          <strong>${escapeHtml(String(assignedLeads.length))}</strong>
        </article>
        <article class="team-member-profile-stat">
          <span>Deals</span>
          <strong>${escapeHtml(String(openDeals.length))}</strong>
        </article>
        <article class="team-member-profile-stat">
          <span>Tasks</span>
          <strong>${escapeHtml(String(openTasks.length))}</strong>
        </article>
      </div>
    </div>
  `;
  const sidebarFactsMarkup = `
    <div class="team-member-profile-sidebar-section team-member-profile-sidebar-section-details">
      <div class="team-member-profile-sidebar-list">
        <div class="team-member-profile-sidebar-list-row">
          <span>Email</span>
          <strong>${escapeHtml(member.email || "No email")}</strong>
        </div>
        <div class="team-member-profile-sidebar-list-row">
          <span>Manager</span>
          <strong>${escapeHtml(member.manager || "No manager")}</strong>
        </div>
        <div class="team-member-profile-sidebar-list-row">
          <span>Timezone</span>
          <strong>${escapeHtml(member.timezone || "Local")}</strong>
        </div>
        <div class="team-member-profile-sidebar-list-row">
          <span>Shift</span>
          <strong>${escapeHtml(member.shift || "09:00-18:00")}</strong>
        </div>
        <div class="team-member-profile-sidebar-list-row">
          <span>Last active</span>
          <strong>${escapeHtml(teamMemberLastActiveLabel(member))}</strong>
        </div>
      </div>
    </div>
  `;
  const sidebarTagsMarkup = `
    <div class="team-member-profile-sidebar-section team-member-profile-sidebar-section-tags">
      <div class="lead-profile-chip-row team-member-profile-sidebar-tags">
        <span class="lead-profile-icon-chip">${teamMemberInfoText("bi-shield-check", `Scope ${scopeValue.toUpperCase()}`, "lead-profile-icon-text")}</span>
        <span class="lead-profile-icon-chip">${teamMemberInfoText("bi-buildings", `${ownedAccounts.length} account${ownedAccounts.length === 1 ? "" : "s"}`, "lead-profile-icon-text")}</span>
        <span class="lead-profile-icon-chip">${teamMemberInfoText("bi-collection", member.queueEligible ? "Queue eligible" : "Direct assignment", "lead-profile-icon-text")}</span>
      </div>
    </div>
  `;
  const overviewPanelMarkup = `
    <section id="team-member-profile-panel-overview" class="lead-profile-panel team-member-profile-panel" data-team-member-view-panel="overview" role="tabpanel" aria-labelledby="team-member-profile-tab-overview">
      <section class="team-member-overview-main">
        <section class="team-member-panel-block">
          <header class="team-member-panel-head">
            <div>
              <p class="lead-profile-section-title">Assigned Leads</p>
              <h4>Current lead ownership</h4>
            </div>
            <button type="button" class="mini-btn mini-btn-primary" data-action="team-member-profile-tab" data-id="leads">View all</button>
          </header>
          <div class="lead-profile-list team-member-record-list">${buildTeamMemberLeadRows(assignedLeads, { limit: 4 })}</div>
        </section>

        <section class="team-member-panel-block">
          <header class="team-member-panel-head">
            <div>
              <p class="lead-profile-section-title">Open Deals</p>
              <h4>Pipeline this member owns</h4>
            </div>
            <button type="button" class="mini-btn mini-btn-primary" data-action="team-member-profile-tab" data-id="deals">View all</button>
          </header>
          <div class="lead-profile-list team-member-record-list">${buildTeamMemberDealRows(openDeals, { limit: 4 })}</div>
        </section>

        <section class="team-member-panel-block">
          <header class="team-member-panel-head">
            <div>
              <p class="lead-profile-section-title">Open Tasks</p>
              <h4>Current work assigned</h4>
            </div>
            <button type="button" class="mini-btn mini-btn-primary" data-action="team-member-profile-tab" data-id="tasks">View all</button>
          </header>
          <div class="lead-profile-list team-member-record-list">${buildTeamMemberTaskRows(openTasks, { limit: 5 })}</div>
        </section>

        <section class="team-member-panel-block">
          <header class="team-member-panel-head">
            <div>
              <p class="lead-profile-section-title">Recent Activity</p>
              <h4>Latest movement across owned records</h4>
            </div>
            <button type="button" class="mini-btn mini-btn-primary" data-action="team-member-profile-tab" data-id="activity">View all</button>
          </header>
          ${buildTeamMemberActivityRows(activityItems, { limit: 6 })}
        </section>
      </section>
    </section>
  `;
  const leadsPanelMarkup = `
    <section id="team-member-profile-panel-leads" class="lead-profile-panel team-member-profile-panel" data-team-member-view-panel="leads" role="tabpanel" aria-labelledby="team-member-profile-tab-leads">
      <section class="team-member-panel-block">
        <header class="team-member-panel-head">
          <div>
            <p class="lead-profile-section-title">Leads</p>
            <h4>All active leads assigned to ${escapeHtml(member.name)}</h4>
          </div>
          <span class="status-chip">${escapeHtml(String(assignedLeads.length))}</span>
        </header>
        <div class="lead-profile-list team-member-record-list team-member-record-list-wide">${buildTeamMemberLeadRows(assignedLeads, { limit: 0 })}</div>
      </section>
    </section>
  `;
  const dealsPanelMarkup = `
    <section id="team-member-profile-panel-deals" class="lead-profile-panel team-member-profile-panel" data-team-member-view-panel="deals" role="tabpanel" aria-labelledby="team-member-profile-tab-deals">
      <section class="team-member-panel-block">
        <header class="team-member-panel-head">
          <div>
            <p class="lead-profile-section-title">Deals</p>
            <h4>Open pipeline currently owned by ${escapeHtml(member.name)}</h4>
          </div>
          <span class="status-chip">${escapeHtml(String(openDeals.length))}</span>
        </header>
        <div class="lead-profile-list team-member-record-list team-member-record-list-wide">${buildTeamMemberDealRows(openDeals, { limit: 0 })}</div>
      </section>
    </section>
  `;
  const tasksPanelMarkup = `
    <section id="team-member-profile-panel-tasks" class="lead-profile-panel team-member-profile-panel" data-team-member-view-panel="tasks" role="tabpanel" aria-labelledby="team-member-profile-tab-tasks">
      <section class="team-member-panel-block">
        <header class="team-member-panel-head">
          <div>
            <p class="lead-profile-section-title">Tasks</p>
            <h4>Open tasks assigned to ${escapeHtml(member.name)}</h4>
          </div>
          <span class="status-chip">${escapeHtml(String(openTasks.length))}</span>
        </header>
        ${completedTaskCount ? `<p class="team-member-profile-note">${escapeHtml(`${completedTaskCount} completed task${completedTaskCount === 1 ? "" : "s"} hidden from this view.`)}</p>` : ""}
        <div class="lead-profile-list team-member-record-list team-member-record-list-wide">${buildTeamMemberTaskRows(openTasks, { limit: 0 })}</div>
      </section>
    </section>
  `;
  const activityPanelMarkup = `
    <section id="team-member-profile-panel-activity" class="lead-profile-panel team-member-profile-panel" data-team-member-view-panel="activity" role="tabpanel" aria-labelledby="team-member-profile-tab-activity">
      <section class="team-member-panel-block">
        <header class="team-member-panel-head">
          <div>
            <p class="lead-profile-section-title">Activity</p>
            <h4>Recent updates tied to this member</h4>
          </div>
        </header>
        ${buildTeamMemberActivityRows(activityItems, { limit: 12 })}
      </section>
    </section>
  `;
  const settingsPanelMarkup = `
    <section id="team-member-profile-panel-settings" class="lead-profile-panel team-member-profile-panel" data-team-member-view-panel="settings" role="tabpanel" aria-labelledby="team-member-profile-tab-settings">
      <form id="teamMemberProfileForm" class="lead-profile-surface lead-record-surface team-member-profile-form" data-member-id="${escapeHtml(member.id)}">
        <header class="team-member-profile-card-head">
          <div>
            <p class="lead-profile-section-title">Settings</p>
            <h4>Editable workspace settings</h4>
          </div>
        </header>
        <p class="team-member-profile-note">${escapeHtml(managementNote)}</p>

        <section class="profile-block">
          <h4>Identity & Team</h4>
          <div class="profile-grid profile-grid-2">
            <label class="form-field"><span>Name</span><input type="text" name="name" value="${escapeHtml(member.name || "")}" required ${controlDisabledAttr} /></label>
            <label class="form-field"><span>Email</span><input type="email" name="email" value="${escapeHtml(member.email || "")}" required ${controlDisabledAttr} /></label>
            <label class="form-field"><span>Job Title</span><input type="text" name="title" value="${escapeHtml(member.title || "")}" placeholder="Sales Manager" ${controlDisabledAttr} /></label>
            <label class="form-field"><span>Department / Team</span><input type="text" name="team" value="${escapeHtml(member.team || "")}" required ${controlDisabledAttr} /></label>
            <label class="form-field"><span>Manager</span><select name="manager" ${controlDisabledAttr}>${managerOptions.map((item) => `<option value="${escapeHtml(item.value)}" ${String(member.manager || "") === item.value ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}</select></label>
            <label class="form-field"><span>Timezone</span><select name="timezone" ${controlDisabledAttr}>${ATTENDANCE_TIMEZONE_OPTIONS.map((item) => `<option value="${escapeHtml(item)}" ${String(member.timezone || "Local") === item ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}</select></label>
          </div>
        </section>

        <section class="profile-block">
          <h4>Access</h4>
          <div class="profile-grid profile-grid-2">
            <label class="form-field"><span>Status</span><select name="status" ${controlDisabledAttr}>${["Pending Invite", "Active", "Inactive"].map((item) => `<option value="${item}" ${normalizeTeamMemberStatus(member.status) === item ? "selected" : ""}>${item}</option>`).join("")}</select></label>
            <label class="form-field"><span>Role</span><select name="role" ${controlDisabledAttr}>${roleOptions.map((item) => `<option value="${item}" ${String(member.role || "") === item ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}</select></label>
            <label class="form-field"><span>Data Scope</span><select name="scope" ${controlDisabledAttr}>${PROFILE_SCOPE_OPTIONS.map((item) => `<option value="${item}" ${scopeValue === item ? "selected" : ""}>${item.toUpperCase()}</option>`).join("")}</select></label>
            <label class="form-field"><span>Shift</span><input type="text" name="shift" value="${escapeHtml(member.shift || "09:00-18:00")}" placeholder="09:00-18:00" ${controlDisabledAttr} /></label>
          </div>
          <div class="profile-toggle-row">
            <label class="profile-check"><input type="checkbox" name="queueEligible" ${member.queueEligible ? "checked" : ""} ${controlDisabledAttr} /> Queue eligible</label>
            <label class="profile-check"><input type="checkbox" name="defaultOwner" ${member.defaultOwner ? "checked" : ""} ${controlDisabledAttr} /> Default owner candidate</label>
          </div>
        </section>

        <section class="profile-block">
          <h4>Advanced Permissions</h4>
          <div class="permission-matrix-shell">
            <table class="permission-matrix">
              <thead>
                <tr><th>Module</th>${PROFILE_PERMISSION_ACTIONS.map((action) => `<th>${escapeHtml(action)}</th>`).join("")}</tr>
              </thead>
              <tbody>
                ${PROFILE_PERMISSION_MODULES.map((module) => {
                  const current = permissions?.[module.id] || {};
                  return `
                    <tr>
                      <td>${escapeHtml(module.label)}</td>
                      ${PROFILE_PERMISSION_ACTIONS.map((action) => `<td><input type="checkbox" name="perm__${escapeHtml(module.id)}__${escapeHtml(action)}" ${current[action] ? "checked" : ""} ${controlDisabledAttr} /></td>`).join("")}
                    </tr>
                  `;
                }).join("")}
              </tbody>
            </table>
          </div>
        </section>

        <div class="form-actions">
          ${inviteActions}
          ${activeActions}
          ${canEditMember ? `<button type="submit" class="btn btn-accent">Save Member</button>` : ""}
        </div>
      </form>
    </section>
  `;
  const activePanelMarkup =
    {
      overview: overviewPanelMarkup,
      leads: leadsPanelMarkup,
      deals: dealsPanelMarkup,
      tasks: tasksPanelMarkup,
      activity: activityPanelMarkup,
      settings: settingsPanelMarkup
    }[activeTab] || overviewPanelMarkup;

  return {
    title: "Team Member Profile",
    subtitle: "CRM-style member record and assignments",
    showWaitingPanel: false,
    html: `
      <section class="view-block settings-profile-view lead-profile-page-view team-member-profile-page">
        <div class="team-member-profile-shell">
          <aside class="team-member-profile-sidebar">
            <article class="team-member-profile-sidebar-card team-member-profile-sidebar-card-identity">
              <div class="team-member-profile-sidebar-hero">
                <div class="team-member-profile-sidebar-cover" aria-hidden="true"></div>
                <span class="team-member-profile-sidebar-avatar">
                  ${memberAvatarUrl ? `<img src="${escapeHtml(memberAvatarUrl)}" alt="${escapeHtml(member.name || "Team member")}" />` : escapeHtml(memberInitials(member.name))}
                </span>
                <div class="team-member-profile-sidebar-copy">
                  <h4>${escapeHtml(member.name)}</h4>
                  <p>${escapeHtml(profileHeroSubtitle)}</p>
                </div>
                <div class="lead-profile-chip-row team-member-profile-sidebar-badges">
                  ${teamMemberRoleBadge(member.role)}
                  ${teamMemberStatusBadge(member.status)}
                </div>
              </div>
              ${sidebarStatsMarkup}
              ${sidebarFactsMarkup}
              ${sidebarTagsMarkup}
            </article>
          </aside>

          <div class="team-member-profile-content">
            <section class="team-member-profile-toolbar">
              <div class="team-member-profile-toolbar-copy">
                <p class="lead-profile-section-title">Workspace Record</p>
                <h4>${escapeHtml(`${member.name}'s CRM record`)}</h4>
                <p>${escapeHtml(`Track ${member.name}'s leads, deals, tasks, and workspace activity in one place.`)}</p>
              </div>
              <div class="lead-profile-head-actions team-member-profile-actions">
                <button class="table-ops-columns-btn" type="button" data-route="team">
                  <i class="bi bi-people" aria-hidden="true"></i>
                  <span>Back To Team</span>
                </button>
                ${
                  assignedLeads.length
                    ? `<button class="btn btn-light" type="button" data-action="team-member-profile-tab" data-id="leads">View Leads</button>`
                    : ""
                }
                ${
                  canManageTeam
                    ? `<button class="btn btn-light" type="button" data-action="team-member-profile-tab" data-id="settings">Edit Settings</button>`
                    : ""
                }
              </div>
            </section>

            <section class="team-member-profile-canvas">
              <nav class="team-member-profile-tabs" aria-label="Team member profile tabs" role="tablist">
                ${tabButton("overview", "Overview")}
                ${tabButton("leads", "Leads", assignedLeads.length)}
                ${tabButton("deals", "Deals", openDeals.length)}
                ${tabButton("tasks", "Tasks", openTasks.length)}
                ${tabButton("activity", "Activity", Math.min(activityItems.length, 99))}
                ${tabButton("settings", "Settings")}
              </nav>
              ${activePanelMarkup}
            </section>
          </div>
        </div>
      </section>
    `
  };
}

export function renderSettings(data, context) {
  const profile = getProfilePageModel(data);
  const workspaceModel = getWorkspacePageModel(data);
  const workspace = workspaceModel.workspace;
  const currentTheme = String(context?.uiTheme || "light").trim().toLowerCase() === "dark" ? "dark" : "light";
  const currentUser = data.currentUser && typeof data.currentUser === "object" ? data.currentUser : {};
  const currentMember = profile.currentMember;
  const security = currentUser.security && typeof currentUser.security === "object" ? currentUser.security : {};
  const notifications =
    currentUser.notifications && typeof currentUser.notifications === "object" ? currentUser.notifications : {};
  const communication =
    currentUser.communication && typeof currentUser.communication === "object" ? currentUser.communication : {};
  const timezoneOptions = getWorkspaceTimezoneOptions(workspace.timezone);
  const ownerOptions = buildWorkspaceOwnerOptions(data, workspace.crmDefaultOwner);
  const passwordUpdatedLabel = formatProfileDateLabel(security.lastPasswordChange);
  const securitySessions = Math.max(1, Number(security.activeSessions || 1) || 1);
  const showWorkspaceSettings = canAccessWorkspaceProfile(data);
  const selectedBusinessDays = new Set(
    (Array.isArray(workspace.businessDays) ? workspace.businessDays : [])
      .map((day) => Number(day))
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
  );

  return {
    title: "Settings",
    subtitle: "Manage account preferences and workspace configuration",
    showWaitingPanel: false,
    html: `
      <section class="view-block settings-page settings-console-view">
        <div class="settings-page-head">${renderSettingsRouteSwitch(data, "settings")}</div>

        <form id="myProfileForm" class="settings-flat-form">
          <section class="settings-flat-section">
            <div class="settings-flat-section-copy">
              <h4>Account</h4>
              <p>Edit the identity and defaults attached to your user account. Profile photo is managed from Profile.</p>
            </div>
            <div class="settings-flat-section-body">
              <div class="settings-profile-grid settings-grid-2 my-profile-card-grid">
                <label class="form-field">
                  <span>Full Name</span>
                  <input type="text" name="name" value="${escapeHtml(profile.fullName)}" required />
                </label>
                <label class="form-field">
                  <span>Email</span>
                  <input type="email" name="email" value="${escapeHtml(profile.emailValue)}" placeholder="name@company.com" />
                </label>
                <label class="form-field">
                  <span>Phone</span>
                  <input type="text" name="phone" value="${escapeHtml(profile.phoneValue)}" placeholder="+1-555-000-0000" />
                </label>
                <label class="form-field">
                  <span>Job Title</span>
                  <input type="text" name="title" value="${escapeHtml(profile.titleValue)}" placeholder="Owner / Manager / Agent" />
                </label>
                <label class="form-field">
                  <span>Availability</span>
                  <select name="availability">
                    ${PROFILE_AVAILABILITY_OPTIONS.map(
                      (item) => `<option value="${escapeHtml(item)}" ${profile.availability === item ? "selected" : ""}>${escapeHtml(item)}</option>`
                    ).join("")}
                  </select>
                </label>
                <label class="form-field">
                  <span>Timezone</span>
                  <select name="timezone">
                    ${ATTENDANCE_TIMEZONE_OPTIONS.map(
                      (item) => `<option value="${escapeHtml(item)}" ${profile.timezone === item ? "selected" : ""}>${escapeHtml(item)}</option>`
                    ).join("")}
                  </select>
                </label>
                <label class="form-field">
                  <span>Language</span>
                  <select name="language">
                    ${PROFILE_LANGUAGE_OPTIONS.map(
                      (item) => `<option value="${escapeHtml(item)}" ${profile.language === item ? "selected" : ""}>${escapeHtml(item)}</option>`
                    ).join("")}
                  </select>
                </label>
              </div>
            </div>
          </section>

          <section class="settings-flat-section">
            <div class="settings-flat-section-copy">
              <h4>Appearance</h4>
              <p>Choose the workspace chrome for this browser. We’ll roll dark mode out across modules in stages.</p>
            </div>
            <div class="settings-flat-section-body">
              <div class="settings-appearance-grid" role="group" aria-label="Appearance theme">
                <button
                  type="button"
                  class="settings-appearance-option ${currentTheme === "light" ? "is-active" : ""}"
                  data-action="ui-theme"
                  data-id="light"
                  aria-pressed="${currentTheme === "light" ? "true" : "false"}"
                >
                  <span class="settings-appearance-preview is-light" aria-hidden="true">
                    <span class="settings-appearance-preview-top"></span>
                    <span class="settings-appearance-preview-sidebar"></span>
                    <span class="settings-appearance-preview-canvas"></span>
                  </span>
                  <span class="settings-appearance-copy">
                    <strong><i class="bi bi-sun" aria-hidden="true"></i><span>Light</span></strong>
                    <small>Bright canvas with the current default workspace styling.</small>
                  </span>
                </button>
                <button
                  type="button"
                  class="settings-appearance-option ${currentTheme === "dark" ? "is-active" : ""}"
                  data-action="ui-theme"
                  data-id="dark"
                  aria-pressed="${currentTheme === "dark" ? "true" : "false"}"
                >
                  <span class="settings-appearance-preview is-dark" aria-hidden="true">
                    <span class="settings-appearance-preview-top"></span>
                    <span class="settings-appearance-preview-sidebar"></span>
                    <span class="settings-appearance-preview-canvas"></span>
                  </span>
                  <span class="settings-appearance-copy">
                    <strong><i class="bi bi-moon-stars" aria-hidden="true"></i><span>Dark</span></strong>
                    <small>Deeper shell with reduced glare for long operating sessions.</small>
                  </span>
                </button>
              </div>
            </div>
          </section>

          <section class="settings-flat-section">
            <div class="settings-flat-section-copy">
              <h4>Notifications</h4>
              <p>Choose which channels should keep you informed.</p>
            </div>
            <div class="settings-flat-section-body">
              <div class="settings-toggle-list">
                <label class="settings-toggle-line">
                  <input type="checkbox" name="notifyInApp" ${notifications.inApp === false ? "" : "checked"} />
                  <span>In-app notifications</span>
                  <small>Receive alerts while working inside the product.</small>
                </label>
                <label class="settings-toggle-line">
                  <input type="checkbox" name="notifyEmail" ${notifications.email === false ? "" : "checked"} />
                  <span>Email notifications</span>
                  <small>Get summaries and direct updates in your inbox.</small>
                </label>
                <label class="settings-toggle-line">
                  <input type="checkbox" name="notifySms" ${notifications.sms ? "checked" : ""} />
                  <span>SMS notifications</span>
                  <small>Reserve texts for urgent reminders and time-sensitive activity.</small>
                </label>
              </div>
            </div>
          </section>

          <section class="settings-flat-section">
            <div class="settings-flat-section-copy">
              <h4>Communication</h4>
              <p>Control how your outbound messages and signatures appear to customers.</p>
            </div>
            <div class="settings-flat-section-body">
              <div class="settings-profile-grid my-profile-card-grid">
                <label class="form-field">
                  <span>Sender Name</span>
                  <input
                    type="text"
                    name="senderName"
                    value="${escapeHtml(
                      String(communication.senderName || currentMember?.communication?.senderName || currentUser.name || "").trim() || profile.fullName
                    )}"
                  />
                </label>
                <label class="form-field">
                  <span>Email Signature</span>
                  <textarea name="signature" rows="4" placeholder="Best,\nName">${escapeHtml(
                    String(communication.signature || currentMember?.communication?.signature || "").trim()
                  )}</textarea>
                </label>
              </div>
            </div>
          </section>

          <section class="settings-flat-section">
            <div class="settings-flat-section-copy">
              <h4>Security</h4>
              <p>Update your password credentials and manage your current session footprint.</p>
            </div>
            <div class="settings-flat-section-body">
              <div class="settings-inline-meta">
                <span>Active sessions: ${escapeHtml(String(securitySessions))}</span>
                <span>Password updated: ${escapeHtml(passwordUpdatedLabel)}</span>
                <button class="mini-btn" type="button" data-action="profile-end-sessions">End Other Sessions</button>
              </div>
              <div class="settings-profile-grid settings-grid-2 my-profile-card-grid">
                <label class="form-field">
                  <span>New Password</span>
                  <input type="password" name="newPassword" autocomplete="new-password" placeholder="Leave blank to keep current" />
                </label>
                <label class="form-field">
                  <span>Confirm Password</span>
                  <input type="password" name="confirmPassword" autocomplete="new-password" placeholder="Repeat new password" />
                </label>
              </div>
            </div>
          </section>

          <div class="settings-flat-actions">
            <button type="submit" class="table-ops-columns-btn my-profile-save-btn">
              <i class="bi bi-check2" aria-hidden="true"></i>
              <span>Save Account Settings</span>
            </button>
          </div>
        </form>

        ${
          showWorkspaceSettings
            ? `
              <form id="workspaceProfileForm" class="settings-flat-form settings-workspace-settings-form">
                <section class="settings-flat-section">
                  <div class="settings-flat-section-copy">
                    <h4>Workspace Brand</h4>
                    <p>Shape the name and identity used across the product. Workspace logo is managed from Workspace.</p>
                  </div>
                  <div class="settings-flat-section-body">
                    <div class="settings-profile-grid settings-grid-2">
                      <label class="form-field">
                        <span>Workspace Name</span>
                        <input type="text" name="workspaceName" value="${escapeHtml(workspace.name)}" required />
                      </label>
                      <label class="form-field">
                        <span>Display Label</span>
                        <input type="text" name="appLabel" value="${escapeHtml(workspace.appLabel)}" />
                      </label>
                      <label class="form-field">
                        <span>Legal Name</span>
                        <input type="text" name="legalName" value="${escapeHtml(workspace.legalName)}" />
                      </label>
                      <label class="form-field settings-color-field">
                        <span>Brand Color</span>
                        <input type="color" name="brandColor" value="${escapeHtml(workspace.brandColor)}" />
                      </label>
                    </div>
                  </div>
                </section>

                <section class="settings-flat-section">
                  <div class="settings-flat-section-copy">
                    <h4>Workspace Contact</h4>
                    <p>Keep the public-facing website, support channels, and business address up to date.</p>
                  </div>
                  <div class="settings-flat-section-body">
                    <div class="settings-profile-grid settings-grid-2">
                      <label class="form-field">
                        <span>Website</span>
                        <input type="url" name="website" value="${escapeHtml(workspace.website)}" placeholder="https://..." />
                      </label>
                      <label class="form-field">
                        <span>Support Email</span>
                        <input type="email" name="supportEmail" value="${escapeHtml(workspace.supportEmail)}" placeholder="support@company.com" />
                      </label>
                      <label class="form-field">
                        <span>Support Phone</span>
                        <input type="text" name="supportPhone" value="${escapeHtml(workspace.supportPhone)}" placeholder="+1-555-000-0000" />
                      </label>
                      <label class="form-field settings-grid-span-2">
                        <span>Business Address</span>
                        <textarea name="businessAddress" rows="3" placeholder="Street, city, region, postal code">${escapeHtml(workspace.businessAddress)}</textarea>
                      </label>
                    </div>
                  </div>
                </section>

                <section class="settings-flat-section">
                  <div class="settings-flat-section-copy">
                    <h4>Operations</h4>
                    <p>Set the timezone, formatting, and weekly operating rhythm the workspace should follow.</p>
                  </div>
                  <div class="settings-flat-section-body">
                    <div class="settings-profile-grid settings-grid-2">
                      <label class="form-field">
                        <span>Timezone</span>
                        <select name="workspaceTimezone">
                          ${timezoneOptions
                            .map(
                              (item) =>
                                `<option value="${escapeHtml(item)}" ${workspace.timezone === item ? "selected" : ""}>${escapeHtml(item)}</option>`
                            )
                            .join("")}
                        </select>
                      </label>
                      <label class="form-field">
                        <span>Date Format</span>
                        <select name="dateFormat">
                          ${WORKSPACE_DATE_FORMATS.map(
                            (item) => `<option value="${item}" ${workspace.dateFormat === item ? "selected" : ""}>${item}</option>`
                          ).join("")}
                        </select>
                      </label>
                      <label class="form-field">
                        <span>Currency</span>
                        <select name="currency">
                          ${WORKSPACE_CURRENCIES.map(
                            (item) => `<option value="${item}" ${workspace.currency === item ? "selected" : ""}>${item}</option>`
                          ).join("")}
                        </select>
                      </label>
                      <label class="form-field">
                        <span>Week Start</span>
                        <select name="weekStart">
                          ${WORKSPACE_WEEK_START_OPTIONS.map(
                            (item) => `<option value="${item}" ${workspace.weekStart === item ? "selected" : ""}>${item}</option>`
                          ).join("")}
                        </select>
                      </label>
                      <label class="form-field">
                        <span>Business Start</span>
                        <input type="time" name="businessStart" value="${escapeHtml(workspace.businessStart)}" />
                      </label>
                      <label class="form-field">
                        <span>Business End</span>
                        <input type="time" name="businessEnd" value="${escapeHtml(workspace.businessEnd)}" />
                      </label>
                    </div>
                    <div class="settings-group-label-row">
                      <span class="settings-group-label">Business Days</span>
                      <small>Choose the weekdays your workspace usually operates.</small>
                    </div>
                    <div class="settings-check-grid settings-check-grid-days">
                      ${WORKDAY_OPTIONS.map((day) => {
                        const isChecked = selectedBusinessDays.has(day.value) ? "checked" : "";
                        return `
                          <label class="settings-check-item">
                            <input type="checkbox" name="businessDays" value="${day.value}" ${isChecked} />
                            <span>${day.label}</span>
                          </label>
                        `;
                      }).join("")}
                    </div>
                  </div>
                </section>

                <section class="settings-flat-section">
                  <div class="settings-flat-section-copy">
                    <h4>CRM Defaults</h4>
                    <p>Set the owner, stage, and response rhythm used when new records are created.</p>
                  </div>
                  <div class="settings-flat-section-body">
                    <div class="settings-profile-grid settings-grid-2">
                      <label class="form-field">
                        <span>Default Stage</span>
                        <select name="crmDefaultStage">
                          ${PIPELINE_STAGE_OPTIONS.map(
                            (item) => `<option value="${escapeHtml(item)}" ${workspace.crmDefaultStage === item ? "selected" : ""}>${escapeHtml(item)}</option>`
                          ).join("")}
                        </select>
                      </label>
                      <label class="form-field">
                        <span>Default Owner</span>
                        <select name="crmDefaultOwner">
                          <option value="" ${workspace.crmDefaultOwner ? "" : "selected"}>Current admin</option>
                          ${ownerOptions
                            .map(
                              (item) =>
                                `<option value="${escapeHtml(item.value)}" ${workspace.crmDefaultOwner === item.value ? "selected" : ""}>${escapeHtml(item.label)}</option>`
                            )
                            .join("")}
                        </select>
                      </label>
                      <label class="form-field">
                        <span>SLA (hours)</span>
                        <input type="number" min="0" max="168" name="crmSlaHours" value="${escapeHtml(String(workspace.crmSlaHours))}" />
                      </label>
                      <label class="form-field">
                        <span>Default Follow-up (days)</span>
                        <input type="number" min="0" max="30" name="crmFollowUpDays" value="${escapeHtml(String(workspace.crmFollowUpDays))}" />
                      </label>
                    </div>
                  </div>
                </section>

                <div class="settings-flat-actions">
                  <button type="submit" class="table-ops-columns-btn settings-save-btn">
                    <i class="bi bi-check2" aria-hidden="true"></i>
                    <span>Save Workspace Settings</span>
                  </button>
                </div>
              </form>
            `
            : ""
        }
      </section>
    `
  };
}

