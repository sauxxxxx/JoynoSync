import { formatCompactMoney, formatMoney } from "../utils/format.js";
import { compareDateIso, compareNumber, compareText } from "../utils/sort.js";
import { escapeHtml, matchesSearch, normalizeForMatch, phoneDigitsOnly } from "../utils/text.js";
import { tableActionMenu, viewSectionHead } from "../utils/ui.js";
import { getContactContext, getLeadContext, getPrimaryLeadContact } from "../modules/crm-context.js";
import { findDirectThreadByName as findDirectThreadByNameInData } from "../modules/comms-core.js";

function initialsFromLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "--";
  }
  const parts = raw.split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return "--";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase();
}

function crmAvatarCell(label, type = "person") {
  const safeLabel = escapeHtml(label || "-");
  const initials = escapeHtml(initialsFromLabel(label));
  const toneClass = type === "company" ? " is-company" : "";
  return `
    <span class="crm-name-cell">
      <span class="crm-inline-avatar${toneClass}" aria-hidden="true">${initials}</span>
      <span class="crm-name-text">${safeLabel}</span>
    </span>
  `;
}

function crmAvatarStackCell(label, subLabel = "", type = "person", nameMeta = "") {
  const safeLabel = escapeHtml(label || "-");
  const safeSubLabel = escapeHtml(subLabel || "");
  const initials = escapeHtml(initialsFromLabel(label));
  const toneClass = type === "company" ? " is-company" : "";
  return `
    <span class="crm-name-cell">
      <span class="crm-inline-avatar${toneClass}" aria-hidden="true">${initials}</span>
      <span class="crm-name-stack">
        <span class="crm-name-line">
          <span class="crm-name-text">${safeLabel}</span>
          ${String(nameMeta || "").trim()}
        </span>
        <span class="crm-name-sub">${safeSubLabel || "&nbsp;"}</span>
      </span>
    </span>
  `;
}

function resolveLeadEmail(lead, contacts = []) {
  const directEmail = String(lead?.email || "").trim();
  if (directEmail) {
    return directEmail;
  }
  const leadName = String(lead?.name || "").trim().toLowerCase();
  const leadCompany = String(lead?.company || "").trim().toLowerCase();
  if (!leadName && !leadCompany) {
    return "";
  }
  const byExactName = contacts.find((contact) => String(contact?.name || "").trim().toLowerCase() === leadName);
  if (byExactName?.email) {
    return String(byExactName.email).trim();
  }
  const byAccount = contacts.find((contact) => String(contact?.account || "").trim().toLowerCase() === leadCompany);
  if (byAccount?.email) {
    return String(byAccount.email).trim();
  }
  return "";
}

function formatLeadProfileDate(value) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) {
    return "Not set";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(parsed));
}

function formatLeadProfileDateTime(value) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) {
    return "";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(parsed));
}

function normalizeLeadAttemptHistoryEntries(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const reason = String(entry.reason || entry.text || "").trim();
      const note = String(entry.note || "").trim();
      const createdAt = String(entry.createdAt || entry.loggedAt || "").trim();
      const actor = String(entry.actor || "").trim();
      return {
        id: String(entry.id || "").trim(),
        createdAt: Number.isFinite(Date.parse(createdAt)) ? createdAt : "",
        reason: reason || "Outreach attempt logged.",
        note,
        actor
      };
    })
    .filter((entry) => Boolean(entry.createdAt) || Boolean(entry.reason) || Boolean(entry.note) || Boolean(entry.actor));
}

function normalizeLeadAttemptHistoryValue(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/g, "")
    .toLowerCase();
}

function parseLeadAttemptHistoryText(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return {
      reason: "Outreach attempt logged.",
      note: ""
    };
  }
  const stripped = raw.replace(/^Attempt\s+\d+\/3\s+logged:\s*/i, "").trim();
  const withoutAutoStatus = stripped.replace(/\s*Lead moved to (?:Contacted|Unqualified)\.?$/i, "").trim();
  const noteSplitIndex = withoutAutoStatus.indexOf(". ");
  const reason =
    (noteSplitIndex >= 0
      ? withoutAutoStatus.slice(0, noteSplitIndex)
      : withoutAutoStatus
    )
      .trim()
      .replace(/\.$/, "") || "Outreach attempt logged.";
  const note =
    noteSplitIndex >= 0
      ? withoutAutoStatus
          .slice(noteSplitIndex + 2)
          .trim()
          .replace(/^Note:\s*/i, "")
          .replace(/\s+Lead moved to (?:Contacted|Unqualified)\.?$/i, "")
          .trim()
      : "";
  return {
    reason,
    note
  };
}

function normalizeLeadAttemptCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.min(3, Math.round(numeric)));
}

function getLeadAttemptMeta(lead) {
  const meta = lead?.meta && typeof lead.meta === "object" ? lead.meta : {};
  const lastAttemptAt = String(meta.lastAttemptAt || "").trim();
  const assignedAt = String(meta.assignedAt || lead?.createdAt || "").trim();
  const attemptHistory = normalizeLeadAttemptHistoryEntries(meta.attemptHistory);
  return {
    attemptCount: normalizeLeadAttemptCount(meta.attemptCount),
    lastAttemptAt: Number.isFinite(Date.parse(lastAttemptAt)) ? lastAttemptAt : "",
    lastAttemptReason: String(meta.lastAttemptReason || "").trim(),
    assignedAt: Number.isFinite(Date.parse(assignedAt)) ? assignedAt : "",
    attemptHistory:
      attemptHistory.length || !String(meta.lastAttemptReason || "").trim()
        ? attemptHistory
        : [
            {
              id: "",
              createdAt: Number.isFinite(Date.parse(lastAttemptAt)) ? lastAttemptAt : "",
              reason: String(meta.lastAttemptReason || "").trim(),
              note: "",
              actor: ""
            }
          ]
  };
}

function getLeadAssignedDays(value) {
  const parsed = Date.parse(String(value || "").trim());
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const assignedDate = new Date(parsed);
  const today = new Date();
  const assignedDay = new Date(assignedDate.getFullYear(), assignedDate.getMonth(), assignedDate.getDate()).getTime();
  const currentDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.max(0, Math.floor((currentDay - assignedDay) / 86400000));
}

function formatLeadAssignedDaysLabel(value) {
  const days = getLeadAssignedDays(value);
  if (days === null) {
    return "Not set";
  }
  return `${days} day${days === 1 ? "" : "s"}`;
}

function getLeadAttemptGuidance(lead, attemptMeta) {
  const assignedDays = getLeadAssignedDays(attemptMeta?.assignedAt);
  const attemptCount = normalizeLeadAttemptCount(attemptMeta?.attemptCount);
  const status = String(lead?.status || "").trim().toLowerCase();
  const isProgressing = status === "qualified" || status === "unqualified" || Boolean(String(lead?.convertedAt || "").trim());
  if (attemptCount >= 3) {
    return {
      label: "Ready for reassignment",
      tone: "warning",
      disableLogging: true,
      assignedDays
    };
  }
  if (assignedDays !== null && assignedDays >= 14 && !isProgressing) {
    return {
      label: `Assigned for ${assignedDays} days with no progress`,
      tone: "warning",
      disableLogging: false,
      assignedDays
    };
  }
  if (attemptCount === 0) {
    return {
      label: "No attempts logged yet",
      tone: "neutral",
      disableLogging: false,
      assignedDays
    };
  }
  const attemptsLeft = Math.max(0, 3 - attemptCount);
  return {
    label: `${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} left before reassignment`,
    tone: attemptsLeft === 1 ? "warning" : "neutral",
    disableLogging: false,
    assignedDays
  };
}

function normalizeLeadWeeklyRemovalState(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "pending" || normalized === "removed") {
    return normalized;
  }
  return "";
}

function normalizeLeadWeeklyRemovalDueAt(value) {
  const parsed = Date.parse(String(value || "").trim());
  if (!Number.isFinite(parsed)) {
    return "";
  }
  const offsetMs = LEAD_WEEKLY_REMOVAL_TIMEZONE_OFFSET_HOURS * 60 * 60 * 1000;
  const localDate = new Date(parsed + offsetMs);
  const isFriday = localDate.getUTCDay() === LEAD_WEEKLY_REMOVAL_WEEKDAY;
  const isBeforeCutoff =
    localDate.getUTCHours() < LEAD_WEEKLY_REMOVAL_CUTOFF_HOUR ||
    (
      localDate.getUTCHours() === LEAD_WEEKLY_REMOVAL_CUTOFF_HOUR &&
      localDate.getUTCMinutes() === 0 &&
      localDate.getUTCSeconds() === 0 &&
      localDate.getUTCMilliseconds() === 0
    );
  if (isFriday && isBeforeCutoff) {
    return new Date(
      Date.UTC(
        localDate.getUTCFullYear(),
        localDate.getUTCMonth(),
        localDate.getUTCDate(),
        LEAD_WEEKLY_REMOVAL_CUTOFF_HOUR,
        0,
        0,
        0
      ) - offsetMs
    ).toISOString();
  }
  return new Date(parsed).toISOString();
}

function resolveLeadWeeklyRemovalDueAt(value = new Date().toISOString()) {
  const parsed = Date.parse(String(value || "").trim());
  const date = Number.isFinite(parsed) ? new Date(parsed) : new Date();
  const localOffsetMs = LEAD_WEEKLY_REMOVAL_TIMEZONE_OFFSET_HOURS * 60 * 60 * 1000;
  const localNow = new Date(date.getTime() + localOffsetMs);
  const localWeekday = localNow.getUTCDay();
  const localHour = localNow.getUTCHours();
  const localMinute = localNow.getUTCMinutes();
  const localSecond = localNow.getUTCSeconds();
  const localMillisecond = localNow.getUTCMilliseconds();
  const daysUntilFriday = (LEAD_WEEKLY_REMOVAL_WEEKDAY - localWeekday + 7) % 7;
  const passedFridayCutoff =
    localWeekday > LEAD_WEEKLY_REMOVAL_WEEKDAY ||
    (
      localWeekday === LEAD_WEEKLY_REMOVAL_WEEKDAY &&
      (
        localHour > LEAD_WEEKLY_REMOVAL_CUTOFF_HOUR ||
        (
          localHour === LEAD_WEEKLY_REMOVAL_CUTOFF_HOUR &&
          (localMinute > 0 || localSecond > 0 || localMillisecond > 0)
        )
      )
    );
  const targetDays = passedFridayCutoff ? daysUntilFriday || 7 : daysUntilFriday;
  return new Date(
    Date.UTC(
      localNow.getUTCFullYear(),
      localNow.getUTCMonth(),
      localNow.getUTCDate() + targetDays,
      LEAD_WEEKLY_REMOVAL_CUTOFF_HOUR,
      0,
      0,
      0
    ) - localOffsetMs
  ).toISOString();
}

function getLeadWeeklyRemovalMeta(lead) {
  const meta = lead?.meta && typeof lead.meta === "object" ? lead.meta : {};
  const unqualifiedAt = String(meta.unqualifiedAt || "").trim();
  const removalDueAt = String(meta.unqualifiedRemovalDueAt || "").trim();
  return {
    unqualifiedAt: Number.isFinite(Date.parse(unqualifiedAt)) ? unqualifiedAt : "",
    removalDueAt:
      Number.isFinite(Date.parse(removalDueAt))
        ? normalizeLeadWeeklyRemovalDueAt(removalDueAt)
        : String(lead?.status || "").trim() === "Unqualified"
          ? resolveLeadWeeklyRemovalDueAt(new Date().toISOString())
          : "",
    removalState: normalizeLeadWeeklyRemovalState(meta.unqualifiedRemovalState),
    removedFromActiveAt: String(meta.removedFromActiveAt || "").trim(),
    removedFromActiveReason: String(meta.removedFromActiveReason || "").trim()
  };
}

function isLeadPendingWeeklyRemoval(lead) {
  const lifecycle = getLeadWeeklyRemovalMeta(lead);
  return (
    String(lead?.status || "").trim() === "Unqualified" &&
    !Boolean(lead?.archived) &&
    lifecycle.removalState !== "removed" &&
    Boolean(lifecycle.removalDueAt)
  );
}

function summarizeLeadWeeklyRemovalQueue(leads = []) {
  const now = Date.now();
  return (Array.isArray(leads) ? leads : []).reduce(
    (summary, lead) => {
      if (!isLeadPendingWeeklyRemoval(lead)) {
        return summary;
      }
      summary.pendingCount += 1;
      const dueAt = Date.parse(getLeadWeeklyRemovalMeta(lead).removalDueAt);
      if (Number.isFinite(dueAt) && dueAt <= now) {
        summary.dueCount += 1;
      }
      return summary;
    },
    { pendingCount: 0, dueCount: 0 }
  );
}

function renderLeadAttemptPill(attemptMeta) {
  const count = normalizeLeadAttemptCount(attemptMeta?.attemptCount);
  if (!count) {
    return "";
  }
  return `<span class="crm-lead-attempt-pill is-step-${count}" title="${count} of 3 attempts logged">${count}/3</span>`;
}

function getDealValueNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  if (!text) {
    return null;
  }
  const numeric = Number(text);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : null;
}

function hasDealValue(value) {
  return getDealValueNumber(value) !== null;
}

function getDealValueClass(value) {
  const numeric = getDealValueNumber(value);
  if (numeric === null) {
    return "deal-value-text is-missing";
  }
  return numeric > 0 ? "deal-value-text" : "deal-value-text is-zero";
}

function formatDealValueLabel(value, emptyLabel = "No value yet") {
  const numeric = getDealValueNumber(value);
  return numeric === null ? emptyLabel : formatMoney(numeric);
}

function formatDealCompactValueLabel(value, emptyLabel = "No value") {
  const numeric = getDealValueNumber(value);
  return numeric === null ? emptyLabel : formatCompactMoney(numeric);
}

function leadDayDiffFromToday(value) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const date = new Date(parsed);
  const today = new Date();
  const targetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const currentDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((targetDay - currentDay) / 86400000);
}

function formatLeadTableDate(value) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) {
    return "Not set";
  }
  const date = new Date(parsed);
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat("en-US", sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatLeadLastTouch(value) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) {
    return "No activity";
  }
  const diff = leadDayDiffFromToday(value);
  const date = new Date(parsed);
  if (diff === 0) {
    return `Today, ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date)}`;
  }
  if (diff === -1) {
    return "Yesterday";
  }
  return formatLeadTableDate(value);
}

function getLeadFollowUpMeta(value) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) {
    return {
      label: "Not set",
      className: "is-not-set",
      fullLabel: "Not set"
    };
  }
  const diff = leadDayDiffFromToday(value);
  const fullLabel = formatLeadProfileDate(value);
  if (diff < 0) {
    return { label: "Overdue", className: "is-overdue", fullLabel };
  }
  if (diff === 0) {
    return { label: "Today", className: "is-today", fullLabel };
  }
  if (diff === 1) {
    return { label: "Tomorrow", className: "is-tomorrow", fullLabel };
  }
  return {
    label: formatLeadTableDate(value),
    className: "is-upcoming",
    fullLabel
  };
}

function leadProfileStatusClass(value) {
  return String(value || "New")
    .trim()
    .toLowerCase()
    .replaceAll(" ", "-");
}

function getDealStageKey(stage) {
  const value = String(stage || "").trim();
  if (!value) {
    return "Prospecting";
  }
  if (value === "Closed Won") {
    return "Won";
  }
  if (value === "Closed Lost") {
    return "Lost";
  }
  return value;
}

function getDealStageLabel(stage) {
  const value = getDealStageKey(stage);
  if (value === "Won") {
    return "Closed Won";
  }
  if (value === "Lost") {
    return "Closed Lost";
  }
  return value;
}

function getNextDealStageMenuLabel(stage) {
  const current = getDealStageKey(stage);
  if (current === "Prospecting") {
    return "Move to Qualified";
  }
  if (current === "Qualified") {
    return "Move to Proposal";
  }
  if (current === "Proposal") {
    return "Move to Negotiation";
  }
  if (current === "Negotiation") {
    return "Move to Closed Won";
  }
  return "Move Forward";
}

function accountHealthClass(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "healthy" || normalized === "on track") {
    return "account-health-healthy";
  }
  if (normalized === "growing" || normalized === "expanding") {
    return "account-health-growing";
  }
  if (normalized === "at risk" || normalized === "needs attention" || normalized === "churn risk") {
    return "account-health-risk";
  }
  return "account-health-neutral";
}

function resolveOwnerDisplayName(data, owner, ownerId = "") {
  const rawOwner = String(owner || "").trim();
  const people = [data.currentUser, ...(data.teamMembers || [])].filter(Boolean);
  const normalizedOwnerId = String(ownerId || "").trim();
  if (normalizedOwnerId) {
    const exactIdMatch = people.find((person) => String(person?.id || "").trim() === normalizedOwnerId);
    if (exactIdMatch?.name) {
      return String(exactIdMatch.name).trim();
    }
  }
  if (!rawOwner) {
    return "";
  }
  const ownerKey = normalizeForMatch(rawOwner);
  const exactMatch = people.find((person) => normalizeForMatch(person.name) === ownerKey);
  if (exactMatch?.name) {
    return String(exactMatch.name).trim();
  }
  const ownerFirst = ownerKey.split(/\s+/)[0] || "";
  const firstNameMatch = people.find((person) => {
    const personFirst = normalizeForMatch(person.name).split(/\s+/)[0] || "";
    return ownerFirst && personFirst === ownerFirst;
  });
  return firstNameMatch?.name ? String(firstNameMatch.name).trim() : rawOwner;
}

function getCurrentUserTeamMember(data) {
  const currentUser = data?.currentUser && typeof data.currentUser === "object" ? data.currentUser : {};
  const teamMembers = Array.isArray(data?.teamMembers) ? data.teamMembers : [];
  const currentId = String(currentUser.id || "").trim();
  const currentEmail = String(currentUser.email || "").trim().toLowerCase();
  const currentName = normalizeForMatch(currentUser.name);
  return (
    teamMembers.find((member) => currentId && String(member?.id || "").trim() === currentId) ||
    teamMembers.find((member) => currentEmail && String(member?.email || "").trim().toLowerCase() === currentEmail) ||
    teamMembers.find((member) => currentName && normalizeForMatch(member?.name) === currentName) ||
    null
  );
}

function isLeadershipProfile(person) {
  if (!person || typeof person !== "object") {
    return false;
  }
  return [person.team, person.department, person.title, person.role]
    .map((value) => String(value || "").trim().toLowerCase())
    .some((value) => value === "leadership" || value.includes("leadership"));
}

function canViewReserveLeadCount(data, canManageLeads) {
  if (!canManageLeads) {
    return false;
  }
  return isLeadershipProfile(data?.currentUser) || isLeadershipProfile(getCurrentUserTeamMember(data));
}

function leadProfileIconText(icon, text, className = "lead-profile-icon-text") {
  return `
    <span class="${className}">
      <i class="bi ${icon}" aria-hidden="true"></i>
      <span>${escapeHtml(text || "")}</span>
    </span>
  `;
}

function leadProfileActionLabel(icon, label) {
  return `
    <i class="bi ${icon}" aria-hidden="true"></i>
    <span>${escapeHtml(label)}</span>
  `;
}

function leadProfileMenuItem(action, id, label, icon, extra = "") {
  return `
    <button type="button" class="lead-profile-actions-item" data-action="${action}" data-id="${escapeHtml(id)}" ${extra}>
      ${leadProfileActionLabel(icon, label)}
    </button>
  `;
}

function leadProfileDangerMenuItem(action, id, label, icon, extra = "") {
  return `
    <button type="button" class="lead-profile-actions-item is-danger" data-action="${action}" data-id="${escapeHtml(id)}" ${extra}>
      ${leadProfileActionLabel(icon, label)}
    </button>
  `;
}

function leadProfileActivityIcon(item) {
  const haystack = `${String(item?.label || "")} ${String(item?.text || "")}`.toLowerCase();
  if (haystack.includes("attempt")) {
    return "bi-check2-circle";
  }
  if (haystack.includes("email")) {
    return "bi-envelope";
  }
  if (haystack.includes("call") || haystack.includes("phone")) {
    return "bi-telephone";
  }
  if (haystack.includes("task")) {
    return "bi-check2-square";
  }
  if (haystack.includes("owner") || haystack.includes("assign")) {
    return "bi-person";
  }
  if (haystack.includes("status") || haystack.includes("qualified") || haystack.includes("convert")) {
    return "bi-arrow-left-right";
  }
  if (haystack.includes("note")) {
    return "bi-journal-text";
  }
  return "bi-activity";
}

function leadProfileDetailRow(icon, label, value) {
  return `
    <div class="lead-record-detail">
      <span class="lead-record-detail-label">
        <i class="bi ${icon}" aria-hidden="true"></i>
        <span>${escapeHtml(label)}</span>
      </span>
      <strong class="lead-record-detail-value">${escapeHtml(value)}</strong>
    </div>
  `;
}

function collectUniquePhoneEntries(entries = []) {
  const seen = new Set();
  return entries.reduce((list, entry) => {
    const value = String(entry?.value || "").trim();
    if (!value) {
      return list;
    }
    const normalized = phoneDigitsOnly(value) || value.toLowerCase();
    if (seen.has(normalized)) {
      return list;
    }
    seen.add(normalized);
    list.push({
      label: String(entry?.label || "").trim(),
      value
    });
    return list;
  }, []);
}

function getLeadPhoneEntries(lead) {
  return collectUniquePhoneEntries([
    { label: "Primary", value: lead?.phone },
    { label: "Alt", value: lead?.secondaryPhone }
  ]);
}

function crmPhoneActionButtons(action, id, phone) {
  const safePhone = String(phone || "").trim();
  if (!safePhone) {
    return "";
  }
  return `
    <span class="crm-phone-actions">
      <button
        type="button"
        class="crm-phone-call-btn"
        data-action="${escapeHtml(action)}"
        data-id="${escapeHtml(id)}"
        data-phone="${escapeHtml(safePhone)}"
        aria-label="Call ${escapeHtml(safePhone)}"
        title="Call ${escapeHtml(safePhone)}"
      >
        <i class="bi bi-telephone" aria-hidden="true"></i>
      </button>
      <button
        type="button"
        class="crm-phone-copy-btn"
        data-action="crm-copy-phone"
        data-id="${escapeHtml(id)}"
        data-phone="${escapeHtml(safePhone)}"
        aria-label="Copy ${escapeHtml(safePhone)}"
        title="Copy ${escapeHtml(safePhone)}"
      >
        <i class="bi bi-clipboard" aria-hidden="true"></i>
      </button>
    </span>
  `;
}

function crmPhoneListCell(entries, action, id, emptyLabel = "No phone") {
  if (!entries.length) {
    return `<span class="crm-table-meta">${escapeHtml(emptyLabel)}</span>`;
  }
  return `
    <div class="crm-phone-stack">
      ${entries
        .map(
          (entry) => `
            <div class="crm-phone-cell">
              <span class="crm-phone-copy">
                <span class="crm-phone-value">${escapeHtml(entry.value)}</span>
              </span>
              ${crmPhoneActionButtons(action, id, entry.value)}
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function leadProfilePhoneList(entries, action, id, emptyLabel = "No phone") {
  if (!entries.length) {
    return `<p class="lead-profile-empty">${escapeHtml(emptyLabel)}</p>`;
  }
  const showLabels = entries.length > 1;
  return `
    <div class="lead-record-phone-list">
      ${entries
        .map(
          (entry) => `
            <div class="crm-phone-cell">
              <span class="crm-phone-copy">
                <span class="crm-phone-value">${escapeHtml(entry.value)}</span>
                ${showLabels && entry.label ? `<span class="crm-phone-label">${escapeHtml(entry.label)}</span>` : ""}
              </span>
              ${crmPhoneActionButtons(action, id, entry.value)}
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function leadProfilePhoneDetailRow(icon, label, entries, id, emptyLabel = "Not set") {
  return `
    <div class="lead-record-detail">
      <span class="lead-record-detail-label">
        <i class="bi ${icon}" aria-hidden="true"></i>
        <span>${escapeHtml(label)}</span>
      </span>
      <div class="lead-record-detail-value is-multiline">
        ${leadProfilePhoneList(entries, "lead-log-call", id, emptyLabel)}
      </div>
    </div>
  `;
}

function buildAccountContext(data, account) {
  const accountKey = normalizeForMatch(account?.name);
  const contacts = (data.contacts || []).filter((contact) => normalizeForMatch(contact.account) === accountKey);
  const deals = (data.deals || []).filter((deal) => normalizeForMatch(deal.account) === accountKey);
  const tasks = (data.tasks || [])
    .filter((task) => {
      const taskAccountKey = normalizeForMatch(task.account || task.accountName);
      const linkType = normalizeForMatch(task.linkType);
      const linkLabel = normalizeForMatch(task.linkLabel);
      return (
        taskAccountKey === accountKey ||
        (linkType === "account" && linkLabel.includes(accountKey))
      );
    })
    .sort((left, right) => Date.parse(String(right.updatedAt || right.createdAt || "")) - Date.parse(String(left.updatedAt || left.createdAt || "")));
  const commMessages = (data.messages || [])
    .filter((message) => {
      const linkedType = normalizeForMatch(message.linkedType);
      const linkedLabel = normalizeForMatch(message.linkedLabel);
      return linkedType === "account" && linkedLabel.includes(accountKey);
    })
    .sort((left, right) => Date.parse(String(right.createdAt || "")) - Date.parse(String(left.createdAt || "")));
  const primaryContact =
    contacts.find((contact) => String(contact.id || "") === String(account.primaryContactId || "").trim()) ||
    contacts.find((contact) => normalizeForMatch(contact.name) === normalizeForMatch(account.primaryContactName)) ||
    contacts.find((contact) => String(contact.email || "").trim() || String(contact.phone || "").trim()) ||
    contacts[0] ||
    null;
  const activity = [
    ...commMessages.map((item) => ({
      label: item.messageType || "Message",
      text: item.text || "Message posted.",
      actor: item.sender || "System",
      createdAt: item.createdAt || ""
    })),
    ...tasks.map((task) => ({
      label: `Task ${task.status || "New"}`,
      text: task.title || "Task updated",
      actor: task.assignee || "System",
      createdAt: task.updatedAt || task.createdAt || ""
    })),
    ...deals.map((deal) => ({
      label: `Deal ${getDealStageLabel(deal.stage || "Prospecting")}`,
      text: `${deal.name || "Deal"} | ${formatDealValueLabel(deal.value)}`,
      actor: deal.owner || "System",
      createdAt: deal.updatedAt || deal.createdAt || ""
    })),
    ...(String(account.updatedAt || "").trim()
      ? [
          {
            label: "Account updated",
            text: "Account details were updated.",
            actor: account.owner || "System",
            createdAt: account.updatedAt
          }
        ]
      : []),
    ...(String(account.createdAt || "").trim()
      ? [
          {
            label: "Account created",
            text: "Account record created.",
            actor: account.owner || "System",
            createdAt: account.createdAt
          }
        ]
      : [])
  ]
    .filter((item) => Number.isFinite(Date.parse(String(item.createdAt || ""))))
    .sort((left, right) => Date.parse(String(right.createdAt || "")) - Date.parse(String(left.createdAt || "")))
    .slice(0, 16);

  return {
    contacts,
    deals,
    tasks,
    commMessages,
    primaryContact,
    activity
  };
}

function buildDealContext(data, deal) {
  const accountKey = normalizeForMatch(deal?.account);
  const dealKey = normalizeForMatch(deal?.name);
  const account = (data.accounts || []).find((item) => normalizeForMatch(item.name) === accountKey) || null;
  const contacts = (data.contacts || []).filter((contact) => normalizeForMatch(contact.account) === accountKey);
  const tasks = (data.tasks || [])
    .filter((task) => {
      const taskAccountKey = normalizeForMatch(task.account || task.accountName);
      const linkType = normalizeForMatch(task.linkType);
      const linkLabel = normalizeForMatch(task.linkLabel);
      const titleKey = normalizeForMatch(task.title);
      return (
        (linkType === "deal" && linkLabel.includes(dealKey)) ||
        titleKey.includes(dealKey) ||
        taskAccountKey === accountKey
      );
    })
    .sort((left, right) => Date.parse(String(right.updatedAt || right.createdAt || "")) - Date.parse(String(left.updatedAt || left.createdAt || "")));
  const commMessages = (data.messages || [])
    .filter((message) => {
      const linkedType = normalizeForMatch(message.linkedType);
      const linkedLabel = normalizeForMatch(message.linkedLabel);
      return (
        (linkedType === "deal" && linkedLabel.includes(dealKey)) ||
        (linkedType === "account" && linkedLabel.includes(accountKey))
      );
    })
    .sort((left, right) => Date.parse(String(right.createdAt || "")) - Date.parse(String(left.createdAt || "")));
  const activity = [
    ...commMessages.map((item) => ({
      label: item.messageType || "Message",
      text: item.text || "Message posted.",
      actor: item.sender || "System",
      createdAt: item.createdAt || ""
    })),
    ...tasks.map((task) => ({
      label: `Task ${task.status || "New"}`,
      text: task.title || "Task updated",
      actor: task.assignee || "System",
      createdAt: task.updatedAt || task.createdAt || ""
    })),
    ...(String(deal.updatedAt || "").trim()
      ? [
          {
            label: `Deal ${getDealStageLabel(deal.stage || "Prospecting")}`,
            text: `${deal.name || "Deal"} updated.`,
            actor: deal.owner || "System",
            createdAt: deal.updatedAt
          }
        ]
      : []),
    ...(String(deal.createdAt || "").trim()
      ? [
          {
            label: "Deal created",
            text: `${deal.name || "Deal"} entered the pipeline.`,
            actor: deal.owner || "System",
            createdAt: deal.createdAt
          }
        ]
      : [])
  ]
    .filter((item) => Number.isFinite(Date.parse(String(item.createdAt || ""))))
    .sort((left, right) => Date.parse(String(right.createdAt || "")) - Date.parse(String(left.createdAt || "")))
    .slice(0, 16);

  return {
    account,
    contacts,
    tasks,
    commMessages,
    activity
  };
}

function crmSortIconClass(sortKey, activeKey, sortDir) {
  if (sortKey !== activeKey || sortDir === "none") {
    return "bi-arrow-down-up";
  }
  return sortDir === "desc" ? "bi-sort-down" : "bi-sort-up";
}

function crmHeaderSortButton(label, sortKey, activeKey, sortDir) {
  const isActive = sortKey === activeKey && sortDir !== "none";
  return `
    <button
      type="button"
      class="table-sort-btn ${isActive ? "is-active" : ""}"
      data-action="crm-table-sort"
      data-id="${sortKey}"
      aria-label="Sort by ${label}"
    >
      <span>${label}</span>
      <i class="bi ${crmSortIconClass(sortKey, activeKey, sortDir)}" aria-hidden="true"></i>
    </button>
  `;
}

function sortCrmRows(rows, sortKey, sortDir, sorters) {
  if (!Object.prototype.hasOwnProperty.call(sorters, sortKey) || sortDir === "none") {
    return rows;
  }
  const direction = sortDir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => sorters[sortKey](a, b) * direction);
}

const CRM_TABLE_PAGE_SIZE_OPTIONS_DEFAULT = [20, 50, 100];
const LEAD_STATUS_FILTER_OPTIONS = [
  { id: "all", label: "All statuses" },
  { id: "New", label: "New" },
  { id: "Contacted", label: "Contacted" },
  { id: "Qualified", label: "Qualified" },
  { id: "Unqualified", label: "Unqualified" },
  { id: "Converted", label: "Converted" }
];
const LEAD_DATE_FILTER_OPTIONS = [
  { id: "all", label: "All dates" },
  { id: "overdue", label: "Overdue" },
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "not-set", label: "Not set" }
];
const LEAD_TIMEZONE_FILTER_OPTIONS = [
  { id: "all", label: "All time zones" },
  { id: "eastern", label: "Eastern" },
  { id: "central", label: "Central" },
  { id: "mountain", label: "Mountain" },
  { id: "pacific", label: "Pacific" },
  { id: "unknown", label: "Unknown" }
];
const LEAD_WEEKLY_REMOVAL_TIMEZONE_OFFSET_HOURS = 8;
const LEAD_WEEKLY_REMOVAL_WEEKDAY = 5;
const LEAD_WEEKLY_REMOVAL_CUTOFF_HOUR = 8;

function getCrmTablePageSizeOptions(routeId) {
  return routeId === "leads" ? [25, 50, 100] : CRM_TABLE_PAGE_SIZE_OPTIONS_DEFAULT;
}

function normalizeCrmPageSize(value, routeId) {
  const numeric = Number(value);
  if (getCrmTablePageSizeOptions(routeId).includes(numeric)) {
    return numeric;
  }
  return routeId === "leads" ? 25 : 20;
}

function buildCrmPagination(totalRecords, page, pageSize, options = {}) {
  const safePageSize = Math.max(1, pageSize);
  const requestedPage = Math.max(1, Number(page) || 1);
  const numericTotalRecords = Math.max(0, Number(totalRecords) || 0);
  const hasExactTotalCount =
    Object.prototype.hasOwnProperty.call(options, "exactTotalCount")
      ? Boolean(options.exactTotalCount)
      : numericTotalRecords > 0;
  const visibleRecordCount = Math.max(0, Number(options.visibleRecordCount) || 0);
  const canGoNext =
    typeof options.canGoNext === "boolean"
      ? options.canGoNext
      : hasExactTotalCount
        ? requestedPage * safePageSize < numericTotalRecords
        : visibleRecordCount >= safePageSize;
  const totalPages = hasExactTotalCount
    ? Math.max(1, Math.ceil(numericTotalRecords / safePageSize))
    : Math.max(requestedPage, canGoNext ? requestedPage + 1 : requestedPage);
  const currentPage = hasExactTotalCount ? Math.max(1, Math.min(requestedPage, totalPages)) : requestedPage;
  const startIndex = (currentPage - 1) * safePageSize;
  const recordCount = hasExactTotalCount ? numericTotalRecords : visibleRecordCount;
  const endIndex = recordCount ? Math.min(startIndex + safePageSize, startIndex + recordCount) : 0;
  return {
    page: currentPage,
    pageSize: safePageSize,
    totalPages,
    startIndex,
    endIndex,
    fromRecord: recordCount ? startIndex + 1 : 0,
    toRecord: recordCount ? endIndex : 0,
    canGoNext
  };
}

function renderCrmTableFooter(routeId, pagination, totalRecords, options = {}) {
  const showTotalRecords = options.showTotalRecords !== false;
  const hasPrevious = pagination.page > 1;
  return `
    <footer class="table-ops-footer">
      <div class="table-ops-page-size">
        <span>Show</span>
        <button type="button" class="crm-page-size-trigger" data-action="crm-table-page-size-menu" data-id="${routeId}">
          <span>${pagination.pageSize}</span>
          <i class="bi bi-chevron-down" aria-hidden="true"></i>
        </button>
        <span>records</span>
      </div>
      <p class="task-meta">Records ${pagination.fromRecord} to ${pagination.toRecord}${showTotalRecords ? ` of ${totalRecords}` : ""}</p>
      <div class="table-ops-pages">
        <button type="button" data-action="crm-table-page" data-id="prev" ${hasPrevious ? "" : "disabled"} aria-label="Previous page">
          <i class="bi bi-chevron-left" aria-hidden="true"></i>
          <span>Previous</span>
        </button>
        <button type="button" data-action="crm-table-page" data-id="next" ${pagination.canGoNext ? "" : "disabled"} aria-label="Next page">
          <span>Next</span>
          <i class="bi bi-chevron-right" aria-hidden="true"></i>
        </button>
      </div>
    </footer>
  `;
}

const LEAD_WORKFLOW_STATUS_RANK = {
  new: 0,
  contacted: 1,
  qualified: 2,
  unqualified: 3,
  converted: 4
};

function getLeadWorkflowStatusRank(value) {
  const key = normalizeForMatch(value);
  if (Object.prototype.hasOwnProperty.call(LEAD_WORKFLOW_STATUS_RANK, key)) {
    return LEAD_WORKFLOW_STATUS_RANK[key];
  }
  return Number.MAX_SAFE_INTEGER;
}

function compareLeadStatusWorkflow(left, right) {
  const rankCompare = compareNumber(getLeadWorkflowStatusRank(left), getLeadWorkflowStatusRank(right));
  if (rankCompare !== 0) {
    return rankCompare;
  }
  return compareText(left, right);
}

function compareLeadRowsByWorkflowStatus(left, right) {
  const statusCompare = compareLeadStatusWorkflow(left?.status, right?.status);
  if (statusCompare !== 0) {
    return statusCompare;
  }
  const lastTouchCompare = compareDateIso(
    String(right?._lastTouchAt || right?.updatedAt || right?.createdAt || ""),
    String(left?._lastTouchAt || left?.updatedAt || left?.createdAt || "")
  );
  if (lastTouchCompare !== 0) {
    return lastTouchCompare;
  }
  return compareText(left?.name, right?.name);
}

function resolveLeadDisplaySort(sortKey, sortDir) {
  if (!sortKey || sortDir === "none") {
    return { key: "lastTouch", dir: "desc" };
  }
  return { key: sortKey, dir: sortDir };
}

const LEAD_SORTERS = {
  name: (a, b) => compareText(a.name, b.name),
  phone: (a, b) => compareText(a.phone || a.secondaryPhone, b.phone || b.secondaryPhone),
  timezone: (a, b) => compareText(a.phoneTimezoneBucket, b.phoneTimezoneBucket),
  interest: (a, b) => compareText(a.interest, b.interest),
  status: (a, b) => compareLeadRowsByWorkflowStatus(a, b),
  owner: (a, b) => compareText(a._ownerDisplay || a.owner, b._ownerDisplay || b.owner),
  lastTouch: (a, b) => compareDateIso(a._lastTouchAt, b._lastTouchAt),
  nextFollowUp: (a, b) => compareDateIso(a.nextFollowUp, b.nextFollowUp)
};

const CONTACT_SORTERS = {
  name: (a, b) => compareText(a.name, b.name),
  account: (a, b) => compareText(a.account, b.account),
  role: (a, b) => compareText(a.role, b.role),
  lastTouch: (a, b) => compareDateIso(a._lastTouchAt, b._lastTouchAt),
  owner: (a, b) => compareText(a._ownerDisplay || a.owner, b._ownerDisplay || b.owner)
};

const ACCOUNT_SORTERS = {
  name: (a, b) => compareText(a.name, b.name),
  owner: (a, b) => compareText(a._ownerDisplay || a.owner, b._ownerDisplay || b.owner),
  openDeals: (a, b) => compareNumber(a.openDeals, b.openDeals),
  lastActivity: (a, b) => compareDateIso(a._lastActivityAt, b._lastActivityAt),
  health: (a, b) => compareText(a.health, b.health)
};

const DEAL_SORTERS = {
  name: (a, b) => compareText(a.name, b.name),
  contact: (a, b) => compareText(a.contactName, b.contactName),
  account: (a, b) => compareText(a.account, b.account),
  value: (a, b) => compareNumber(a.value, b.value),
  stage: (a, b) => compareText(a.stage, b.stage),
  closeDate: (a, b) => compareDateIso(a.closeDate, b.closeDate),
  owner: (a, b) => compareText(a._ownerDisplay || a.owner, b._ownerDisplay || b.owner)
};

const DEAL_STAGE_SUMMARY = [
  { id: "Prospecting", label: "Prospecting" },
  { id: "Qualified", label: "Qualified" },
  { id: "Proposal", label: "Proposal" },
  { id: "Negotiation", label: "Negotiation" },
  { id: "Won", label: "Closed Won" },
  { id: "Lost", label: "Closed Lost" }
];
const LEAD_STATUS_TABLE_OPTIONS = ["New", "Contacted", "Qualified", "Unqualified"];

function dealProbability(stage) {
  const normalized = getDealStageKey(stage).toLowerCase();
  if (normalized === "prospecting") {
    return 25;
  }
  if (normalized === "qualified") {
    return 55;
  }
  if (normalized === "proposal") {
    return 70;
  }
  if (normalized === "negotiation") {
    return 85;
  }
  if (normalized === "won") {
    return 100;
  }
  if (normalized === "lost") {
    return 0;
  }
  return 30;
}

function dealStageClass(stage) {
  const normalized = getDealStageKey(stage).toLowerCase();
  if (normalized === "prospecting") {
    return "stage-prospecting";
  }
  if (normalized === "qualified") {
    return "stage-qualified";
  }
  if (normalized === "proposal") {
    return "stage-proposal";
  }
  if (normalized === "negotiation") {
    return "stage-negotiation";
  }
  if (normalized === "won") {
    return "stage-won";
  }
  if (normalized === "lost") {
    return "stage-lost";
  }
  return "stage-prospecting";
}

function dealOwnerMatchesCurrent(owner, currentUserName) {
  const ownerValue = String(owner || "").trim().toLowerCase();
  const currentValue = String(currentUserName || "").trim().toLowerCase();
  if (!ownerValue || !currentValue) {
    return false;
  }
  if (ownerValue === currentValue) {
    return true;
  }
  const ownerFirst = ownerValue.split(/\s+/)[0] || "";
  const currentFirst = currentValue.split(/\s+/)[0] || "";
  return ownerFirst && currentFirst && ownerFirst === currentFirst;
}

function leadTableMenuItems(lead) {
  const canConvert = String(lead.status || "").trim() === "Qualified";
  return [
    ...(canConvert
      ? [
          {
            action: "lead-convert",
            id: lead.id,
            label: "Convert to Deal",
            icon: "bi-arrow-up-right-circle",
            primary: true
          }
        ]
      : []),
    {
      action: "lead-open",
      id: lead.id,
      label: "Open Lead",
      icon: "bi-box-arrow-up-right"
    },
    {
      action: "lead-edit",
      id: lead.id,
      label: "Edit",
      icon: "bi-pencil-square"
    },
    { type: "divider" },
    {
      action: "lead-log-call",
      id: lead.id,
      label: "Log Call",
      icon: "bi-telephone"
    },
    {
      action: "lead-schedule-call",
      id: lead.id,
      label: "Schedule Call",
      icon: "bi-calendar-plus"
    },
    {
      action: "lead-create-callback",
      id: lead.id,
      label: "Create Callback",
      icon: "bi-telephone-inbound"
    },
    {
      action: "lead-send-email",
      id: lead.id,
      label: "Send Email",
      icon: "bi-envelope"
    },
    {
      action: "lead-archive",
      id: lead.id,
      label: "Archive",
      icon: "bi-archive",
      muted: true
    },
    {
      action: "lead-more-actions",
      id: lead.id,
      label: "More actions",
      icon: "bi-sliders",
      muted: true,
      dividerBefore: true
    }
  ];
}

function crmPhoneCell(phone, action, id, emptyLabel = "No phone") {
  const safePhone = String(phone || "").trim();
  if (!safePhone) {
    return `<span class="crm-table-meta">${escapeHtml(emptyLabel)}</span>`;
  }
  return `
    <div class="crm-phone-cell">
      <span class="crm-phone-copy">
        <span class="crm-phone-value">${escapeHtml(safePhone)}</span>
      </span>
      ${crmPhoneActionButtons(action, id, safePhone)}
    </div>
  `;
}

function crmContactLeadCell(contact) {
  const safeLabel = escapeHtml(contact.name || "-");
  const safeEmail = escapeHtml(contact.email || "");
  const initials = escapeHtml(initialsFromLabel(contact.name || "-"));
  return `
    <span class="crm-name-cell">
      <span class="crm-inline-avatar" aria-hidden="true">${initials}</span>
      <span class="crm-name-stack">
        <span class="crm-name-text">${safeLabel}</span>
        <span class="crm-name-sub">${safeEmail || "&nbsp;"}</span>
      </span>
    </span>
  `;
}

function leadRow(lead, leadEmailById = {}, context = {}) {
  const leadEmail = String(leadEmailById[lead.id] || "").trim();
  const leadPhoneEntries = getLeadPhoneEntries(lead);
  const leadAttemptMeta = getLeadAttemptMeta(lead);
  const phoneTimezoneLabel = formatLeadPhoneTimezoneBucket(lead.phoneTimezoneBucket);
  const interest = String(lead.interest || "").trim();
  const followUpMeta = getLeadFollowUpMeta(lead.nextFollowUp);
  const lastTouchLabel = formatLeadLastTouch(lead._lastTouchAt);
  const leadMenuItems = leadTableMenuItems(lead);
  const statusKey = leadProfileStatusClass(lead.status);
  const archivingLeadIds = new Set(
    (Array.isArray(context.leadArchivingIds) ? context.leadArchivingIds : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  );
  const isStatusOpen = String(context.leadStatusOpenId || "").trim() === String(lead.id || "").trim();
  const statusPopoverStyle = isStatusOpen ? String(context.leadStatusPopoverStyle || "").trim() : "";
  const savingLeadIds = new Set(
    (Array.isArray(context.leadStatusSavingIds) ? context.leadStatusSavingIds : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  );
  const isArchiving = archivingLeadIds.has(String(lead.id || "").trim());
  const isStatusSaving =
    String(context.leadStatusSavingId || "").trim() === String(lead.id || "").trim() ||
    savingLeadIds.has(String(lead.id || "").trim());
  const canInlineChangeStatus = !isArchiving && LEAD_STATUS_TABLE_OPTIONS.includes(String(lead.status || "").trim());
  const selectedLeadIds = new Set(
    (Array.isArray(context.selectedLeadIds) ? context.selectedLeadIds : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  );
  const isSelected = selectedLeadIds.has(String(lead.id || "").trim());
  return `
    <tr class="lead-row ${isSelected ? "is-selected" : ""} ${isStatusSaving ? "is-status-saving" : ""} ${isArchiving ? "is-archiving" : ""}" data-lead-open="${lead.id}" data-card-menu="lead" data-id="${lead.id}">
      <td class="table-col-check crm-lead-select-cell">
        <input type="checkbox" name="leadSelect" value="${escapeHtml(lead.id)}" ${isSelected ? "checked" : ""} ${isArchiving ? "disabled" : ""} aria-label="Select ${escapeHtml(lead.name || "lead")}" />
      </td>
      <td class="lead-name-cell">${crmAvatarStackCell(lead.name, leadEmail, "person", renderLeadAttemptPill(leadAttemptMeta))}</td>
      <td class="crm-phone-cell-col">${crmPhoneListCell(leadPhoneEntries, "lead-log-call", lead.id)}</td>
      <td class="crm-timezone-cell"><span class="crm-table-meta">${escapeHtml(phoneTimezoneLabel)}</span></td>
      <td class="crm-interest-cell"><span class="crm-table-meta crm-interest-text" title="${escapeHtml(interest || "No interest")}">${escapeHtml(interest || "No interest")}</span></td>
      <td class="table-status-text crm-status-cell">
        <div class="lead-status-control" data-lead-status-control="${escapeHtml(lead.id)}">
          <button
            type="button"
            class="status-chip lead-status-trigger status-${escapeHtml(statusKey)} ${isStatusOpen ? "is-open" : ""}"
            data-action="${canInlineChangeStatus ? "lead-status-toggle" : ""}"
            data-id="${canInlineChangeStatus ? escapeHtml(lead.id) : ""}"
            ${isStatusSaving || isArchiving ? "disabled" : ""}
            aria-haspopup="${canInlineChangeStatus ? "menu" : "false"}"
            aria-expanded="${isStatusOpen ? "true" : "false"}"
          >
            <span>${escapeHtml(isArchiving ? "Archiving..." : lead.status)}</span>
            ${
              isArchiving
                ? `<i class="bi bi-arrow-repeat lead-status-spinner" aria-hidden="true"></i>`
                : isStatusSaving
                ? `<i class="bi bi-arrow-repeat lead-status-spinner" aria-hidden="true"></i>`
                : canInlineChangeStatus
                  ? `<i class="bi bi-chevron-down" aria-hidden="true"></i>`
                  : ""
            }
          </button>
          ${
            canInlineChangeStatus
              ? `
                <div class="lead-status-popover" style="${escapeHtml(statusPopoverStyle)}" ${isStatusOpen ? "" : "hidden"}>
                  ${LEAD_STATUS_TABLE_OPTIONS.map(
                    (status) => `
                      <button
                        type="button"
                        class="lead-status-option ${status === lead.status ? "is-selected" : ""}"
                        data-action="lead-status-select"
                        data-id="${escapeHtml(`${lead.id}::${status}`)}"
                      >
                        <span class="status-chip status-${escapeHtml(leadProfileStatusClass(status))}">${escapeHtml(status)}</span>
                        ${status === lead.status ? `<i class="bi bi-check2" aria-hidden="true"></i>` : ""}
                      </button>
                    `
                  ).join("")}
                </div>
              `
              : ""
          }
        </div>
      </td>
      <td class="crm-owner-cell"><span class="crm-owner-text">${escapeHtml(lead._ownerDisplay || lead.owner)}</span></td>
      <td class="crm-last-touch-cell"><span class="crm-table-meta">${escapeHtml(lastTouchLabel)}</span></td>
      <td class="lead-followup-cell crm-next-followup-cell">
        <div class="lead-followup-cell-inner">
          <span class="waiting-due-pill ${followUpMeta.className}" title="${escapeHtml(followUpMeta.fullLabel)}">${escapeHtml(followUpMeta.label)}</span>
          <span class="lead-row-inline-actions row-actions row-actions-table">
            ${tableActionMenu("More lead actions", leadMenuItems)}
          </span>
        </div>
      </td>
    </tr>
  `;
}

function crmSkeletonBar(width, extraClass = "") {
  const safeWidth = Number.isFinite(Number(width)) ? `${Math.max(24, Number(width))}px` : "72px";
  return `<span class="crm-skeleton-bar${extraClass ? ` ${extraClass}` : ""}" style="width:${safeWidth}" aria-hidden="true"></span>`;
}

function renderLeadSkeletonRows(count = 7) {
  return Array.from({ length: count }, (_, index) => {
    const cycle = index % 4;
    const nameWidth = [132, 118, 146, 124][cycle];
    const subWidth = [88, 76, 98, 82][cycle];
    const phoneWidth = [92, 108, 84, 96][cycle];
    const interestWidth = [86, 70, 94, 78][cycle];
    const ownerWidth = [74, 90, 68, 82][cycle];
    const touchWidth = [62, 78, 70, 58][cycle];
    const followUpWidth = [70, 62, 82, 66][cycle];
    return `
      <tr class="crm-table-skeleton-row" aria-hidden="true">
        <td class="table-col-check crm-lead-select-cell"><span class="crm-skeleton-icon"></span></td>
        <td class="lead-name-cell">
          <span class="crm-name-cell crm-skeleton-name-cell">
            <span class="crm-skeleton-avatar"></span>
            <span class="crm-name-stack">
              ${crmSkeletonBar(nameWidth, "is-name")}
              ${crmSkeletonBar(subWidth, "is-sub")}
            </span>
          </span>
        </td>
        <td>${crmSkeletonBar(phoneWidth, "is-medium")}</td>
        <td>${crmSkeletonBar(66, "is-short")}</td>
        <td>${crmSkeletonBar(interestWidth, "is-medium")}</td>
        <td>${crmSkeletonBar(76, "is-pill")}</td>
        <td>${crmSkeletonBar(ownerWidth, "is-short")}</td>
        <td>${crmSkeletonBar(touchWidth, "is-short")}</td>
        <td class="lead-followup-cell">
          <div class="lead-followup-cell-inner lead-skeleton-followup">
            ${crmSkeletonBar(followUpWidth, "is-pill")}
            <span class="crm-skeleton-icon"></span>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function renderContactSkeletonRows(count = 7) {
  return Array.from({ length: count }, (_, index) => {
    const cycle = index % 4;
    const nameWidth = [128, 114, 142, 122][cycle];
    const subWidth = [92, 78, 86, 74][cycle];
    const phoneWidth = [98, 86, 104, 92][cycle];
    const accountWidth = [96, 116, 88, 102][cycle];
    const roleWidth = [70, 82, 66, 76][cycle];
    const touchWidth = [68, 78, 60, 72][cycle];
    const ownerWidth = [76, 92, 70, 84][cycle];
    return `
      <tr class="crm-table-skeleton-row" aria-hidden="true">
        <td>
          <span class="crm-name-cell crm-skeleton-name-cell">
            <span class="crm-skeleton-avatar"></span>
            <span class="crm-name-stack">
              ${crmSkeletonBar(nameWidth, "is-name")}
              ${crmSkeletonBar(subWidth, "is-sub")}
            </span>
          </span>
        </td>
        <td>${crmSkeletonBar(phoneWidth, "is-medium")}</td>
        <td>${crmSkeletonBar(accountWidth, "is-medium")}</td>
        <td>${crmSkeletonBar(roleWidth, "is-short")}</td>
        <td>${crmSkeletonBar(touchWidth, "is-short")}</td>
        <td class="crm-row-end-cell">
          <div class="crm-row-end-cell-inner lead-skeleton-followup">
            ${crmSkeletonBar(ownerWidth, "is-short")}
            <span class="crm-skeleton-icon"></span>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function renderAccountSkeletonRows(count = 7) {
  return Array.from({ length: count }, (_, index) => {
    const cycle = index % 4;
    const nameWidth = [134, 120, 148, 126][cycle];
    const subWidth = [98, 86, 92, 80][cycle];
    const dealsWidth = [34, 42, 30, 38][cycle];
    const activityWidth = [74, 68, 80, 62][cycle];
    const ownerWidth = [82, 76, 90, 72][cycle];
    return `
      <tr class="crm-table-skeleton-row" aria-hidden="true">
        <td>
          <span class="crm-name-cell crm-skeleton-name-cell">
            <span class="crm-skeleton-avatar"></span>
            <span class="crm-name-stack">
              ${crmSkeletonBar(nameWidth, "is-name")}
              ${crmSkeletonBar(subWidth, "is-sub")}
            </span>
          </span>
        </td>
        <td>${crmSkeletonBar(84, "is-pill")}</td>
        <td>${crmSkeletonBar(dealsWidth, "is-short")}</td>
        <td>${crmSkeletonBar(activityWidth, "is-short")}</td>
        <td class="crm-row-end-cell">
          <div class="crm-row-end-cell-inner lead-skeleton-followup">
            ${crmSkeletonBar(ownerWidth, "is-short")}
            <span class="crm-skeleton-icon"></span>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function renderDealSkeletonRows(count = 7) {
  return Array.from({ length: count }, (_, index) => {
    const cycle = index % 4;
    const dealWidth = [126, 142, 118, 134][cycle];
    const contactWidth = [92, 80, 104, 88][cycle];
    const accountWidth = [96, 114, 90, 106][cycle];
    const valueWidth = [62, 76, 58, 70][cycle];
    const closeWidth = [64, 78, 70, 60][cycle];
    const ownerWidth = [80, 92, 72, 84][cycle];
    return `
      <tr class="crm-table-skeleton-row" aria-hidden="true">
        <td>${crmSkeletonBar(dealWidth, "is-medium")}</td>
        <td>${crmSkeletonBar(contactWidth, "is-medium")}</td>
        <td>${crmSkeletonBar(accountWidth, "is-medium")}</td>
        <td>${crmSkeletonBar(valueWidth, "is-short")}</td>
        <td>${crmSkeletonBar(84, "is-pill")}</td>
        <td>${crmSkeletonBar(closeWidth, "is-short")}</td>
        <td class="crm-row-end-cell">
          <div class="crm-row-end-cell-inner lead-skeleton-followup">
            ${crmSkeletonBar(ownerWidth, "is-short")}
            <span class="crm-skeleton-icon"></span>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function contactMenuItems(contact) {
  return [
    {
      action: "contact-open",
      id: contact.id,
      label: "Open Contact",
      icon: "bi-box-arrow-up-right"
    },
    {
      action: "contact-edit",
      id: contact.id,
      label: "Edit",
      icon: "bi-pencil-square"
    },
    { type: "divider" },
    {
      action: "contact-log-call",
      id: contact.id,
      label: "Log Call",
      icon: "bi-telephone"
    },
    {
      action: "contact-schedule-call",
      id: contact.id,
      label: "Schedule Call",
      icon: "bi-calendar-plus"
    },
    {
      action: "contact-create-callback",
      id: contact.id,
      label: "Create Callback",
      icon: "bi-telephone-inbound"
    },
    {
      action: "contact-send-email",
      id: contact.id,
      label: "Send Email",
      icon: "bi-envelope"
    },
    {
      action: "contact-send-sms",
      id: contact.id,
      label: "Send SMS",
      icon: "bi-chat-dots"
    },
    {
      action: "contact-more-actions",
      id: contact.id,
      label: "More actions",
      icon: "bi-sliders",
      muted: true,
      dividerBefore: true
    }
  ];
}

function accountMenuItems(account) {
  return [
    {
      action: "account-open",
      id: account.id,
      label: "Open Account",
      icon: "bi-box-arrow-up-right"
    },
    {
      action: "account-edit",
      id: account.id,
      label: "Edit",
      icon: "bi-pencil-square"
    },
    { type: "divider" },
    {
      action: "account-log-call",
      id: account.id,
      label: "Log Call",
      icon: "bi-telephone"
    },
    {
      action: "account-schedule-call",
      id: account.id,
      label: "Schedule Call",
      icon: "bi-calendar-plus"
    },
    {
      action: "account-create-callback",
      id: account.id,
      label: "Create Callback",
      icon: "bi-telephone-inbound"
    },
    {
      action: "account-send-email",
      id: account.id,
      label: "Send Email",
      icon: "bi-envelope"
    },
    {
      action: "account-more-actions",
      id: account.id,
      label: "More actions",
      icon: "bi-sliders",
      muted: true,
      dividerBefore: true
    }
  ];
}

function dealMenuItems(deal) {
  const stage = getDealStageKey(deal.stage);
  const progressItem =
    stage === "Lost"
      ? {
          action: "deal-reopen",
          id: deal.id,
          label: "Reopen Deal",
          icon: "bi-arrow-counterclockwise",
          primary: true,
          dividerBefore: true
        }
      : stage === "Won"
        ? null
        : {
            action: "deal-next-stage",
            id: deal.id,
            label: getNextDealStageMenuLabel(stage),
            icon: "bi-arrow-right-circle",
            primary: true,
            dividerBefore: true
          };
  return [
    { action: "deal-open", id: deal.id, label: "Open Deal", icon: "bi-box-arrow-up-right" },
    { action: "deal-edit", id: deal.id, label: "Edit Deal", icon: "bi-pencil-square" },
    ...(!hasDealValue(deal.value)
      ? [{ action: "deal-set-value", id: deal.id, label: "Set Value", icon: "bi-currency-dollar" }]
      : []),
    { action: "deal-schedule-call", id: deal.id, label: "Schedule Call", icon: "bi-calendar-plus" },
    { action: "deal-create-callback", id: deal.id, label: "Create Callback", icon: "bi-telephone-inbound" },
    ...(progressItem ? [progressItem] : []),
    {
      action: "deal-more-actions",
      id: deal.id,
      label: "More actions",
      icon: "bi-sliders",
      muted: true,
      dividerBefore: true
    }
  ];
}

function buildLeadOwnerFilterOptions(data) {
  const seen = new Set();
  const people = [data.currentUser, ...(Array.isArray(data.teamMembers) ? data.teamMembers : [])]
    .filter((person) => person && typeof person === "object")
    .map((person) => ({
      id: String(person.id || "").trim(),
      name: String(person.name || "").trim()
    }))
    .filter((person) => person.id && person.name)
    .filter((person) => {
      if (seen.has(person.id)) {
        return false;
      }
      seen.add(person.id);
      return true;
    })
    .sort((left, right) => compareText(left.name, right.name));
  return [
    { id: "all", label: "All owners" },
    { id: "unassigned", label: "Unassigned" },
    ...people.map((person) => ({
      id: person.id,
      label: person.name
    }))
  ];
}

function leadMatchesOwnerFilter(data, lead, ownerFilter, ownerOptionMap) {
  const normalizedFilter = String(ownerFilter || "all").trim();
  if (!normalizedFilter || normalizedFilter === "all") {
    return true;
  }
  const ownerId = String(lead?.ownerId || "").trim();
  const ownerName = String(resolveOwnerDisplayName(data, lead?.owner, lead?.ownerId) || lead?.owner || "").trim();
  if (normalizedFilter === "unassigned") {
    return !ownerId && !ownerName;
  }
  if (ownerId) {
    return ownerId === normalizedFilter;
  }
  const option = ownerOptionMap.get(normalizedFilter);
  if (!option) {
    return true;
  }
  return normalizeForMatch(ownerName) === normalizeForMatch(option.label);
}

function localIsoDate(daysFromNow = 0) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + daysFromNow);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function leadMatchesStatusFilter(lead, statusFilter) {
  const normalizedFilter = String(statusFilter || "all").trim();
  if (!normalizedFilter || normalizedFilter === "all") {
    return true;
  }
  return String(lead?.status || "").trim() === normalizedFilter;
}

function leadMatchesDateFilter(lead, dateFilter) {
  const normalizedFilter = String(dateFilter || "all").trim().toLowerCase();
  if (!normalizedFilter || normalizedFilter === "all") {
    return true;
  }
  const nextFollowUp = String(lead?.nextFollowUp || "").trim();
  if (normalizedFilter === "not-set") {
    return !nextFollowUp;
  }
  if (!nextFollowUp) {
    return false;
  }
  const today = localIsoDate(0);
  if (normalizedFilter === "overdue") {
    return nextFollowUp < today;
  }
  if (normalizedFilter === "today") {
    return nextFollowUp === today;
  }
  if (normalizedFilter === "tomorrow") {
    return nextFollowUp === localIsoDate(1);
  }
  return true;
}

function leadMatchesTimezoneFilter(lead, timezoneFilter) {
  const normalizedFilter = String(timezoneFilter || "all").trim().toLowerCase();
  if (!normalizedFilter || normalizedFilter === "all") {
    return true;
  }
  const normalizedLeadValue = String(lead?.phoneTimezoneBucket || "unknown").trim().toLowerCase() || "unknown";
  return normalizedLeadValue === normalizedFilter;
}

function formatLeadPhoneTimezoneBucket(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "eastern") {
    return "Eastern";
  }
  if (normalized === "central") {
    return "Central";
  }
  if (normalized === "mountain") {
    return "Mountain";
  }
  if (normalized === "pacific") {
    return "Pacific";
  }
  return "Unknown";
}

export function renderLeads(data, context) {
  const routeId = "leads";
  const canManageLeads = ["Owner", "Admin", "Manager"].includes(String(data.currentUser?.role || "").trim());
  const activeScope = canManageLeads ? "all" : "mine";
  const currentUserName = String(data.currentUser?.name || "").trim();
  const rawSortKey = String(context.crmSortKey || "").trim();
  const sortDir = context.crmSortDir === "desc" ? "desc" : context.crmSortDir === "asc" ? "asc" : "none";
  const sortKey = Object.prototype.hasOwnProperty.call(LEAD_SORTERS, rawSortKey) ? rawSortKey : "";
  const displaySort = resolveLeadDisplaySort(sortKey, sortDir);
  const requestedStatusFilter = String(context.leadsStatusFilter || "all").trim();
  const requestedDateFilter = String(context.leadsDateFilter || "all").trim();
  const requestedSourceFilter = String(context.leadsSourceFilter || "all").trim();
  const requestedTimezoneFilter = String(context.leadsTimezoneFilter || "all").trim().toLowerCase();
  const requestedOwnerFilter = String(context.leadsOwnerFilter || "all").trim();
  const ownerFilterOptions = buildLeadOwnerFilterOptions(data);
  const ownerOptionMap = new Map(ownerFilterOptions.map((option) => [option.id, option]));
  const canUsePagedLeadsData =
    Boolean(context.usePagedLeadsRoute) &&
    (
      Boolean(context.leadsPageData?.rowLoading) ||
      Boolean(context.leadsPageData?.loaded) ||
      Boolean((context.leadsPageData?.rows || []).length) ||
      Boolean(context.crmTableLoading)
    );
  let showTableSkeleton = false;
  let sourceOptions = [{ id: "all", label: "All" }];
  let activeStatusFilter = LEAD_STATUS_FILTER_OPTIONS.some((option) => option.id === requestedStatusFilter) ? requestedStatusFilter : "all";
  let activeDateFilter = LEAD_DATE_FILTER_OPTIONS.some((option) => option.id === requestedDateFilter) ? requestedDateFilter : "all";
  let activeSourceFilter = "all";
  let activeTimezoneFilter = LEAD_TIMEZONE_FILTER_OPTIONS.some((option) => option.id === requestedTimezoneFilter)
    ? requestedTimezoneFilter
    : "all";
  let activeOwnerFilter = "all";
  let rows = "";
  let visibleLeadCount = 0;
  let pagination = buildCrmPagination(0, Number(context.crmPage || 1), normalizeCrmPageSize(context.crmPageSize, routeId));
  let footerTotalRecords = 0;
  let exactTotalCount = false;
  let showInitialLoadingRow = false;
  let visibleRowsForSelection = [];
  let reviewableLeads = [];
  const hiddenLeadIds = new Set(
    (Array.isArray(context.leadArchiveHiddenIds) ? context.leadArchiveHiddenIds : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  );
  const selectedLeadIds = new Set(
    (Array.isArray(context.selectedLeadIds) ? context.selectedLeadIds : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  );

  if (canUsePagedLeadsData) {
    const pageData = context.leadsPageData && typeof context.leadsPageData === "object" ? context.leadsPageData : {};
    const localLeadById = new Map((data.leads || []).map((lead) => [String(lead.id || "").trim(), lead]));
    const pageRows = (Array.isArray(pageData.rows) ? pageData.rows : [])
      .map((lead) => {
        const localLead = localLeadById.get(String(lead?.id || "").trim());
        if (!localLead) {
          return lead;
        }
        return {
          ...lead,
          ...localLead,
          _lastTouchAt:
            localLead._lastTouchAt ||
            lead._lastTouchAt ||
            localLead.updatedAt ||
            localLead.createdAt ||
            lead.updatedAt ||
            lead.createdAt ||
          ""
      };
      })
      .filter((lead) =>
        lead?.activePool !== false &&
        !hiddenLeadIds.has(String(lead?.id || "").trim()) &&
        !(lead.archived || String(lead.status || "") === "Archived")
      );
    const pageSize = normalizeCrmPageSize(pageData.pageSize || context.crmPageSize, routeId);
    const leadEmailById = Object.fromEntries(
      pageRows.map((lead) => [lead.id, String(lead.email || "").trim() || resolveLeadEmail(lead, data.contacts || [])])
    );
    const liveTotalCount = Number(pageData.totalCount || 0);
    const lastKnownTotalCount = Number(pageData.lastKnownTotalCount || 0);
    exactTotalCount =
      Boolean(pageData.metaLoaded) &&
      !Boolean(pageData.metaLoading) &&
      !Boolean(pageData.rowLoading) &&
      liveTotalCount > 0;
    const displayTotalCount = exactTotalCount ? liveTotalCount : Math.max(lastKnownTotalCount, pageRows.length);
    sourceOptions =
      Array.isArray(pageData.sourceOptions) && pageData.sourceOptions.length
        ? pageData.sourceOptions
        : [{ id: "all", label: "All" }];
    activeStatusFilter = LEAD_STATUS_FILTER_OPTIONS.some((option) => option.id === String(pageData.statusFilter || requestedStatusFilter).trim())
      ? String(pageData.statusFilter || requestedStatusFilter).trim()
      : "all";
    activeDateFilter = LEAD_DATE_FILTER_OPTIONS.some((option) => option.id === String(pageData.dateFilter || requestedDateFilter).trim())
      ? String(pageData.dateFilter || requestedDateFilter).trim()
      : "all";
    activeSourceFilter = sourceOptions.some((option) => option.id === requestedSourceFilter)
      ? requestedSourceFilter
      : String(pageData.sourceFilter || "all").trim() || "all";
    activeTimezoneFilter = LEAD_TIMEZONE_FILTER_OPTIONS.some(
      (option) => option.id === String(pageData.timezoneFilter || requestedTimezoneFilter).trim().toLowerCase()
    )
      ? String(pageData.timezoneFilter || requestedTimezoneFilter).trim().toLowerCase()
      : "all";
    activeOwnerFilter =
      canManageLeads && activeScope !== "mine" && ownerOptionMap.has(requestedOwnerFilter)
        ? requestedOwnerFilter
        : String(pageData.ownerFilter || "all").trim() || "all";
    visibleLeadCount = displayTotalCount;
    pagination = buildCrmPagination(
      displayTotalCount,
      Number(pageData.page || context.crmPage || 1),
      pageSize,
      {
        canGoNext: Object.prototype.hasOwnProperty.call(pageData, "hasNextPage")
          ? Boolean(pageData.hasNextPage)
          : Object.prototype.hasOwnProperty.call(pageData, "hasMore")
            ? Boolean(pageData.hasMore)
          : pageRows.length >= pageSize,
        exactTotalCount,
        visibleRecordCount: pageRows.length
      }
    );
    footerTotalRecords = displayTotalCount;
    showTableSkeleton = false;
    showInitialLoadingRow = Boolean(pageData.rowLoading) && !pageRows.length;
    visibleRowsForSelection = pageRows;
    reviewableLeads = pageRows;
    rows = pageRows.map((lead) => leadRow(lead, leadEmailById, context)).join("");
  } else {
    const baseVisibleLeads = (data.leads || []).filter((lead) => {
      if (
        lead?.activePool === false ||
        hiddenLeadIds.has(String(lead?.id || "").trim()) ||
        lead.archived ||
        String(lead.status || "") === "Archived"
      ) {
        return false;
      }
      const ownerMatches = dealOwnerMatchesCurrent(resolveOwnerDisplayName(data, lead.owner, lead.ownerId) || lead.owner, currentUserName);
      if (!canManageLeads) {
        return ownerMatches;
      }
      if (activeScope === "mine") {
        return ownerMatches;
      }
      if (activeScope === "unassigned") {
        return !String(lead.owner || "").trim();
      }
      if (activeScope === "assigned") {
        return Boolean(String(lead.owner || "").trim());
      }
      return true;
    });
    activeOwnerFilter =
      canManageLeads && activeScope !== "mine" && ownerOptionMap.has(requestedOwnerFilter)
        ? requestedOwnerFilter
        : "all";
    const countBaseLeads = baseVisibleLeads.filter((lead) =>
      leadMatchesOwnerFilter(data, lead, activeOwnerFilter, ownerOptionMap)
    );
    reviewableLeads = countBaseLeads;
    const leadEmailById = Object.fromEntries(
      countBaseLeads.map((lead) => [lead.id, resolveLeadEmail(lead, data.contacts || [])])
    );
    sourceOptions = [
      { id: "all", label: "All" },
      ...(Array.from(
        new Set(
          countBaseLeads
            .map((lead) => String(lead.source || "").trim())
            .filter(Boolean)
        )
      )
        .sort((left, right) => compareText(left, right))
        .map((source) => ({
          id: source,
          label: source
        })))
    ];
    activeSourceFilter = sourceOptions.some((option) => option.id === requestedSourceFilter) ? requestedSourceFilter : "all";
    const filtered = countBaseLeads
      .filter((lead) =>
        leadMatchesStatusFilter(lead, activeStatusFilter) &&
        leadMatchesDateFilter(lead, activeDateFilter) &&
        (activeSourceFilter === "all" || normalizeForMatch(lead.source) === normalizeForMatch(activeSourceFilter)) &&
        leadMatchesTimezoneFilter(lead, activeTimezoneFilter) &&
        matchesSearch(
          [lead.name, lead.company, lead.phone, lead.secondaryPhone, lead.phoneTimezoneBucket, lead.email, lead.interest, lead.source, lead.status, lead.owner, lead.nextFollowUp],
          context.searchTerm
        )
      );
    const leadsWithContext = filtered.map((lead) => {
      const leadContext = getLeadContext(data, lead, normalizeForMatch);
      return {
        ...lead,
        _ownerDisplay: resolveOwnerDisplayName(data, lead.owner, lead.ownerId),
        _lastTouchAt: leadContext.activity[0]?.createdAt || lead.updatedAt || lead.createdAt || ""
      };
    });
    const sortedRows = sortCrmRows(leadsWithContext, displaySort.key, displaySort.dir, LEAD_SORTERS);
    pagination = buildCrmPagination(
      sortedRows.length,
      Number(context.crmPage || 1),
      normalizeCrmPageSize(context.crmPageSize, routeId)
    );
    showTableSkeleton = Boolean(context.crmTableLoading) && !(data.leads || []).length;
    rows = showTableSkeleton
      ? renderLeadSkeletonRows()
      : ((visibleRowsForSelection = sortedRows.slice(pagination.startIndex, pagination.endIndex)),
        visibleRowsForSelection.map((lead) => leadRow(lead, leadEmailById, context)).join(""));
    visibleLeadCount = filtered.length;
    footerTotalRecords = sortedRows.length;
  }
  const selectedVisibleRows = visibleRowsForSelection.filter((lead) => selectedLeadIds.has(String(lead?.id || "").trim()));
  const selectedCount = selectedVisibleRows.length;
  const archivingCount = (Array.isArray(context.leadArchivingIds) ? context.leadArchivingIds : []).filter(Boolean).length;
  const bulkSavingCount = (Array.isArray(context.leadStatusSavingIds) ? context.leadStatusSavingIds : []).filter(Boolean).length;
  const bulkSavingStatus = String(context.leadBulkStatusTarget || "").trim();
  const controlsBusy = Boolean(context.leadBulkStatusSaving || archivingCount);
  const showBulkBar = selectedCount > 0 || Boolean(context.leadBulkStatusSaving && bulkSavingCount) || archivingCount > 0;
  const allVisibleSelected = visibleRowsForSelection.length > 0 && visibleRowsForSelection.every((lead) => selectedLeadIds.has(String(lead?.id || "").trim()));
  const partiallySelected = selectedCount > 0 && !allVisibleSelected;
  const selectedStatusValue =
    selectedVisibleRows.length && selectedVisibleRows.every((lead) => String(lead?.status || "").trim() === String(selectedVisibleRows[0]?.status || "").trim())
      ? String(selectedVisibleRows[0]?.status || "").trim()
      : "";
  const totalLeadCount = visibleLeadCount;
  const showReserveLeadCount = canViewReserveLeadCount(data, canManageLeads);
  const reserveCount = showReserveLeadCount
    ? Math.max(0, Number(context.leadsPageData?.reserveCount || 0) || 0)
    : 0;
  const showReserveLeadMeter = showReserveLeadCount && reserveCount > 0;
  const reserveCountLabel = reserveCount.toLocaleString();
  const activeScopeLabel = canManageLeads
    ? (
        {
          mine: "My Leads",
          unassigned: "Unassigned",
          assigned: "Assigned",
          all: "All Leads"
        }[activeScope] || "Leads"
      )
    : "My Leads";
  const activeFilterCount = [
    String(context.searchTerm || "").trim(),
    activeStatusFilter !== "all",
    canManageLeads && activeOwnerFilter !== "all",
    activeSourceFilter !== "all",
    activeTimezoneFilter !== "all",
    activeDateFilter !== "all"
  ].filter(Boolean).length;
  const leadFilterButtonLabel = activeFilterCount
    ? `Open filters (${activeFilterCount} active filter${activeFilterCount === 1 ? "" : "s"})`
    : "Open filters";
  const filterPopover = context.leadFiltersOpen
    ? `
      <form id="leadFilterForm" class="kanban-filter-popover lead-filter-popover" autocomplete="off">
        <div class="kanban-filter-popover-head">
          <div class="kanban-filter-popover-copy">
            <h4>Filters</h4>
            <p>Narrow the leads list without leaving the table.</p>
          </div>
          <button type="button" class="mini-btn" data-action="lead-filters-close" data-id="close">Close</button>
        </div>
        <div class="kanban-filter-popover-grid">
          <label class="kanban-filter-popover-field is-full">
            <span>Search</span>
            <div class="kanban-filter-search">
              <i class="bi bi-search" aria-hidden="true"></i>
              <input
                type="search"
                name="searchTerm"
                value="${escapeHtml(String(context.searchTerm || ""))}"
                placeholder="Search leads, interest, owner, phone, or timezone"
              />
            </div>
          </label>
          <label class="kanban-filter-popover-field">
            <span>Status</span>
            <div class="kanban-filter-select">
              <select name="statusFilter">
                ${LEAD_STATUS_FILTER_OPTIONS
                  .map(
                    (option) => `
                      <option value="${escapeHtml(option.id)}" ${activeStatusFilter === option.id ? "selected" : ""}>
                        ${escapeHtml(option.label)}
                      </option>
                    `
                  )
                  .join("")}
              </select>
              <i class="bi bi-chevron-down" aria-hidden="true"></i>
            </div>
          </label>
          ${
            canManageLeads
              ? `
                <label class="kanban-filter-popover-field">
                  <span>Owner</span>
                  <div class="kanban-filter-select">
                    <select name="ownerFilter">
                      ${ownerFilterOptions
                        .map(
                          (option) => `
                            <option value="${escapeHtml(option.id)}" ${activeOwnerFilter === option.id ? "selected" : ""}>
                              ${escapeHtml(option.label)}
                            </option>
                          `
                        )
                        .join("")}
                    </select>
                    <i class="bi bi-chevron-down" aria-hidden="true"></i>
                  </div>
                </label>
              `
              : `<input type="hidden" name="ownerFilter" value="all" />`
          }
          <label class="kanban-filter-popover-field">
            <span>Source</span>
            <div class="kanban-filter-select">
              <select name="sourceFilter">
                ${sourceOptions
                  .map(
                    (option) => `
                      <option value="${escapeHtml(option.id)}" ${activeSourceFilter === option.id ? "selected" : ""}>
                        ${escapeHtml(option.id === "all" ? "All sources" : option.label)}
                      </option>
                    `
                  )
                  .join("")}
              </select>
              <i class="bi bi-chevron-down" aria-hidden="true"></i>
            </div>
          </label>
          <label class="kanban-filter-popover-field">
            <span>Timezone</span>
            <div class="kanban-filter-select">
              <select name="timezoneFilter">
                ${LEAD_TIMEZONE_FILTER_OPTIONS
                  .map(
                    (option) => `
                      <option value="${escapeHtml(option.id)}" ${activeTimezoneFilter === option.id ? "selected" : ""}>
                        ${escapeHtml(option.label)}
                      </option>
                    `
                  )
                  .join("")}
              </select>
              <i class="bi bi-chevron-down" aria-hidden="true"></i>
            </div>
          </label>
          <label class="kanban-filter-popover-field">
            <span>Date</span>
            <div class="kanban-filter-select">
              <select name="dateFilter">
                ${LEAD_DATE_FILTER_OPTIONS
                  .map(
                    (option) => `
                      <option value="${escapeHtml(option.id)}" ${activeDateFilter === option.id ? "selected" : ""}>
                        ${escapeHtml(option.label)}
                      </option>
                    `
                  )
                  .join("")}
              </select>
              <i class="bi bi-chevron-down" aria-hidden="true"></i>
            </div>
          </label>
        </div>
        <div class="kanban-filter-popover-actions">
          <button type="button" class="ghost-btn" data-action="lead-filters-clear" data-id="clear">Reset</button>
          <button type="submit" class="btn btn-accent">Apply</button>
        </div>
      </form>
    `
    : "";

  return {
    title: "Leads",
    subtitle: "Capture, qualify, and schedule follow-ups",
    primaryAction: "Add Lead",
    showWaitingPanel: false,
    html: `
      <section class="view-block crm-list-v2 crm-leads-list">
        <div class="crm-lead-header-shell">
          <div class="crm-lead-header-main">
            <div class="crm-lead-title-group">
              <div class="crm-lead-title-row">
                <h3 class="block-title">Leads</h3>
                <span class="crm-lead-total-badge">${escapeHtml(String(visibleLeadCount))}</span>
              </div>
              <p class="crm-lead-title-meta">${escapeHtml(activeScopeLabel)} view${visibleLeadCount !== totalLeadCount ? ` · ${escapeHtml(String(totalLeadCount))} total` : ""}</p>
            </div>
            <div class="team-head-actions crm-lead-header-actions">
              ${showReserveLeadMeter ? `<span class="crm-lead-reserve-meter" title="Reserve leads available for refill"><span>Reserve</span><strong>${escapeHtml(reserveCountLabel)}</strong></span>` : ""}
              ${canManageLeads ? `<button type="button" class="mini-btn crm-lead-header-icon-btn crm-lead-import-btn" data-action="lead-import-open" data-id="open" aria-label="Import leads" title="Import leads"><i class="bi bi-upload" aria-hidden="true"></i></button>` : ""}
              ${canManageLeads ? `<button type="button" class="mini-btn crm-lead-header-icon-btn crm-lead-export-btn" data-action="lead-export-unqualified" data-id="unqualified" aria-label="Export unqualified leads" title="Export unqualified leads"><i class="bi bi-download" aria-hidden="true"></i></button>` : ""}
              ${canManageLeads ? `<button type="button" class="mini-btn crm-lead-header-icon-btn crm-lead-export-btn" data-action="lead-export-duplicates" data-id="duplicates" aria-label="Export duplicate leads" title="Export duplicate leads"><i class="bi bi-files" aria-hidden="true"></i></button>` : ""}
              <button class="table-ops-columns-btn" type="button" data-action="view-add-record" data-id="create">
                <i class="bi bi-plus-lg" aria-hidden="true"></i>
                <span>New Lead</span>
              </button>
              <div class="kanban-filter-shell lead-filter-shell">
                <button
                  class="mini-btn kanban-filter-btn crm-lead-header-icon-btn crm-lead-filter-btn ${activeFilterCount ? "is-active" : ""}"
                  type="button"
                  data-action="lead-open-filters"
                  data-id="open"
                  aria-label="${escapeHtml(leadFilterButtonLabel)}"
                  title="${escapeHtml(leadFilterButtonLabel)}"
                  aria-expanded="${context.leadFiltersOpen ? "true" : "false"}"
                >
                  <i class="bi bi-funnel" aria-hidden="true"></i>
                  ${activeFilterCount ? `<small>${escapeHtml(String(activeFilterCount))}</small>` : ""}
                </button>
                ${filterPopover}
              </div>
            </div>
          </div>
        </div>
        <div class="table-ops-wrap data-table-shell">
          <table class="data-table">
            <thead>
              <tr>
                <th class="table-col-check crm-lead-select-cell">
                  <input
                    id="leadSelectAll"
                    type="checkbox"
                    aria-label="Select all visible leads"
                    ${allVisibleSelected ? "checked" : ""}
                    ${partiallySelected ? `data-indeterminate="true"` : ""}
                    ${!visibleRowsForSelection.length ? "disabled" : ""}
                  />
                </th>
                <th class="crm-col-lead">${crmHeaderSortButton("Lead", "name", sortKey, sortDir)}</th>
                <th class="crm-col-phone">${crmHeaderSortButton("Phone", "phone", sortKey, sortDir)}</th>
                <th class="crm-col-timezone">${crmHeaderSortButton("Timezone", "timezone", sortKey, sortDir)}</th>
                <th class="crm-col-interest">${crmHeaderSortButton("Interest", "interest", sortKey, sortDir)}</th>
                <th class="crm-col-status">${crmHeaderSortButton("Status", "status", sortKey, sortDir)}</th>
                <th class="crm-col-owner">${crmHeaderSortButton("Owner", "owner", sortKey, sortDir)}</th>
                <th class="crm-col-last-touch">${crmHeaderSortButton("Last Touch", "lastTouch", sortKey, sortDir)}</th>
                <th class="crm-col-next-followup">${crmHeaderSortButton("Next Follow-up", "nextFollowUp", sortKey, sortDir)}</th>
              </tr>
            </thead>
            <tbody>
              ${
                rows ||
                (showInitialLoadingRow
                  ? "<tr><td colspan='9' class='task-meta'>Loading leads...</td></tr>"
                  : "<tr><td colspan='9' class='task-meta'>No leads found.</td></tr>")
              }
            </tbody>
          </table>
        </div>
        ${
          showBulkBar
            ? `
              <div class="crm-lead-bulk-bar ${controlsBusy ? "is-saving" : ""}" ${controlsBusy ? 'aria-busy="true"' : ""}>
                <div class="crm-lead-bulk-copy">
                  <p class="task-meta">${
                    archivingCount
                      ? `Archiving ${archivingCount} lead${archivingCount === 1 ? "" : "s"}...`
                      : context.leadBulkStatusSaving
                      ? `${bulkSavingCount} lead${bulkSavingCount === 1 ? "" : "s"} updating${bulkSavingStatus ? ` to ${escapeHtml(bulkSavingStatus)}` : ""}...`
                      : `${selectedCount} of ${visibleRowsForSelection.length} selected`
                  }</p>
                  ${
                    archivingCount
                      ? `<p class="crm-lead-bulk-note">Leads will leave the active list automatically.</p>`
                      : context.leadBulkStatusSaving
                      ? `<p class="crm-lead-bulk-note">Please wait while the selected leads are being updated.</p>`
                      : ""
                  }
                </div>
                <div class="crm-lead-bulk-actions">
                  <button
                    type="button"
                    class="crm-lead-bulk-trigger crm-lead-bulk-trigger-attempt"
                    data-action="lead-bulk-attempt"
                    data-id="attempt"
                    ${controlsBusy ? "disabled" : ""}
                  >
                    <i class="bi bi-check2-circle" aria-hidden="true"></i>
                    <span>${selectedCount === 1 ? "Log attempt" : "Log attempts"}</span>
                  </button>
                  <button
                    type="button"
                    class="crm-lead-bulk-trigger crm-lead-bulk-trigger-archive"
                    data-action="lead-bulk-archive"
                    data-id="archive"
                    ${controlsBusy ? "disabled" : ""}
                  >
                    <i class="bi ${archivingCount ? "bi-arrow-repeat lead-status-spinner" : "bi-archive"}" aria-hidden="true"></i>
                    <span>${archivingCount ? "Archiving..." : "Archive selected"}</span>
                  </button>
                  <div class="lead-status-control crm-lead-bulk-status-control" data-lead-bulk-status-control="bulk">
                    <button
                      type="button"
                      class="crm-lead-bulk-trigger ${context.leadBulkStatusOpen ? "is-open" : ""}"
                      data-action="lead-bulk-status-toggle"
                      data-id="bulk"
                      aria-haspopup="menu"
                      aria-expanded="${context.leadBulkStatusOpen ? "true" : "false"}"
                      ${controlsBusy ? "disabled" : ""}
                    >
                      <i class="bi ${context.leadBulkStatusSaving ? "bi-arrow-repeat lead-status-spinner" : "bi-pencil-square"}" aria-hidden="true"></i>
                      <span>${context.leadBulkStatusSaving ? "Updating status..." : "Change status"}</span>
                      ${controlsBusy ? "" : `<i class="bi bi-chevron-down" aria-hidden="true"></i>`}
                    </button>
                    ${
                      context.leadBulkStatusOpen && !controlsBusy
                        ? `
                          <div class="lead-status-popover crm-lead-bulk-popover is-open" role="menu">
                            ${LEAD_STATUS_TABLE_OPTIONS.map(
                              (status) => `
                                <button
                                  type="button"
                                  class="lead-status-option crm-lead-bulk-option ${status === selectedStatusValue ? "is-selected" : ""}"
                                  data-action="lead-bulk-status-apply"
                                  data-id="${escapeHtml(status)}"
                                >
                                  <span class="status-chip status-${escapeHtml(leadProfileStatusClass(status))}">${escapeHtml(status)}</span>
                                  ${status === selectedStatusValue ? `<i class="bi bi-check2" aria-hidden="true"></i>` : ""}
                                </button>
                              `
                            ).join("")}
                          </div>
                        `
                        : ""
                    }
                  </div>
                </div>
              </div>
            `
            : ""
        }
        ${showTableSkeleton ? "" : renderCrmTableFooter(routeId, pagination, footerTotalRecords, { showTotalRecords: exactTotalCount })}
      </section>
    `
  };
}

export function renderLeadProfile(data, context) {
  const selectedLeadId = String(context.selectedLeadId || "").trim();
  const isDrawer = String(context.leadProfileDisplay || "").trim() === "drawer";
  const leadProfileData = context.leadProfileData || {};
  const profileLead =
    String(leadProfileData.leadId || "").trim() === selectedLeadId &&
    leadProfileData.lead &&
    typeof leadProfileData.lead === "object"
      ? leadProfileData.lead
      : null;
  const lead = profileLead || (data.leads || []).find((item) => item.id === selectedLeadId) || null;

  if (!lead) {
    const directProfileLoading =
      String(leadProfileData.leadId || "").trim() === selectedLeadId && Boolean(leadProfileData.loading);
    const isLoadingProfile =
      Boolean(selectedLeadId) &&
      (directProfileLoading ||
        (!Boolean(leadProfileData.loaded) &&
          !String(leadProfileData.error || "").trim() &&
          (Boolean(context.crmSnapshotLoading) || !Boolean(context.crmSnapshotLoaded) || context.supabaseConfigured)));
    if (isLoadingProfile) {
      return {
        title: "Lead Profile",
        subtitle: "Loading lead details",
        showWaitingPanel: false,
        html: `
          <section class="view-block lead-profile-page-view lead-record-page lead-record-loading-page${isDrawer ? " lead-profile-drawer-view" : ""}">
            ${
              isDrawer
                ? ""
                : `
                  <div class="lead-profile-page-toolbar">
                    <nav class="lead-profile-breadcrumb" aria-label="Lead breadcrumb">
                      <span class="lead-profile-breadcrumb-link lead-profile-breadcrumb-link-static">Leads</span>
                      <span class="lead-profile-breadcrumb-separator" aria-hidden="true">/</span>
                      <span class="lead-record-skeleton-line is-crumb" aria-hidden="true"></span>
                    </nav>
                  </div>
                `
            }

            <section class="lead-profile-shell lead-profile-page-shell">
              <section class="lead-profile-head lead-profile-page-head lead-record-hero lead-record-hero-shell lead-record-loading-hero" aria-label="Loading lead profile">
                <div class="lead-profile-identity">
                  <span class="lead-profile-avatar lead-record-skeleton-avatar" aria-hidden="true"></span>
                  <div class="lead-profile-identity-meta lead-record-loading-copy">
                    <p class="lead-profile-eyebrow">Lead</p>
                    <div class="lead-record-header-title-row">
                      <span class="lead-record-skeleton-line is-title" aria-hidden="true"></span>
                      <span class="lead-record-skeleton-pill" aria-hidden="true"></span>
                    </div>
                    <div class="lead-record-subline-row">
                      <span class="lead-record-skeleton-line is-subtitle" aria-hidden="true"></span>
                      <span class="lead-record-skeleton-icon" aria-hidden="true"></span>
                    </div>
                    <div class="lead-record-loading-meta" aria-hidden="true">
                      <span class="lead-record-skeleton-line is-meta"></span>
                      <span class="lead-record-skeleton-line is-meta is-short"></span>
                      <span class="lead-record-skeleton-line is-meta"></span>
                      <span class="lead-record-skeleton-line is-meta is-short"></span>
                    </div>
                  </div>
                </div>
                <div class="lead-profile-head-actions lead-record-header-actions lead-record-loading-actions" aria-hidden="true">
                  <span class="lead-record-skeleton-button is-primary"></span>
                  <span class="lead-record-skeleton-button"></span>
                  <span class="lead-record-skeleton-button"></span>
                  <span class="lead-record-skeleton-button is-icon"></span>
                </div>
              </section>

              <section class="lead-record-layout">
                <div class="lead-record-main">
                  <section class="lead-profile-surface lead-record-surface lead-record-workspace">
                    <section class="lead-record-block">
                      <div class="lead-record-loading-section-head" aria-hidden="true">
                        <div class="lead-record-loading-section-copy">
                          <span class="lead-record-skeleton-line is-section-title"></span>
                          <span class="lead-record-skeleton-line is-section-subtitle"></span>
                        </div>
                        <span class="lead-record-skeleton-button"></span>
                      </div>
                      <div class="lead-record-loading-timeline" aria-hidden="true">
                        <article class="lead-record-loading-item">
                          <span class="lead-record-skeleton-line is-item-title"></span>
                          <span class="lead-record-skeleton-line is-item-meta"></span>
                          <span class="lead-record-skeleton-line is-item-body"></span>
                        </article>
                        <article class="lead-record-loading-item">
                          <span class="lead-record-skeleton-line is-item-title"></span>
                          <span class="lead-record-skeleton-line is-item-meta is-short"></span>
                          <span class="lead-record-skeleton-line is-item-body is-short"></span>
                        </article>
                        <article class="lead-record-loading-item">
                          <span class="lead-record-skeleton-line is-item-title is-short"></span>
                          <span class="lead-record-skeleton-line is-item-meta"></span>
                          <span class="lead-record-skeleton-line is-item-body"></span>
                        </article>
                      </div>
                    </section>

                    <section class="lead-record-block">
                      <div class="lead-record-loading-section-head" aria-hidden="true">
                        <div class="lead-record-loading-section-copy">
                          <span class="lead-record-skeleton-line is-section-title"></span>
                          <span class="lead-record-skeleton-line is-section-subtitle is-short"></span>
                        </div>
                        <span class="lead-record-skeleton-button"></span>
                      </div>
                      <div class="lead-record-loading-list" aria-hidden="true">
                        <div class="lead-record-loading-row">
                          <span class="lead-record-skeleton-line is-item-title"></span>
                          <span class="lead-record-skeleton-pill is-row"></span>
                        </div>
                        <div class="lead-record-loading-row">
                          <span class="lead-record-skeleton-line is-item-title"></span>
                          <span class="lead-record-skeleton-pill is-row"></span>
                        </div>
                        <div class="lead-record-loading-row">
                          <span class="lead-record-skeleton-line is-item-title is-short"></span>
                          <span class="lead-record-skeleton-pill is-row"></span>
                        </div>
                      </div>
                    </section>

                    <section class="lead-record-block">
                      <div class="lead-record-loading-section-head" aria-hidden="true">
                        <div class="lead-record-loading-section-copy">
                          <span class="lead-record-skeleton-line is-section-title"></span>
                          <span class="lead-record-skeleton-line is-section-subtitle"></span>
                        </div>
                      </div>
                      <div class="lead-record-loading-actions-grid" aria-hidden="true">
                        <span class="lead-record-skeleton-button"></span>
                        <span class="lead-record-skeleton-button"></span>
                        <span class="lead-record-skeleton-button"></span>
                        <span class="lead-record-skeleton-button"></span>
                      </div>
                      <div class="lead-record-loading-contact" aria-hidden="true">
                        <span class="lead-record-skeleton-line is-item-title"></span>
                        <span class="lead-record-skeleton-line is-item-meta"></span>
                        <span class="lead-record-skeleton-line is-item-meta is-short"></span>
                      </div>
                      <div class="lead-record-loading-phone-list" aria-hidden="true">
                        <span class="lead-record-skeleton-line is-item-title is-short"></span>
                        <span class="lead-record-skeleton-line is-item-body"></span>
                      </div>
                    </section>
                  </section>
                </div>

                <aside class="lead-record-side lead-record-side-stack">
                  <section class="lead-record-focus-card lead-record-side-panel lead-record-loading-focus" aria-hidden="true">
                    <div class="lead-record-focus-rail">
                      <span class="lead-record-skeleton-pill is-focus"></span>
                      <span class="lead-record-skeleton-line is-focus-title"></span>
                      <span class="lead-record-skeleton-line is-focus-copy"></span>
                      <div class="lead-record-loading-focus-grid">
                        <span class="lead-record-skeleton-line is-detail-label"></span>
                        <span class="lead-record-skeleton-line is-detail-label"></span>
                        <span class="lead-record-skeleton-line is-detail-label is-short"></span>
                        <span class="lead-record-skeleton-line is-detail-label is-short"></span>
                      </div>
                    </div>
                  </section>

                  <section class="lead-profile-surface lead-record-surface lead-record-side-panel" aria-hidden="true">
                    <div class="lead-record-loading-section-copy">
                      <span class="lead-record-skeleton-line is-section-title"></span>
                      <span class="lead-record-skeleton-line is-section-subtitle"></span>
                    </div>
                    <div class="lead-record-loading-detail-list">
                      <div class="lead-record-loading-detail-row">
                        <span class="lead-record-skeleton-line is-detail-label"></span>
                        <span class="lead-record-skeleton-line is-detail-value"></span>
                      </div>
                      <div class="lead-record-loading-detail-row">
                        <span class="lead-record-skeleton-line is-detail-label"></span>
                        <span class="lead-record-skeleton-line is-detail-value is-short"></span>
                      </div>
                      <div class="lead-record-loading-detail-row">
                        <span class="lead-record-skeleton-line is-detail-label"></span>
                        <span class="lead-record-skeleton-line is-detail-value"></span>
                      </div>
                      <div class="lead-record-loading-detail-row">
                        <span class="lead-record-skeleton-line is-detail-label"></span>
                        <span class="lead-record-skeleton-line is-detail-value is-short"></span>
                      </div>
                      <div class="lead-record-loading-detail-row">
                        <span class="lead-record-skeleton-line is-detail-label"></span>
                        <span class="lead-record-skeleton-line is-detail-value"></span>
                      </div>
                    </div>
                  </section>

                  <section class="lead-profile-surface lead-record-surface lead-record-side-panel" aria-hidden="true">
                    <div class="lead-record-loading-section-copy">
                      <span class="lead-record-skeleton-line is-section-title"></span>
                      <span class="lead-record-skeleton-line is-section-subtitle is-short"></span>
                    </div>
                    <div class="lead-record-loading-list">
                      <div class="lead-record-loading-row">
                        <span class="lead-record-skeleton-line is-item-title"></span>
                        <span class="lead-record-skeleton-pill is-row"></span>
                      </div>
                      <div class="lead-record-loading-row">
                        <span class="lead-record-skeleton-line is-item-title"></span>
                        <span class="lead-record-skeleton-pill is-row"></span>
                      </div>
                      <div class="lead-record-loading-row">
                        <span class="lead-record-skeleton-line is-item-title is-short"></span>
                        <span class="lead-record-skeleton-pill is-row"></span>
                      </div>
                    </div>
                  </section>
                </aside>
              </section>
            </section>
          </section>
        `
      };
    }
    return {
      title: "Lead Profile",
      subtitle: String(leadProfileData.error || "").trim() && String(leadProfileData.error || "").trim() !== "not-found"
        ? "Lead profile unavailable"
        : "Lead record not found",
      showWaitingPanel: false,
      html: `
        <section class="view-block lead-profile-page-view${isDrawer ? " lead-profile-drawer-view" : ""}">
          <section class="lead-profile-empty-state">
            <p class="lead-profile-eyebrow">Lead</p>
            <h3>${escapeHtml(
              String(leadProfileData.error || "").trim() && String(leadProfileData.error || "").trim() !== "not-found"
                ? "Lead profile unavailable"
                : "Lead not found"
            )}</h3>
            <p class="lead-profile-list-meta">${escapeHtml(
              String(leadProfileData.error || "").trim() && String(leadProfileData.error || "").trim() !== "not-found"
                ? String(leadProfileData.error || "").trim()
                : "The selected lead does not exist anymore or has been removed from the demo data."
            )}</p>
            ${
              isDrawer
                ? ""
                : `
                  <div class="lead-profile-page-actions">
                    <button type="button" class="mini-btn" data-route="leads">
                      <i class="bi bi-arrow-left" aria-hidden="true"></i>
                      <span>Back to Leads</span>
                    </button>
                  </div>
                `
            }
          </section>
        </section>
      `
    };
  }

  const leadContext = getLeadContext(data, lead, normalizeForMatch);
  const leadAttemptMeta = getLeadAttemptMeta(lead);
  const leadAttemptGuidance = getLeadAttemptGuidance(lead, leadAttemptMeta);
  const primaryContact = getPrimaryLeadContact(lead, leadContext);
  const canConvert = String(lead.status || "").trim().toLowerCase() === "qualified";
  const followUpLabel = formatLeadProfileDate(lead.nextFollowUp);
  const lastActivity = leadContext.activity[0] || null;
  const lastTouchLabel = lastActivity ? formatLeadProfileDateTime(lastActivity.createdAt) : "No activity yet";
  const ownerLabel = resolveOwnerDisplayName(data, lead.owner, lead.ownerId) || "Unassigned";
  const attemptCountLabel = `${leadAttemptMeta.attemptCount}/3`;
  const lastAttemptAtLabel = formatLeadProfileDateTime(leadAttemptMeta.lastAttemptAt) || "Not logged yet";
  const lastAttemptReasonLabel = leadAttemptMeta.lastAttemptReason || "Not logged yet";
  const assignedAtLabel = formatLeadAssignedDaysLabel(leadAttemptMeta.assignedAt);
  const weeklyRemovalMeta = getLeadWeeklyRemovalMeta(lead);
  const showWeeklyRemovalHelper = isLeadPendingWeeklyRemoval(lead);
  const weeklyRemovalDueLabel = formatLeadProfileDate(weeklyRemovalMeta.removalDueAt);
  const interestLabel = String(lead.interest || "").trim();
  const companyLabel = String(lead.company || "").trim();
  const profileSubtitleParts = [interestLabel, companyLabel && companyLabel !== "Individual" ? companyLabel : "", lead.source || "Lead source"].filter(Boolean);
  const primaryAction = canConvert
    ? { action: "lead-convert", label: "Convert to Deal", disabled: false }
    : { action: "lead-create-followup-task", label: "Create Task", disabled: false };
  const primaryActionIcon = canConvert ? "bi-arrow-left-right" : "bi-plus-square";

  const contactsRows = leadContext.contacts.length
    ? leadContext.contacts
        .slice(0, 8)
        .map(
          (contact) => `
            <article class="lead-profile-list-row" data-contact-open="${escapeHtml(contact.id)}">
              <div class="lead-profile-list-main">
                <p class="lead-profile-list-title">${escapeHtml(contact.name || "Contact")}</p>
                <p class="lead-profile-list-meta">
                  ${leadProfileIconText("bi-person-badge", contact.role || "Contact", "lead-profile-inline-meta-item")}
                  ${leadProfileIconText("bi-building", contact.account || (companyLabel && companyLabel !== "Individual" ? companyLabel : "") || "No account", "lead-profile-inline-meta-item")}
                </p>
              </div>
              <span class="lead-profile-list-side">${leadProfileIconText("bi-person", resolveOwnerDisplayName(data, contact.owner, contact.ownerId) || "Unassigned", "lead-profile-inline-side-item")}</span>
            </article>
          `
        )
        .join("")
    : "<p class='lead-profile-empty'>No contacts linked yet.</p>";

  const relatedDealsRows = leadContext.deals.length
    ? leadContext.deals
        .slice(0, 6)
        .map(
          (deal) => `
            <article class="lead-profile-list-row" data-deal-open="${escapeHtml(deal.id)}">
              <div class="lead-profile-list-main">
                <p class="lead-profile-list-title">${escapeHtml(deal.name || "Deal")}</p>
                <p class="lead-profile-list-meta">
                  ${leadProfileIconText("bi-building", deal.account || (companyLabel && companyLabel !== "Individual" ? companyLabel : "") || "No account", "lead-profile-inline-meta-item")}
                </p>
              </div>
              <span class="status-chip ${dealStageClass(deal.stage)}">${escapeHtml(getDealStageLabel(deal.stage))}</span>
            </article>
          `
        )
        .join("")
    : "<p class='lead-profile-empty'>No deals linked yet.</p>";

  const tasksRows = leadContext.linkedTasks.length
    ? leadContext.linkedTasks
        .slice(0, 10)
        .map(
          (task) => `
            <article class="lead-profile-list-row lead-profile-task-row" data-task-open="${escapeHtml(task.id)}">
              <div class="lead-profile-list-main">
                <p class="lead-profile-list-title">${escapeHtml(task.title || "Task")}</p>
                <p class="lead-profile-list-meta">
                  ${leadProfileIconText("bi-calendar3", `${task.day || "No date"}${task.time ? ` | ${task.time}` : ""}`, "lead-profile-inline-meta-item")}
                </p>
              </div>
              <span class="status-chip status-${escapeHtml(String(task.status || "New").toLowerCase().replaceAll(" ", "-"))}">${escapeHtml(
                task.status || "New"
              )}</span>
            </article>
          `
        )
        .join("")
    : "<p class='lead-profile-empty'>No follow-up tasks yet.</p>";

  const activityRows = leadContext.activity.length
    ? leadContext.activity
        .map(
          (item) => `
            <article class="lead-profile-timeline-item">
              <div class="lead-profile-timeline-head">
                <p class="lead-profile-list-title lead-profile-timeline-title">
                  <i class="bi ${leadProfileActivityIcon(item)}" aria-hidden="true"></i>
                  <span>${escapeHtml(item.label)}</span>
                </p>
                <span class="lead-profile-list-side">${escapeHtml(formatLeadProfileDateTime(item.createdAt))}</span>
              </div>
              <p class="lead-profile-list-meta">${leadProfileIconText("bi-person", item.actor || "System", "lead-profile-inline-meta-item")}</p>
              <p class="lead-profile-list-body">${escapeHtml(item.text)}</p>
            </article>
          `
        )
        .join("")
    : "<p class='lead-profile-empty'>No activity yet.</p>";

  const leadAttemptHistoryEntries = [];
  const leadAttemptHistorySeen = new Set();
  const matchesLeadAttemptHistoryEntry = (entry) => {
    const entryLeadId = String(entry?.leadId || "").trim();
    const entryLeadName = String(entry?.leadName || "").trim().toLowerCase();
    const leadId = String(lead.id || "").trim();
    const leadName = String(lead.name || "").trim().toLowerCase();
    if (entryLeadId && entryLeadId === leadId) {
      return true;
    }
    if (!entryLeadId && entryLeadName && entryLeadName === leadName) {
      return true;
    }
    return false;
  };
  const addLeadAttemptHistoryEntry = (entry, options = {}) => {
    const source = String(options.source || "meta").trim().toLowerCase() || "meta";
    const parsedCreatedAt = String(entry.createdAt || "").trim();
    const parsedId = String(entry.id || "").trim();
    const parsedReason = String(entry.reason || "").trim();
    const parsedNote = String(entry.note || "").trim();
    const parsedActor = String(entry.actor || "").trim();
    const normalizedReason = normalizeLeadAttemptHistoryValue(parsedReason);
    const normalizedNote = normalizeLeadAttemptHistoryValue(parsedNote);
    const normalizedActor = normalizeLeadAttemptHistoryValue(parsedActor);
    const parsedCreatedAtMs = Date.parse(parsedCreatedAt);
    const dedupeKey = parsedId
      ? `id:${parsedId}`
      : [
          parsedCreatedAt || "no-date",
          normalizedReason,
          normalizedNote,
          normalizedActor
        ].join("|");
    if (leadAttemptHistorySeen.has(dedupeKey)) {
      return;
    }
    const nearDuplicate =
      source === "activity-log"
        ? leadAttemptHistoryEntries.some((existingEntry) => {
            if (String(existingEntry._source || "").trim() !== "meta") {
              return false;
            }
            const existingCreatedAtMs = Date.parse(String(existingEntry.createdAt || "").trim());
            if (!Number.isFinite(parsedCreatedAtMs) || !Number.isFinite(existingCreatedAtMs)) {
              return false;
            }
            return (
              normalizeLeadAttemptHistoryValue(existingEntry.reason) === normalizedReason &&
              normalizeLeadAttemptHistoryValue(existingEntry.note) === normalizedNote &&
              normalizeLeadAttemptHistoryValue(existingEntry.actor) === normalizedActor &&
              Math.abs(existingCreatedAtMs - parsedCreatedAtMs) <= 30000
            );
          })
        : false;
    if (nearDuplicate) {
      return;
    }
    leadAttemptHistorySeen.add(dedupeKey);
    leadAttemptHistoryEntries.push({
      id: parsedId,
      createdAt: parsedCreatedAt,
      reason: parsedReason || "Outreach attempt logged.",
      note: parsedNote,
      actor: parsedActor,
      _source: source
    });
  };

  (leadAttemptMeta.attemptHistory || []).forEach((entry) => {
    addLeadAttemptHistoryEntry({
      id: entry.id,
      createdAt: entry.createdAt,
      reason: entry.reason,
      note: entry.note,
      actor: entry.actor
    }, { source: "meta" });
  });

  (data.activityLog || [])
    .filter((entry) => matchesLeadAttemptHistoryEntry(entry))
    .filter((entry) => String(entry.type || "").trim().toLowerCase() === "lead-attempt-logged")
    .sort((a, b) => Date.parse(String(b.createdAt || "")) - Date.parse(String(a.createdAt || "")))
    .forEach((entry) => {
      const parsedAttempt = parseLeadAttemptHistoryText(entry.text);
      addLeadAttemptHistoryEntry({
        createdAt: entry.createdAt,
        reason: parsedAttempt.reason,
        note: parsedAttempt.note,
        actor: entry.actor || ""
      }, { source: "activity-log" });
    });

  const leadAttemptHistoryRows = leadAttemptHistoryEntries.length
    ? leadAttemptHistoryEntries
        .slice()
        .sort((a, b) => Date.parse(String(b.createdAt || "")) - Date.parse(String(a.createdAt || "")))
        .map((entry) => `
            <article class="lead-attempt-history-item">
              <div class="lead-attempt-history-head">
                <p class="lead-profile-list-title lead-attempt-history-title">
                  <i class="bi bi-check2-circle" aria-hidden="true"></i>
                  <span>Attempt logged</span>
                </p>
                <span class="lead-profile-list-side">${escapeHtml(formatLeadProfileDateTime(entry.createdAt) || "Not set")}</span>
              </div>
              <p class="lead-profile-list-meta">${leadProfileIconText("bi-person", entry.actor || "System", "lead-profile-inline-meta-item")}</p>
              <p class="lead-profile-list-body">${escapeHtml(entry.reason)}</p>
              ${
                entry.note
                  ? `<p class="lead-attempt-history-note">${escapeHtml(entry.note)}</p>`
                  : ""
              }
            </article>
          `)
        .join("")
    : "<p class='lead-profile-empty'>No attempt history yet.</p>";

  const notesLabel = String(lead.notes || "").trim()
    ? `<p class="lead-profile-list-body">${escapeHtml(lead.notes)}</p>`
    : "<p class='lead-profile-empty'>No notes yet.</p>";
  const leadPhoneEntries = getLeadPhoneEntries(lead);
  const accountLabel = leadContext.account?.name || (companyLabel && companyLabel !== "Individual" ? companyLabel : "") || "Not linked";
  const leadIdentityLine = [companyLabel || (accountLabel !== "Not linked" ? accountLabel : ""), lead.source || "No source"].filter(Boolean).join(" | ");
  const leadHeaderSubline = interestLabel || leadIdentityLine || "No source";
  const leadFocusTitle = canConvert
    ? "Ready for pipeline handoff"
    : leadContext.linkedTasks.length
      ? "Follow-up already in motion"
      : "Schedule the next touch";
  const leadFocusCopy = canConvert
    ? "Convert once value, owner, and timing are confirmed."
    : leadContext.linkedTasks.length
      ? "Review the latest activity and keep the next customer touch on track."
      : "Create a follow-up so ownership and timing stay visible.";
  const leadSummaryParts = [
    lead.source || "No source",
    `Owner ${ownerLabel}`,
    `Follow-up ${followUpLabel}`,
    lastTouchLabel
  ].filter(Boolean);
  const leadSummaryMarkup = leadSummaryParts
    .map((item) => `<span class="lead-record-header-meta-item">${escapeHtml(item)}</span>`)
    .join("");
  const leadQuickActions = [
    { action: "lead-log-call", label: "Log Call", icon: "bi-telephone" },
    { action: "lead-send-email", label: "Email", icon: "bi-envelope" }
  ]
    .map(
      (item) => `
        <button type="button" class="mini-btn" data-action="${item.action}" data-id="${lead.id}">
          ${leadProfileActionLabel(item.icon, item.label)}
        </button>
      `
    )
    .join("");
  const primaryContactPanel = primaryContact
    ? `
      <div class="lead-record-contact-band">
        <div class="lead-record-contact-main">
          <p class="lead-profile-section-title">Primary Contact</p>
          <p class="lead-profile-list-title">${escapeHtml(primaryContact.name)}</p>
          <p class="lead-profile-list-meta">
            ${leadProfileIconText("bi-envelope", primaryContact.email || "No email", "lead-profile-inline-meta-item")}
            ${leadProfileIconText("bi-telephone", primaryContact.phone || "No phone", "lead-profile-inline-meta-item")}
          </p>
        </div>
        <div class="lead-record-contact-side">
          ${leadProfileIconText("bi-building", primaryContact.account || accountLabel, "lead-profile-inline-side-item")}
        </div>
      </div>
    `
    : "<p class='lead-profile-empty'>No contact channel linked yet.</p>";
  const leadInterestLineMarkup = interestLabel
    ? `
      <div class="lead-record-subline-row">
        <p class="lead-profile-subline">${escapeHtml(leadHeaderSubline)}</p>
        <button
          type="button"
          class="lead-record-copy-btn"
          data-action="lead-copy-name-interest"
          data-id="${escapeHtml(lead.id)}"
          data-text="${escapeHtml(`${String(lead.name || "Lead").trim()}\n${interestLabel}`)}"
          aria-label="Copy lead name and interest for ${escapeHtml(String(lead.name || "Lead").trim())}"
          title="Copy lead name and interest"
        >
          <i class="bi bi-clipboard" aria-hidden="true"></i>
        </button>
      </div>
    `
    : `<p class="lead-profile-subline">${escapeHtml(leadHeaderSubline)}</p>`;
  const leadFocusPanel = `
    <section class="lead-record-focus-card lead-record-side-panel">
      <div class="lead-record-focus-rail">
        <div class="lead-record-focus-head">
          <p class="lead-profile-section-title">Current Focus</p>
          <div class="lead-record-focus-status">
            <span class="status-chip status-${leadProfileStatusClass(lead.status)}">${escapeHtml(lead.status || "New")}</span>
            ${canConvert ? `<span class="lead-record-focus-flag">Conversion ready</span>` : ""}
          </div>
          <p class="lead-record-focus-title">${escapeHtml(leadFocusTitle)}</p>
          <p class="lead-record-focus-copy">${escapeHtml(leadFocusCopy)}</p>
        </div>
      </div>
    </section>
  `;
  const leadAttemptPanel = `
    <section class="lead-profile-surface lead-record-surface lead-record-side-panel lead-attempt-panel">
      <div class="lead-record-section-head">
        <div>
          <p class="lead-profile-section-title">Attempt tracker</p>
          <p class="lead-record-section-subtitle">Log RingCentral or manual outreach without leaving the lead detail.</p>
        </div>
        <button
          type="button"
          class="mini-btn"
          data-action="lead-log-attempt"
          data-id="${lead.id}"
          ${leadAttemptGuidance.disableLogging ? 'disabled title="This lead has reached the attempt limit and is ready for reassignment."' : ""}
        >
          ${leadProfileActionLabel("bi-check2-circle", "Log attempt")}
        </button>
      </div>
      <div class="lead-record-detail-list">
        ${leadProfileDetailRow("bi-check2-circle", "Attempts", attemptCountLabel)}
        ${leadProfileDetailRow("bi-clock-history", "Last attempt", lastAttemptAtLabel)}
        ${leadProfileDetailRow("bi-chat-left-text", "Last reason", lastAttemptReasonLabel)}
        ${leadProfileDetailRow("bi-person-badge", "Assigned for", assignedAtLabel)}
      </div>
      <p class="lead-attempt-helper is-${escapeHtml(leadAttemptGuidance.tone)}">${escapeHtml(leadAttemptGuidance.label)}</p>
      ${
        showWeeklyRemovalHelper
          ? `
            <div class="lead-weekly-removal-helper">
              <p class="lead-weekly-removal-title">Weekly cleanup</p>
              <p class="lead-weekly-removal-copy">This lead will leave active leads Friday at 8:00 AM if it stays Unqualified.</p>
              <p class="lead-weekly-removal-note">Scheduled removal: ${escapeHtml(weeklyRemovalDueLabel)}</p>
            </div>
          `
          : ""
      }
      <div class="lead-attempt-history">
        <div class="lead-record-section-head lead-attempt-history-headbar">
          <div>
            <p class="lead-profile-section-title">Attempt history</p>
            <p class="lead-record-section-subtitle">Every logged outreach reason stays visible here.</p>
          </div>
        </div>
        <div class="lead-attempt-history-list">${leadAttemptHistoryRows}</div>
      </div>
    </section>
  `;

  return {
    title: lead.name || "Lead Profile",
    subtitle: profileSubtitleParts.join(" | "),
    showWaitingPanel: false,
    html: `
      <section class="view-block lead-profile-page-view lead-record-page${isDrawer ? " lead-profile-drawer-view" : ""}">
        ${
          isDrawer
            ? ""
            : `
              <div class="lead-profile-page-toolbar">
                <nav class="lead-profile-breadcrumb" aria-label="Lead breadcrumb">
                  <button type="button" class="lead-profile-breadcrumb-link" data-route="leads">Leads</button>
                  <span class="lead-profile-breadcrumb-separator" aria-hidden="true">/</span>
                  <span class="lead-profile-breadcrumb-current">${escapeHtml(lead.name || "Lead")}</span>
                </nav>
              </div>
            `
        }

        <section class="lead-profile-shell lead-profile-page-shell">
          <section class="lead-profile-head lead-profile-page-head lead-record-hero lead-record-hero-shell">
            <div class="lead-profile-identity">
              <span class="lead-profile-avatar">${escapeHtml(initialsFromLabel(lead.name || "Lead"))}</span>
              <div class="lead-profile-identity-meta">
                <p class="lead-profile-eyebrow">Lead</p>
                <div class="lead-record-header-title-row">
                  <h4>${escapeHtml(lead.name)}</h4>
                </div>
                ${leadInterestLineMarkup}
                <div class="lead-record-header-meta">${leadSummaryMarkup}</div>
              </div>
            </div>
            <div class="lead-profile-head-actions lead-record-header-actions">
              <button
                type="button"
                class="mini-btn mini-btn-primary"
                data-action="${primaryAction.action}"
                data-id="${lead.id}"
                ${primaryAction.disabled ? "disabled" : ""}
              >
                ${leadProfileActionLabel(primaryActionIcon, primaryAction.label)}
              </button>
              ${leadQuickActions}
              <details class="lead-profile-actions-menu">
                <summary aria-label="Lead actions">
                  <i class="bi bi-three-dots" aria-hidden="true"></i>
                </summary>
                <div class="lead-profile-actions-dropdown">
                  ${leadProfileMenuItem("lead-edit", lead.id, "Edit Lead", "bi-pencil-square")}
                  ${leadProfileMenuItem("lead-reassign-owner", lead.id, "Reassign Owner", "bi-person-gear")}
                  ${leadProfileMenuItem("lead-set-followup", lead.id, "Set Follow-up", "bi-calendar-event")}
                  ${leadProfileMenuItem("lead-create-followup-task", lead.id, "Create Task", "bi-check2-square")}
                  ${leadProfileMenuItem("lead-log-call", lead.id, "Log Call", "bi-telephone")}
                  ${leadProfileMenuItem(
                    "lead-log-attempt",
                    lead.id,
                    "Log Attempt",
                    "bi-check2-circle",
                    leadAttemptGuidance.disableLogging ? 'disabled title="This lead has reached the attempt limit and is ready for reassignment."' : ""
                  )}
                  ${leadProfileMenuItem("lead-schedule-call", lead.id, "Schedule Call", "bi-calendar-plus")}
                  ${leadProfileMenuItem("lead-create-callback", lead.id, "Create Callback", "bi-telephone-inbound")}
                  ${leadProfileMenuItem("lead-send-email", lead.id, "Send Email", "bi-envelope")}
                  ${leadProfileMenuItem("lead-add-note", lead.id, "Add Note", "bi-journal-plus")}
                  ${leadProfileMenuItem(
                    "lead-convert",
                    lead.id,
                    "Convert to Deal",
                    "bi-arrow-left-right",
                    `${canConvert ? "" : "disabled"} title="${canConvert ? "Convert this lead" : "Lead must be Qualified before conversion."}"`
                  )}
                  ${leadProfileMenuItem("lead-archive", lead.id, "Archive", "bi-archive")}
                  ${leadProfileDangerMenuItem("lead-delete", lead.id, "Delete", "bi-trash3")}
                </div>
              </details>
            </div>
          </section>

          <section class="lead-record-layout">
            <div class="lead-record-main">
              <section class="lead-profile-surface lead-record-surface lead-record-workspace">
                <section class="lead-record-block">
                  <div class="lead-record-section-head">
                    <div>
                      <p class="lead-profile-section-title">Activity</p>
                      <p class="lead-record-section-subtitle">Calls, emails, notes, and qualification changes.</p>
                    </div>
                    <div class="lead-profile-inline-actions">
                      <button type="button" class="mini-btn" data-action="lead-add-note" data-id="${lead.id}">${leadProfileActionLabel("bi-journal-plus", "Add Note")}</button>
                    </div>
                  </div>
                  <div class="lead-profile-timeline">${activityRows}</div>
                </section>

                <section class="lead-record-block">
                  <div class="lead-record-section-head">
                    <div>
                      <p class="lead-profile-section-title">Follow-up Tasks</p>
                      <p class="lead-record-section-subtitle">Upcoming work tied to this lead.</p>
                    </div>
                    <button type="button" class="mini-btn" data-action="lead-create-followup-task" data-id="${lead.id}">${leadProfileActionLabel("bi-check2-square", "Create Task")}</button>
                  </div>
                  <div class="lead-profile-list">${tasksRows}</div>
                </section>

                <section class="lead-record-block">
                  <div class="lead-record-section-head">
                    <div>
                      <p class="lead-profile-section-title">Communication</p>
                      <p class="lead-record-section-subtitle">Reach out, then log the outcome back into the timeline.</p>
                    </div>
                  </div>
                  <div class="lead-profile-inline-actions">
                    <button type="button" class="mini-btn" data-action="lead-log-call" data-id="${lead.id}">${leadProfileActionLabel("bi-telephone", "Log Call")}</button>
                    <button type="button" class="mini-btn" data-action="lead-schedule-call" data-id="${lead.id}">${leadProfileActionLabel("bi-calendar-plus", "Schedule Call")}</button>
                    <button type="button" class="mini-btn" data-action="lead-create-callback" data-id="${lead.id}">${leadProfileActionLabel("bi-telephone-inbound", "Callback")}</button>
                    <button type="button" class="mini-btn" data-action="lead-send-email" data-id="${lead.id}">${leadProfileActionLabel("bi-envelope", "Send Email")}</button>
                  </div>
                  ${primaryContactPanel}
                  <div class="lead-record-phone-panel">
                    <p class="lead-profile-section-title">Lead Phone Numbers</p>
                    ${leadProfilePhoneList(leadPhoneEntries, "lead-log-call", lead.id, "No lead phone numbers added yet.")}
                  </div>
                </section>
              </section>
            </div>

            <aside class="lead-record-side lead-record-side-stack">
              ${leadFocusPanel}
              ${leadAttemptPanel}

              <section class="lead-profile-surface lead-record-surface lead-record-side-panel">
                <div class="lead-record-section-head">
                  <div>
                    <p class="lead-profile-section-title">Lead Details</p>
                    <p class="lead-record-section-subtitle">Ownership, sourcing, and qualification context.</p>
                  </div>
                </div>
                <div class="lead-record-detail-list">
                  ${leadProfileDetailRow("bi-book", "Interest", interestLabel || "Not set")}
                  ${leadProfileDetailRow("bi-building", "Company", companyLabel || "Not linked")}
                  ${leadProfileDetailRow("bi-envelope", "Email", lead.email || "Not set")}
                  ${leadProfilePhoneDetailRow("bi-telephone", "Phone", leadPhoneEntries, lead.id)}
                  ${leadProfileDetailRow("bi-globe-americas", "Timezone", formatLeadPhoneTimezoneBucket(lead.phoneTimezoneBucket))}
                  ${leadProfileDetailRow("bi-broadcast-pin", "Source", lead.source || "n/a")}
                  ${leadProfileDetailRow("bi-person", "Owner", ownerLabel)}
                  ${leadProfileDetailRow("bi-flag", "Status", lead.status || "New")}
                  ${leadProfileDetailRow("bi-calendar3", "Next Follow-up", followUpLabel)}
                  ${leadProfileDetailRow("bi-diagram-3", "Account", accountLabel)}
                </div>
                <div class="lead-record-notes lead-record-side-notes">
                  <p class="lead-profile-section-title">Notes</p>
                  ${notesLabel}
                </div>
              </section>

              <section class="lead-profile-surface lead-record-surface lead-record-side-panel">
                <div class="lead-record-section-head">
                  <div>
                    <p class="lead-profile-section-title">Related Records</p>
                    <p class="lead-record-section-subtitle">Contacts and opportunities already linked.</p>
                  </div>
                </div>
                <div class="lead-record-related-block">
                  <p class="lead-profile-section-title">Contacts</p>
                  <div class="lead-profile-list">${contactsRows}</div>
                </div>
                <div class="lead-record-related-block">
                  <p class="lead-profile-section-title">Deals</p>
                  <div class="lead-profile-list">${relatedDealsRows}</div>
                </div>
              </section>
            </aside>
          </section>
        </section>
      </section>
    `
  };
}

export function renderAccountProfile(data, context) {
  const selectedAccountId = String(context.selectedAccountId || "").trim();
  const accountProfileData = context.accountProfileData || {};
  const profileAccount =
    String(accountProfileData.entityId || "").trim() === selectedAccountId &&
    accountProfileData.entity &&
    typeof accountProfileData.entity === "object"
      ? accountProfileData.entity
      : null;
  const account = profileAccount || (data.accounts || []).find((item) => item.id === selectedAccountId) || null;

  if (!account) {
    const directProfileLoading =
      String(accountProfileData.entityId || "").trim() === selectedAccountId && Boolean(accountProfileData.loading);
    const isLoadingProfile =
      Boolean(selectedAccountId) &&
      (directProfileLoading ||
        (!Boolean(accountProfileData.loaded) &&
          !String(accountProfileData.error || "").trim() &&
          (Boolean(context.crmSnapshotLoading) || !Boolean(context.crmSnapshotLoaded) || context.supabaseConfigured)));
    if (isLoadingProfile) {
      return {
        title: "Account Profile",
        subtitle: "Loading account details",
        showWaitingPanel: false,
        html: `
          <section class="view-block lead-profile-page-view">
            <section class="lead-profile-empty-state">
              <p class="lead-profile-eyebrow">Account</p>
              <h3>Loading account details</h3>
              <p class="lead-profile-list-meta">We’re fetching the latest account detail bundle for this view.</p>
            </section>
          </section>
        `
      };
    }
    return {
      title: "Account Profile",
      subtitle: String(accountProfileData.error || "").trim() && String(accountProfileData.error || "").trim() !== "not-found"
        ? "Account profile unavailable"
        : "Account record not found",
      showWaitingPanel: false,
      html: `
        <section class="view-block lead-profile-page-view">
          <section class="lead-profile-empty-state">
            <p class="lead-profile-eyebrow">Account</p>
            <h3>${escapeHtml(
              String(accountProfileData.error || "").trim() && String(accountProfileData.error || "").trim() !== "not-found"
                ? "Account profile unavailable"
                : "Account not found"
            )}</h3>
            <p class="lead-profile-list-meta">${escapeHtml(
              String(accountProfileData.error || "").trim() && String(accountProfileData.error || "").trim() !== "not-found"
                ? String(accountProfileData.error || "").trim()
                : "The selected account does not exist anymore or has been removed from the demo data."
            )}</p>
            <div class="lead-profile-page-actions">
              <button type="button" class="mini-btn" data-route="accounts">
                <i class="bi bi-arrow-left" aria-hidden="true"></i>
                <span>Back to Accounts</span>
              </button>
            </div>
          </section>
        </section>
      `
    };
  }

  const accountContext = buildAccountContext(data, account);
  const renewalLabel = account.renewalDate ? formatLeadProfileDate(account.renewalDate) : "Not set";
  const arrLabel = Number(account.arr || 0) > 0 ? formatCompactMoney(Number(account.arr || 0)) : "$0";
  const lastActivity = accountContext.activity[0] || null;
  const lastTouchLabel = lastActivity ? formatLeadProfileDateTime(lastActivity.createdAt) : "No activity yet";
  const contactsRows = accountContext.contacts.length
    ? accountContext.contacts.slice(0, 8).map((contact) => `
        <article class="lead-profile-list-row" data-contact-open="${escapeHtml(contact.id)}">
          <div class="lead-profile-list-main">
            <p class="lead-profile-list-title">${escapeHtml(contact.name || "Contact")}</p>
            <p class="lead-profile-list-meta">${escapeHtml(contact.role || "Contact")} | ${escapeHtml(contact.email || "No email")}</p>
          </div>
          <span class="lead-profile-list-side">${escapeHtml(contact.owner || "Unassigned")}</span>
        </article>
      `).join("")
    : "<p class='lead-profile-empty'>No contacts linked yet.</p>";
  const dealsRows = accountContext.deals.length
    ? accountContext.deals.slice(0, 10).map((deal) => `
        <article class="lead-profile-list-row" data-deal-open="${escapeHtml(deal.id)}">
          <div class="lead-profile-list-main">
            <p class="lead-profile-list-title">${escapeHtml(deal.name || "Deal")}</p>
            <p class="lead-profile-list-meta">${escapeHtml(getDealStageLabel(deal.stage || "Prospecting"))} | ${escapeHtml(deal.closeDate || "No close date")}</p>
          </div>
          <span class="${getDealValueClass(deal.value)}">${escapeHtml(formatDealValueLabel(deal.value))}</span>
        </article>
      `).join("")
    : "<p class='lead-profile-empty'>No deals linked yet.</p>";
  const tasksRows = accountContext.tasks.length
    ? accountContext.tasks.slice(0, 10).map((task) => `
        <article class="lead-profile-list-row lead-profile-task-row" data-task-open="${escapeHtml(task.id)}">
          <div class="lead-profile-list-main">
            <p class="lead-profile-list-title">${escapeHtml(task.title || "Task")}</p>
            <p class="lead-profile-list-meta">${escapeHtml(task.assignee || "Unassigned")} | ${escapeHtml(task.dueDate || "No due date")}</p>
          </div>
          <span class="status-chip status-${escapeHtml(String(task.status || "New").toLowerCase().replaceAll(" ", "-"))}">${escapeHtml(task.status || "New")}</span>
        </article>
      `).join("")
    : "<p class='lead-profile-empty'>No tasks linked yet.</p>";
  const activityRows = accountContext.activity.length
    ? accountContext.activity.map((item) => `
        <article class="lead-profile-timeline-item">
          <div class="lead-profile-timeline-head">
            <p class="lead-profile-list-title">${escapeHtml(item.label)}</p>
            <span class="lead-profile-list-side">${escapeHtml(formatLeadProfileDateTime(item.createdAt))}</span>
          </div>
          <p class="lead-profile-list-meta">${escapeHtml(item.actor || "System")}</p>
          <p class="lead-profile-list-body">${escapeHtml(item.text || "")}</p>
        </article>
      `).join("")
    : "<p class='lead-profile-empty'>No activity yet.</p>";
  const notesLabel = String(account.notes || "").trim()
    ? `<p class="lead-profile-list-body">${escapeHtml(account.notes)}</p>`
    : "<p class='lead-profile-empty'>No notes yet.</p>";

  return {
    title: account.name || "Account Profile",
    subtitle: `${account.industry || "Industry"} | ${account.owner || "Owner"}`,
    showWaitingPanel: false,
    html: `
      <section class="view-block lead-profile-page-view">
        <div class="lead-profile-page-toolbar">
          <button type="button" class="mini-btn" data-route="accounts">
            <i class="bi bi-arrow-left" aria-hidden="true"></i>
            <span>Back to Accounts</span>
          </button>
        </div>

        <section class="lead-profile-shell lead-profile-page-shell">
          <section class="lead-profile-head lead-profile-page-head lead-record-hero">
            <div class="lead-profile-head-top">
              <div class="lead-profile-identity">
                <span class="lead-profile-avatar">${escapeHtml(initialsFromLabel(account.name || "Account"))}</span>
                <div class="lead-profile-identity-meta">
                  <p class="lead-profile-eyebrow">Account</p>
                  <h4>${escapeHtml(account.name || "Account")}</h4>
                  <p class="lead-profile-subline">${escapeHtml(account.industry || "Industry")} | ${escapeHtml(account.health || "Healthy")}</p>
                </div>
              </div>
              <div class="lead-profile-head-actions">
                <button type="button" class="mini-btn mini-btn-primary" data-action="account-create-deal" data-id="${account.id}">Create Deal</button>
                <details class="lead-profile-actions-menu">
                  <summary aria-label="Account actions">
                    <i class="bi bi-three-dots" aria-hidden="true"></i>
                  </summary>
                  <div class="lead-profile-actions-dropdown">
                    <button type="button" class="lead-profile-actions-item" data-action="account-edit" data-id="${account.id}">Edit Account</button>
                    <button type="button" class="lead-profile-actions-item" data-action="account-log-call" data-id="${account.id}">Log Call</button>
                    <button type="button" class="lead-profile-actions-item" data-action="account-schedule-call" data-id="${account.id}">Schedule Call</button>
                    <button type="button" class="lead-profile-actions-item" data-action="account-create-callback" data-id="${account.id}">Create Callback</button>
                    <button type="button" class="lead-profile-actions-item" data-action="account-send-email" data-id="${account.id}">Send Email</button>
                    <button type="button" class="lead-profile-actions-item" data-action="account-create-followup-task" data-id="${account.id}">Create Task</button>
                    <button type="button" class="lead-profile-actions-item" data-action="account-add-note" data-id="${account.id}">Add Note</button>
                    <button type="button" class="lead-profile-actions-item" data-action="account-reassign-owner" data-id="${account.id}">Reassign Owner</button>
                    <button type="button" class="lead-profile-actions-item" data-action="account-archive" data-id="${account.id}">Archive</button>
                    <button type="button" class="lead-profile-actions-item is-danger" data-action="account-delete" data-id="${account.id}">Delete</button>
                  </div>
                </details>
              </div>
            </div>
            <div class="lead-profile-chip-row">
              <span class="status-chip">Owner: ${escapeHtml(account.owner || "Unassigned")}</span>
              <span class="status-chip">${escapeHtml(account.health || "Healthy")}</span>
              <span class="status-chip">Renewal: ${escapeHtml(renewalLabel)}</span>
              <span class="status-chip">Last touch: ${escapeHtml(lastTouchLabel)}</span>
            </div>
          </section>

          <section class="lead-record-summary-strip" aria-label="Account summary">
            <article class="lead-record-summary-item">
              <p class="lead-record-summary-label">Contacts</p>
              <p class="lead-record-summary-value">${accountContext.contacts.length}</p>
            </article>
            <article class="lead-record-summary-item">
              <p class="lead-record-summary-label">Open Deals</p>
              <p class="lead-record-summary-value">${accountContext.deals.length}</p>
            </article>
            <article class="lead-record-summary-item">
              <p class="lead-record-summary-label">ARR</p>
              <p class="lead-record-summary-text">${escapeHtml(arrLabel)}</p>
            </article>
            <article class="lead-record-summary-item">
              <p class="lead-record-summary-label">Renewal</p>
              <p class="lead-record-summary-text">${escapeHtml(renewalLabel)}</p>
            </article>
          </section>

          <section class="lead-record-layout">
            <div class="lead-record-main">
              <section class="lead-profile-surface lead-record-surface">
                <div class="lead-record-section-head">
                  <div>
                    <p class="lead-profile-section-title">Open Deals</p>
                    <p class="lead-record-section-subtitle">Active pipeline associated with this account</p>
                  </div>
                  <button type="button" class="mini-btn" data-action="account-create-deal" data-id="${account.id}">Create Deal</button>
                </div>
                <div class="lead-profile-list">${dealsRows}</div>
              </section>

              <section class="lead-profile-surface lead-record-surface">
                <div class="lead-record-section-head">
                  <div>
                    <p class="lead-profile-section-title">Activity</p>
                    <p class="lead-record-section-subtitle">Recent deal, task, and communication updates</p>
                  </div>
                  <div class="lead-profile-inline-actions">
                    <button type="button" class="mini-btn" data-action="account-log-call" data-id="${account.id}">Log Call</button>
                    <button type="button" class="mini-btn" data-action="account-schedule-call" data-id="${account.id}">Schedule Call</button>
                    <button type="button" class="mini-btn" data-action="account-create-callback" data-id="${account.id}">Callback</button>
                  </div>
                </div>
                <div class="lead-profile-timeline">${activityRows}</div>
              </section>

              <section class="lead-profile-surface lead-record-surface">
                <div class="lead-record-section-head">
                  <div>
                    <p class="lead-profile-section-title">Tasks</p>
                    <p class="lead-record-section-subtitle">Follow-up work across this account</p>
                  </div>
                  <button type="button" class="mini-btn" data-action="account-create-followup-task" data-id="${account.id}">Create Task</button>
                </div>
                <div class="lead-profile-list">${tasksRows}</div>
              </section>
            </div>

            <aside class="lead-record-side">
              <section class="lead-profile-surface lead-record-surface">
                <div class="lead-record-section-head">
                  <div>
                    <p class="lead-profile-section-title">Account Details</p>
                    <p class="lead-record-section-subtitle">Ownership, renewal, and company details</p>
                  </div>
                </div>
                <div class="lead-record-detail-list">
                  <div class="lead-record-detail"><span class="lead-record-detail-label">Industry</span><strong class="lead-record-detail-value">${escapeHtml(account.industry || "n/a")}</strong></div>
                  <div class="lead-record-detail"><span class="lead-record-detail-label">Owner</span><strong class="lead-record-detail-value">${escapeHtml(account.owner || "Unassigned")}</strong></div>
                  <div class="lead-record-detail"><span class="lead-record-detail-label">Health</span><strong class="lead-record-detail-value">${escapeHtml(account.health || "Healthy")}</strong></div>
                  <div class="lead-record-detail"><span class="lead-record-detail-label">Open Deals</span><strong class="lead-record-detail-value">${escapeHtml(String(account.openDeals ?? accountContext.deals.length))}</strong></div>
                  <div class="lead-record-detail"><span class="lead-record-detail-label">Website</span><strong class="lead-record-detail-value">${escapeHtml(account.website || "n/a")}</strong></div>
                  <div class="lead-record-detail"><span class="lead-record-detail-label">Company Size</span><strong class="lead-record-detail-value">${escapeHtml(account.companySize || "n/a")}</strong></div>
                </div>
                <div class="lead-record-notes">
                  <p class="lead-profile-section-title">Notes</p>
                  ${notesLabel}
                </div>
              </section>

              <section class="lead-profile-surface lead-record-surface">
                <div class="lead-record-section-head">
                  <div>
                    <p class="lead-profile-section-title">Contacts</p>
                    <p class="lead-record-section-subtitle">Primary stakeholders for this account</p>
                  </div>
                </div>
                ${
                  accountContext.primaryContact
                    ? `
                      <div class="lead-record-inline-meta">
                        <span>Primary contact</span>
                        <strong>${escapeHtml(accountContext.primaryContact.name)}</strong>
                        <span>${escapeHtml(accountContext.primaryContact.email || "No email")}</span>
                        <span>${escapeHtml(accountContext.primaryContact.phone || "No phone")}</span>
                      </div>
                    `
                    : ""
                }
                <div class="lead-profile-list">${contactsRows}</div>
              </section>
            </aside>
          </section>
        </section>
      </section>
    `
  };
}

export function renderDealProfile(data, context) {
  const selectedDealId = String(context.selectedDealId || "").trim();
  const dealProfileData = context.dealProfileData || {};
  const profileDeal =
    String(dealProfileData.entityId || "").trim() === selectedDealId &&
    dealProfileData.entity &&
    typeof dealProfileData.entity === "object"
      ? dealProfileData.entity
      : null;
  const deal = profileDeal || (data.deals || []).find((item) => item.id === selectedDealId) || null;

  if (!deal) {
    const directProfileLoading =
      String(dealProfileData.entityId || "").trim() === selectedDealId && Boolean(dealProfileData.loading);
    const isLoadingProfile =
      Boolean(selectedDealId) &&
      (directProfileLoading ||
        (!Boolean(dealProfileData.loaded) &&
          !String(dealProfileData.error || "").trim() &&
          (Boolean(context.crmSnapshotLoading) || !Boolean(context.crmSnapshotLoaded) || context.supabaseConfigured)));
    if (isLoadingProfile) {
      return {
        title: "Deal Profile",
        subtitle: "Loading deal details",
        showWaitingPanel: false,
        html: `
          <section class="view-block lead-profile-page-view">
            <section class="lead-profile-empty-state">
              <p class="lead-profile-eyebrow">Deal</p>
              <h3>Loading deal details</h3>
              <p class="lead-profile-list-meta">We’re fetching the latest deal detail bundle for this view.</p>
            </section>
          </section>
        `
      };
    }
    return {
      title: "Deal Profile",
      subtitle: String(dealProfileData.error || "").trim() && String(dealProfileData.error || "").trim() !== "not-found"
        ? "Deal profile unavailable"
        : "Deal record not found",
      showWaitingPanel: false,
      html: `
        <section class="view-block lead-profile-page-view">
          <section class="lead-profile-empty-state">
            <p class="lead-profile-eyebrow">Deal</p>
            <h3>${escapeHtml(
              String(dealProfileData.error || "").trim() && String(dealProfileData.error || "").trim() !== "not-found"
                ? "Deal profile unavailable"
                : "Deal not found"
            )}</h3>
            <p class="lead-profile-list-meta">${escapeHtml(
              String(dealProfileData.error || "").trim() && String(dealProfileData.error || "").trim() !== "not-found"
                ? String(dealProfileData.error || "").trim()
                : "The selected deal does not exist anymore or has been removed from the demo data."
            )}</p>
            <div class="lead-profile-page-actions">
              <button type="button" class="mini-btn" data-route="deals">
                <i class="bi bi-arrow-left" aria-hidden="true"></i>
                <span>Back to Deals</span>
              </button>
            </div>
          </section>
        </section>
      `
    };
  }

  const dealContext = buildDealContext(data, deal);
  const probability = dealProbability(deal.stage);
  const closeDateLabel = deal.closeDate ? formatLeadProfileDate(deal.closeDate) : "Not set";
  const stageLabel = getDealStageLabel(deal.stage || "Prospecting");
  const stageKey = getDealStageKey(deal.stage || "Prospecting");
  const lastActivity = dealContext.activity[0] || null;
  const lastTouchLabel = lastActivity ? formatLeadProfileDateTime(lastActivity.createdAt) : "No activity yet";
  const missingValue = !hasDealValue(deal.value);
  const valueLabel = formatDealValueLabel(deal.value);
  const primaryAction =
    stageKey === "Lost"
      ? { action: "deal-reopen", label: "Reopen Deal" }
      : stageKey === "Won"
        ? { action: "deal-create-followup-task", label: "Create Task" }
        : { action: "deal-next-stage", label: "Move to Next Stage" };
  const overflowActions = [
    ...(missingValue ? [{ action: "deal-set-value", label: "Set Value" }] : []),
    { action: "deal-edit", label: "Edit Deal" },
    { action: "deal-set-close-date", label: "Set Close Date" },
    { action: "deal-reassign-owner", label: "Reassign Owner" },
    { action: "deal-create-followup-task", label: "Create Task" },
    { action: "deal-schedule-call", label: "Schedule Call" },
    { action: "deal-create-callback", label: "Create Callback" },
    ...(stageKey === "Lost"
      ? [{ action: "deal-reopen", label: "Reopen Deal" }]
      : stageKey === "Won"
        ? []
        : [{ action: "deal-mark-lost", label: "Mark as Lost" }]),
    { action: "deal-delete", label: "Delete" }
  ];
  const contactsRows = dealContext.contacts.length
    ? dealContext.contacts.slice(0, 8).map((contact) => `
        <article class="lead-profile-list-row" data-contact-open="${escapeHtml(contact.id)}">
          <div class="lead-profile-list-main">
            <p class="lead-profile-list-title">${escapeHtml(contact.name || "Contact")}</p>
            <p class="lead-profile-list-meta">${escapeHtml(contact.role || "Contact")} | ${escapeHtml(contact.email || "No email")}</p>
          </div>
          <span class="lead-profile-list-side">${escapeHtml(contact.owner || "Unassigned")}</span>
        </article>
      `).join("")
    : "<p class='lead-profile-empty'>No contacts linked yet.</p>";
  const tasksRows = dealContext.tasks.length
    ? dealContext.tasks.slice(0, 10).map((task) => `
        <article class="lead-profile-list-row lead-profile-task-row" data-task-open="${escapeHtml(task.id)}">
          <div class="lead-profile-list-main">
            <p class="lead-profile-list-title">${escapeHtml(task.title || "Task")}</p>
            <p class="lead-profile-list-meta">${escapeHtml(task.assignee || "Unassigned")} | ${escapeHtml(task.dueDate || "No due date")}</p>
          </div>
          <span class="status-chip status-${escapeHtml(String(task.status || "New").toLowerCase().replaceAll(" ", "-"))}">${escapeHtml(task.status || "New")}</span>
        </article>
      `).join("")
    : "<p class='lead-profile-empty'>No tasks linked yet.</p>";
  const activityRows = dealContext.activity.length
    ? dealContext.activity.map((item) => `
        <article class="lead-profile-timeline-item">
          <div class="lead-profile-timeline-head">
            <p class="lead-profile-list-title">${escapeHtml(item.label)}</p>
            <span class="lead-profile-list-side">${escapeHtml(formatLeadProfileDateTime(item.createdAt))}</span>
          </div>
          <p class="lead-profile-list-meta">${escapeHtml(item.actor || "System")}</p>
          <p class="lead-profile-list-body">${escapeHtml(item.text || "")}</p>
        </article>
      `).join("")
    : "<p class='lead-profile-empty'>No activity yet.</p>";

  return {
    title: deal.name || "Deal Profile",
    subtitle: `${deal.account || "Account"} | ${stageLabel}`,
    showWaitingPanel: false,
    html: `
      <section class="view-block lead-profile-page-view">
        <div class="lead-profile-page-toolbar">
          <button type="button" class="mini-btn" data-route="deals">
            <i class="bi bi-arrow-left" aria-hidden="true"></i>
            <span>Back to Deals</span>
          </button>
        </div>

        <section class="lead-profile-shell lead-profile-page-shell">
          <section class="lead-profile-head lead-profile-page-head lead-record-hero">
            <div class="lead-profile-head-top">
              <div class="lead-profile-identity">
                <span class="lead-profile-avatar">${escapeHtml(initialsFromLabel(deal.name || "Deal"))}</span>
                <div class="lead-profile-identity-meta">
                  <p class="lead-profile-eyebrow">Deal</p>
                  <h4>${escapeHtml(deal.name || "Deal")}</h4>
                  <p class="lead-profile-subline">${escapeHtml(deal.account || "No account")} | ${escapeHtml(stageLabel)}</p>
                </div>
              </div>
              <div class="lead-profile-head-actions">
                <button type="button" class="mini-btn mini-btn-primary" data-action="${primaryAction.action}" data-id="${deal.id}">${primaryAction.label}</button>
                <details class="lead-profile-actions-menu">
                  <summary aria-label="Deal actions">
                    <i class="bi bi-three-dots" aria-hidden="true"></i>
                  </summary>
                  <div class="lead-profile-actions-dropdown">
                    ${overflowActions
                      .map(
                        (item) => `
                          <button type="button" class="lead-profile-actions-item" data-action="${item.action}" data-id="${deal.id}">${item.label}</button>
                        `
                      )
                      .join("")}
                  </div>
                </details>
              </div>
            </div>
            <div class="lead-profile-chip-row">
              <span class="status-chip ${dealStageClass(deal.stage)}">${escapeHtml(stageLabel)}</span>
              <span class="status-chip">Owner: ${escapeHtml(deal.owner || "Unassigned")}</span>
              <span class="status-chip">Closes: ${escapeHtml(closeDateLabel)}</span>
              <span class="status-chip">Last touch: ${escapeHtml(lastTouchLabel)}</span>
            </div>
          </section>

          ${
            missingValue
              ? `
                <section class="deal-value-callout" aria-label="Deal value missing">
                  <div>
                    <p class="deal-value-callout-title">Deal value not set yet</p>
                    <p class="deal-value-callout-copy">Forecast totals ignore this deal until you add a value.</p>
                  </div>
                  <button type="button" class="mini-btn mini-btn-primary" data-action="deal-set-value" data-id="${deal.id}">Set Value</button>
                </section>
              `
              : ""
          }

          <section class="lead-record-summary-strip" aria-label="Deal summary">
            <article class="lead-record-summary-item">
              <p class="lead-record-summary-label">Value</p>
              <p class="lead-record-summary-text ${getDealValueClass(deal.value)}">${escapeHtml(valueLabel)}</p>
            </article>
            <article class="lead-record-summary-item">
              <p class="lead-record-summary-label">Probability</p>
              <p class="lead-record-summary-value">${escapeHtml(String(probability))}%</p>
            </article>
            <article class="lead-record-summary-item">
              <p class="lead-record-summary-label">Contacts</p>
              <p class="lead-record-summary-value">${dealContext.contacts.length}</p>
            </article>
            <article class="lead-record-summary-item">
              <p class="lead-record-summary-label">Close Date</p>
              <p class="lead-record-summary-text">${escapeHtml(closeDateLabel)}</p>
            </article>
          </section>

          <section class="lead-record-layout">
            <div class="lead-record-main">
              <section class="lead-profile-surface lead-record-surface">
                <div class="lead-record-section-head">
                  <div>
                    <p class="lead-profile-section-title">Activity</p>
                    <p class="lead-record-section-subtitle">Stage changes, tasks, and communication updates</p>
                  </div>
                  <div class="lead-profile-inline-actions">
                    <button type="button" class="mini-btn" data-action="deal-create-followup-task" data-id="${deal.id}">Create Task</button>
                    <button type="button" class="mini-btn" data-action="deal-schedule-call" data-id="${deal.id}">Schedule Call</button>
                    <button type="button" class="mini-btn" data-action="deal-create-callback" data-id="${deal.id}">Callback</button>
                  </div>
                </div>
                <div class="lead-profile-timeline">${activityRows}</div>
              </section>

              <section class="lead-profile-surface lead-record-surface">
                <div class="lead-record-section-head">
                  <div>
                    <p class="lead-profile-section-title">Tasks</p>
                    <p class="lead-record-section-subtitle">Work items linked to this deal and account</p>
                  </div>
                  <button type="button" class="mini-btn" data-action="deal-create-followup-task" data-id="${deal.id}">Create Task</button>
                </div>
                <div class="lead-profile-list">${tasksRows}</div>
              </section>
            </div>

            <aside class="lead-record-side">
              <section class="lead-profile-surface lead-record-surface">
                <div class="lead-record-section-head">
                  <div>
                    <p class="lead-profile-section-title">Deal Details</p>
                    <p class="lead-record-section-subtitle">Current pipeline state and ownership</p>
                  </div>
                </div>
                <div class="lead-record-detail-list">
                  <div class="lead-record-detail"><span class="lead-record-detail-label">Account</span><strong class="lead-record-detail-value">${escapeHtml(deal.account || "Not linked")}</strong></div>
                  <div class="lead-record-detail"><span class="lead-record-detail-label">Stage</span><strong class="lead-record-detail-value">${escapeHtml(stageLabel)}</strong></div>
                  <div class="lead-record-detail"><span class="lead-record-detail-label">Value</span><strong class="lead-record-detail-value ${missingValue ? "deal-value-detail is-missing" : ""}">${escapeHtml(valueLabel)}</strong></div>
                  <div class="lead-record-detail"><span class="lead-record-detail-label">Probability</span><strong class="lead-record-detail-value">${escapeHtml(`${probability}%`)}</strong></div>
                  <div class="lead-record-detail"><span class="lead-record-detail-label">Close Date</span><strong class="lead-record-detail-value">${escapeHtml(closeDateLabel)}</strong></div>
                  <div class="lead-record-detail"><span class="lead-record-detail-label">Owner</span><strong class="lead-record-detail-value">${escapeHtml(deal.owner || "Unassigned")}</strong></div>
                </div>
              </section>

              <section class="lead-profile-surface lead-record-surface">
                <div class="lead-record-section-head">
                  <div>
                    <p class="lead-profile-section-title">Related People</p>
                    <p class="lead-record-section-subtitle">Account contacts supporting this opportunity</p>
                  </div>
                </div>
                ${
                  dealContext.account
                    ? `
                      <div class="lead-record-inline-meta">
                        <span>Account</span>
                        <strong>${escapeHtml(dealContext.account.name)}</strong>
                        <span>${escapeHtml(dealContext.account.industry || "n/a")}</span>
                      </div>
                    `
                    : ""
                }
                <div class="lead-profile-list">${contactsRows}</div>
              </section>
            </aside>
          </section>
        </section>
      </section>
    `
  };
}

export function renderContacts(data, context) {
  const routeId = "contacts";
  const showTableSkeleton = Boolean(context.crmTableLoading) && !(data.contacts || []).length;
  const rawSortKey = String(context.crmSortKey || "").trim();
  const sortDir = context.crmSortDir === "desc" ? "desc" : context.crmSortDir === "asc" ? "asc" : "none";
  const sortKey = Object.prototype.hasOwnProperty.call(CONTACT_SORTERS, rawSortKey) ? rawSortKey : "";
  const filtered = data.contacts
    .filter((contact) =>
      matchesSearch(
        [contact.name, contact.email, contact.phone, contact.account, contact.role, contact.owner],
        context.searchTerm
      )
    );
  const contactsWithContext = filtered.map((contact) => {
    const contactContext = getContactContext(data, contact, {
      normalizeForMatch,
      normalizePhoneValue: (value) => String(value || "").replace(/\D+/g, ""),
      parseIsoDateLocal: (value) => {
        const parsed = Date.parse(String(value || ""));
        return Number.isFinite(parsed) ? new Date(parsed) : null;
      },
      formatDealMoney: (value) => formatMoney(value),
      findDirectThreadByName: (name) => findDirectThreadByNameInData(data, name, normalizeForMatch)
    });
    return {
      ...contact,
        _ownerDisplay: resolveOwnerDisplayName(data, contact.owner, contact.ownerId),
      _lastTouchAt: contactContext.activity[0]?.createdAt || contact.updatedAt || contact.createdAt || ""
    };
  });
  const sortedRows = sortCrmRows(contactsWithContext, sortKey, sortDir, CONTACT_SORTERS);
  const pagination = buildCrmPagination(
    sortedRows.length,
    Number(context.crmPage || 1),
    normalizeCrmPageSize(context.crmPageSize, routeId)
  );
  const rows = showTableSkeleton
    ? renderContactSkeletonRows()
    : sortedRows
        .slice(pagination.startIndex, pagination.endIndex)
        .map(
          (contact) => `
            <tr class="crm-table-hover-row" data-contact-open="${contact.id}" data-card-menu="contact" data-id="${contact.id}">
              <td>${crmContactLeadCell(contact)}</td>
              <td>${crmPhoneCell(String(contact.phone || "").trim(), "contact-log-call", contact.id)}</td>
              <td>${escapeHtml(contact.account)}</td>
              <td>${escapeHtml(contact.role)}</td>
              <td><span class="crm-table-meta">${escapeHtml(formatLeadLastTouch(contact._lastTouchAt))}</span></td>
              <td class="crm-row-end-cell">
                <div class="crm-row-end-cell-inner">
                  <span class="crm-owner-text">${escapeHtml(contact._ownerDisplay || contact.owner)}</span>
                  <span class="crm-row-inline-actions row-actions row-actions-table">
                    ${tableActionMenu("More contact actions", contactMenuItems(contact))}
                  </span>
                </div>
              </td>
            </tr>
          `
        )
        .join("");

  return {
    title: "Contacts",
    subtitle: "People linked to accounts, leads, and deals",
    primaryAction: "Add Contact",
    showWaitingPanel: true,
    waitingTitle: "Recent Contacts",
    waitingSubtitle: "Most recently added",
    waitingItems: data.contacts.slice(0, 5).map((contact) => ({
      id: contact.id,
      title: contact.name,
      owner: resolveOwnerDisplayName(data, contact.owner, contact.ownerId),
      linkedType: contact.account
    })),
    html: `
      <section class="view-block crm-list-v2">
        ${viewSectionHead("Contact Directory", "Add Contact")}
        <div class="table-ops-wrap data-table-shell">
          <table class="data-table">
            <thead>
              <tr>
                <th>${crmHeaderSortButton("Contact", "name", sortKey, sortDir)}</th>
                <th>${crmHeaderSortButton("Phone", "phone", sortKey, sortDir)}</th>
                <th>${crmHeaderSortButton("Account", "account", sortKey, sortDir)}</th>
                <th>${crmHeaderSortButton("Role", "role", sortKey, sortDir)}</th>
                <th>${crmHeaderSortButton("Last Touch", "lastTouch", sortKey, sortDir)}</th>
                <th>${crmHeaderSortButton("Owner", "owner", sortKey, sortDir)}</th>
              </tr>
            </thead>
            <tbody>
              ${rows || "<tr><td colspan='6' class='task-meta'>No contacts found.</td></tr>"}
            </tbody>
          </table>
        </div>
        ${showTableSkeleton ? "" : renderCrmTableFooter(routeId, pagination, sortedRows.length)}
      </section>
    `
  };
}

export function renderAccounts(data, context) {
  const routeId = "accounts";
  const showTableSkeleton = Boolean(context.crmTableLoading) && !(data.accounts || []).length;
  const rawSortKey = String(context.crmSortKey || "").trim();
  const sortDir = context.crmSortDir === "desc" ? "desc" : context.crmSortDir === "asc" ? "asc" : "none";
  const sortKey = Object.prototype.hasOwnProperty.call(ACCOUNT_SORTERS, rawSortKey) ? rawSortKey : "";
  const filtered = data.accounts
    .filter((account) =>
      !account.archived &&
      matchesSearch(
        [account.name, account.industry, account.owner, String(account.openDeals), account.health],
        context.searchTerm
      )
    );
  const accountsWithContext = filtered.map((account) => {
    const accountContext = buildAccountContext(data, account);
    return {
      ...account,
      _lastActivityAt: accountContext.activity[0]?.createdAt || account.updatedAt || account.createdAt || "",
        _ownerDisplay: resolveOwnerDisplayName(data, account.owner, account.ownerId),
      _primaryContactLabel: accountContext.primaryContact?.name || "",
      _industryLabel: account.industry || ""
    };
  });
  const sortedRows = sortCrmRows(accountsWithContext, sortKey, sortDir, ACCOUNT_SORTERS);
  const pagination = buildCrmPagination(
    sortedRows.length,
    Number(context.crmPage || 1),
    normalizeCrmPageSize(context.crmPageSize, routeId)
  );
  const rows = showTableSkeleton
    ? renderAccountSkeletonRows()
    : sortedRows
        .slice(pagination.startIndex, pagination.endIndex)
        .map(
          (account) => `
            <tr class="crm-table-hover-row" data-account-open="${account.id}" data-card-menu="account" data-id="${account.id}">
              <td>${crmAvatarStackCell(account.name, account._primaryContactLabel || account._industryLabel || "No primary contact", "company")}</td>
              <td><span class="status-chip ${accountHealthClass(account.health)}">${escapeHtml(account.health)}</span></td>
              <td>${escapeHtml(account.openDeals)}</td>
              <td><span class="crm-table-meta">${escapeHtml(formatLeadLastTouch(account._lastActivityAt))}</span></td>
              <td class="crm-row-end-cell">
                <div class="crm-row-end-cell-inner">
                  <span class="crm-owner-text">${escapeHtml(account._ownerDisplay || account.owner)}</span>
                  <span class="crm-row-inline-actions row-actions row-actions-table">
                    ${tableActionMenu("More account actions", accountMenuItems(account))}
                  </span>
                </div>
              </td>
            </tr>
          `
        )
        .join("");

  return {
    title: "Accounts",
    subtitle: "Customer organizations and ownership",
    primaryAction: "Add Account",
    showWaitingPanel: false,
    html: `
      <section class="view-block crm-list-v2">
        ${viewSectionHead("Account Directory", "Add Account")}
        <div class="table-ops-wrap data-table-shell">
          <table class="data-table">
            <thead>
              <tr>
                <th>${crmHeaderSortButton("Account", "name", sortKey, sortDir)}</th>
                <th>${crmHeaderSortButton("Health", "health", sortKey, sortDir)}</th>
                <th>${crmHeaderSortButton("Open Deals", "openDeals", sortKey, sortDir)}</th>
                <th>${crmHeaderSortButton("Last Activity", "lastActivity", sortKey, sortDir)}</th>
                <th>${crmHeaderSortButton("Owner", "owner", sortKey, sortDir)}</th>
              </tr>
            </thead>
            <tbody>
              ${rows || "<tr><td colspan='5' class='task-meta'>No accounts found.</td></tr>"}
            </tbody>
          </table>
        </div>
        ${showTableSkeleton ? "" : renderCrmTableFooter(routeId, pagination, sortedRows.length)}
      </section>
    `
  };
}

export function renderDeals(data, context) {
  const routeId = "deals";
  const currentUserName = String(data.currentUser?.name || "").trim();
  const dealsView = String(context.dealsView || "table").toLowerCase() === "pipeline" ? "pipeline" : "table";
  const showTableSkeleton = dealsView === "table" && Boolean(context.crmTableLoading) && !(data.deals || []).length;
  const quickFilter = ["all", "mine", "month"].includes(String(context.dealsQuickFilter || "all"))
    ? String(context.dealsQuickFilter || "all")
    : "all";
  const stageFilter = String(context.dealsStageFilter || "all");
  const activeStageFilter = dealsView === "pipeline" ? "all" : stageFilter;
  const rawSortKey = String(context.crmSortKey || "").trim();
  const sortDir = context.crmSortDir === "desc" ? "desc" : context.crmSortDir === "asc" ? "asc" : "none";
  const sortKey = Object.prototype.hasOwnProperty.call(DEAL_SORTERS, rawSortKey) ? rawSortKey : "";

  const searchScopedDeals = (data.deals || []).filter((deal) =>
    matchesSearch(
      [deal.name, deal.contactName, deal.account, deal.stage, deal.owner, deal.closeDate, hasDealValue(deal.value) ? String(getDealValueNumber(deal.value)) : ""],
      context.searchTerm
    )
  );
  const quickScopedDeals = searchScopedDeals.filter((deal) => {
    if (quickFilter === "mine") {
      return dealOwnerMatchesCurrent(deal.owner, currentUserName);
    }
    if (quickFilter === "month") {
      const parsed = new Date(String(deal.closeDate || ""));
      if (Number.isNaN(parsed.valueOf())) {
        return false;
      }
      const now = new Date();
      return parsed.getFullYear() === now.getFullYear() && parsed.getMonth() === now.getMonth();
    }
    return true;
  }).map((deal) => ({
    ...deal,
        _ownerDisplay: resolveOwnerDisplayName(data, deal.owner, deal.ownerId)
  }));
  const visibleDeals = quickScopedDeals.filter((deal) => {
    if (activeStageFilter === "all") {
      return true;
    }
    return getDealStageKey(deal.stage) === activeStageFilter;
  });
  const sortedDeals = sortCrmRows(visibleDeals, sortKey, sortDir, DEAL_SORTERS);
  const pagination = buildCrmPagination(
    sortedDeals.length,
    Number(context.crmPage || 1),
    normalizeCrmPageSize(context.crmPageSize, routeId)
  );
  const visibleTableDeals = sortedDeals.slice(pagination.startIndex, pagination.endIndex);
  const pipelineDeals = [...visibleDeals].sort((a, b) => {
    const closeCompared = compareDateIso(a.closeDate, b.closeDate);
    if (closeCompared !== 0) {
      return closeCompared;
    }
    const valueCompared = compareNumber(b.value, a.value);
    if (valueCompared !== 0) {
      return valueCompared;
    }
    return compareText(a.name, b.name);
  });

  const rows = showTableSkeleton
    ? renderDealSkeletonRows()
    : visibleTableDeals
        .map((deal) => {
          const stageClass = dealStageClass(deal.stage);
          const valueClass = getDealValueClass(deal.value);
          return `
            <tr class="crm-table-hover-row" data-deal-open="${deal.id}" data-card-menu="deal" data-id="${deal.id}">
              <td>${escapeHtml(deal.name)}</td>
              <td>${escapeHtml(deal.contactName || "No contact")}</td>
              <td>${escapeHtml(deal.account)}</td>
              <td><span class="${valueClass}">${escapeHtml(formatDealValueLabel(deal.value))}</span></td>
              <td><span class="status-chip ${stageClass}">${escapeHtml(getDealStageLabel(deal.stage))}</span></td>
              <td>${escapeHtml(deal.closeDate)}</td>
              <td class="crm-row-end-cell">
                <div class="crm-row-end-cell-inner">
                  <span class="crm-owner-text">${escapeHtml(deal._ownerDisplay || deal.owner)}</span>
                  <span class="crm-row-inline-actions row-actions row-actions-table">
                    ${tableActionMenu("More deal actions", dealMenuItems(deal))}
                  </span>
                </div>
              </td>
            </tr>
          `;
        })
        .join("");

  const summaryMetrics = new Map(
    DEAL_STAGE_SUMMARY.map((stage) => [stage.id, { count: 0, value: 0, valuedCount: 0 }])
  );
  quickScopedDeals.forEach((deal) => {
    const stage = getDealStageKey(deal.stage);
    if (!summaryMetrics.has(stage)) {
      return;
    }
    const bucket = summaryMetrics.get(stage);
    bucket.count += 1;
    const numericValue = getDealValueNumber(deal.value);
    if (numericValue !== null) {
      bucket.value += numericValue;
      bucket.valuedCount += 1;
    }
  });
  const summaryCards = DEAL_STAGE_SUMMARY.map((stage) => {
    const summary = summaryMetrics.get(stage.id) || { count: 0, value: 0, valuedCount: 0 };
    const isActive = activeStageFilter === stage.id;
    const countLabel = `${summary.count} deal${summary.count === 1 ? "" : "s"}`;
    const unsetCount = Math.max(0, summary.count - summary.valuedCount);
    const valueLabel =
      summary.count === 0 ? "—" : summary.valuedCount > 0 ? formatDealCompactValueLabel(summary.value) : "Unset";
    const valueClass = summary.count === 0 ? "is-empty" : summary.valuedCount > 0 ? "" : "is-unset";
    const metaParts =
      summary.count === 0
        ? ["No deals yet"]
        : [countLabel, ...(unsetCount > 0 ? [`${unsetCount} unset`] : [])];
    return `
      <button
        type="button"
        class="deal-stage-card ${isActive ? "is-active" : ""}"
        data-action="deal-filter-stage"
        data-id="${stage.id}"
        role="tab"
        aria-selected="${isActive ? "true" : "false"}"
      >
        <div class="deal-stage-card-head">
          <span class="deal-stage-card-label">${escapeHtml(stage.label)}</span>
          <span class="deal-stage-card-count">${summary.count}</span>
        </div>
        <strong class="deal-stage-card-value ${valueClass}">${escapeHtml(valueLabel)}</strong>
        <small class="deal-stage-card-meta">${escapeHtml(metaParts.join(" • "))}</small>
      </button>
    `;
  }).join("");

  const stageCounts = new Map(DEAL_STAGE_SUMMARY.map((stage) => [stage.id, 0]));
  pipelineDeals.forEach((deal) => {
    const stage = getDealStageKey(deal.stage);
    stageCounts.set(stage, (stageCounts.get(stage) || 0) + 1);
  });
  const maxStageCount = Math.max(1, ...[...stageCounts.values()]);
  const pipelineColumns = DEAL_STAGE_SUMMARY.map((stage) => {
    const stageDeals = pipelineDeals.filter((deal) => getDealStageKey(deal.stage) === stage.id);
    const count = stageDeals.length;
    const trackWidth = count ? Math.max(12, Math.round((count / maxStageCount) * 100)) : 0;
    const cards = stageDeals
      .map((deal) => {
        const probability = dealProbability(deal.stage);
        return `
          <article
            class="deal-pipeline-card is-draggable"
            draggable="true"
            data-drag-type="deal-stage"
            data-id="${deal.id}"
            data-card-menu="deal"
            data-deal-open="${deal.id}"
          >
            <div class="deal-pipeline-card-head">
              <p class="deal-pipeline-card-title" title="${escapeHtml(deal.name)}">${escapeHtml(deal.name)}</p>
              <strong class="deal-pipeline-card-value ${!hasDealValue(deal.value) ? "is-empty" : ""}">${escapeHtml(formatDealValueLabel(deal.value))}</strong>
            </div>
            <p class="task-meta">${escapeHtml(deal.account)} | ${escapeHtml(deal._ownerDisplay || deal.owner)}</p>
            <div class="deal-pipeline-card-meta">
              <span>${escapeHtml(deal.closeDate || "-")}</span>
              <span>${escapeHtml(`${probability}%`)}</span>
            </div>
          </article>
        `;
      })
      .join("");

    return `
      <section
        class="deal-pipeline-column"
        data-drop-type="deal-stage"
        data-drop-value="${stage.id}"
      >
        <header class="deal-pipeline-column-head">
          <div class="deal-pipeline-column-row">
            <h4>${escapeHtml(stage.label)}</h4>
            <span>${count}</span>
          </div>
          <div class="deal-pipeline-column-track">${trackWidth ? `<span style="width:${trackWidth}%"></span>` : ""}</div>
        </header>
        <div class="deal-pipeline-column-list">
          ${cards || "<p class='task-meta'>No deals.</p>"}
        </div>
      </section>
    `;
  }).join("");

  return {
    title: "Deals",
    subtitle: "Pipeline summary and structured deal execution",
    primaryAction: "Add Deal",
    showWaitingPanel: false,
    html: `
      <section class="view-block crm-list-v2">
        <div class="team-section-head deal-section-head">
          <h3 class="block-title">Deal Pipeline</h3>
        </div>
        ${
          dealsView === "table"
            ? `
              <div class="deal-stage-summary" role="tablist" aria-label="Deal stage summary">
                ${summaryCards}
              </div>
            `
            : ""
        }
        <div class="deal-controls-row">
          <div class="deal-quick-filter-row">
            <button type="button" class="mini-btn ${quickFilter === "all" ? "is-active" : ""}" data-action="deal-filter-quick" data-id="all">All Deals</button>
            <button type="button" class="mini-btn ${quickFilter === "mine" ? "is-active" : ""}" data-action="deal-filter-quick" data-id="mine">My Deals</button>
            <button type="button" class="mini-btn ${quickFilter === "month" ? "is-active" : ""}" data-action="deal-filter-quick" data-id="month">This Month</button>
          </div>
          <div class="deal-controls-actions">
            <div class="team-view-toggle deal-view-toggle" role="tablist" aria-label="Deals view">
              <button
                type="button"
                class="team-view-toggle-btn ${dealsView === "table" ? "is-active" : ""}"
                data-action="deal-view"
                data-id="table"
                role="tab"
                aria-selected="${dealsView === "table" ? "true" : "false"}"
              >
                Table
              </button>
              <button
                type="button"
                class="team-view-toggle-btn ${dealsView === "pipeline" ? "is-active" : ""}"
                data-action="deal-view"
                data-id="pipeline"
                role="tab"
                aria-selected="${dealsView === "pipeline" ? "true" : "false"}"
              >
                Pipeline
              </button>
            </div>
            <button class="table-ops-columns-btn" type="button" data-action="view-add-record" data-id="create">
              <i class="bi bi-plus-lg" aria-hidden="true"></i>
              <span>Add Deal</span>
            </button>
          </div>
        </div>
        ${
          dealsView === "table"
            ? `
              <div class="table-ops-wrap data-table-shell">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>${crmHeaderSortButton("Deal", "name", sortKey, sortDir)}</th>
                      <th>${crmHeaderSortButton("Contact", "contact", sortKey, sortDir)}</th>
                      <th>${crmHeaderSortButton("Account", "account", sortKey, sortDir)}</th>
                      <th>${crmHeaderSortButton("Value", "value", sortKey, sortDir)}</th>
                      <th>${crmHeaderSortButton("Stage", "stage", sortKey, sortDir)}</th>
                      <th>${crmHeaderSortButton("Close Date", "closeDate", sortKey, sortDir)}</th>
                      <th>${crmHeaderSortButton("Owner", "owner", sortKey, sortDir)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rows || "<tr><td colspan='7' class='task-meta'>No deals found for this filter.</td></tr>"}
                  </tbody>
                </table>
              </div>
              ${showTableSkeleton ? "" : renderCrmTableFooter(routeId, pagination, sortedDeals.length)}
            `
            : `
              <div class="deal-pipeline-board">
                ${pipelineColumns}
              </div>
            `
        }
      </section>
    `
  };
}
