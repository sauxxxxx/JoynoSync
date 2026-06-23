import { conversationKey } from "../utils/conversations.js";
import { formatCompactMoney, formatMoney } from "../utils/format.js";
import { compareNumber, compareText } from "../utils/sort.js";
import { escapeHtml, matchesSearch, normalizeForMatch, phoneDigitsOnly } from "../utils/text.js";
import { tableActionMenu, viewSectionHead } from "../utils/ui.js";
import { canonicalTaskType, isCallTaskType, isCallbackTaskType } from "../modules/task-call.js";
import { canManageTeamMembersByRole, normalizeTeamMemberStatus } from "../modules/profile-core.js";
import { canTaskEditCore, canTaskUpdateProgress } from "../modules/task-rbac.js";
import { renderAttendanceUpgrade } from "./attendance-upgrade.js";

const CALLS_SCHEDULER_START_HOUR = 7;
const CALLS_SCHEDULER_END_HOUR = 19;
const CALLS_SCHEDULER_VISIBLE_DAYS = 5;
const CALLS_SCHEDULER_HOUR_HEIGHT = 56;
const CALLS_SCHEDULER_SLOT_MINUTES = 30;
const CALLS_PERFORMANCE_DAILY_TARGET = 30;
const CALLS_PERFORMANCE_OUTCOMES = ["Contacted", "Qualified", "Unqualified"];
const CALLS_PERFORMANCE_ACTIVITY_OUTCOMES = ["New", ...CALLS_PERFORMANCE_OUTCOMES];
let callsPerformanceEffectiveEventsMemo = {
  key: "",
  events: []
};
let dashboardCommandModelMemo = {
  key: "",
  model: null
};

const TEAM_SORTERS = {
  name: (a, b) => compareText(a.name, b.name),
  email: (a, b) => compareText(a.email, b.email),
  team: (a, b) => compareText(a.team, b.team),
  role: (a, b) => compareText(a.role, b.role),
  lastActive: (a, b) => compareNumber(teamLastActiveSortValue(a), teamLastActiveSortValue(b)),
  status: (a, b) => compareText(a.status, b.status)
};

function teamSortIconClass(sortKey, activeKey, sortDir) {
  if (sortKey !== activeKey || sortDir === "none") {
    return "bi-arrow-down-up";
  }
  return sortDir === "desc" ? "bi-sort-down" : "bi-sort-up";
}

function teamHeaderSortButton(label, sortKey, activeKey, sortDir) {
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
      <i class="bi ${teamSortIconClass(sortKey, activeKey, sortDir)}" aria-hidden="true"></i>
    </button>
  `;
}

function sortTeamRows(members, sortKey, sortDir) {
  if (!Object.prototype.hasOwnProperty.call(TEAM_SORTERS, sortKey) || sortDir === "none") {
    return members;
  }
  const direction = sortDir === "desc" ? -1 : 1;
  return [...members].sort((a, b) => TEAM_SORTERS[sortKey](a, b) * direction);
}

function formatLocalIsoDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatShortDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return String(value || "-");
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(date);
}

function parseCallsSchedulerIsoDate(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.valueOf()) ? null : date;
}

function addCallsSchedulerDays(date, count) {
  const next = new Date(date);
  next.setDate(next.getDate() + count);
  return next;
}

function getCallsSchedulerWeekStart(date) {
  const start = new Date(date);
  const currentDay = start.getDay();
  const delta = currentDay === 0 ? -6 : 1 - currentDay;
  start.setDate(start.getDate() + delta);
  start.setHours(0, 0, 0, 0);
  return start;
}

function parseCallsSchedulerMinutes(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return -1;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatCallsSchedulerTime(value) {
  const minutes = parseCallsSchedulerMinutes(value);
  if (minutes < 0) {
    return "";
  }
  const date = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60, 0, 0);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatCallsSchedulerRange(start, end) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  });
  return `${formatter.format(start)} - ${formatter.format(end)}`;
}

function callsSchedulerTaskMatchesOwner(task, memberId = "", memberName = "") {
  const normalizedMemberId = String(memberId || "").trim();
  const normalizedTaskAssigneeId = String(task?.assigneeId || "").trim();
  if (normalizedMemberId && normalizedTaskAssigneeId && normalizedMemberId === normalizedTaskAssigneeId) {
    return true;
  }
  const normalizedMemberName = String(memberName || "").trim().toLowerCase();
  const normalizedTaskAssigneeName = String(task?.assignee || "").trim().toLowerCase();
  return Boolean(normalizedMemberName) && normalizedMemberName === normalizedTaskAssigneeName;
}

function getCallsSchedulerOwnerName(data, ownerId = "") {
  const normalizedOwnerId = String(ownerId || "").trim();
  if (!normalizedOwnerId) {
    return "";
  }
  return String((data.teamMembers || []).find((member) => String(member?.id || "").trim() === normalizedOwnerId)?.name || "").trim();
}

function getCallsSchedulerDurationMinutes(task) {
  const start = parseCallsSchedulerMinutes(task?.startTime);
  const end = parseCallsSchedulerMinutes(task?.endTime);
  if (start >= 0 && end > start) {
    return end - start;
  }
  return isCallbackTaskType(task?.taskType) ? 30 : 45;
}

function getCallsSchedulerTasks(data, context) {
  const schedulerType = String(context.callsSchedulerType || "all").trim().toLowerCase();
  const scope = String(context.callsSchedulerScope || "mine").trim().toLowerCase();
  const selectedOwnerId = String(context.callsSchedulerOwnerId || "").trim();
  const currentUserId = String(data.currentUser?.id || "").trim();
  const currentUserName = String(data.currentUser?.name || "").trim();
  const selectedOwnerName = getCallsSchedulerOwnerName(data, selectedOwnerId);
  return (Array.isArray(data.tasks) ? data.tasks : [])
    .filter((task) => String(task?.status || "").trim() !== "Completed")
    .filter((task) => isCallTaskType(task?.taskType))
    .filter((task) => {
      const canonicalType = canonicalTaskType(task?.taskType, "Call").toLowerCase();
      if (schedulerType === "call") {
        return canonicalType === "call";
      }
      if (schedulerType === "callback") {
        return canonicalType === "callback";
      }
      return true;
    })
    .filter((task) => {
      if (scope === "team") {
        return selectedOwnerId ? callsSchedulerTaskMatchesOwner(task, selectedOwnerId, selectedOwnerName) : true;
      }
      return callsSchedulerTaskMatchesOwner(task, currentUserId, currentUserName);
    });
}

function getCallsSchedulerDayLayout(tasks, dateKey, windowMeta) {
  const sorted = tasks
    .map((task) => {
      const rawStartMinutes = getCallsSchedulerTaskRelativeStart(task, dateKey, windowMeta);
      if (rawStartMinutes < 0) {
        return null;
      }
      const rawEndMinutes = rawStartMinutes + getCallsSchedulerDurationMinutes(task);
      const startMinutes = Math.max(rawStartMinutes, windowMeta.startRelative);
      const endMinutes = Math.min(rawEndMinutes, windowMeta.endRelative);
      if (endMinutes <= startMinutes) {
        return null;
      }
      return {
        task,
        rawStartMinutes,
        startMinutes,
        endMinutes
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.rawStartMinutes !== right.rawStartMinutes) {
        return left.rawStartMinutes - right.rawStartMinutes;
      }
      return String(left?.task?.title || "").localeCompare(String(right?.task?.title || ""), undefined, { sensitivity: "base" });
    });
  const laneEnds = [];
  const laidOut = sorted.map((task) => {
    const startMinutes = task.startMinutes;
    const endMinutes = task.endMinutes;
    let laneIndex = laneEnds.findIndex((laneEnd) => startMinutes >= laneEnd);
    if (laneIndex === -1) {
      laneIndex = laneEnds.length;
      laneEnds.push(endMinutes);
    } else {
      laneEnds[laneIndex] = endMinutes;
    }
    return {
      task: task.task,
      startMinutes,
      endMinutes,
      laneIndex
    };
  });
  const laneCount = Math.max(laneEnds.length, 1);
  return laidOut.map((entry) => ({ ...entry, laneCount }));
}

function isCallsSchedulerQueuedTask(task) {
  return String(task?.backlogState || "").trim().toLowerCase() === "queue" || !String(task?.dueDate || "").trim();
}

function getCallsSchedulerVisibleMode(context) {
  const normalized = String(context.callsSchedulerMode || "").trim().toLowerCase();
  return ["day", "agenda"].includes(normalized) ? normalized : "week";
}

function getCallsSchedulerWindowMode(context) {
  const normalized = String(context.callsSchedulerWindow || "").trim().toLowerCase();
  return normalized === "full-day" ? "full-day" : "shift";
}

function getCallsSchedulerVisibleDates(context) {
  const selectedDate = parseCallsSchedulerIsoDate(context.callsSchedulerDate) || new Date();
  if (getCallsSchedulerVisibleMode(context) === "day") {
    return [selectedDate];
  }
  const weekStart = getCallsSchedulerWeekStart(selectedDate);
  return Array.from({ length: CALLS_SCHEDULER_VISIBLE_DAYS }, (_, index) => addCallsSchedulerDays(weekStart, index));
}

function getCallsSchedulerPolicy(data) {
  return {
    shiftStart: "09:00",
    shiftEnd: "18:00",
    timezone: "Local",
    ...(data?.attendancePolicy && typeof data.attendancePolicy === "object" ? data.attendancePolicy : {})
  };
}

function formatCallsSchedulerClockValue(totalMinutes) {
  const normalized = ((Math.floor(Number(totalMinutes || 0)) % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function getCallsSchedulerWindowMeta(data, context) {
  const policy = getCallsSchedulerPolicy(data);
  const timing = callsPerformanceShiftTiming(policy);
  const windowMode = getCallsSchedulerWindowMode(context);
  const usesShiftWindow =
    windowMode === "shift" && timing.shiftStartMinutes >= 0 && timing.shiftEndMinutes >= 0 && timing.durationMinutes > 0;
  const startRelative = usesShiftWindow ? timing.shiftStartMinutes : 0;
  const endRelative = usesShiftWindow
    ? timing.crossesMidnight
      ? timing.shiftEndMinutes + 1440
      : timing.shiftEndMinutes
    : 1440;
  const totalMinutes = Math.max(CALLS_SCHEDULER_SLOT_MINUTES, endRelative - startRelative || 1440);
  return {
    mode: windowMode,
    policy,
    timing,
    usesShiftWindow,
    startRelative,
    endRelative,
    totalMinutes,
    slotCount: Math.ceil(totalMinutes / CALLS_SCHEDULER_SLOT_MINUTES),
    boardHeight: Math.max(CALLS_SCHEDULER_HOUR_HEIGHT, Math.round((totalMinutes / 60) * CALLS_SCHEDULER_HOUR_HEIGHT))
  };
}

function getCallsSchedulerTaskDateKey(task, windowMeta) {
  const dueDate = String(task?.dueDate || "").trim();
  if (!dueDate) {
    return "";
  }
  if (!windowMeta?.usesShiftWindow || !windowMeta?.timing?.crossesMidnight) {
    return dueDate;
  }
  const startMinutes = parseCallsSchedulerMinutes(task?.startTime);
  if (startMinutes >= 0 && startMinutes < windowMeta.timing.shiftEndMinutes) {
    const previousDate = addCallsSchedulerDays(parseCallsSchedulerIsoDate(dueDate) || new Date(dueDate), -1);
    return formatLocalIsoDate(previousDate) || dueDate;
  }
  return dueDate;
}

function getCallsSchedulerTaskRelativeStart(task, dateKey, windowMeta) {
  const startMinutes = parseCallsSchedulerMinutes(task?.startTime);
  if (startMinutes < 0) {
    return -1;
  }
  const dueDate = String(task?.dueDate || "").trim();
  if (!windowMeta?.usesShiftWindow) {
    return dueDate === dateKey ? startMinutes : -1;
  }
  const taskDateKey = getCallsSchedulerTaskDateKey(task, windowMeta);
  if (taskDateKey !== dateKey) {
    return -1;
  }
  if (windowMeta.timing.crossesMidnight && dueDate && dueDate !== dateKey) {
    return startMinutes + 1440;
  }
  return startMinutes;
}

function getCallsSchedulerConflictIds(tasks, windowMeta) {
  const conflicts = new Set();
  const grouped = new Map();
  tasks.forEach((task) => {
    const assigneeKey = String(task?.assigneeId || task?.assignee || "unassigned").trim().toLowerCase();
    const dueDate = getCallsSchedulerTaskDateKey(task, windowMeta) || String(task?.dueDate || "").trim();
    const key = `${dueDate}:${assigneeKey}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(task);
  });
  grouped.forEach((items, groupKey) => {
    const dateKey = String(groupKey || "").split(":")[0] || "";
    const sorted = [...items].sort(
      (left, right) =>
        getCallsSchedulerTaskRelativeStart(left, dateKey, windowMeta) -
          getCallsSchedulerTaskRelativeStart(right, dateKey, windowMeta) ||
        compareText(left?.title || "", right?.title || "")
    );
    for (let index = 0; index < sorted.length; index += 1) {
      const current = sorted[index];
      const currentStart = getCallsSchedulerTaskRelativeStart(current, dateKey, windowMeta);
      const currentEnd = currentStart + getCallsSchedulerDurationMinutes(current);
      for (let compareIndex = index + 1; compareIndex < sorted.length; compareIndex += 1) {
        const next = sorted[compareIndex];
        const nextStart = getCallsSchedulerTaskRelativeStart(next, dateKey, windowMeta);
        if (nextStart >= currentEnd) {
          break;
        }
        conflicts.add(String(current?.id || ""));
        conflicts.add(String(next?.id || ""));
      }
    }
  });
  return conflicts;
}

function getCallsSchedulerPrimaryAction(task) {
  if (!canTaskUpdateProgress(task)) {
    return null;
  }
  if (String(task?.status || "").trim() === "In progress") {
    return {
      action: "task-mark-done",
      icon: "bi-check2-circle",
      label: "Done"
    };
  }
  return {
    action: "task-start",
    icon: "bi-play-circle",
    label: "Start"
  };
}

function renderCallsSchedulerQuickActions(task, options = {}) {
  const compact = Boolean(options.compact);
  const includePlan = Boolean(options.includePlan);
  const actions = [];
  if (includePlan && canTaskEditCore(task)) {
    actions.push({ action: "calls-scheduler-plan-existing", icon: "bi-calendar-plus", label: "Plan" });
  }
  const primary = getCallsSchedulerPrimaryAction(task);
  if (primary) {
    actions.push(primary);
  }
  if (canTaskEditCore(task)) {
    actions.push({ action: "task-edit", icon: "bi-pencil-square", label: "Edit" });
  }
  if (!actions.length) {
    return "";
  }
  return actions
    .map((actionItem) => {
      if (compact) {
        return `
          <button
            type="button"
            class="calls-scheduler-inline-action is-compact"
            data-action="${escapeHtml(actionItem.action)}"
            data-id="${escapeHtml(String(task?.id || ""))}"
            aria-label="${escapeHtml(actionItem.label)}"
            title="${escapeHtml(actionItem.label)}"
          >
            <i class="bi ${escapeHtml(actionItem.icon)}" aria-hidden="true"></i>
          </button>
        `;
      }
      return `
        <button
          type="button"
          class="calls-scheduler-inline-action"
          data-action="${escapeHtml(actionItem.action)}"
          data-id="${escapeHtml(String(task?.id || ""))}"
        >
          <i class="bi ${escapeHtml(actionItem.icon)}" aria-hidden="true"></i>
          <span>${escapeHtml(actionItem.label)}</span>
        </button>
      `;
    })
    .join("");
}

function renderCallsSchedulerEventCard(entry, conflictIds, windowMeta) {
  const startOffsetMinutes = Math.max(0, entry.startMinutes - windowMeta.startRelative);
  const top = Math.round((startOffsetMinutes / 60) * CALLS_SCHEDULER_HOUR_HEIGHT);
  const durationMinutes = Math.max(CALLS_SCHEDULER_SLOT_MINUTES, entry.endMinutes - entry.startMinutes);
  const height = Math.max(18, Math.round((durationMinutes / 60) * CALLS_SCHEDULER_HOUR_HEIGHT) - 2);
  const laneWidth = 100 / Math.max(entry.laneCount, 1);
  const leftPercent = laneWidth * entry.laneIndex;
  const widthPercent = laneWidth;
  const task = entry.task || {};
  const typeLabel = canonicalTaskType(task.taskType, "Call");
  const metaParts = [String(task.accountName || "").trim(), String(task.callPhone || "").trim()].filter(Boolean);
  const displayTitle = String(task.linkLabel || task.title || typeLabel).trim() || typeLabel;
  const ownerInitial = String(task.assignee || "?").trim().slice(0, 1).toUpperCase() || "?";
  const canEdit = canTaskEditCore(task);
  const dragAttrs = canEdit ? `draggable="true" data-drag-type="call-schedule" data-id="${escapeHtml(String(task.id || ""))}"` : "";
  const isConflict = conflictIds.has(String(task.id || ""));
  const isCompact = height < 38;
  const isTight = height >= 38 && height < 60;
  const compactActions = height >= 84 ? renderCallsSchedulerQuickActions(task, { compact: true }) : "";
  const timeLabel = formatCallsSchedulerTime(task.startTime);
  const compactLine = [timeLabel, displayTitle].filter(Boolean).join("  ");
  return `
    <article
      class="calls-scheduler-event tone-${typeLabel.toLowerCase()} ${canEdit ? "is-draggable" : ""} ${isConflict ? "is-conflict" : ""} ${isCompact ? "is-compact" : ""} ${isTight ? "is-tight" : ""}"
      data-task-open="${escapeHtml(String(task.id || "").trim())}"
      data-card-menu="task"
      data-id="${escapeHtml(String(task.id || "").trim())}"
      ${dragAttrs}
      style="top:${top}px;height:${height}px;left:calc(${leftPercent}% + 8px);width:calc(${widthPercent}% - 12px);"
    >
      ${
        isCompact
          ? `<p class="calls-scheduler-event-line">${escapeHtml(compactLine || displayTitle)}</p>`
          : `
            <p class="calls-scheduler-event-time">${escapeHtml(timeLabel)}</p>
            <p class="calls-scheduler-event-title">${escapeHtml(displayTitle)}</p>
            ${height >= 60 ? `<p class="calls-scheduler-event-meta">${escapeHtml(metaParts.join(" | ") || typeLabel)}</p>` : ""}
          `
      }
      ${isConflict ? `<span class="calls-scheduler-event-flag">Conflict</span>` : ""}
      ${height >= 40 ? `<span class="calls-scheduler-event-owner">${escapeHtml(ownerInitial)}</span>` : ""}
      ${compactActions ? `<div class="calls-scheduler-event-actions">${compactActions}</div>` : ""}
      ${
        canEdit
          ? `
            <button
              type="button"
              class="calls-scheduler-event-resize"
              draggable="true"
              data-drag-type="call-duration"
              data-id="${escapeHtml(String(task.id || ""))}"
              aria-label="Resize ${escapeHtml(displayTitle)}"
              title="Resize"
            ></button>
          `
          : ""
      }
    </article>
  `;
}

function renderCallsSchedulerDayColumn(date, scheduledTasks, conflictIds, windowMeta) {
  const iso = formatLocalIsoDate(date);
  const nextIso = formatLocalIsoDate(addCallsSchedulerDays(date, 1));
  const dayTasks = getCallsSchedulerDayLayout(
    scheduledTasks.filter((task) => getCallsSchedulerTaskDateKey(task, windowMeta) === iso),
    iso,
    windowMeta
  );
  const dayLabel = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date);
  const dateLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
  const slotButtons = Array.from(
    { length: windowMeta.slotCount },
    (_, index) => {
      const totalMinutes = windowMeta.startRelative + index * CALLS_SCHEDULER_SLOT_MINUTES;
      const slotTime = formatCallsSchedulerClockValue(totalMinutes);
      const slotIso = windowMeta.usesShiftWindow && windowMeta.timing.crossesMidnight && totalMinutes >= 1440 ? nextIso : iso;
      return `
        <button
          type="button"
          class="calls-scheduler-slot"
          data-action="calls-scheduler-slot"
          data-id="${slotIso}|${slotTime}"
          data-drop-type="call-schedule,call-duration"
          data-drop-value="${slotIso}|${slotTime}"
          data-slot-label="${escapeHtml(formatCallsSchedulerTime(slotTime) || slotTime)}"
          aria-label="Schedule on ${slotIso} at ${slotTime}"
          style="top:${(index * CALLS_SCHEDULER_HOUR_HEIGHT) / 2}px;height:${CALLS_SCHEDULER_HOUR_HEIGHT / 2}px;"
        ></button>
      `;
    }
  ).join("");
  const eventMarkup = dayTasks.map((entry) => renderCallsSchedulerEventCard(entry, conflictIds, windowMeta)).join("");
  return `
    <section class="calls-scheduler-day">
      <header class="calls-scheduler-day-head">
        <strong>${escapeHtml(dateLabel)}</strong>
        <span>${escapeHtml(dayLabel)}</span>
      </header>
      <div class="calls-scheduler-day-grid" style="min-height:${windowMeta.boardHeight}px;">
        ${slotButtons}
        ${eventMarkup}
      </div>
    </section>
  `;
}

function renderCallsSchedulerQueueCards(tasks) {
  if (!tasks.length) {
    return `<p class="task-meta">No unscheduled calls or callbacks.</p>`;
  }
  return tasks
    .map((task) => {
      const canEdit = canTaskEditCore(task);
      const dragAttrs = canEdit ? `draggable="true" data-drag-type="call-schedule" data-id="${escapeHtml(String(task.id || ""))}"` : "";
      const typeLabel = canonicalTaskType(task.taskType, "Call");
      const metaParts = [typeLabel, String(task.assignee || "").trim(), String(task.callPhone || "").trim()].filter(Boolean);
      return `
        <article
          class="calls-scheduler-queue-card ${canEdit ? "is-draggable" : ""}"
          data-task-open="${escapeHtml(String(task.id || ""))}"
          data-card-menu="task"
          data-id="${escapeHtml(String(task.id || ""))}"
          ${dragAttrs}
        >
          <div class="calls-scheduler-queue-copy">
            <p class="calls-scheduler-queue-title">${escapeHtml(String(task.linkLabel || task.title || typeLabel).trim() || typeLabel)}</p>
            <p class="calls-scheduler-queue-meta">${escapeHtml(metaParts.join(" | "))}</p>
          </div>
          <div class="calls-scheduler-queue-actions">
            ${renderCallsSchedulerQuickActions(task, { includePlan: true })}
          </div>
        </article>
      `;
    })
    .join("");
}

function renderCallsSchedulerAgenda(tasks, visibleDates, conflictIds, windowMeta) {
  return visibleDates
    .map((date) => {
      const iso = formatLocalIsoDate(date);
      const dayTasks = tasks
        .filter((task) => getCallsSchedulerTaskDateKey(task, windowMeta) === iso)
        .sort(
          (left, right) =>
            getCallsSchedulerTaskRelativeStart(left, iso, windowMeta) - getCallsSchedulerTaskRelativeStart(right, iso, windowMeta)
        );
      const heading = new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric"
      }).format(date);
      return `
        <section class="calls-scheduler-agenda-day">
          <header class="calls-scheduler-agenda-head">
            <h4>${escapeHtml(heading)}</h4>
            <span>${dayTasks.length}</span>
          </header>
          <div class="calls-scheduler-agenda-list">
            ${
              dayTasks.length
                ? dayTasks
                    .map((task) => {
                      const typeLabel = canonicalTaskType(task.taskType, "Call");
                      const isConflict = conflictIds.has(String(task.id || ""));
                      const metaParts = [String(task.accountName || "").trim(), String(task.callPhone || "").trim(), String(task.assignee || "").trim()].filter(Boolean);
                      return `
                        <article class="calls-scheduler-agenda-item ${isConflict ? "is-conflict" : ""}" data-task-open="${escapeHtml(String(task.id || ""))}" data-card-menu="task" data-id="${escapeHtml(String(task.id || ""))}">
                          <div class="calls-scheduler-agenda-time">
                            <strong>${escapeHtml(formatCallsSchedulerTime(task.startTime) || "Anytime")}</strong>
                            <span>${escapeHtml(typeLabel)}</span>
                          </div>
                          <div class="calls-scheduler-agenda-copy">
                            <p class="calls-scheduler-agenda-title">${escapeHtml(String(task.linkLabel || task.title || typeLabel).trim() || typeLabel)}</p>
                            <p class="calls-scheduler-agenda-meta">${escapeHtml(metaParts.join(" | "))}</p>
                          </div>
                          <div class="calls-scheduler-agenda-actions">
                            ${renderCallsSchedulerQuickActions(task)}
                          </div>
                        </article>
                      `;
                    })
                    .join("")
                : `<p class="task-meta">No scheduled calls for this day.</p>`
            }
          </div>
        </section>
      `;
    })
    .join("");
}

function renderCallsSchedulerView(data, context) {
  const schedulerMode = getCallsSchedulerVisibleMode(context);
  const visibleDates = getCallsSchedulerVisibleDates(context);
  const windowMeta = getCallsSchedulerWindowMeta(data, context);
  const selectedDate = visibleDates[0] || new Date();
  const visibleIsoSet = new Set(visibleDates.map((date) => formatLocalIsoDate(date)));
  const scopedTasks = getCallsSchedulerTasks(data, context);
  const scheduledTasks = scopedTasks
    .filter((task) => !isCallsSchedulerQueuedTask(task))
    .filter((task) => visibleIsoSet.has(getCallsSchedulerTaskDateKey(task, windowMeta)));
  const unscheduledTasks = scopedTasks
    .filter((task) => isCallsSchedulerQueuedTask(task))
    .sort((left, right) => compareText(left?.title || left?.linkLabel, right?.title || right?.linkLabel));
  const conflictIds = getCallsSchedulerConflictIds(scheduledTasks, windowMeta);
  const showSideRail = unscheduledTasks.length > 0;
  const ownerOptions = (Array.isArray(data.teamMembers) ? data.teamMembers : [])
    .filter((member) => String(member?.status || "").trim() === "Active")
    .sort((left, right) => compareText(left?.name, right?.name));
  const hourMarkers = Array.from({ length: Math.ceil(windowMeta.totalMinutes / 60) }, (_, index) => {
    const relativeMinutes = windowMeta.startRelative + index * 60;
    const labelDate = new Date(2000, 0, 1, 0, 0, 0, 0);
    const normalizedMinutes = ((relativeMinutes % 1440) + 1440) % 1440;
    labelDate.setHours(Math.floor(normalizedMinutes / 60), normalizedMinutes % 60, 0, 0);
    return {
      hour: relativeMinutes,
      label: new Intl.DateTimeFormat("en-US", { hour: "numeric" }).format(labelDate)
    };
  });
  const ownerOptionsMarkup = [
    `<option value="" ${String(context.callsSchedulerOwnerId || "").trim() ? "" : "selected"}>All owners</option>`,
    ...ownerOptions.map((member) => {
      const memberId = String(member?.id || "").trim();
      const selected = memberId === String(context.callsSchedulerOwnerId || "").trim() ? "selected" : "";
      return `<option value="${escapeHtml(memberId)}" ${selected}>${escapeHtml(String(member?.name || "Unknown").trim() || "Unknown")}</option>`;
    })
  ].join("");
  const rangeLabel =
    schedulerMode === "day"
      ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric" }).format(selectedDate)
      : formatCallsSchedulerRange(visibleDates[0], visibleDates[visibleDates.length - 1]);
  const dayColumnsMarkup = visibleDates.map((date) => renderCallsSchedulerDayColumn(date, scheduledTasks, conflictIds, windowMeta)).join("");
  const agendaMarkup = renderCallsSchedulerAgenda(scheduledTasks, visibleDates, conflictIds, windowMeta);

  return `
    <section class="calls-scheduler-shell">
      <header class="calls-scheduler-toolbar">
        <div class="calls-scheduler-toolbar-left">
          <div class="calls-scheduler-nav">
            <button type="button" class="mini-btn" data-action="calls-scheduler-today" data-id="today">Today</button>
            <button type="button" class="panel-toggle-btn" data-action="calls-scheduler-nav" data-id="prev" aria-label="Previous range">
              <i class="bi bi-chevron-left" aria-hidden="true"></i>
            </button>
            <button type="button" class="panel-toggle-btn" data-action="calls-scheduler-nav" data-id="next" aria-label="Next range">
              <i class="bi bi-chevron-right" aria-hidden="true"></i>
            </button>
            <strong>${escapeHtml(rangeLabel)}</strong>
          </div>
        </div>
        <div class="calls-scheduler-toolbar-right">
          <div class="calls-scheduler-toggle" role="tablist" aria-label="Scheduler mode">
            <button type="button" class="mini-btn ${schedulerMode === "week" ? "is-active" : ""}" data-action="calls-scheduler-mode" data-id="week">Week</button>
            <button type="button" class="mini-btn ${schedulerMode === "day" ? "is-active" : ""}" data-action="calls-scheduler-mode" data-id="day">Day</button>
            <button type="button" class="mini-btn ${schedulerMode === "agenda" ? "is-active" : ""}" data-action="calls-scheduler-mode" data-id="agenda">Agenda</button>
          </div>
          <div class="calls-scheduler-toggle" role="tablist" aria-label="Scheduler window">
            <button type="button" class="mini-btn ${windowMeta.mode === "shift" ? "is-active" : ""}" data-action="calls-scheduler-window" data-id="shift">Shift</button>
            <button type="button" class="mini-btn ${windowMeta.mode === "full-day" ? "is-active" : ""}" data-action="calls-scheduler-window" data-id="full-day">Full Day</button>
          </div>
          <div class="calls-scheduler-toggle" role="tablist" aria-label="Scheduler scope">
            <button type="button" class="mini-btn ${String(context.callsSchedulerScope || "mine") === "mine" ? "is-active" : ""}" data-action="calls-scheduler-scope" data-id="mine">Mine</button>
            <button type="button" class="mini-btn ${String(context.callsSchedulerScope || "") === "team" ? "is-active" : ""}" data-action="calls-scheduler-scope" data-id="team">Team</button>
          </div>
          <div class="calls-scheduler-toggle" role="tablist" aria-label="Call task type">
            <button type="button" class="mini-btn ${String(context.callsSchedulerType || "all") === "all" ? "is-active" : ""}" data-action="calls-scheduler-type" data-id="all">All</button>
            <button type="button" class="mini-btn ${String(context.callsSchedulerType || "") === "call" ? "is-active" : ""}" data-action="calls-scheduler-type" data-id="call">Calls</button>
            <button type="button" class="mini-btn ${String(context.callsSchedulerType || "") === "callback" ? "is-active" : ""}" data-action="calls-scheduler-type" data-id="callback">Callbacks</button>
          </div>
          <label class="calls-scheduler-owner-select">
            <select data-calls-scheduler-owner-select aria-label="Filter scheduler by owner">
              ${ownerOptionsMarkup}
            </select>
          </label>
          <button type="button" class="btn btn-accent" data-action="calls-scheduler-new" data-id="new">
            <i class="bi bi-calendar-plus" aria-hidden="true"></i>
            <span>Schedule Call</span>
          </button>
        </div>
      </header>
      <div class="calls-scheduler-main ${schedulerMode === "agenda" ? "is-agenda" : ""} ${showSideRail ? "" : "is-board-only"}">
        <section class="calls-scheduler-primary">
          ${
            schedulerMode === "agenda"
              ? `<section class="calls-scheduler-agenda">${agendaMarkup}</section>`
              : `
                <div class="calls-scheduler-board ${schedulerMode === "day" ? "is-day" : ""}">
                  <aside class="calls-scheduler-time-rail" aria-hidden="true">
                    <div class="calls-scheduler-time-rail-head"></div>
                    <div class="calls-scheduler-time-rail-body" style="min-height:${windowMeta.boardHeight}px;">
                      ${hourMarkers
                        .map(
                          (marker) => `
                            <span class="calls-scheduler-time-row">${escapeHtml(marker.label)}</span>
                          `
                        )
                        .join("")}
                    </div>
                  </aside>
                  <div class="calls-scheduler-grid ${schedulerMode === "day" ? "is-day" : ""}">
                    ${dayColumnsMarkup}
                  </div>
                </div>
              `
          }
        </section>
        ${
          showSideRail
            ? `
              <aside class="calls-scheduler-side">
                <section class="calls-scheduler-side-card">
                  <div class="calls-scheduler-side-head">
                    <div>
                      <h4>Unscheduled</h4>
                      <p>Drag these onto the board or plan them directly.</p>
                    </div>
                    <span>${unscheduledTasks.length}</span>
                  </div>
                  <div class="calls-scheduler-queue-list">
                    ${renderCallsSchedulerQueueCards(unscheduledTasks)}
                  </div>
                </section>
              </aside>
            `
            : ""
        }
      </div>
    </section>
  `;
}

function callsPerformanceDateObject(isoDate) {
  const parsed = parseCallsSchedulerIsoDate(isoDate);
  return parsed && !Number.isNaN(parsed.valueOf()) ? parsed : null;
}

function callsPerformanceIsoDate(date) {
  return formatLocalIsoDate(date instanceof Date ? date : new Date(date));
}

function callsPerformanceMonthStartIso(isoDate) {
  const date = callsPerformanceDateObject(isoDate) || new Date();
  date.setDate(1);
  return callsPerformanceIsoDate(date);
}

function callsPerformanceShiftMonthIso(isoDate, offset = 0) {
  const date = callsPerformanceDateObject(callsPerformanceMonthStartIso(isoDate)) || new Date();
  date.setMonth(date.getMonth() + Number(offset || 0), 1);
  return callsPerformanceIsoDate(date);
}

function callsPerformanceFormatMonthLabel(isoDate) {
  const date = callsPerformanceDateObject(isoDate) || new Date();
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(date);
}

function callsPerformanceBuildCalendarMeta(monthIso, selectedIso, todayIso) {
  const monthStart = callsPerformanceDateObject(callsPerformanceMonthStartIso(monthIso || todayIso));
  if (!monthStart) {
    return { label: "", cells: [] };
  }
  const gridStart = new Date(monthStart.getTime());
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());
  const cells = [];
  for (let index = 0; index < 42; index += 1) {
    const cellDate = new Date(gridStart.getTime());
    cellDate.setDate(gridStart.getDate() + index);
    const isoDate = callsPerformanceIsoDate(cellDate);
    cells.push({
      isoDate,
      label: String(cellDate.getDate()),
      isOutsideMonth: cellDate.getMonth() !== monthStart.getMonth(),
      isToday: isoDate === todayIso,
      isSelected: isoDate === selectedIso
    });
  }
  return {
    label: callsPerformanceFormatMonthLabel(monthStart),
    cells
  };
}

function callsPerformanceResolveWindow(rangeValue, selectedIso, todayIso) {
  const normalizedRange = String(rangeValue || "today").trim().toLowerCase();
  const anchor = callsPerformanceDateObject(selectedIso) || callsPerformanceDateObject(todayIso) || new Date();
  const start = new Date(anchor.getTime());
  const end = new Date(anchor.getTime());
  let label = "Today";

  if (normalizedRange === "week") {
    const weekday = start.getDay();
    const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
    start.setDate(start.getDate() + mondayOffset);
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 6);
    label = "This Week";
  } else if (normalizedRange === "month") {
    start.setDate(1);
    end.setMonth(start.getMonth() + 1, 0);
    label = "This Month";
  }

  return {
    range: ["today", "week", "month"].includes(normalizedRange) ? normalizedRange : "today",
    startIso: callsPerformanceIsoDate(start),
    endIso: callsPerformanceIsoDate(end),
    label
  };
}

function callsPerformanceRangeLabel(windowMeta) {
  if (!windowMeta?.startIso || !windowMeta?.endIso) {
    return "";
  }
  if (windowMeta.startIso === windowMeta.endIso) {
    return formatShortDate(windowMeta.startIso);
  }
  return `${formatShortDate(windowMeta.startIso)} - ${formatShortDate(windowMeta.endIso)}`;
}

function callsPerformanceShiftTiming(policy) {
  const shiftStartMinutes = attendanceTimeToMinutes(policy?.shiftStart);
  const shiftEndMinutes = attendanceTimeToMinutes(policy?.shiftEnd);
  const crossesMidnight =
    shiftStartMinutes >= 0 && shiftEndMinutes >= 0 && shiftEndMinutes < shiftStartMinutes;
  const durationMinutes =
    shiftStartMinutes < 0 || shiftEndMinutes < 0
      ? -1
      : shiftEndMinutes === shiftStartMinutes
        ? 0
        : crossesMidnight
          ? 1440 - shiftStartMinutes + shiftEndMinutes
          : shiftEndMinutes - shiftStartMinutes;
  return {
    shiftStartMinutes,
    shiftEndMinutes,
    crossesMidnight,
    durationMinutes
  };
}

function callsPerformanceShiftDateForInstant(value, policy, timeZone = attendanceResolvedTimeZone(policy)) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return "";
  }
  const parts = attendanceDateParts(date, timeZone);
  if (!parts) {
    return "";
  }
  const timing = callsPerformanceShiftTiming(policy);
  const localMinutes = parts.hour * 60 + parts.minute;
  if (timing.crossesMidnight && localMinutes >= 0 && localMinutes < timing.shiftEndMinutes) {
    const anchorParts = attendanceDateParts(new Date(date.getTime() - 12 * 60 * 60 * 1000), timeZone) || parts;
    return String(anchorParts?.isoDate || parts.isoDate || "");
  }
  return String(parts.isoDate || "");
}

function callsPerformanceShiftRelativeMinutesForInstant(value, policy, timeZone = attendanceResolvedTimeZone(policy)) {
  const parts = attendanceDateParts(value, timeZone);
  if (!parts) {
    return -1;
  }
  const timing = callsPerformanceShiftTiming(policy);
  const localMinutes = parts.hour * 60 + parts.minute;
  if (timing.crossesMidnight && localMinutes < timing.shiftStartMinutes) {
    return localMinutes + 1440;
  }
  return localMinutes;
}

function callsPerformanceShortTimeLabel(totalMinutes) {
  const normalized = ((Number(totalMinutes || 0) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  const suffix = hours >= 12 ? "p" : "a";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return minutes === 0 ? `${hour12}${suffix}` : `${hour12}:${String(minutes).padStart(2, "0")}${suffix}`;
}

function callsPerformanceEventTimeLabel(value, policy) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return "--";
  }
  const timeZone = attendanceResolvedTimeZone(policy);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone || undefined,
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function callsPerformanceEventSource(entry) {
  const meta = entry?.meta && typeof entry.meta === "object" ? entry.meta : {};
  return String(meta.source || entry?.source || "").trim().toLowerCase();
}

function isCallsPerformanceAttemptEvent(entry) {
  return ["lead-attempt-trigger", "lead-attempt-history", "lead-attempt-history-backfill"].includes(
    callsPerformanceEventSource(entry)
  );
}

function callsPerformanceAgentFirstName(value) {
  const fullName = String(value || "").trim();
  if (!fullName) {
    return "Agent";
  }
  return fullName.split(/\s+/)[0] || fullName;
}

function callsPerformanceAgentInitial(value) {
  return String(callsPerformanceAgentFirstName(value) || "A")
    .trim()
    .slice(0, 1)
    .toUpperCase() || "A";
}

function callsPerformanceLeadEvent(lead, teamMembersById) {
  const meta = lead?.meta && typeof lead.meta === "object" ? lead.meta : {};
  const status = String(meta.lastStatusChangedTo || lead?.status || "").trim();
  if (!CALLS_PERFORMANCE_ACTIVITY_OUTCOMES.includes(status)) {
    return null;
  }
  const timestamp = String(meta.lastStatusChangedAt || lead?.updatedAt || "").trim();
  if (!timestamp) {
    return null;
  }
  const memberId = String(meta.lastStatusChangedByMemberId || lead?.updatedById || "").trim();
  const member = memberId ? teamMembersById.get(memberId) || null : null;
  const department = String(member?.team || member?.department || "").trim();
  const agentName =
    String(member?.name || "").trim() ||
    String(meta.lastStatusChangedByName || lead?.updatedBy || lead?.owner || "Unassigned").trim() ||
    "Unassigned";
  return {
    id: String(lead?.id || "").trim(),
    leadId: String(lead?.id || "").trim(),
    leadName: String(lead?.name || "Lead").trim() || "Lead",
    outcome: status,
    occurredAt: timestamp,
    occurredDate: callsPerformanceIsoDate(timestamp),
    timeLabel: callsPerformanceEventTimeLabel(timestamp),
    agentId: memberId || "",
    agentName,
    department,
    direction: "Outbound"
  };
}

function callsPerformancePolicySignature(policy = {}) {
  return [
    policy?.shiftStart,
    policy?.shiftEnd,
    policy?.timezone,
    policy?.workdayStart,
    policy?.workdayEnd
  ]
    .map((value) => String(value || "").trim())
    .join("|");
}

function callsPerformanceTeamSignature(teamMembers = []) {
  return (Array.isArray(teamMembers) ? teamMembers : [])
    .map((member) =>
      [
        member?.id,
        member?.name,
        member?.team || member?.department,
        member?.avatarUrl
      ]
        .map((value) => String(value || "").trim())
        .join(":")
    )
    .join("|");
}

function callsPerformanceEventsSignature(events = [], performanceData = {}, policy = {}, teamMembers = []) {
  const list = Array.isArray(events) ? events : [];
  const first = list[0] || {};
  const last = list[list.length - 1] || {};
  return [
    performanceData?.queryKey,
    performanceData?.sourceKind,
    performanceData?.lastAttemptAt,
    list.length,
    first?.id,
    first?.leadId,
    first?.outcome,
    first?.occurredAt,
    last?.id,
    last?.leadId,
    last?.outcome,
    last?.occurredAt,
    callsPerformancePolicySignature(policy),
    callsPerformanceTeamSignature(teamMembers)
  ]
    .map((value) => String(value || "").trim())
    .join("::");
}

function callsPerformanceEffectiveShiftEvents(events, policy = null) {
  const performancePolicy = policy || {};
  const timeZone = attendanceResolvedTimeZone(performancePolicy);
  const latestEventsByLeadShift = new Map();
  const sequencedEvents = (Array.isArray(events) ? events : [])
    .map((entry, index) => {
      const occurredAt = String(entry?.occurredAt || "").trim();
      const outcome = String(entry?.outcome || "").trim();
      if (!occurredAt || !CALLS_PERFORMANCE_ACTIVITY_OUTCOMES.includes(outcome)) {
        return null;
      }
      const shiftDate = String(
        callsPerformanceShiftDateForInstant(occurredAt, performancePolicy, timeZone) || entry?.shiftDate || ""
      ).trim();
      const leadKey = String(entry?.leadId || "").trim() || String(entry?.leadName || "").trim().toLowerCase();
      if (!shiftDate || !leadKey) {
        return null;
      }
      return {
        ...entry,
        outcome,
        occurredAt,
        _timeMs: Date.parse(occurredAt) || 0,
        occurredDate: callsPerformanceIsoDate(occurredAt),
        shiftDate,
        timeLabel: callsPerformanceEventTimeLabel(occurredAt, performancePolicy),
        _sequence: index
      };
    })
    .filter(Boolean)
    .sort(
      (left, right) =>
        compareNumber(left?._timeMs, right?._timeMs) ||
        compareNumber(right?._sequence, left?._sequence)
    );
  sequencedEvents.forEach((entry) => {
    const leadKey = String(entry?.leadId || "").trim() || String(entry?.leadName || "").trim().toLowerCase();
    if (isCallsPerformanceAttemptEvent(entry)) {
      latestEventsByLeadShift.set(`${entry.shiftDate}:${leadKey}:attempt:${entry.id || entry._sequence}`, entry);
      return;
    }
    latestEventsByLeadShift.set(`${entry.shiftDate}:${leadKey}:status`, entry);
  });
  return [...latestEventsByLeadShift.values()]
    .filter((entry) => CALLS_PERFORMANCE_OUTCOMES.includes(String(entry?.outcome || "").trim()))
    .sort((left, right) => compareNumber(right?._timeMs, left?._timeMs));
}

function getCallsPerformanceEffectiveEvents(performanceEvents, performanceData, performancePolicy, teamMembersById, teamMembersByName, teamMembers) {
  const memoKey = callsPerformanceEventsSignature(performanceEvents, performanceData, performancePolicy, teamMembers);
  if (callsPerformanceEffectiveEventsMemo.key === memoKey) {
    return callsPerformanceEffectiveEventsMemo.events;
  }
  const rawEvents = (Array.isArray(performanceEvents) ? performanceEvents : [])
    .map((entry) => {
      const occurredAt = String(entry?.occurredAt || "").trim();
      const outcome = String(entry?.outcome || "").trim();
      if (!occurredAt || !CALLS_PERFORMANCE_ACTIVITY_OUTCOMES.includes(outcome)) {
        return null;
      }
      return {
        ...entry,
        occurredAt,
        _timeMs: Date.parse(occurredAt) || 0,
        occurredDate: callsPerformanceIsoDate(occurredAt),
        shiftDate: String(entry?.shiftDate || callsPerformanceShiftDateForInstant(occurredAt, performancePolicy) || "").trim(),
        timeLabel: callsPerformanceEventTimeLabel(occurredAt, performancePolicy),
        agentAvatarUrl: String(
          teamMembersById.get(String(entry?.agentId || "").trim())?.avatarUrl ||
            teamMembersByName.get(String(entry?.agentName || "").trim().toLowerCase())?.avatarUrl ||
            entry?.agentAvatarUrl ||
            ""
        ).trim()
      };
    })
    .filter(Boolean);
  const events = String(performanceData?.sourceKind || "").trim() === "shift-rpc"
    ? rawEvents
        .filter((entry) => CALLS_PERFORMANCE_OUTCOMES.includes(String(entry?.outcome || "").trim()))
        .sort((left, right) => compareNumber(right?._timeMs, left?._timeMs))
    : callsPerformanceEffectiveShiftEvents(rawEvents, performancePolicy);
  callsPerformanceEffectiveEventsMemo = {
    key: memoKey,
    events
  };
  return events;
}

function callsPerformanceFilterEventsByWindow(events, windowMeta, policy = null) {
  return (Array.isArray(events) ? events : []).filter((entry) => {
    const timeZone = attendanceResolvedTimeZone(policy || {});
    const shiftDate = String(
      entry?.shiftDate || callsPerformanceShiftDateForInstant(entry?.occurredAt, policy || {}, timeZone) || ""
    ).trim();
    return Boolean(shiftDate && shiftDate >= windowMeta.startIso && shiftDate <= windowMeta.endIso);
  });
}

function callsPerformanceOutcomeTone(outcome) {
  const normalized = String(outcome || "").trim().toLowerCase();
  if (normalized === "qualified") {
    return "outcome-connected";
  }
  if (normalized === "unqualified") {
    return "outcome-missed";
  }
  return "outcome-live";
}

function callsPerformanceSeriesTone(outcome) {
  const normalized = String(outcome || "").trim().toLowerCase();
  if (normalized === "qualified") {
    return "is-qualified";
  }
  if (normalized === "unqualified") {
    return "is-unqualified";
  }
  return "is-contacted";
}

function callsPerformanceTrendBuckets(windowMeta, policy = null) {
  if (!windowMeta?.startIso || !windowMeta?.endIso) {
    return [];
  }
  if (windowMeta.range === "today") {
    const timing = callsPerformanceShiftTiming(policy || {});
    if (timing.shiftStartMinutes >= 0 && timing.shiftEndMinutes >= 0 && timing.durationMinutes > 0) {
      const shiftStartRelative = timing.shiftStartMinutes;
      const shiftEndRelative = timing.crossesMidnight ? timing.shiftEndMinutes + 1440 : timing.shiftEndMinutes;
      const bucketCount = Math.max(1, Math.ceil((shiftEndRelative - shiftStartRelative) / 60));
      const labelStep = bucketCount > 12 ? 2 : 1;
      return Array.from({ length: bucketCount }, (_, index) => {
        const relativeMinutes = shiftStartRelative + index * 60;
        return {
          key: String(relativeMinutes),
          label: callsPerformanceShortTimeLabel(relativeMinutes),
          shortLabel: index % labelStep === 0 ? callsPerformanceShortTimeLabel(relativeMinutes) : "",
          values: {
            Contacted: 0,
            Qualified: 0,
            Unqualified: 0
          }
        };
      });
    }
    const buckets = Array.from({ length: 24 }, (_, hour) => ({
      key: String(hour),
      label: `${String(hour).padStart(2, "0")}:00`,
      shortLabel: [0, 4, 8, 12, 16, 20].includes(hour) ? callsPerformanceShortTimeLabel(hour * 60) : "",
      values: {
        Contacted: 0,
        Qualified: 0,
        Unqualified: 0
      }
    }));
    return buckets;
  }

  const points = [];
  const cursor = callsPerformanceDateObject(windowMeta.startIso);
  const endDate = callsPerformanceDateObject(windowMeta.endIso);
  if (!cursor || !endDate) {
    return [];
  }
  while (cursor <= endDate) {
    const isoDate = callsPerformanceIsoDate(cursor);
    const weekdayLabel = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(cursor);
    points.push({
      key: isoDate,
      label: formatShortDate(isoDate),
      shortLabel: windowMeta.range === "week" ? weekdayLabel : formatShortDate(isoDate),
      values: {
        Contacted: 0,
        Qualified: 0,
        Unqualified: 0
      }
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return points;
}

function callsPerformanceTrendDataset(events, windowMeta, policy = null) {
  const points = callsPerformanceTrendBuckets(windowMeta, policy);
  if (!points.length) {
    return {
      points: [],
      maxValue: 0,
      series: []
    };
  }
  const pointByKey = new Map(points.map((point) => [point.key, point]));
  (Array.isArray(events) ? events : []).forEach((entry) => {
    const outcome = String(entry?.outcome || "").trim();
    if (!CALLS_PERFORMANCE_OUTCOMES.includes(outcome)) {
      return;
    }
    let key = String(entry?.occurredDate || "").trim();
    if (windowMeta.range === "today") {
      const timing = callsPerformanceShiftTiming(policy || {});
      if (timing.shiftStartMinutes >= 0 && timing.shiftEndMinutes >= 0 && timing.durationMinutes > 0) {
        const relativeMinutes = callsPerformanceShiftRelativeMinutesForInstant(entry?.occurredAt || "", policy || {}, attendanceResolvedTimeZone(policy || {}));
        const shiftStartRelative = timing.shiftStartMinutes;
        const shiftEndRelative = timing.crossesMidnight ? timing.shiftEndMinutes + 1440 : timing.shiftEndMinutes;
        if (relativeMinutes < shiftStartRelative || relativeMinutes >= shiftEndRelative) {
          return;
        }
        const bucketIndex = Math.floor((relativeMinutes - shiftStartRelative) / 60);
        const resolvedPoint = points[Math.max(0, Math.min(points.length - 1, bucketIndex))];
        key = String(resolvedPoint?.key || "");
      } else {
        const date = new Date(entry?.occurredAt || "");
        if (Number.isNaN(date.valueOf())) {
          return;
        }
        key = String(date.getHours());
      }
    } else {
      key = String(entry?.shiftDate || entry?.occurredDate || "").trim();
    }
    const point = pointByKey.get(key);
    if (point) {
      point.values[outcome] = Number(point.values[outcome] || 0) + 1;
    }
  });
  const series = CALLS_PERFORMANCE_OUTCOMES.map((outcome) => ({
    key: outcome,
    label: outcome,
    tone: callsPerformanceSeriesTone(outcome)
  }));
  const maxValue = Math.max(
    1,
    ...points.flatMap((point) => CALLS_PERFORMANCE_OUTCOMES.map((outcome) => Number(point?.values?.[outcome] || 0)))
  );
  return { points, series, maxValue };
}

function normalizeCallsPerformanceTablePageSize(value) {
  const numeric = Number(value);
  return [10, 20, 50].includes(numeric) ? numeric : 10;
}

function buildCallsPerformanceTablePagination(totalRecords, page, pageSize) {
  const safePageSize = Math.max(1, normalizeCallsPerformanceTablePageSize(pageSize));
  const totalPages = Math.max(1, Math.ceil(Math.max(0, totalRecords) / safePageSize));
  const currentPage = Math.max(1, Math.min(Number(page) || 1, totalPages));
  const startIndex = totalRecords ? (currentPage - 1) * safePageSize : 0;
  const endIndex = Math.min(startIndex + safePageSize, totalRecords);
  return {
    page: currentPage,
    pageSize: safePageSize,
    totalPages,
    startIndex,
    endIndex,
    fromRecord: totalRecords ? startIndex + 1 : 0,
    toRecord: totalRecords ? endIndex : 0
  };
}

function renderCallsPerformanceTableFooter(pagination, totalRecords) {
  return `
    <footer class="table-ops-footer">
      <div class="table-ops-page-size">
        <span>Show</span>
        <button type="button" class="crm-page-size-trigger" data-action="calls-performance-table-page-size-menu">
          <span>${pagination.pageSize}</span>
          <i class="bi bi-chevron-down" aria-hidden="true"></i>
        </button>
        <span>records</span>
      </div>
      <p class="task-meta">Records ${pagination.fromRecord} to ${pagination.toRecord} of ${totalRecords}</p>
      <div class="table-ops-pages">
        <span>${pagination.totalPages} page${pagination.totalPages === 1 ? "" : "s"}</span>
        <button type="button" data-action="calls-performance-table-page" data-id="${pagination.page - 1}" ${pagination.page <= 1 ? "disabled" : ""}>
          <i class="bi bi-chevron-left" aria-hidden="true"></i>
        </button>
        <button type="button" data-action="calls-performance-table-page" data-id="${pagination.page}" disabled>${pagination.page}</button>
        <button type="button" data-action="calls-performance-table-page" data-id="${pagination.page + 1}" ${pagination.page >= pagination.totalPages ? "disabled" : ""}>
          <i class="bi bi-chevron-right" aria-hidden="true"></i>
        </button>
      </div>
    </footer>
  `;
}

function callsPerformanceBuildLinePath(coords) {
  return coords
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
}

function renderCallsPerformanceTrendChart(dataset, emptyLabel) {
  const points = Array.isArray(dataset?.points) ? dataset.points : [];
  const series = Array.isArray(dataset?.series) ? dataset.series : [];
  const maxValue = Math.max(1, Number(dataset?.maxValue || 0));
  const hasValues = points.some((point) =>
    CALLS_PERFORMANCE_OUTCOMES.some((outcome) => Number(point?.values?.[outcome] || 0) > 0)
  );
  if (!points.length || !series.length || !hasValues) {
    return `<div class="calls-performance-chart-empty">${escapeHtml(emptyLabel)}</div>`;
  }
  const width = 560;
  const height = 248;
  const paddingLeft = 44;
  const paddingRight = 18;
  const paddingTop = 18;
  const paddingBottom = 34;
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;
  const singlePoint = points.length === 1;
  const xStep = singlePoint ? 0 : chartWidth / Math.max(points.length - 1, 1);
  const yForValue = (value) => paddingTop + chartHeight - (Number(value || 0) / maxValue) * chartHeight;
  const renderedSeries = series.map((entry) => {
    const coords = points.map((point, index) => ({
      x: singlePoint ? paddingLeft + chartWidth / 2 : paddingLeft + xStep * index,
      y: yForValue(point?.values?.[entry.key] || 0),
      value: Number(point?.values?.[entry.key] || 0),
      key: String(point?.key || "")
    }));
    return {
      ...entry,
      path: callsPerformanceBuildLinePath(coords),
      points: coords
    };
  });
  const yTickValues = [1, 0.75, 0.5, 0.25, 0].map((ratio) => Math.round(maxValue * ratio));
  const gridlines = yTickValues
    .map((tickValue) => {
      const y = yForValue(tickValue);
      return `
        <line x1="${paddingLeft}" y1="${y.toFixed(2)}" x2="${(width - paddingRight).toFixed(2)}" y2="${y.toFixed(2)}" class="calls-performance-line-gridline"></line>
        <text x="${(paddingLeft - 10).toFixed(2)}" y="${(y + 3).toFixed(2)}" text-anchor="end" class="calls-performance-line-y-label">${escapeHtml(String(tickValue))}</text>
      `;
    })
    .join("");
  return `
    <div class="calls-performance-line-chart">
      <div class="calls-performance-legend">
        ${series
          .map(
            (entry) => `
              <span class="calls-performance-legend-item">
                <span class="calls-performance-legend-swatch ${entry.tone}"></span>
                <span>${escapeHtml(entry.label)}</span>
              </span>
            `
          )
          .join("")}
      </div>
      <svg class="calls-performance-line-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
        <rect
          x="${paddingLeft}"
          y="${paddingTop}"
          width="${chartWidth}"
          height="${chartHeight}"
          rx="10"
          class="calls-performance-line-frame"
        ></rect>
        ${gridlines}
        <line x1="${paddingLeft}" y1="${(height - paddingBottom).toFixed(2)}" x2="${(width - paddingRight).toFixed(2)}" y2="${(height - paddingBottom).toFixed(2)}" class="calls-performance-line-baseline"></line>
        ${renderedSeries
          .map(
            (entry) => `
              <path d="${escapeHtml(entry.path)}" class="calls-performance-line-path ${entry.tone}"></path>
              ${entry.points
                .map(
                  (point) => `
                    <circle
                      cx="${point.x.toFixed(2)}"
                      cy="${point.y.toFixed(2)}"
                      r="3.5"
                      class="calls-performance-line-point ${entry.tone}"
                    ></circle>
                  `
                )
                .join("")}
            `
          )
          .join("")}
      </svg>
      <div class="calls-performance-line-axis" style="grid-template-columns:repeat(${points.length}, minmax(0, 1fr));">
        ${points
          .map(
            (point) => `
              <span title="${escapeHtml(point.label || point.shortLabel || "")}">${escapeHtml(point.shortLabel || "")}</span>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderCallsPerformanceAgentChart(agentRows, options = {}) {
  const rows = Array.isArray(agentRows) ? agentRows : [];
  const emptyLabel = String(options.emptyLabel || "No agent activity to compare yet.");
  if (!rows.length || !rows.some((row) => Number(row?.total || 0) > 0)) {
    return `<div class="calls-performance-chart-empty">${escapeHtml(emptyLabel)}</div>`;
  }
  const maxValue = Math.max(...rows.map((row) => Number(row?.total || 0)), 1);
  const donutPercent = Math.max(0, Math.min(100, Number(options.donutPercent || 0)));
  const donutPrimary = Math.max(0, Math.min(100, Number(options.donutPrimary || 0)));
  const donutSecondary = Math.max(0, Math.min(100, 100 - donutPrimary));
  const donutStyle = `background: conic-gradient(var(--calls-performance-donut-primary) 0 ${donutPrimary}%, var(--calls-performance-donut-secondary) ${donutPrimary}% 100%);`;
  return `
    <div class="calls-performance-agent-split">
      <div class="calls-performance-agent-metric">
        <div class="calls-performance-legend">
          <span class="calls-performance-legend-item">
            <span class="calls-performance-legend-swatch is-contacted"></span>
            <span>Contacted</span>
          </span>
          <span class="calls-performance-legend-item">
            <span class="calls-performance-legend-swatch is-qualified"></span>
            <span>Qualified</span>
          </span>
          <span class="calls-performance-legend-item">
            <span class="calls-performance-legend-swatch is-unqualified"></span>
            <span>Unqualified</span>
          </span>
        </div>
        <div class="calls-performance-agent-bars">
          ${rows
            .map((row) => {
              const total = Number(row?.total || 0);
              const totalHeight = maxValue > 0 ? Math.max(12, Math.round((total / maxValue) * 100)) : 12;
              const contactedShare = total > 0 ? (Number(row?.contacted || 0) / total) * 100 : 0;
              const qualifiedShare = total > 0 ? (Number(row?.qualified || 0) / total) * 100 : 0;
              const unqualifiedShare = total > 0 ? (Number(row?.unqualified || 0) / total) * 100 : 0;
              const shortName = String(row?.name || "Agent").trim().split(/\s+/)[0] || "Agent";
              const tooltip = `${row.name || "Agent"} · Contacted ${row.contacted || 0}, Qualified ${row.qualified || 0}, Unqualified ${row.unqualified || 0}`;
              return `
                <div class="calls-performance-agent-column" title="${escapeHtml(tooltip)}">
                  <div class="calls-performance-agent-stack-shell">
                    <div class="calls-performance-agent-stack" style="height:${totalHeight}%">
                      ${
                        Number(row?.contacted || 0) > 0
                          ? `<span class="calls-performance-agent-segment is-contacted" style="height:${Math.max(8, contactedShare)}%"></span>`
                          : ""
                      }
                      ${
                        Number(row?.qualified || 0) > 0
                          ? `<span class="calls-performance-agent-segment is-qualified" style="height:${Math.max(8, qualifiedShare)}%"></span>`
                          : ""
                      }
                      ${
                        Number(row?.unqualified || 0) > 0
                          ? `<span class="calls-performance-agent-segment is-unqualified" style="height:${Math.max(8, unqualifiedShare)}%"></span>`
                          : ""
                      }
                    </div>
                  </div>
                  <strong>${escapeHtml(shortName)}</strong>
                  <small>${escapeHtml(String(total))}</small>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
      <div class="calls-performance-donut-card">
        <p class="task-title">${escapeHtml(String(options.donutTitle || "Quota Hit Rate"))}</p>
        <div class="calls-performance-donut-shell">
          <div class="calls-performance-donut" style="${donutStyle}">
            <div class="calls-performance-donut-center">
              <strong>${escapeHtml(`${donutPercent}%`)}</strong>
              <span>${escapeHtml(String(options.donutCenterLabel || "hit"))}</span>
            </div>
          </div>
        </div>
        <div class="calls-performance-donut-legend">
          <span class="calls-performance-legend-item">
            <span class="calls-performance-legend-swatch is-hit"></span>
            <span>${escapeHtml(String(options.donutPrimaryLabel || "Hit target"))}</span>
          </span>
          <span class="calls-performance-legend-item">
            <span class="calls-performance-legend-swatch is-remaining"></span>
            <span>${escapeHtml(String(options.donutSecondaryLabel || "Below target"))}</span>
          </span>
        </div>
      </div>
    </div>
  `;
}

function renderCallsPerformanceAgentDonutChart(agentRows, options = {}) {
  const rows = Array.isArray(agentRows) ? agentRows : [];
  const emptyLabel = String(options.emptyLabel || "No agent activity to compare yet.");
  const contactedRows = rows
    .filter((row) => Number(row?.contacted || 0) > 0)
    .sort((left, right) => compareNumber(right?.contacted, left?.contacted) || compareText(left?.name, right?.name));
  if (!contactedRows.length) {
    return `<div class="calls-performance-chart-empty">${escapeHtml(emptyLabel)}</div>`;
  }
  const palette = ["#4b90f1", "#5ac28d", "#ef6f6c", "#f1b24a", "#8a6df1", "#3fc3c9"];
  const totalContacted = Math.max(1, contactedRows.reduce((sum, row) => sum + Number(row?.contacted || 0), 0));
  const topRows = contactedRows.slice(0, 6).map((row, index) => ({
    ...row,
    color: palette[index % palette.length]
  }));
  const extraTotal = contactedRows.slice(6).reduce((sum, row) => sum + Number(row?.contacted || 0), 0);
  const donutRows = extraTotal > 0
    ? [...topRows, { id: "others", name: "Others", contacted: extraTotal, color: "#d6e0ec" }]
    : topRows;
  let cursor = 0;
  const donutStops = donutRows
    .map((row) => {
      const share = (Number(row?.contacted || 0) / totalContacted) * 100;
      const start = cursor;
      const end = cursor + share;
      cursor = end;
      return `${row.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
    })
    .join(", ");
  const donutStyle = `background: conic-gradient(${donutStops});`;
  return `
    <div class="calls-performance-agent-donut-layout">
      <div class="calls-performance-donut-card is-agent-share">
        <p class="task-title">${escapeHtml(String(options.donutTitle || "Contacted by Agent"))}</p>
        <div class="calls-performance-donut-shell">
          <div class="calls-performance-donut is-agent-share" style="${donutStyle}">
            <div class="calls-performance-donut-center is-agent-share">
              <strong>${escapeHtml(String(totalContacted))}</strong>
              <span>${escapeHtml(String(options.donutCenterLabel || "Contacted"))}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="calls-performance-agent-list">
        ${donutRows
          .map((row) => {
            const share = totalContacted > 0 ? Math.round((Number(row?.contacted || 0) / totalContacted) * 100) : 0;
            return `
              <div class="calls-performance-agent-list-row">
                <span class="calls-performance-agent-list-name">
                  <span class="calls-performance-agent-list-swatch" style="background:${escapeHtml(row.color)}"></span>
                  <span>${escapeHtml(String(row?.name || "Agent"))}</span>
                </span>
                <span class="calls-performance-agent-list-metric">${escapeHtml(String(row?.contacted || 0))}</span>
                <span class="calls-performance-agent-list-share">${escapeHtml(`${share}%`)}</span>
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function getCallsPerformanceAgentChartMeta(agentRows, selectedAgentId = "") {
  const rows = Array.isArray(agentRows) ? agentRows : [];
  const selectedAgent = selectedAgentId
    ? rows.find((row) => String(row?.id || "").trim() === String(selectedAgentId || "").trim()) || null
    : null;
  const agentsHitTarget = rows.filter((row) => Number(row?.contacted || 0) >= CALLS_PERFORMANCE_DAILY_TARGET).length;
  const remainingToTarget = selectedAgent
    ? Math.max(0, CALLS_PERFORMANCE_DAILY_TARGET - Number(selectedAgent?.contacted || 0))
    : rows.reduce((sum, row) => sum + Math.max(0, CALLS_PERFORMANCE_DAILY_TARGET - Number(row?.contacted || 0)), 0);
  const quotaValue = selectedAgent
    ? `${Math.min(Number(selectedAgent?.contacted || 0), CALLS_PERFORMANCE_DAILY_TARGET)}/${CALLS_PERFORMANCE_DAILY_TARGET}`
    : `${agentsHitTarget}/${Math.max(rows.length, 1)}`;
  return {
    selectedAgent,
    remainingToTarget,
    quotaValue,
    quotaLabel: selectedAgent ? "Quota Progress" : "Agents Hit Target"
  };
}

function buildCallsPerformanceAgentRows(events, availableAgents) {
  const baseRows = (Array.isArray(availableAgents) ? availableAgents : []).map((member) => ({
    id: String(member?.id || "").trim(),
    name: String(member?.name || "Agent").trim() || "Agent",
    contacted: 0,
    qualified: 0,
    unqualified: 0,
    total: 0
  }));
  const rowMap = new Map(baseRows.map((row) => [row.id || row.name, row]));
  (Array.isArray(events) ? events : []).forEach((entry) => {
    const key = String(entry?.agentId || "").trim() || String(entry?.agentName || "").trim();
    if (!key) {
      return;
    }
    const existing = rowMap.get(key);
    if (!existing) {
      rowMap.set(key, {
        id: String(entry?.agentId || "").trim(),
        name: String(entry?.agentName || "Agent").trim() || "Agent",
        contacted: 0,
        qualified: 0,
        unqualified: 0,
        total: 0
      });
    }
    const row = rowMap.get(key);
    if (!row) {
      return;
    }
    const normalizedOutcome = String(entry?.outcome || "").trim().toLowerCase();
    if (normalizedOutcome === "qualified") {
      row.qualified += 1;
    } else if (normalizedOutcome === "unqualified") {
      row.unqualified += 1;
    } else {
      row.contacted += 1;
    }
    row.total += 1;
  });
  return [...rowMap.values()].sort(
    (left, right) => compareNumber(right.total, left.total) || compareText(left.name, right.name)
  );
}

function countCallsPerformanceUniqueLeadsByOutcome(events, outcome) {
  const normalizedOutcome = String(outcome || "").trim().toLowerCase();
  const seen = new Set();
  return (Array.isArray(events) ? events : []).reduce((count, entry) => {
    if (String(entry?.outcome || "").trim().toLowerCase() !== normalizedOutcome) {
      return count;
    }
    const leadKey = String(entry?.leadId || "").trim() || String(entry?.leadName || "").trim().toLowerCase();
    if (!leadKey || seen.has(leadKey)) {
      return count;
    }
    seen.add(leadKey);
    return count + 1;
  }, 0);
}

function renderCallsPerformanceView(data, context) {
  const contextPerformanceData = context.callsPerformanceData && typeof context.callsPerformanceData === "object"
    ? context.callsPerformanceData
    : {};
  const performancePolicy = {
    shiftStart: "09:00",
    shiftEnd: "18:00",
    timezone: "Local",
    ...(data.attendancePolicy && typeof data.attendancePolicy === "object" ? data.attendancePolicy : {}),
    ...(contextPerformanceData.policy && typeof contextPerformanceData.policy === "object" ? contextPerformanceData.policy : {})
  };
  const nowIso = new Date().toISOString();
  const todayIso = callsPerformanceShiftDateForInstant(nowIso, performancePolicy) || callsPerformanceIsoDate(nowIso);
  const selectedDateIso = String(context.callsPerformanceDate || todayIso).trim() || todayIso;
  const rangeValue = String(context.callsPerformanceRange || "today").trim().toLowerCase();
  const rangeWindow = callsPerformanceResolveWindow(rangeValue, selectedDateIso, todayIso);
  const calendarAnchorIso = String(context.callsPerformanceMonth || selectedDateIso || todayIso).trim() || selectedDateIso || todayIso;
  const calendarMonthIso = callsPerformanceMonthStartIso(calendarAnchorIso);
  const calendarMeta = callsPerformanceBuildCalendarMeta(calendarMonthIso, selectedDateIso, todayIso);
  const searchValue = String(context.callsPerformanceSearch || "").trim();
  const searchLower = searchValue.toLowerCase();
  const agentFilterValue = String(context.callsPerformanceAgentId || "all").trim() || "all";
  const departmentFilterValue = String(context.callsPerformanceDepartment || "all").trim() || "all";
  const outcomeFilterValue = String(context.callsPerformanceOutcome || "all").trim().toLowerCase() || "all";
  const teamMembers = Array.isArray(data.teamMembers) ? data.teamMembers : [];
  const teamMembersById = new Map(
    teamMembers
      .map((member) => {
        const memberId = String(member?.id || "").trim();
        return memberId ? [memberId, member] : null;
      })
      .filter(Boolean)
  );
  const teamMembersByName = new Map(
    teamMembers
      .map((member) => {
        const memberName = String(member?.name || "").trim().toLowerCase();
        return memberName ? [memberName, member] : null;
      })
      .filter(Boolean)
  );
  const performanceData = contextPerformanceData;
  const performanceEvents = Array.isArray(performanceData.events) ? performanceData.events : [];
  const isPerformanceLoading = Boolean(performanceData.loading && !performanceData.loaded);
  const performanceError = String(performanceData.error || "").trim();
  const departmentOptions = [...new Set(teamMembers.map((member) => String(member?.team || member?.department || "").trim()).filter(Boolean))].sort(compareText);
  const visibleAgentOptions = teamMembers
    .filter((member) => {
      if (departmentFilterValue === "all") {
        return true;
      }
      const memberDepartment = String(member?.team || member?.department || "").trim().toLowerCase();
      return memberDepartment === departmentFilterValue.toLowerCase();
    })
    .sort((left, right) => compareText(left?.name, right?.name));
  const effectiveEvents = getCallsPerformanceEffectiveEvents(
    performanceEvents,
    performanceData,
    performancePolicy,
    teamMembersById,
    teamMembersByName,
    teamMembers
  );
  const rangeEvents = callsPerformanceFilterEventsByWindow(effectiveEvents, rangeWindow, performancePolicy);
  const scopeEvents = rangeEvents.filter((entry) => {
    if (departmentFilterValue !== "all") {
      const entryDepartment = String(entry?.department || "").trim().toLowerCase();
      if (entryDepartment !== departmentFilterValue.toLowerCase()) {
        return false;
      }
    }
    if (agentFilterValue !== "all" && String(entry?.agentId || "").trim() !== agentFilterValue) {
      return false;
    }
    return true;
  });
  const tableEvents = scopeEvents
    .filter((entry) => {
      if (outcomeFilterValue !== "all" && String(entry?.outcome || "").trim().toLowerCase() !== outcomeFilterValue) {
        return false;
      }
      if (!searchLower) {
        return true;
      }
      return [entry?.leadName, entry?.agentName, entry?.department].join(" ").toLowerCase().includes(searchLower);
    })
    .sort((left, right) => compareNumber(right?._timeMs, left?._timeMs));
  const tablePagination = buildCallsPerformanceTablePagination(
    tableEvents.length,
    Number(context.callsPerformanceTablePage || 1),
    Number(context.callsPerformanceTablePageSize || 10)
  );
  const visibleTableEvents = tableEvents.slice(tablePagination.startIndex, tablePagination.endIndex);

  const outcomeCounts = scopeEvents.reduce(
    (counts, entry) => {
      const outcome = String(entry?.outcome || "").trim();
      if (Object.hasOwn(counts, outcome)) {
        counts[outcome] += 1;
      }
      return counts;
    },
    { Contacted: 0, Qualified: 0, Unqualified: 0 }
  );
  const contactedLeadCount = outcomeCounts.Contacted;
  const qualifiedLeadCount = outcomeCounts.Qualified;
  const unqualifiedLeadCount = outcomeCounts.Unqualified;
  const availableAgents = agentFilterValue === "all"
    ? visibleAgentOptions
    : visibleAgentOptions.filter((member) => String(member?.id || "").trim() === agentFilterValue);
  const agentChartRows = buildCallsPerformanceAgentRows(scopeEvents, availableAgents);
  const agentChartMeta = getCallsPerformanceAgentChartMeta(agentChartRows, agentFilterValue);
  const selectedAgent = agentChartMeta.selectedAgent;
  const trendDataset = callsPerformanceTrendDataset(scopeEvents, rangeWindow, performancePolicy);
  const trendEmptyLabel = isPerformanceLoading
    ? "Loading performance activity..."
    : performanceError
      ? "Performance activity could not be loaded."
      : rangeWindow.range === "today"
        ? "No contact activity for this day."
        : "No contact activity in this range.";
  const agentChartEmptyLabel = isPerformanceLoading
    ? "Loading agent activity..."
    : performanceError
      ? "Performance activity could not be loaded."
      : "No agent activity to compare yet.";
  const tableRowsMarkup = visibleTableEvents.length
    ? visibleTableEvents
        .map((entry) => {
          const fullAgentName = String(entry?.agentName || "Unassigned").trim() || "Unassigned";
          const agentAvatarUrl = String(entry?.agentAvatarUrl || "").trim();
          const agentLabel = callsPerformanceAgentFirstName(fullAgentName);
          const agentInitial = callsPerformanceAgentInitial(fullAgentName);
          return `
            <tr>
              <td>${escapeHtml(entry.timeLabel || "--")}</td>
              <td>
                <span class="calls-performance-agent-cell" title="${escapeHtml(fullAgentName)}">
                  <span class="calls-performance-agent-avatar" aria-hidden="true">
                    ${
                      agentAvatarUrl
                        ? `<img src="${escapeHtml(agentAvatarUrl)}" alt="${escapeHtml(fullAgentName)}" />`
                        : escapeHtml(agentInitial)
                    }
                  </span>
                  <span class="calls-performance-agent-cell-name">${escapeHtml(agentLabel)}</span>
                </span>
              </td>
              <td><span class="calls-performance-lead-cell-name">${escapeHtml(entry.leadName || "Lead")}</span></td>
              <td>Outbound</td>
              <td>
                <span class="calls-outcome-pill ${callsPerformanceOutcomeTone(entry.outcome)}">${escapeHtml(entry.outcome)}</span>
              </td>
              <td>
                <button type="button" class="mini-btn calls-performance-action-btn" data-action="lead-open" data-id="${escapeHtml(entry.leadId || "")}">
                  <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i>
                </button>
              </td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="6" class="task-meta">${
        isPerformanceLoading
          ? "Loading contact activity..."
          : performanceError
            ? escapeHtml(performanceError)
            : "No contact activity matches this filter."
      }</td></tr>`;

  return `
    <section class="calls-performance-shell attendance-manager-shell">
      <aside class="attendance-manager-sidebar calls-performance-sidebar">
        <article class="attendance-manager-side-card">
          <div class="attendance-manager-calendar">
            <div class="attendance-manager-calendar-head">
              <button type="button" class="attendance-manager-calendar-nav" data-action="calls-performance-month" data-id="prev" aria-label="Previous month">
                <i class="bi bi-chevron-left" aria-hidden="true"></i>
              </button>
              <strong>${escapeHtml(calendarMeta.label)}</strong>
              <button type="button" class="attendance-manager-calendar-nav" data-action="calls-performance-month" data-id="next" aria-label="Next month">
                <i class="bi bi-chevron-right" aria-hidden="true"></i>
              </button>
            </div>
            <div class="attendance-manager-calendar-weekdays">
              ${["S", "M", "T", "W", "T", "F", "S"].map((label) => `<span>${label}</span>`).join("")}
            </div>
            <div class="attendance-manager-calendar-grid">
              ${calendarMeta.cells
                .map(
                  (cell) => `
                    <button
                      type="button"
                      class="attendance-manager-calendar-day ${cell.isOutsideMonth ? "is-outside" : ""} ${cell.isToday ? "is-today" : ""} ${cell.isSelected ? "is-selected" : ""}"
                      data-action="calls-performance-day"
                      data-id="${escapeHtml(cell.isoDate)}"
                    >
                      ${escapeHtml(cell.label)}
                    </button>
                  `
                )
                .join("")}
            </div>
          </div>
        </article>

        <article class="attendance-manager-side-card">
          <div class="attendance-manager-filter-group">
            <div class="attendance-manager-filter-label">
              <span>Range</span>
            </div>
            <div class="attendance-manager-chip-row is-segmented">
              <button type="button" class="mini-btn ${rangeWindow.range === "today" ? "is-active" : ""}" data-action="calls-performance-range" data-id="today">Today</button>
              <button type="button" class="mini-btn ${rangeWindow.range === "week" ? "is-active" : ""}" data-action="calls-performance-range" data-id="week">This Week</button>
              <button type="button" class="mini-btn ${rangeWindow.range === "month" ? "is-active" : ""}" data-action="calls-performance-range" data-id="month">This Month</button>
            </div>
          </div>
          <div class="attendance-manager-filter-group">
            <label class="attendance-manager-filter-label" for="callsPerformanceAgentSelect">Agent</label>
            <div class="attendance-manager-select-field">
              <select id="callsPerformanceAgentSelect" data-calls-performance-agent>
                <option value="all" ${agentFilterValue === "all" ? "selected" : ""}>All agents</option>
                ${visibleAgentOptions
                  .map((member) => {
                    const memberId = String(member?.id || "").trim();
                    return `<option value="${escapeHtml(memberId)}" ${memberId === agentFilterValue ? "selected" : ""}>${escapeHtml(String(member?.name || "Agent").trim() || "Agent")}</option>`;
                  })
                  .join("")}
              </select>
              <i class="bi bi-chevron-down" aria-hidden="true"></i>
            </div>
          </div>
          <div class="attendance-manager-filter-group">
            <label class="attendance-manager-filter-label" for="callsPerformanceDepartmentSelect">Department</label>
            <div class="attendance-manager-select-field">
              <select id="callsPerformanceDepartmentSelect" data-calls-performance-department>
                <option value="all" ${departmentFilterValue === "all" ? "selected" : ""}>All departments</option>
                ${departmentOptions
                  .map((department) => `<option value="${escapeHtml(department)}" ${department === context.callsPerformanceDepartment ? "selected" : ""}>${escapeHtml(department)}</option>`)
                  .join("")}
              </select>
              <i class="bi bi-chevron-down" aria-hidden="true"></i>
            </div>
          </div>
          <div class="attendance-manager-filter-group">
            <label class="attendance-manager-filter-label" for="callsPerformanceOutcomeSelect">Outcome</label>
            <div class="attendance-manager-select-field">
              <select id="callsPerformanceOutcomeSelect" data-calls-performance-outcome>
                <option value="all" ${outcomeFilterValue === "all" ? "selected" : ""}>All outcomes</option>
                ${CALLS_PERFORMANCE_OUTCOMES
                  .map((outcome) => {
                    const normalizedOutcome = outcome.toLowerCase();
                    return `<option value="${normalizedOutcome}" ${normalizedOutcome === outcomeFilterValue ? "selected" : ""}>${escapeHtml(outcome)}</option>`;
                  })
                  .join("")}
              </select>
              <i class="bi bi-chevron-down" aria-hidden="true"></i>
            </div>
          </div>
          <div class="attendance-manager-filter-group">
            <label class="attendance-manager-filter-label" for="callsPerformanceSearchInput">Search</label>
            <label class="attendance-manager-search" for="callsPerformanceSearchInput">
              <i class="bi bi-search" aria-hidden="true"></i>
              <input id="callsPerformanceSearchInput" type="search" value="${escapeHtml(searchValue)}" placeholder="Search lead or agent" />
            </label>
          </div>
        </article>
      </aside>

      <section class="attendance-manager-main calls-performance-main">
        <section class="attendance-manager-summary-grid calls-performance-summary-grid">
          <article class="attendance-manager-summary-card calls-performance-kpi-card is-contacted">
            <span class="calls-performance-kpi-icon" aria-hidden="true">
              <i class="bi bi-telephone-outbound"></i>
            </span>
            <div class="calls-performance-kpi-copy">
              <span>Contacted</span>
              <strong>${escapeHtml(String(contactedLeadCount))}</strong>
            </div>
          </article>
          <article class="attendance-manager-summary-card calls-performance-kpi-card is-qualified">
            <span class="calls-performance-kpi-icon" aria-hidden="true">
              <i class="bi bi-patch-check"></i>
            </span>
            <div class="calls-performance-kpi-copy">
              <span>Qualified</span>
              <strong>${escapeHtml(String(qualifiedLeadCount))}</strong>
            </div>
          </article>
          <article class="attendance-manager-summary-card calls-performance-kpi-card is-quota">
            <span class="calls-performance-kpi-icon" aria-hidden="true">
              <i class="bi bi-bullseye"></i>
            </span>
            <div class="calls-performance-kpi-copy">
              <span>${escapeHtml(agentChartMeta.quotaLabel)}</span>
              <strong>${escapeHtml(agentChartMeta.quotaValue)}</strong>
            </div>
          </article>
          <article class="attendance-manager-summary-card calls-performance-kpi-card is-remaining">
            <span class="calls-performance-kpi-icon" aria-hidden="true">
              <i class="bi bi-flag"></i>
            </span>
            <div class="calls-performance-kpi-copy">
              <span>Remaining to Target</span>
              <strong>${escapeHtml(String(agentChartMeta.remainingToTarget))}</strong>
            </div>
          </article>
        </section>

        <section class="calls-performance-grid">
          <article class="calls-performance-card">
            <header class="calls-performance-card-head">
              <div>
                <p class="task-title">${rangeWindow.range === "today" ? "Contact Activity by Hour" : "Contact Activity Over Time"}</p>
              </div>
            </header>
            ${renderCallsPerformanceTrendChart(trendDataset, trendEmptyLabel)}
          </article>

          <article class="calls-performance-card">
            <header class="calls-performance-card-head">
              <div>
                <p class="task-title">Contacted by Agent</p>
              </div>
            </header>
            ${renderCallsPerformanceAgentDonutChart(agentChartRows, {
              emptyLabel: agentChartEmptyLabel,
              donutTitle: "Contacted by Agent",
              donutCenterLabel: "Contacted"
            })}
          </article>
        </section>

        <article class="calls-performance-card calls-performance-table-card">
          <header class="calls-performance-card-head">
            <div>
              <p class="task-title">Contact Activity</p>
              <p class="task-meta">Temporary activity feed based on CRM status changes while live call sync is still rolling out.</p>
            </div>
          </header>
          <div class="table-ops-wrap data-table-shell calls-performance-table-shell">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Agent</th>
                  <th>Lead</th>
                  <th>Direction</th>
                  <th>Outcome</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${tableRowsMarkup}
              </tbody>
            </table>
            ${renderCallsPerformanceTableFooter(tablePagination, tableEvents.length)}
          </div>
        </article>
      </section>
    </section>
  `;
}

function dashboardStageClass(stageId) {
  const normalized = String(stageId || "").trim().toLowerCase();
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

function buildDashboardTrend(currentValue, baselineValue, compareLabel) {
  const current = Math.max(0, Number(currentValue || 0));
  const baseline = Math.max(1, Number(baselineValue || 1));
  const diff = current - baseline;
  const rawPercent = Math.abs((diff / baseline) * 100);
  const percent = Math.max(0.1, Math.min(99.9, rawPercent));
  return {
    isUp: diff >= 0,
    percentLabel: `${percent.toFixed(1)}%`,
    compareLabel: compareLabel || "vs previous period"
  };
}

function isTaskScheduledForToday(task, todayIso, todayShortDay) {
  if (String(task.dueDate || "").trim() === todayIso) {
    return true;
  }
  const dayLabel = String(task.day || "")
    .trim()
    .slice(0, 3)
    .toLowerCase();
  return Boolean(dayLabel && dayLabel === todayShortDay.toLowerCase());
}

function buildNameResolver(data) {
  const exactMap = new Map();
  const firstNameMap = new Map();

  (data.teamMembers || []).forEach((member) => {
    const full = String(member.name || "").trim();
    if (!full) {
      return;
    }
    exactMap.set(full.toLowerCase(), full);

    const first = full.split(/\s+/)[0]?.toLowerCase() || "";
    if (!first) {
      return;
    }
    if (!firstNameMap.has(first)) {
      firstNameMap.set(first, full);
      return;
    }
    const current = firstNameMap.get(first);
    if (current !== full) {
      firstNameMap.set(first, "");
    }
  });

  return (value) => {
    const raw = String(value || "").trim();
    if (!raw) {
      return "";
    }
    const exact = exactMap.get(raw.toLowerCase());
    if (exact) {
      return exact;
    }
    const first = raw.split(/\s+/)[0]?.toLowerCase() || "";
    const byFirst = firstNameMap.get(first);
    if (byFirst) {
      return byFirst;
    }
    return raw;
  };
}

function renderDashboardLoadingState() {
  return {
    title: "Dashboard",
    subtitle: "Revenue, pipeline, and activity",
    primaryAction: "Add Task",
    showWaitingPanel: false,
    html: `
      <section class="dashboard-v3" aria-busy="true">
        <section class="dashboard-kpi-grid">
          ${Array.from({ length: 4 }, (_, index) => `
            <article class="dashboard-kpi-card dashboard-kpi-skeleton dashboard-kpi-skeleton-${index + 1}" aria-hidden="true">
              <span class="dashboard-skeleton-icon"></span>
              <span class="dashboard-skeleton-line is-label"></span>
              <span class="dashboard-skeleton-line is-value"></span>
              <span class="dashboard-skeleton-line is-meta"></span>
            </article>
          `).join("")}
        </section>
        <section class="dashboard-main-grid">
          <article class="dashboard-panel dashboard-panel-skeleton" aria-hidden="true">
            <header class="dashboard-panel-head">
              <span class="dashboard-skeleton-line is-title"></span>
              <span class="dashboard-skeleton-pill"></span>
            </header>
            <section class="dashboard-stage-grid">
              ${Array.from({ length: 5 }, () => `
                <article class="dashboard-stage-cell">
                  <span class="dashboard-skeleton-line is-stage"></span>
                  <span class="dashboard-skeleton-line is-stage-label"></span>
                  <span class="dashboard-skeleton-line is-stage-value"></span>
                </article>
              `).join("")}
            </section>
            <div class="dashboard-table-shell">
              <div class="dashboard-skeleton-table">
                ${Array.from({ length: 4 }, () => `<span class="dashboard-skeleton-line is-row"></span>`).join("")}
              </div>
            </div>
          </article>
          <aside class="dashboard-side-column">
            ${Array.from({ length: 2 }, () => `
              <article class="dashboard-panel dashboard-panel-skeleton" aria-hidden="true">
                <header class="dashboard-panel-head">
                  <span class="dashboard-skeleton-line is-title"></span>
                </header>
                <div class="dashboard-feed">
                  ${Array.from({ length: 3 }, () => `
                    <div class="dashboard-skeleton-feed-item">
                      <span class="dashboard-skeleton-avatar"></span>
                      <div class="dashboard-skeleton-feed-copy">
                        <span class="dashboard-skeleton-line is-feed-title"></span>
                        <span class="dashboard-skeleton-line is-feed-meta"></span>
                      </div>
                    </div>
                  `).join("")}
                </div>
              </article>
            `).join("")}
          </aside>
        </section>
      </section>
    `
  };
}

function renderDashboardErrorState(message) {
  return {
    title: "Dashboard",
    subtitle: "Revenue, pipeline, and activity",
    primaryAction: "Add Task",
    showWaitingPanel: false,
    html: `
      <section class="dashboard-v3">
        <article class="dashboard-panel dashboard-state-panel">
          <header class="dashboard-panel-head">
            <h3>Dashboard unavailable</h3>
          </header>
          <div class="dashboard-state-copy">
            <p>${escapeHtml(message || "We couldn't load the latest dashboard snapshot.")}</p>
            <p class="task-meta">Try refreshing the page after the workspace data finishes syncing.</p>
          </div>
        </article>
      </section>
    `
  };
}

function renderDashboardLockedState() {
  return {
    title: "Dashboard",
    subtitle: "Revenue, pipeline, and activity",
    primaryAction: "Open My Work",
    showWaitingPanel: false,
    html: `
      <section class="dashboard-v3">
        <article class="dashboard-panel dashboard-state-panel">
          <header class="dashboard-panel-head">
            <h3>Dashboard locked</h3>
          </header>
          <div class="dashboard-state-copy">
            <p>Your role does not currently include dashboard access.</p>
            <p class="task-meta">Ask a workspace owner or admin to enable the Dashboard view permission for your member profile.</p>
          </div>
        </article>
      </section>
    `
  };
}

function parseDashboardDate(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.valueOf()) ? null : date;
  }
  const date = new Date(raw);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function dashboardStartOfDay(value) {
  const date = value instanceof Date ? new Date(value) : parseDashboardDate(value);
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) {
    return null;
  }
  date.setHours(0, 0, 0, 0);
  return date;
}

function dashboardDaysAgo(value, referenceDate = new Date()) {
  const date = dashboardStartOfDay(value);
  const reference = dashboardStartOfDay(referenceDate);
  if (!(date instanceof Date) || !(reference instanceof Date)) {
    return -1;
  }
  return Math.round((reference.getTime() - date.getTime()) / 86400000);
}

function dashboardIsSameMonth(value, referenceDate = new Date()) {
  const date = parseDashboardDate(value);
  if (!(date instanceof Date)) {
    return false;
  }
  return date.getFullYear() === referenceDate.getFullYear() && date.getMonth() === referenceDate.getMonth();
}

function dashboardCountLabel(count, singular, plural = `${singular}s`) {
  const safeCount = Math.max(0, Number(count || 0));
  return `${new Intl.NumberFormat("en-US").format(safeCount)} ${safeCount === 1 ? singular : plural}`;
}

function dashboardMemberMatchesRecord(member, ownerId, ownerName) {
  const normalizedMemberId = String(member?.id || "").trim();
  const normalizedOwnerId = String(ownerId || "").trim();
  if (normalizedMemberId && normalizedOwnerId && normalizedMemberId === normalizedOwnerId) {
    return true;
  }
  const normalizedMemberName = String(member?.name || "").trim().toLowerCase();
  const normalizedOwnerName = String(ownerName || "").trim().toLowerCase();
  return Boolean(normalizedMemberName) && Boolean(normalizedOwnerName) && normalizedMemberName === normalizedOwnerName;
}

function getDashboardInitials(name) {
  return (
    String(name || "")
      .split(/\s+/)
      .map((part) => part.slice(0, 1))
      .join("")
      .slice(0, 2)
      .toUpperCase() || "NA"
  );
}

function buildDashboardTrendGeometry(points) {
  const safePoints = Array.isArray(points) && points.length ? points : [{ label: "", shortLabel: "", value: 0 }];
  const width = 520;
  const height = 184;
  const paddingX = 12;
  const paddingTop = 14;
  const paddingBottom = 32;
  const innerWidth = width - paddingX * 2;
  const innerHeight = height - paddingTop - paddingBottom;
  const maxValue = Math.max(...safePoints.map((point) => Number(point.value || 0)), 1);
  const coords = safePoints.map((point, index) => {
    const x =
      safePoints.length === 1
        ? paddingX + innerWidth / 2
        : paddingX + (innerWidth * index) / (safePoints.length - 1);
    const y = paddingTop + innerHeight - (Math.max(0, Number(point.value || 0)) / maxValue) * innerHeight;
    return { ...point, x, y };
  });
  const baselineY = paddingTop + innerHeight;
  const linePath = coords
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
  const firstPoint = coords[0];
  const lastPoint = coords[coords.length - 1];
  const areaPath = `${linePath} L ${lastPoint.x.toFixed(2)} ${baselineY.toFixed(2)} L ${firstPoint.x.toFixed(2)} ${baselineY.toFixed(2)} Z`;
  const markerIndices = Array.from(
    new Set([0, Math.floor((coords.length - 1) / 2), coords.length - 1].filter((index) => index >= 0))
  );
  return {
    width,
    height,
    baselineY,
    maxValue,
    coords,
    linePath,
    areaPath,
    markers: markerIndices.map((index) => coords[index])
  };
}

function normalizeDashboardUiState(uiState) {
  const allowedRanges = new Set(["today", "7d", "30d", "mtd", "qtd"]);
  const allowedSourceMetrics = new Set(["volume", "converted"]);
  const allowedOwnerMetrics = new Set(["qualified", "converted"]);
  const allowedSeries = new Set(["new", "contacted", "qualified", "won"]);
  const range = String(uiState?.range || "").trim().toLowerCase();
  const sourceMetric = String(uiState?.sourceMetric || "").trim().toLowerCase();
  const ownerMetric = String(uiState?.ownerMetric || "").trim().toLowerCase();
  const hiddenSeries = Array.isArray(uiState?.hiddenSeries)
    ? uiState.hiddenSeries
        .map((entry) => String(entry || "").trim().toLowerCase())
        .filter((entry, index, values) => allowedSeries.has(entry) && values.indexOf(entry) === index)
    : [];
  return {
    range: allowedRanges.has(range) ? range : "30d",
    sourceMetric: allowedSourceMetrics.has(sourceMetric) ? sourceMetric : "converted",
    ownerMetric: allowedOwnerMetrics.has(ownerMetric) ? ownerMetric : "qualified",
    hiddenSeries
  };
}

export function clearDashboardCommandModelCache() {
  dashboardCommandModelMemo = {
    key: "",
    model: null
  };
}

function dashboardRecordSignature(record, fields = []) {
  if (!record || typeof record !== "object") {
    return "";
  }
  return fields
    .map((field) => {
      const value = record[field];
      if (value === null || value === undefined) {
        return "";
      }
      if (typeof value === "object") {
        try {
          return JSON.stringify(value);
        } catch (error) {
          return "";
        }
      }
      return String(value);
    })
    .join("~");
}

function dashboardCollectionSignature(items, fields = []) {
  const safeItems = Array.isArray(items) ? items : [];
  return `${safeItems.length}:${safeItems
    .map((item) => dashboardRecordSignature(item, fields))
    .sort()
    .join("|")}`;
}

function dashboardSnapshotSignature(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return "";
  }
  return JSON.stringify({
    schemaVersion: String(snapshot.schemaVersion || ""),
    range: String(snapshot.range || ""),
    rangeLabel: String(snapshot.rangeLabel || ""),
    compareLabel: String(snapshot.compareLabel || ""),
    window: snapshot.window && typeof snapshot.window === "object" ? snapshot.window : null,
    generatedAt: String(snapshot.generatedAt || ""),
    quarterLabel: String(snapshot.quarterLabel || ""),
    leadStatusDistribution: dashboardCollectionSignature(snapshot.leadStatusDistribution, ["key", "label", "count"]),
    salesFunnel: dashboardCollectionSignature(snapshot.salesFunnel, ["key", "label", "count"]),
    topReps: dashboardCollectionSignature(snapshot.topReps, ["id", "name", "dealsClosed", "percent"]),
    pipelineTrend: dashboardCollectionSignature(snapshot.pipelineTrend?.points, ["key", "label", "values"]),
    followUpTasks: dashboardCollectionSignature(snapshot.followUpTasks, ["id", "title", "assignee", "dueDate", "status"]),
    topDeals: dashboardCollectionSignature(snapshot.topDeals, ["id", "account", "value", "stage", "closeDate"]),
    recentActivity: dashboardCollectionSignature(snapshot.recentActivity, ["actor", "headline", "createdAt"]),
    dueTasks: {
      dueTodayCount: Number(snapshot.dueTasks?.dueTodayCount || 0),
      items: dashboardCollectionSignature(snapshot.dueTasks?.items, ["id", "title", "assignee", "dueDate", "status"])
    }
  });
}

function buildDashboardCommandModelCacheKey(data, snapshot, dashboardUiState, now) {
  return JSON.stringify({
    day: formatLocalIsoDate(now),
    hour: now.getHours(),
    currentUser: dashboardRecordSignature(data?.currentUser, ["id", "email", "name", "fullName", "firstName"]),
    ui: dashboardUiState,
    snapshot: dashboardSnapshotSignature(snapshot),
    leads: dashboardCollectionSignature(data?.leads, [
      "id",
      "createdAt",
      "updatedAt",
      "status",
      "source",
      "ownerId",
      "owner",
      "nextFollowUp",
      "archived",
      "archivedAt",
      "meta"
    ]),
    deals: dashboardCollectionSignature(data?.deals, [
      "id",
      "createdAt",
      "updatedAt",
      "stage",
      "value",
      "closeDate",
      "ownerId",
      "owner",
      "archived"
    ]),
    tasks: dashboardCollectionSignature(data?.tasks, [
      "id",
      "createdAt",
      "updatedAt",
      "status",
      "dueDate",
      "deadlineAt",
      "assigneeId",
      "assignee",
      "taskType",
      "title"
    ]),
    messages: dashboardCollectionSignature(data?.messages, ["id", "createdAt", "updatedAt", "sender", "subject", "preview"]),
    teamMembers: dashboardCollectionSignature(data?.teamMembers, ["id", "email", "name", "status", "role", "team"])
  });
}

function dashboardShiftDay(value, offset) {
  const date = dashboardStartOfDay(value);
  if (!(date instanceof Date)) {
    return null;
  }
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + Number(offset || 0));
}

function dashboardDaysBetween(startValue, endValue) {
  const start = dashboardStartOfDay(startValue);
  const end = dashboardStartOfDay(endValue);
  if (!(start instanceof Date) || !(end instanceof Date)) {
    return 0;
  }
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
}

function dashboardDateInWindow(value, startValue, endValue) {
  const date = dashboardStartOfDay(value);
  const start = dashboardStartOfDay(startValue);
  const end = dashboardStartOfDay(endValue);
  if (!(date instanceof Date) || !(start instanceof Date) || !(end instanceof Date)) {
    return false;
  }
  return date >= start && date <= end;
}

function formatDashboardAxisValue(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) {
    return "0";
  }
  if (Math.abs(numeric) >= 10 || Number.isInteger(numeric)) {
    return String(Math.round(numeric));
  }
  return String(Number(numeric.toFixed(1)));
}

function buildDashboardDailyPoints(startValue, endValue, options = {}) {
  const start = dashboardStartOfDay(startValue);
  const end = dashboardStartOfDay(endValue);
  if (!(start instanceof Date) || !(end instanceof Date)) {
    return [];
  }
  const totalDays = Math.max(1, dashboardDaysBetween(start, end) + 1);
  const showEvery = totalDays <= 7 ? 1 : totalDays <= 14 ? 2 : totalDays <= 24 ? 4 : 5;
  return Array.from({ length: totalDays }, (_, index) => {
    const date = dashboardShiftDay(start, index);
    const isEdge = index === 0 || index === totalDays - 1;
    const shouldShowLongLabel = totalDays === 1 || isEdge || index % showEvery === 0;
    return {
      key: formatLocalIsoDate(date) || `point-${index}`,
      label: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      shortLabel:
        totalDays === 1
          ? options.singleLabel || date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
          : totalDays <= 7
            ? date.toLocaleDateString("en-US", { weekday: "short" })
            : shouldShowLongLabel
              ? date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
              : "",
      dateStart: date,
      dateEnd: date
    };
  });
}

function buildDashboardWeeklyPoints(startValue, endValue) {
  const start = dashboardStartOfDay(startValue);
  const end = dashboardStartOfDay(endValue);
  if (!(start instanceof Date) || !(end instanceof Date)) {
    return [];
  }
  const points = [];
  let cursor = start;
  let index = 0;
  while (cursor <= end) {
    const dateStart = cursor;
    const candidateEnd = dashboardShiftDay(cursor, 6);
    const dateEnd = candidateEnd instanceof Date && candidateEnd < end ? candidateEnd : end;
    points.push({
      key: `week-${index}-${formatLocalIsoDate(dateStart) || ""}`,
      label: `${dateStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} to ${dateEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
      shortLabel: dateEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      dateStart,
      dateEnd
    });
    cursor = dashboardShiftDay(dateEnd, 1);
    index += 1;
  }
  return points;
}

function buildDashboardRangeMeta(rangeId, referenceDate = new Date()) {
  const today = dashboardStartOfDay(referenceDate) || new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const previousMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const previousMonthMaxDay = new Date(today.getFullYear(), today.getMonth(), 0).getDate();
  const previousMonthComparableDay = new Date(
    previousMonthStart.getFullYear(),
    previousMonthStart.getMonth(),
    Math.min(today.getDate(), previousMonthMaxDay)
  );
  const quarterMonth = Math.floor(today.getMonth() / 3) * 3;
  const quarterStart = new Date(today.getFullYear(), quarterMonth, 1);
  const previousQuarterStart = new Date(today.getFullYear(), quarterMonth - 3, 1);
  const quarterElapsedDays = dashboardDaysBetween(quarterStart, today);
  const previousQuarterEnd = dashboardShiftDay(previousQuarterStart, quarterElapsedDays);
  switch (rangeId) {
    case "today":
      return {
        id: "today",
        label: "Today",
        compareLabel: "vs yesterday",
        start: today,
        end: today,
        previousStart: dashboardShiftDay(today, -1),
        previousEnd: dashboardShiftDay(today, -1),
        points: buildDashboardDailyPoints(today, today, { singleLabel: "Today" })
      };
    case "7d":
      return {
        id: "7d",
        label: "Last 7 days",
        compareLabel: "vs previous 7 days",
        start: dashboardShiftDay(today, -6),
        end: today,
        previousStart: dashboardShiftDay(today, -13),
        previousEnd: dashboardShiftDay(today, -7),
        points: buildDashboardDailyPoints(dashboardShiftDay(today, -6), today)
      };
    case "mtd":
      return {
        id: "mtd",
        label: "Month to date",
        compareLabel: "vs previous MTD",
        start: monthStart,
        end: today,
        previousStart: previousMonthStart,
        previousEnd: previousMonthComparableDay,
        points: buildDashboardDailyPoints(monthStart, today)
      };
    case "qtd":
      return {
        id: "qtd",
        label: "Quarter to date",
        compareLabel: "vs previous QTD",
        start: quarterStart,
        end: today,
        previousStart: previousQuarterStart,
        previousEnd: previousQuarterEnd,
        points: buildDashboardWeeklyPoints(quarterStart, today)
      };
    case "30d":
    default:
      return {
        id: "30d",
        label: "Last 30 days",
        compareLabel: "vs previous 30 days",
        start: dashboardShiftDay(today, -29),
        end: today,
        previousStart: dashboardShiftDay(today, -59),
        previousEnd: dashboardShiftDay(today, -30),
        points: buildDashboardDailyPoints(dashboardShiftDay(today, -29), today)
      };
  }
}

function findDashboardPoint(points, value) {
  const date = dashboardStartOfDay(value);
  if (!(date instanceof Date)) {
    return null;
  }
  return (
    (Array.isArray(points) ? points : []).find(
      (point) =>
        point?.dateStart instanceof Date &&
        point?.dateEnd instanceof Date &&
        date >= point.dateStart &&
        date <= point.dateEnd
    ) || null
  );
}

function buildDashboardMetricPointValues(points, records, getDateValue, getMetricValue = () => 1, predicate = null) {
  const mappedPoints = (Array.isArray(points) ? points : []).map((point) => ({ ...point, value: 0 }));
  (Array.isArray(records) ? records : []).forEach((record) => {
    if (typeof predicate === "function" && !predicate(record)) {
      return;
    }
    const point = findDashboardPoint(mappedPoints, getDateValue(record));
    if (!point) {
      return;
    }
    point.value += Math.max(0, Number(getMetricValue(record) || 0));
  });
  return mappedPoints;
}

function formatDashboardDeltaBadge(currentValue, baselineValue) {
  const current = Math.max(0, Number(currentValue || 0));
  const baseline = Math.max(0, Number(baselineValue || 0));
  if (!current && !baseline) {
    return "0.0%";
  }
  if (!baseline && current > 0) {
    return "+100.0%";
  }
  const trend = buildDashboardTrend(current, baseline, "vs previous period");
  return `${trend.isUp ? "+" : "-"}${trend.percentLabel}`;
}

function buildDashboardRangeNote(currentValue, baselineValue, compareLabel, fallbackLabel) {
  const current = Math.max(0, Number(currentValue || 0));
  const baseline = Math.max(0, Number(baselineValue || 0));
  if (!current && !baseline) {
    return fallbackLabel || `No movement ${String(compareLabel || "vs previous period").toLowerCase()}.`;
  }
  return `${formatDashboardDeltaBadge(current, baseline)} ${compareLabel || "vs previous period"}`;
}

function renderDashboardSparkline(values, tone) {
  const safeValues =
    Array.isArray(values) && values.length
      ? values
      : Array.from({ length: 6 }, (_, index) => ({ label: String(index + 1), value: 0 }));
  const geometry = buildDashboardTrendGeometry(
    safeValues.map((entry, index) => ({
      label: String(entry?.label || index + 1),
      value: Math.max(0, Number(entry?.value || 0))
    }))
  );
  return `
    <svg class="dashboard-command-sparkline ${escapeHtml(tone || "")}" viewBox="0 0 ${geometry.width} ${geometry.height}" preserveAspectRatio="none" aria-hidden="true">
      <path d="${escapeHtml(geometry.areaPath)}" class="dashboard-command-sparkline-area"></path>
      <path d="${escapeHtml(geometry.linePath)}" class="dashboard-command-sparkline-line"></path>
      ${geometry.markers
        .map(
          (point) => `
            <circle
              cx="${point.x.toFixed(2)}"
              cy="${point.y.toFixed(2)}"
              r="5.25"
              class="dashboard-command-sparkline-point"
            ></circle>
          `
        )
        .join("")}
    </svg>
  `;
}

function renderDashboardPipelineTrendChart(dataset, emptyLabel) {
  const points =
    Array.isArray(dataset?.points) && dataset.points.length
      ? dataset.points
      : buildDashboardDailyPoints(new Date(), new Date(), { singleLabel: "Today" });
  const series = Array.isArray(dataset?.series) ? dataset.series : [];
  const activeSeries = series.filter((entry) => !entry?.hidden);
  const maxValue = Math.max(
    1,
    ...points.flatMap((point) => activeSeries.map((entry) => Number(point?.values?.[entry.key] || 0)))
  );
  const hasVisibleSeries = activeSeries.length > 0;
  const hasValues = points.some((point) => activeSeries.some((entry) => Number(point?.values?.[entry.key] || 0) > 0));
  const chartEmptyLabel = hasVisibleSeries ? emptyLabel : "Turn a stage back on to see movement.";
  const width = 560;
  const height = 248;
  const paddingLeft = 44;
  const paddingRight = 18;
  const paddingTop = 18;
  const paddingBottom = 34;
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;
  const singlePoint = points.length === 1;
  const xStep = singlePoint ? 0 : chartWidth / Math.max(points.length - 1, 1);
  const yForValue = (value) => paddingTop + chartHeight - (Math.max(0, Number(value || 0)) / maxValue) * chartHeight;
  const renderedSeries = activeSeries.map((entry) => {
    const coords = points.map((point, index) => ({
      x: singlePoint ? paddingLeft + chartWidth / 2 : paddingLeft + xStep * index,
      y: yForValue(point?.values?.[entry.key] || 0),
      value: Number(point?.values?.[entry.key] || 0)
    }));
    return {
      ...entry,
      path: callsPerformanceBuildLinePath(coords),
      points: coords
    };
  });
  const yTickValues = Array.from(
    { length: 5 },
    (_, index) => Number(((maxValue * (4 - index)) / 4).toFixed(maxValue < 4 ? 1 : 0))
  );
  const gridlines = yTickValues
    .map((tickValue) => {
      const y = yForValue(tickValue);
      return `
        <line x1="${paddingLeft}" y1="${y.toFixed(2)}" x2="${(width - paddingRight).toFixed(2)}" y2="${y.toFixed(2)}" class="dashboard-pipeline-line-gridline"></line>
        <text x="${(paddingLeft - 10).toFixed(2)}" y="${(y + 3).toFixed(2)}" text-anchor="end" class="dashboard-pipeline-line-y-label">${escapeHtml(formatDashboardAxisValue(tickValue))}</text>
      `;
    })
    .join("");
  return `
    <div class="dashboard-pipeline-line-chart dashboard-command-chart">
      <div class="dashboard-pipeline-legend dashboard-command-chart-legend">
        ${series
          .map(
            (entry) => `
              <button
                type="button"
                class="dashboard-command-legend-btn ${entry.hidden ? "" : "is-active"}"
                data-action="dashboard-series-toggle"
                data-id="${escapeHtml(entry.key || "")}"
                aria-pressed="${entry.hidden ? "false" : "true"}"
              >
                <span class="dashboard-pipeline-legend-swatch ${escapeHtml(entry.tone)}"></span>
                <span>${escapeHtml(entry.label)}</span>
              </button>
            `
          )
          .join("")}
      </div>
      <div class="dashboard-command-chart-frame">
        <svg class="dashboard-pipeline-line-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
          <rect
            x="${paddingLeft}"
            y="${paddingTop}"
            width="${chartWidth}"
            height="${chartHeight}"
            rx="10"
            class="dashboard-pipeline-line-frame"
          ></rect>
          ${gridlines}
          <line x1="${paddingLeft}" y1="${(height - paddingBottom).toFixed(2)}" x2="${(width - paddingRight).toFixed(2)}" y2="${(height - paddingBottom).toFixed(2)}" class="dashboard-pipeline-line-baseline"></line>
          ${renderedSeries
            .map(
              (entry) => `
                <path d="${escapeHtml(entry.path)}" class="dashboard-pipeline-line-path ${escapeHtml(entry.tone)}"></path>
                ${entry.points
                  .map(
                    (point) => `
                      <circle
                        cx="${point.x.toFixed(2)}"
                        cy="${point.y.toFixed(2)}"
                        r="3.5"
                        class="dashboard-pipeline-line-point ${escapeHtml(entry.tone)}"
                      ></circle>
                    `
                  )
                  .join("")}
              `
            )
            .join("")}
        </svg>
        ${hasValues ? "" : `<p class="dashboard-command-chart-empty">${escapeHtml(chartEmptyLabel || "No pipeline activity in this window.")}</p>`}
      </div>
      <div class="dashboard-pipeline-line-axis" style="grid-template-columns:repeat(${points.length}, minmax(0, 1fr));">
        ${points
          .map(
            (point) => `
              <span title="${escapeHtml(point.label || point.shortLabel || "")}">${escapeHtml(point.shortLabel || "")}</span>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function buildDashboardRecentActivityFromData(data) {
  const resolveDisplayName = buildNameResolver(data);
  const messageItems = (Array.isArray(data.messages) ? data.messages : [])
    .filter((message) => String(message?.createdAt || "").trim())
    .map((message) => {
      const actor = resolveDisplayName(message.sender || "System") || "System";
      return {
        id: `message-${String(message.id || message.createdAt || actor)}`,
        actor,
        headline: message.linkedLabel ? `${actor} updated ${message.linkedLabel}` : `${actor} posted an update`,
        createdAt: String(message.createdAt || "")
      };
    });

  if (messageItems.length) {
    return messageItems
      .sort((left, right) => Date.parse(String(right.createdAt || "")) - Date.parse(String(left.createdAt || "")))
      .slice(0, 6);
  }

  const fallbackItems = [];
  (Array.isArray(data.leads) ? data.leads : []).forEach((lead) => {
    if (lead?.archived || !String(lead?.updatedAt || lead?.createdAt || "").trim()) {
      return;
    }
    fallbackItems.push({
      id: `lead-${String(lead.id || lead.updatedAt || lead.name)}`,
      actor: String(lead.owner || "CRM").trim() || "CRM",
      headline: `Lead updated: ${String(lead.name || "Untitled lead").trim() || "Untitled lead"}`,
      createdAt: String(lead.updatedAt || lead.createdAt || "")
    });
  });
  (Array.isArray(data.deals) ? data.deals : []).forEach((deal) => {
    if (deal?.archived || !String(deal?.updatedAt || deal?.createdAt || "").trim()) {
      return;
    }
    fallbackItems.push({
      id: `deal-${String(deal.id || deal.updatedAt || deal.name)}`,
      actor: String(deal.owner || "CRM").trim() || "CRM",
      headline: `Deal updated: ${String(deal.name || "Untitled deal").trim() || "Untitled deal"}`,
      createdAt: String(deal.updatedAt || deal.createdAt || "")
    });
  });
  (Array.isArray(data.tasks) ? data.tasks : []).forEach((task) => {
    if (!String(task?.updatedAt || task?.createdAt || "").trim()) {
      return;
    }
    const isCompleted = String(task?.status || "").trim() === "Completed";
    fallbackItems.push({
      id: `task-${String(task.id || task.updatedAt || task.title)}`,
      actor: String(task.assignee || "CRM").trim() || "CRM",
      headline: `${isCompleted ? "Task completed" : "Task updated"}: ${String(task.title || "Untitled task").trim() || "Untitled task"}`,
      createdAt: String(task.updatedAt || task.createdAt || "")
    });
  });
  return fallbackItems
    .sort((left, right) => Date.parse(String(right.createdAt || "")) - Date.parse(String(left.createdAt || "")))
    .slice(0, 6);
}

function buildDashboardModel(data, snapshot) {
  const now = new Date();
  const todayIso = formatLocalIsoDate(now);
  const todayShortDay = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(now);
  const weekStart = dashboardStartOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));
  const previousWeekStart = dashboardStartOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 13));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const leads = (Array.isArray(data?.leads) ? data.leads : []).filter(
    (lead) => !lead?.archived && String(lead?.status || "").trim().toLowerCase() !== "archived"
  );
  const deals = (Array.isArray(data?.deals) ? data.deals : []).filter((deal) => !deal?.archived);
  const openDeals = deals.filter((deal) => !["Won", "Lost", "Closed Won", "Closed Lost"].includes(String(deal?.stage || "").trim()));
  const wonDealsThisMonth = deals.filter((deal) => {
    const stage = String(deal?.stage || "").trim();
    const dateCandidate = String(deal?.closeDate || deal?.updatedAt || deal?.createdAt || "").trim();
    return (stage === "Won" || stage === "Closed Won") && dashboardIsSameMonth(dateCandidate, now);
  });
  const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
  const openTasks = tasks.filter((task) => String(task?.status || "").trim() !== "Completed");
  const overdueTasks = openTasks.filter((task) => {
    const dueDate = String(task?.dueDate || "").trim();
    return Boolean(dueDate) && dueDate < todayIso;
  });
  const staleDeals = openDeals.filter((deal) => dashboardDaysAgo(deal?.updatedAt || deal?.createdAt, now) >= 14);
  const overdueLeadFollowUps = leads.filter((lead) => {
    const nextFollowUp = String(lead?.nextFollowUp || "").trim();
    return Boolean(nextFollowUp) && nextFollowUp < todayIso;
  });
  const callsToday = openTasks.filter(
    (task) => isCallTaskType(task?.taskType) && isTaskScheduledForToday(task, todayIso, todayShortDay)
  );
  const newLeadsThisMonth = leads.filter((lead) => dashboardIsSameMonth(lead?.createdAt, now));
  const newLeadsThisWeek = leads.filter((lead) => {
    const createdAt = dashboardStartOfDay(lead?.createdAt);
    return createdAt instanceof Date && createdAt >= weekStart;
  });
  const newLeadsPreviousWeek = leads.filter((lead) => {
    const createdAt = dashboardStartOfDay(lead?.createdAt);
    return createdAt instanceof Date && createdAt >= previousWeekStart && createdAt < weekStart;
  });
  const pipelineValue = openDeals.reduce((sum, deal) => sum + Number(deal?.value || 0), 0);
  const wonValueThisMonth = wonDealsThisMonth.reduce((sum, deal) => sum + Number(deal?.value || 0), 0);
  const wonDealsLastMonth = deals.filter((deal) => {
    const stage = String(deal?.stage || "").trim();
    const dateCandidate = parseDashboardDate(deal?.closeDate || deal?.updatedAt || deal?.createdAt);
    return (
      (stage === "Won" || stage === "Closed Won") &&
      dateCandidate instanceof Date &&
      dateCandidate >= previousMonthStart &&
      dateCandidate < monthStart
    );
  });
  const atRiskCount = overdueLeadFollowUps.length + overdueTasks.length;
  const leadStatusCount = (status) =>
    leads.filter((lead) => String(lead?.status || "").trim().toLowerCase() === String(status || "").trim().toLowerCase()).length;
  const convertedLeadCount = leadStatusCount("Converted");
  const leadBase = Math.max(leads.length, 1);
  const pipelineTrendSeries = [
    { key: "new", label: "New", tone: "is-new", statuses: ["New"] },
    { key: "contacted", label: "Contacted", tone: "is-contacted", statuses: ["Contacted"] },
    { key: "qualified", label: "Qualified", tone: "is-qualified", statuses: ["Qualified"] },
    { key: "won", label: "Won / Converted", tone: "is-won", statuses: ["Converted", "Won"] }
  ];
  const pipelineTrendDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (6 - index));
    return {
      date,
      iso: formatLocalIsoDate(date),
      label: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      shortLabel: date.toLocaleDateString("en-US", { weekday: "short" }),
      values: {
        new: 0,
        contacted: 0,
        qualified: 0,
        won: 0
      }
    };
  });
  const pipelineTrendLookup = new Map(pipelineTrendDays.map((point) => [point.iso, point]));
  leads.forEach((lead) => {
    const meta = lead?.meta && typeof lead.meta === "object" ? lead.meta : {};
    const status = String(meta.lastStatusChangedTo || lead?.status || "").trim();
    const stage = pipelineTrendSeries.find((entry) => entry.statuses.includes(status));
    if (!stage) {
      return;
    }
    const changedAt = String(meta.lastStatusChangedAt || lead?.updatedAt || lead?.createdAt || "").trim();
    const changedDate = formatLocalIsoDate(changedAt);
    if (!changedDate) {
      return;
    }
    const bucket = pipelineTrendLookup.get(changedDate);
    if (!bucket) {
      return;
    }
    bucket.values[stage.key] += 1;
  });
  const pipelineTrendMaxValue = Math.max(
    1,
    ...pipelineTrendDays.flatMap((point) => pipelineTrendSeries.map((entry) => Number(point.values?.[entry.key] || 0)))
  );
  const pipelineTrend = buildDashboardTrend(openDeals.length, Math.max(1, openDeals.length - Math.max(1, wonDealsThisMonth.length)), "vs recent pace");
  const newLeadTrend = buildDashboardTrend(newLeadsThisWeek.length, newLeadsPreviousWeek.length, "vs last week");
  const wonTrend = buildDashboardTrend(wonDealsThisMonth.length, wonDealsLastMonth.length, "vs last month");
  const attentionItems = [
    ...overdueLeadFollowUps.map((lead) => {
      const overdueDays = Math.max(1, dashboardDaysAgo(lead?.nextFollowUp, now));
      return {
        key: `attention-lead-${String(lead?.id || lead?.name || overdueDays)}`,
        eyebrow: "Lead follow-up",
        title: String(lead?.name || "Unnamed lead").trim() || "Unnamed lead",
        meta: `${String(lead?.company || "No company").trim() || "No company"} | ${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue`,
        chip: "Overdue",
        tone: "overdue",
        priority: 400 + overdueDays,
        actionAttr: `data-lead-open="${escapeHtml(String(lead?.id || ""))}"`
      };
    }),
    ...overdueTasks.map((task) => {
      const overdueDays = Math.max(1, dashboardDaysAgo(task?.dueDate, now));
      return {
        key: `attention-task-${String(task?.id || task?.title || overdueDays)}`,
        eyebrow: String(task?.taskType || "Task").trim() || "Task",
        title: String(task?.title || "Untitled task").trim() || "Untitled task",
        meta: `${String(task?.assignee || "Unassigned").trim() || "Unassigned"} | ${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue`,
        chip: "Late",
        tone: "late",
        priority: 300 + overdueDays,
        actionAttr: `data-task-open="${escapeHtml(String(task?.id || ""))}" data-card-menu="task" data-id="${escapeHtml(String(task?.id || ""))}"`
      };
    }),
    ...staleDeals.map((deal) => {
        const staleDays = Math.max(14, dashboardDaysAgo(deal?.updatedAt || deal?.createdAt, now));
        return {
          key: `attention-deal-${String(deal?.id || deal?.name || staleDays)}`,
          eyebrow: "Deal at risk",
          title: String(deal?.name || "Untitled deal").trim() || "Untitled deal",
          meta: `${String(deal?.account || "No account").trim() || "No account"} | ${staleDays} days without movement`,
          chip: "Stale",
          tone: "stale",
          priority: 200 + staleDays,
          actionAttr: `data-deal-open="${escapeHtml(String(deal?.id || ""))}"`
        };
      })
  ]
    .sort((left, right) => right.priority - left.priority || String(left.title || "").localeCompare(String(right.title || "")))
    .slice(0, 6);
  const attentionSummary = [
    {
      key: "overdue",
      label: "Overdue Follow-ups",
      count: overdueLeadFollowUps.length,
      tone: "overdue",
      color: "#d55a35"
    },
    {
      key: "tasks",
      label: "Overdue Tasks",
      count: overdueTasks.length,
      tone: "late",
      color: "#d89018"
    },
    {
      key: "stale",
      label: "Stale Deals",
      count: staleDeals.length,
      tone: "stale",
      color: "#6f58d8"
    }
  ];
  const attentionCount = attentionSummary.reduce((sum, item) => sum + Math.max(0, Number(item.count || 0)), 0);
  const statusDistributionOrder = [
    { key: "contacted", label: "Contacted", color: "#1f84f1" },
    { key: "new", label: "New", color: "#20b486" },
    { key: "qualified", label: "Qualified", color: "#f5a623" },
    { key: "lost", label: "Lost", color: "#e25555" }
  ];
  const statusDistributionCounts = {
    contacted: 0,
    new: 0,
    qualified: 0,
    lost: 0
  };
  leadsInRange.forEach((lead) => {
    const normalizedStatus = String(lead?.status || "").trim().toLowerCase();
    if (normalizedStatus === "contacted") {
      statusDistributionCounts.contacted += 1;
      return;
    }
    if (normalizedStatus === "new") {
      statusDistributionCounts.new += 1;
      return;
    }
    if (normalizedStatus === "qualified" || normalizedStatus === "converted") {
      statusDistributionCounts.qualified += 1;
      return;
    }
    if (normalizedStatus === "lost" || normalizedStatus === "unqualified") {
      statusDistributionCounts.lost += 1;
    }
  });
  const statusDistributionTotal = statusDistributionOrder.reduce(
    (sum, item) => sum + Math.max(0, Number(statusDistributionCounts[item.key] || 0)),
    0
  );
  const statusDistribution = statusDistributionOrder.map((item) => {
    const count = Math.max(0, Number(statusDistributionCounts[item.key] || 0));
    return {
      ...item,
      count,
      percent: statusDistributionTotal ? Math.round((count / statusDistributionTotal) * 100) : 0
    };
  });
  const statusDistributionFeatured =
    statusDistribution.find((item) => item.count === Math.max(...statusDistribution.map((entry) => entry.count))) ||
    statusDistribution[0];
  const proposalStageSet = new Set(["Proposal", "Negotiation"]);
  const salesFunnelStages = [
    { key: "leads", label: "Leads", count: leadsInRange.length, tone: "leads" },
    {
      key: "contacted",
      label: "Contacted",
      count: leadsInRange.filter((lead) => String(lead?.status || "").trim() === "Contacted").length,
      tone: "contacted"
    },
    {
      key: "qualified",
      label: "Qualified",
      count: leadsInRange.filter((lead) => String(lead?.status || "").trim() === "Qualified").length,
      tone: "qualified"
    },
    {
      key: "proposal",
      label: "Proposal",
      count: deals.filter((deal) => {
        const stage = String(deal?.stage || "").trim();
        return proposalStageSet.has(stage) && dashboardDateInWindow(deal?.updatedAt || deal?.createdAt, rangeMeta.start, rangeMeta.end);
      }).length,
      tone: "proposal"
    },
    { key: "closed", label: "Closed", count: wonDealsInRange.length, tone: "closed" }
  ];
  const salesFunnelRows = salesFunnelStages.map((stage) => ({
    ...stage,
    barWidth: Math.max(
      0,
      Math.min(
        100,
        (Number(stage.count || 0) / Math.max(1, ...salesFunnelStages.map((entry) => Number(entry.count || 0)))) * 100
      )
    )
  }));
  const salesFunnelNote = salesFunnelStages.some((stage) => Number(stage.count || 0) > 0)
    ? ""
    : `No funnel activity in ${rangeLabelLower}.`;
  const activeTeamMembers = (Array.isArray(data?.teamMembers) ? data.teamMembers : [])
    .filter((member) => String(member?.name || "").trim())
    .filter((member) => normalizeTeamMemberStatus(member?.status) !== "invited");
  const teamRows = activeTeamMembers
    .map((member) => {
      const memberLeads = leads.filter((lead) => dashboardMemberMatchesRecord(member, lead?.ownerId, lead?.owner));
      const memberOpenDeals = openDeals.filter((deal) => dashboardMemberMatchesRecord(member, deal?.ownerId, deal?.owner));
      const memberOverdueFollowUps = overdueLeadFollowUps.filter((lead) => dashboardMemberMatchesRecord(member, lead?.ownerId, lead?.owner));
      const memberOpenTasks = openTasks.filter((task) => dashboardMemberMatchesRecord(member, task?.assigneeId, task?.assignee));
      return {
        id: String(member?.id || member?.email || member?.name).trim(),
        name: String(member?.name || "Unknown").trim() || "Unknown",
        initials: getDashboardInitials(member?.name),
        role: String(member?.role || "Member").trim() || "Member",
        status: String(member?.status || "Active").trim() || "Active",
        leads: memberLeads.length,
        openDeals: memberOpenDeals.length,
        overdueFollowUps: memberOverdueFollowUps.length,
        openTasks: memberOpenTasks.length
      };
    })
    .sort((left, right) => {
      if (right.overdueFollowUps !== left.overdueFollowUps) {
        return right.overdueFollowUps - left.overdueFollowUps;
      }
      if (right.openDeals !== left.openDeals) {
        return right.openDeals - left.openDeals;
      }
      if (right.leads !== left.leads) {
        return right.leads - left.leads;
      }
      return String(left.name || "").localeCompare(String(right.name || ""), undefined, { sensitivity: "base" });
    });
  const sourceMap = new Map();
  leads.forEach((lead) => {
    const sourceLabel = String(lead?.source || "").trim() || "Not set";
    const key = sourceLabel.toLowerCase();
    if (!sourceMap.has(key)) {
      sourceMap.set(key, { key, label: sourceLabel, count: 0, qualified: 0, converted: 0 });
    }
    const bucket = sourceMap.get(key);
    bucket.count += 1;
    if (String(lead?.status || "").trim() === "Qualified") {
      bucket.qualified += 1;
    }
    if (String(lead?.status || "").trim() === "Converted") {
      bucket.converted += 1;
    }
  });
  const sourceRows = [...sourceMap.values()]
    .sort((left, right) => {
      if (right.converted !== left.converted) {
        return right.converted - left.converted;
      }
      if (right.qualified !== left.qualified) {
        return right.qualified - left.qualified;
      }
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return String(left.label || "").localeCompare(String(right.label || ""), undefined, { sensitivity: "base" });
    })
    .slice(0, 5)
    .map((row) => ({
      ...row,
      shareLabel: `${Math.round((row.count / leadBase) * 100)}% share`,
      meta: `${dashboardCountLabel(row.count, "lead")} • ${dashboardCountLabel(row.qualified, "qualified")}`
    }));
  const ownerRows = teamRows
    .map((member) => {
      const qualifiedLeads = leads.filter(
        (lead) =>
          dashboardMemberMatchesRecord({ id: member.id, name: member.name }, lead?.ownerId, lead?.owner) &&
          String(lead?.status || "").trim() === "Qualified"
      ).length;
      const convertedLeads = leads.filter(
        (lead) =>
          dashboardMemberMatchesRecord({ id: member.id, name: member.name }, lead?.ownerId, lead?.owner) &&
          String(lead?.status || "").trim() === "Converted"
      ).length;
      return {
        ...member,
        qualifiedLeads,
        convertedLeads,
        meta: `${dashboardCountLabel(member.openDeals, "open deal")} • ${dashboardCountLabel(member.overdueFollowUps, "overdue follow-up")}`
      };
    })
    .sort((left, right) => {
      if (right.qualifiedLeads !== left.qualifiedLeads) {
        return right.qualifiedLeads - left.qualifiedLeads;
      }
      if (right.convertedLeads !== left.convertedLeads) {
        return right.convertedLeads - left.convertedLeads;
      }
      if (right.openDeals !== left.openDeals) {
        return right.openDeals - left.openDeals;
      }
      return String(left.name || "").localeCompare(String(right.name || ""), undefined, { sensitivity: "base" });
    })
    .slice(0, 5);
  const tomorrowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const tomorrowIso = formatLocalIsoDate(tomorrowDate);
  const noFollowUpCount = leads.filter((lead) => !String(lead?.nextFollowUp || "").trim()).length;
  const followUpPressure = [
    {
      key: "today",
      label: "Today",
      count: leads.filter((lead) => String(lead?.nextFollowUp || "").trim() === todayIso).length,
      meta: dashboardCountLabel(callsToday.length, "scheduled call"),
      tone: "today"
    },
    {
      key: "tomorrow",
      label: "Tomorrow",
      count: leads.filter((lead) => String(lead?.nextFollowUp || "").trim() === tomorrowIso).length,
      meta: "Next queue",
      tone: "tomorrow"
    },
    {
      key: "overdue",
      label: "Overdue",
      count: overdueLeadFollowUps.length,
      meta: dashboardCountLabel(overdueTasks.length, "task"),
      tone: "overdue"
    },
    {
      key: "unscheduled",
      label: "Not set",
      count: noFollowUpCount,
      meta: "Needs ownership",
      tone: "unscheduled"
    }
  ];
  const recentActivity =
    hasSnapshot && Array.isArray(snapshot?.recentActivity) && snapshot.recentActivity.length
      ? snapshot.recentActivity.slice(0, 6).map((item) => ({
          id: `activity-${String(item?.createdAt || item?.actor || item?.headline || "")}`,
          actor: String(item?.actor || "System").trim() || "System",
          headline: String(item?.headline || "Updated the workspace").trim() || "Updated the workspace",
          createdAt: String(item?.createdAt || "")
        }))
      : buildDashboardRecentActivityFromData(data);
  return {
    kpis: [
      {
        id: "new-leads",
        icon: "bi-person-plus",
        label: "New Leads",
        value: new Intl.NumberFormat("en-US").format(newLeadsThisMonth.length),
        note: `${newLeadTrend.isUp ? "+" : "-"}${newLeadTrend.percentLabel} vs last week`,
        tone: "new-leads"
      },
      {
        id: "pipeline",
        icon: "bi-graph-up-arrow",
        label: "Open Pipeline Value",
        value: formatCompactMoney(pipelineValue),
        note: `${dashboardCountLabel(openDeals.length, "open deal")} across stages`,
        tone: "pipeline"
      },
      {
        id: "won-month",
        icon: "bi-trophy",
        label: "Won This Month",
        value: formatCompactMoney(wonValueThisMonth),
        note: `${wonTrend.isUp ? "+" : "-"}${wonTrend.percentLabel} vs last month`,
        tone: "won-month"
      },
      {
        id: "at-risk",
        icon: "bi-exclamation-triangle",
        label: "At-Risk Follow-Ups",
        value: new Intl.NumberFormat("en-US").format(atRiskCount),
        note: `${dashboardCountLabel(overdueLeadFollowUps.length, "follow-up")} • ${dashboardCountLabel(overdueTasks.length, "task")}`,
        tone: "at-risk"
      }
    ],
    pipelineTrendDataset: {
      points: pipelineTrendDays,
      series: pipelineTrendSeries,
      maxValue: pipelineTrendMaxValue
    },
    attentionCount,
    attentionItems,
    attentionSummary,
    sourceRows,
    ownerRows,
    followUpPressure,
    recentActivity: recentActivity.slice(0, 4),
    pipelineSummary: `${dashboardCountLabel(openDeals.length, "open deal")} • ${formatCompactMoney(pipelineValue)}`,
    pipelineTrendNote: `${pipelineTrend.isUp ? "+" : "-"}${pipelineTrend.percentLabel} ${pipelineTrend.compareLabel}`
  };
}

function renderDashboardShell(model) {
  const kpiCards = (model.kpis || [])
    .map(
      (kpi) => `
        <article class="dashboard-insight-kpi is-${escapeHtml(kpi.tone || kpi.id)}" data-live-key="kpi-${escapeHtml(String(kpi.id || kpi.label || ""))}">
          <span class="dashboard-insight-kpi-icon" aria-hidden="true"><i class="bi ${escapeHtml(kpi.icon)}"></i></span>
          <div class="dashboard-insight-kpi-copy">
            <p class="dashboard-insight-kpi-label">${escapeHtml(kpi.label)}</p>
            <p class="dashboard-insight-kpi-value">${escapeHtml(kpi.value)}</p>
            <p class="dashboard-insight-kpi-note">${escapeHtml(kpi.note)}</p>
          </div>
        </article>
      `
    )
    .join("");

  const pipelineTrendChart = renderDashboardPipelineTrendChart(
    model.pipelineTrendDataset,
    "No stage activity across the last 7 days."
  );

  const attentionRows = (model.attentionItems || [])
    .map(
      (item) => `
        <article class="dashboard-attention-item is-${escapeHtml(item.tone)}" ${item.actionAttr} data-live-key="${escapeHtml(item.key)}">
          <div class="dashboard-attention-copy">
            <p class="dashboard-attention-eyebrow">${escapeHtml(item.eyebrow)}</p>
            <p class="dashboard-attention-title">${escapeHtml(item.title)}</p>
            <p class="dashboard-attention-meta">${escapeHtml(item.meta)}</p>
          </div>
          <span class="dashboard-attention-chip">${escapeHtml(item.chip)}</span>
        </article>
      `
    )
    .join("");

  const attentionTotal = Math.max(
    0,
    (model.attentionSummary || []).reduce((sum, item) => sum + Number(item.count || 0), 0)
  );
  let attentionProgress = 0;
  const attentionChartBackground =
    attentionTotal > 0
      ? `conic-gradient(${(model.attentionSummary || [])
          .map((item) => {
            const start = attentionProgress;
            const share = (Math.max(0, Number(item.count || 0)) / attentionTotal) * 100;
            attentionProgress += share;
            return `${item.color} ${start.toFixed(2)}% ${attentionProgress.toFixed(2)}%`;
          })
          .join(", ")})`
      : "conic-gradient(#edf2f8 0 100%)";
  const attentionStats = (model.attentionSummary || [])
    .map(
      (item) => `
        <article class="dashboard-attention-stat is-${escapeHtml(item.tone || item.key || "")}">
          <span class="dashboard-attention-stat-swatch" aria-hidden="true"></span>
          <div class="dashboard-attention-stat-copy">
            <strong>${escapeHtml(item.label)}</strong>
            <span>${escapeHtml(new Intl.NumberFormat("en-US").format(item.count || 0))}</span>
          </div>
        </article>
      `
    )
    .join("");
  const activityRows = (model.recentActivity || [])
    .map((item) => {
      const relative = formatRelativeTime(item.createdAt);
      const relativeLabel = relative && relative !== "now" ? `${relative} ago` : relative || formatShortDate(item.createdAt);
      return `
        <article class="dashboard-insight-activity-item" data-live-key="activity-${escapeHtml(String(item.id || item.createdAt || item.headline || ""))}">
          <span class="dashboard-insight-activity-avatar">${escapeHtml(getDashboardInitials(item.actor))}</span>
          <div class="dashboard-insight-activity-body">
            <p class="dashboard-insight-activity-title">${escapeHtml(item.headline)}</p>
            <p class="dashboard-insight-activity-meta">${escapeHtml(item.actor)} • ${escapeHtml(relativeLabel)}</p>
          </div>
        </article>
      `;
    })
    .join("");

  return {
    title: "Dashboard",
    subtitle: "CRM insights and funnel health",
    primaryAction: "Add Task",
    showWaitingPanel: false,
    html: `
      <section class="dashboard-v3 dashboard-insights" data-dashboard-live-root>
        <section class="dashboard-insight-kpis" data-dashboard-region="kpis">
          ${kpiCards}
        </section>

        <section class="dashboard-insight-main">
          <article class="dashboard-insight-panel">
            <header class="dashboard-insight-head">
              <div>
                <p class="dashboard-insight-kicker">Pipeline Trend</p>
                <h3>How lead stages are moving this week</h3>
              </div>
              <span class="dashboard-insight-note" data-dashboard-region="pipeline-summary">${escapeHtml(model.pipelineSummary)}</span>
            </header>
            <div class="dashboard-pipeline-chart-shell" data-dashboard-region="funnel">
              ${pipelineTrendChart}
            </div>
            <footer class="dashboard-insight-footnote" data-dashboard-region="pipeline-footnote">${escapeHtml(model.pipelineTrendNote)}</footer>
          </article>

          <article class="dashboard-insight-panel">
            <header class="dashboard-insight-head">
              <div>
                <p class="dashboard-insight-kicker">Needs Attention</p>
                <h3>What needs action now</h3>
              </div>
              <span class="dashboard-insight-note is-alert" data-dashboard-region="attention-note">${escapeHtml(new Intl.NumberFormat("en-US").format(model.attentionCount || 0))}</span>
            </header>
            <div class="dashboard-attention-visual-shell" data-dashboard-region="attention">
              <article class="dashboard-attention-visual" data-live-key="attention-visual">
                <div class="dashboard-attention-chart-shell">
                  <div class="dashboard-attention-donut" style="background:${escapeHtml(attentionChartBackground)}">
                    <div class="dashboard-attention-donut-center">
                      <strong>${escapeHtml(new Intl.NumberFormat("en-US").format(attentionTotal))}</strong>
                      <span>issues</span>
                    </div>
                  </div>
                  <div class="dashboard-attention-stats">
                    ${attentionStats}
                  </div>
                </div>
              </article>
            </div>
          </article>
        </section>

        <section class="dashboard-insight-bottom dashboard-insight-bottom-single">
          <article class="dashboard-insight-panel dashboard-insight-panel-activity">
            <header class="dashboard-insight-head">
              <div>
                <p class="dashboard-insight-kicker">Recent Activity</p>
                <h3>Latest workspace updates</h3>
              </div>
            </header>
            <div class="dashboard-insight-activity-feed" data-dashboard-region="activity">
              ${activityRows || "<p class='task-meta' data-live-key='activity-empty'>No recent activity yet.</p>"}
            </div>
          </article>
        </section>
      </section>
    `
  };
}

function buildDashboardCommandModel(data, snapshot, uiState = {}) {
  const dashboardUiState = normalizeDashboardUiState(uiState);
  const now = new Date();
  const memoKey = buildDashboardCommandModelCacheKey(data || {}, snapshot, dashboardUiState, now);
  if (dashboardCommandModelMemo.key === memoKey && dashboardCommandModelMemo.model) {
    return dashboardCommandModelMemo.model;
  }
  const todayIso = formatLocalIsoDate(now);
  const todayShortDay = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(now);
  const rangeMeta = buildDashboardRangeMeta(dashboardUiState.range, now);
  const snapshotRange = String(snapshot?.range || "").trim().toLowerCase();
  const snapshotMatchesRange =
    Boolean(snapshot && typeof snapshot === "object") &&
    snapshot?.schemaVersion === "command-sections-v3" &&
    snapshotRange === dashboardUiState.range;
  const hasSnapshot = snapshotMatchesRange && Boolean(String(snapshot?.generatedAt || "").trim());
  const snapshotKpis = snapshot?.kpis && typeof snapshot.kpis === "object" ? snapshot.kpis : {};
  const snapshotKpiNumber = (key, field = "value") => {
    const numeric = Number(snapshotKpis?.[key]?.[field]);
    return Number.isFinite(numeric) ? numeric : 0;
  };
  const leads = (Array.isArray(data?.leads) ? data.leads : []).filter(
    (lead) => !lead?.archived && String(lead?.status || "").trim().toLowerCase() !== "archived"
  );
  const deals = (Array.isArray(data?.deals) ? data.deals : []).filter((deal) => !deal?.archived);
  const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
  const openDeals = deals.filter(
    (deal) => !["Won", "Lost", "Closed Won", "Closed Lost"].includes(String(deal?.stage || "").trim())
  );
  const openTasks = tasks.filter((task) => String(task?.status || "").trim() !== "Completed");
  const overdueTasks = openTasks.filter((task) => {
    const dueDate = String(task?.dueDate || "").trim();
    return Boolean(dueDate) && dueDate < todayIso;
  });
  const overdueLeadFollowUps = leads.filter((lead) => {
    const nextFollowUp = String(lead?.nextFollowUp || "").trim();
    return Boolean(nextFollowUp) && nextFollowUp < todayIso;
  });
  const staleDeals = openDeals.filter((deal) => dashboardDaysAgo(deal?.updatedAt || deal?.createdAt, now) >= 14);
  const callsToday = openTasks.filter(
    (task) => isCallTaskType(task?.taskType) && isTaskScheduledForToday(task, todayIso, todayShortDay)
  );
  const pipelineValue = openDeals.reduce((sum, deal) => sum + Number(deal?.value || 0), 0);
  const atRiskCount = overdueLeadFollowUps.length + overdueTasks.length;
  const rangeLabelLower = String(rangeMeta.label || "selected window").toLowerCase();
  const pipelineTrendSeries = [
    { key: "new", label: "New", tone: "is-new", statuses: ["New"] },
    { key: "contacted", label: "Contacted", tone: "is-contacted", statuses: ["Contacted"] },
    { key: "qualified", label: "Qualified", tone: "is-qualified", statuses: ["Qualified"] },
    { key: "won", label: "Won / Converted", tone: "is-won", statuses: ["Converted", "Won"] }
  ];
  const pipelineTrendPoints = (Array.isArray(rangeMeta.points) ? rangeMeta.points : []).map((point) => ({
    ...point,
    values: {
      new: 0,
      contacted: 0,
      qualified: 0,
      won: 0
    }
  }));

  leads.forEach((lead) => {
    const meta = lead?.meta && typeof lead.meta === "object" ? lead.meta : {};
    const status = String(meta.lastStatusChangedTo || lead?.status || "").trim();
    const seriesEntry = pipelineTrendSeries.find((entry) => entry.statuses.includes(status));
    if (!seriesEntry) {
      return;
    }
    const changedAt = meta.lastStatusChangedAt || lead?.updatedAt || lead?.createdAt;
    const bucket = findDashboardPoint(pipelineTrendPoints, changedAt);
    if (!bucket || !dashboardDateInWindow(changedAt, rangeMeta.start, rangeMeta.end)) {
      return;
    }
    bucket.values[seriesEntry.key] += 1;
  });

  const currentStageMovements = pipelineTrendPoints.reduce(
    (sum, point) => sum + pipelineTrendSeries.reduce((seriesSum, entry) => seriesSum + Number(point.values?.[entry.key] || 0), 0),
    0
  );
  const previousStageMovements = leads.reduce((sum, lead) => {
    const meta = lead?.meta && typeof lead.meta === "object" ? lead.meta : {};
    const status = String(meta.lastStatusChangedTo || lead?.status || "").trim();
    const matchesStage = pipelineTrendSeries.some((entry) => entry.statuses.includes(status));
    if (!matchesStage) {
      return sum;
    }
    const changedAt = meta.lastStatusChangedAt || lead?.updatedAt || lead?.createdAt;
    return dashboardDateInWindow(changedAt, rangeMeta.previousStart, rangeMeta.previousEnd) ? sum + 1 : sum;
  }, 0);
  const pipelineTrendMaxValue = Math.max(
    1,
    ...pipelineTrendPoints.flatMap((point) => pipelineTrendSeries.map((entry) => Number(point.values?.[entry.key] || 0)))
  );
  const leadsInRange = leads.filter((lead) => dashboardDateInWindow(lead?.createdAt, rangeMeta.start, rangeMeta.end));
  const leadsInPreviousRange = leads.filter((lead) =>
    dashboardDateInWindow(lead?.createdAt, rangeMeta.previousStart, rangeMeta.previousEnd)
  );
  const wonDealsInRange = deals.filter((deal) => {
    const stage = String(deal?.stage || "").trim();
    const wonDate = deal?.closeDate || deal?.updatedAt || deal?.createdAt;
    return (stage === "Won" || stage === "Closed Won") && dashboardDateInWindow(wonDate, rangeMeta.start, rangeMeta.end);
  });
  const wonDealsInPreviousRange = deals.filter((deal) => {
    const stage = String(deal?.stage || "").trim();
    const wonDate = deal?.closeDate || deal?.updatedAt || deal?.createdAt;
    return (
      (stage === "Won" || stage === "Closed Won") &&
      dashboardDateInWindow(wonDate, rangeMeta.previousStart, rangeMeta.previousEnd)
    );
  });
  const wonValueInRange = wonDealsInRange.reduce((sum, deal) => sum + Number(deal?.value || 0), 0);
  const wonValueInPreviousRange = wonDealsInPreviousRange.reduce((sum, deal) => sum + Number(deal?.value || 0), 0);
  const newLeadSparkPoints = buildDashboardMetricPointValues(rangeMeta.points, leads, (lead) => lead?.createdAt);
  const pipelineValueSparkPoints = buildDashboardMetricPointValues(
    rangeMeta.points,
    openDeals,
    (deal) => deal?.updatedAt || deal?.createdAt,
    (deal) => Number(deal?.value || 0)
  );
  const wonSparkPoints = buildDashboardMetricPointValues(
    rangeMeta.points,
    deals,
    (deal) => deal?.closeDate || deal?.updatedAt || deal?.createdAt,
    (deal) => Number(deal?.value || 0),
    (deal) => ["Won", "Closed Won"].includes(String(deal?.stage || "").trim())
  );
  const riskSparkPoints = [
    { label: "Follow-ups", value: overdueLeadFollowUps.length },
    { label: "Tasks", value: overdueTasks.length },
    { label: "Deals", value: staleDeals.length },
    { label: "Calls", value: callsToday.length }
  ];
  const attentionItems = [
    ...overdueLeadFollowUps.map((lead) => {
      const overdueDays = Math.max(1, dashboardDaysAgo(lead?.nextFollowUp, now));
      return {
        key: `attention-lead-${String(lead?.id || lead?.name || overdueDays)}`,
        eyebrow: "Lead follow-up",
        title: String(lead?.name || "Unnamed lead").trim() || "Unnamed lead",
        meta: `${String(lead?.company || "No company").trim() || "No company"} | ${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue`,
        chip: "Overdue",
        tone: "overdue",
        priority: 400 + overdueDays,
        actionAttr: `data-lead-open="${escapeHtml(String(lead?.id || ""))}"`
      };
    }),
    ...overdueTasks.map((task) => {
      const overdueDays = Math.max(1, dashboardDaysAgo(task?.dueDate, now));
      return {
        key: `attention-task-${String(task?.id || task?.title || overdueDays)}`,
        eyebrow: String(task?.taskType || "Task").trim() || "Task",
        title: String(task?.title || "Untitled task").trim() || "Untitled task",
        meta: `${String(task?.assignee || "Unassigned").trim() || "Unassigned"} | ${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue`,
        chip: "Late",
        tone: "late",
        priority: 300 + overdueDays,
        actionAttr: `data-task-open="${escapeHtml(String(task?.id || ""))}" data-card-menu="task" data-id="${escapeHtml(String(task?.id || ""))}"`
      };
    }),
    ...staleDeals.map((deal) => {
      const staleDays = Math.max(14, dashboardDaysAgo(deal?.updatedAt || deal?.createdAt, now));
      return {
        key: `attention-deal-${String(deal?.id || deal?.name || staleDays)}`,
        eyebrow: "Deal at risk",
        title: String(deal?.name || "Untitled deal").trim() || "Untitled deal",
        meta: `${String(deal?.account || "No account").trim() || "No account"} | ${staleDays} days without movement`,
        chip: "Stale",
        tone: "stale",
        priority: 200 + staleDays,
        actionAttr: `data-deal-open="${escapeHtml(String(deal?.id || ""))}"`
      };
    })
  ]
    .sort((left, right) => right.priority - left.priority || String(left.title || "").localeCompare(String(right.title || "")))
    .slice(0, 6);
  const attentionSummary = [
    {
      key: "overdue",
      label: "Overdue Follow-ups",
      count: overdueLeadFollowUps.length,
      tone: "overdue",
      color: "#d55a35"
    },
    {
      key: "tasks",
      label: "Overdue Tasks",
      count: overdueTasks.length,
      tone: "late",
      color: "#d89018"
    },
    {
      key: "stale",
      label: "Stale Deals",
      count: staleDeals.length,
      tone: "stale",
      color: "#6f58d8"
    }
  ];
  const attentionCount = attentionSummary.reduce((sum, item) => sum + Math.max(0, Number(item.count || 0)), 0);
  const statusDistributionOrder = [
    { key: "contacted", label: "Contacted", color: "#1f84f1" },
    { key: "new", label: "New", color: "#20b486" },
    { key: "qualified", label: "Qualified", color: "#f5a623" },
    { key: "lost", label: "Lost", color: "#e25555" }
  ];
  const statusDistributionCounts = {
    contacted: 0,
    new: 0,
    qualified: 0,
    lost: 0
  };
  leadsInRange.forEach((lead) => {
    const normalizedStatus = String(lead?.status || "").trim().toLowerCase();
    if (normalizedStatus === "contacted") {
      statusDistributionCounts.contacted += 1;
      return;
    }
    if (normalizedStatus === "new") {
      statusDistributionCounts.new += 1;
      return;
    }
    if (normalizedStatus === "qualified" || normalizedStatus === "converted") {
      statusDistributionCounts.qualified += 1;
      return;
    }
    if (normalizedStatus === "lost" || normalizedStatus === "unqualified") {
      statusDistributionCounts.lost += 1;
    }
  });
  const statusDistributionTotal = statusDistributionOrder.reduce(
    (sum, item) => sum + Math.max(0, Number(statusDistributionCounts[item.key] || 0)),
    0
  );
  const statusDistribution = statusDistributionOrder.map((item) => {
    const count = Math.max(0, Number(statusDistributionCounts[item.key] || 0));
    return {
      ...item,
      count,
      percent: statusDistributionTotal ? Math.round((count / statusDistributionTotal) * 100) : 0
    };
  });
  const statusDistributionFeatured =
    statusDistribution.find((item) => item.count === Math.max(...statusDistribution.map((entry) => entry.count))) ||
    statusDistribution[0];
  const proposalStageSet = new Set(["Proposal", "Negotiation"]);
  const salesFunnelStages = [
    { key: "leads", label: "Leads", count: leadsInRange.length, tone: "leads" },
    {
      key: "contacted",
      label: "Contacted",
      count: leadsInRange.filter((lead) => String(lead?.status || "").trim() === "Contacted").length,
      tone: "contacted"
    },
    {
      key: "qualified",
      label: "Qualified",
      count: leadsInRange.filter((lead) => String(lead?.status || "").trim() === "Qualified").length,
      tone: "qualified"
    },
    {
      key: "proposal",
      label: "Proposal",
      count: deals.filter((deal) => {
        const stage = String(deal?.stage || "").trim();
        return proposalStageSet.has(stage) && dashboardDateInWindow(deal?.updatedAt || deal?.createdAt, rangeMeta.start, rangeMeta.end);
      }).length,
      tone: "proposal"
    },
    { key: "closed", label: "Closed", count: wonDealsInRange.length, tone: "closed" }
  ];
  const salesFunnelRows = salesFunnelStages.map((stage) => ({
    ...stage,
    barWidth: Math.max(
      0,
      Math.min(
        100,
        (Number(stage.count || 0) / Math.max(1, ...salesFunnelStages.map((entry) => Number(entry.count || 0)))) * 100
      )
    )
  }));
  const salesFunnelNote = salesFunnelStages.some((stage) => Number(stage.count || 0) > 0)
    ? ""
    : `No funnel activity in ${rangeLabelLower}.`;
  const activeTeamMembers = (Array.isArray(data?.teamMembers) ? data.teamMembers : [])
    .filter((member) => String(member?.name || "").trim())
    .filter((member) => normalizeTeamMemberStatus(member?.status) !== "invited");
  const teamRows = activeTeamMembers
    .map((member) => {
      const memberLeads = leads.filter((lead) => dashboardMemberMatchesRecord(member, lead?.ownerId, lead?.owner));
      const memberOpenDeals = openDeals.filter((deal) => dashboardMemberMatchesRecord(member, deal?.ownerId, deal?.owner));
      const memberOverdueFollowUps = overdueLeadFollowUps.filter((lead) =>
        dashboardMemberMatchesRecord(member, lead?.ownerId, lead?.owner)
      );
      const memberOpenTasks = openTasks.filter((task) =>
        dashboardMemberMatchesRecord(member, task?.assigneeId, task?.assignee)
      );
      return {
        id: String(member?.id || member?.email || member?.name).trim(),
        name: String(member?.name || "Unknown").trim() || "Unknown",
        initials: getDashboardInitials(member?.name),
        role: String(member?.role || "Member").trim() || "Member",
        leads: memberLeads.length,
        openDeals: memberOpenDeals.length,
        overdueFollowUps: memberOverdueFollowUps.length,
        openTasks: memberOpenTasks.length
      };
    })
    .sort((left, right) => {
      if (right.overdueFollowUps !== left.overdueFollowUps) {
        return right.overdueFollowUps - left.overdueFollowUps;
      }
      if (right.openDeals !== left.openDeals) {
        return right.openDeals - left.openDeals;
      }
      if (right.leads !== left.leads) {
        return right.leads - left.leads;
      }
      return String(left.name || "").localeCompare(String(right.name || ""), undefined, { sensitivity: "base" });
    });
  const sourceMetricKey = dashboardUiState.sourceMetric === "volume" ? "count" : "converted";
  const sourceMap = new Map();
  leadsInRange.forEach((lead) => {
    const sourceLabel = String(lead?.source || "").trim() || "Not set";
    const key = sourceLabel.toLowerCase();
    if (!sourceMap.has(key)) {
      sourceMap.set(key, { key, label: sourceLabel, count: 0, qualified: 0, converted: 0 });
    }
    const bucket = sourceMap.get(key);
    bucket.count += 1;
    if (String(lead?.status || "").trim() === "Qualified") {
      bucket.qualified += 1;
    }
    if (String(lead?.status || "").trim() === "Converted") {
      bucket.converted += 1;
    }
  });
  const sourceRows = [...sourceMap.values()]
    .sort((left, right) => {
      if (right[sourceMetricKey] !== left[sourceMetricKey]) {
        return right[sourceMetricKey] - left[sourceMetricKey];
      }
      if (right.qualified !== left.qualified) {
        return right.qualified - left.qualified;
      }
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return String(left.label || "").localeCompare(String(right.label || ""), undefined, { sensitivity: "base" });
    })
    .slice(0, 5)
    .map((row) => ({
      ...row,
      conversionRate: row.count ? Math.round((row.converted / row.count) * 100) : 0,
      selectedMetric: sourceMetricKey === "count" ? row.count : row.converted,
      metricLabel:
        sourceMetricKey === "count"
          ? dashboardCountLabel(row.count, "lead")
          : dashboardCountLabel(row.converted, "converted lead", "converted leads"),
      secondaryLabel:
        sourceMetricKey === "count"
          ? `${dashboardCountLabel(row.converted, "converted lead", "converted leads")} | ${Math.round((row.count / Math.max(leadsInRange.length, 1)) * 100)}% share`
          : `${row.conversionRate}% conversion | ${dashboardCountLabel(row.qualified, "qualified")}`,
      meta: `${dashboardCountLabel(row.count, "lead")} | ${dashboardCountLabel(row.qualified, "qualified")}`
    }));
  const ownerSeedMap = new Map();
  teamRows.forEach((member) => {
    ownerSeedMap.set(member.id, {
      id: member.id,
      name: member.name,
      initials: member.initials,
      role: member.role,
      openDeals: member.openDeals,
      overdueFollowUps: member.overdueFollowUps
    });
  });
  leads.forEach((lead) => {
    const ownerName = String(lead?.owner || "Unassigned").trim() || "Unassigned";
    const ownerId = String(lead?.ownerId || "").trim();
    const existingMatch = [...ownerSeedMap.values()].find((member) =>
      dashboardMemberMatchesRecord({ id: member.id, name: member.name }, ownerId, ownerName)
    );
    if (existingMatch) {
      return;
    }
    const key = ownerId || ownerName.toLowerCase();
    ownerSeedMap.set(key, {
      id: key,
      name: ownerName,
      initials: getDashboardInitials(ownerName),
      role: "Owner",
      openDeals: openDeals.filter((deal) => dashboardMemberMatchesRecord({ id: key, name: ownerName }, deal?.ownerId, deal?.owner)).length,
      overdueFollowUps: overdueLeadFollowUps.filter((leadEntry) =>
        dashboardMemberMatchesRecord({ id: key, name: ownerName }, leadEntry?.ownerId, leadEntry?.owner)
      ).length
    });
  });
  const ownerMetricKey = dashboardUiState.ownerMetric === "converted" ? "convertedLeads" : "qualifiedLeads";
  const ownerMetricLabel = dashboardUiState.ownerMetric === "converted" ? "converted" : "qualified";
  const ownerRows = [...ownerSeedMap.values()]
    .map((member) => {
      const qualifiedLeads = leadsInRange.filter(
        (lead) =>
          dashboardMemberMatchesRecord({ id: member.id, name: member.name }, lead?.ownerId, lead?.owner) &&
          String(lead?.status || "").trim() === "Qualified"
      ).length;
      const convertedLeads = leadsInRange.filter(
        (lead) =>
          dashboardMemberMatchesRecord({ id: member.id, name: member.name }, lead?.ownerId, lead?.owner) &&
          String(lead?.status || "").trim() === "Converted"
      ).length;
      const ownerMetaParts = [];
      if (member.openDeals > 0) {
        ownerMetaParts.push(dashboardCountLabel(member.openDeals, "open deal"));
      }
      if (member.overdueFollowUps > 0) {
        ownerMetaParts.push(dashboardCountLabel(member.overdueFollowUps, "overdue follow-up"));
      }
      const selectedMetric = dashboardUiState.ownerMetric === "converted" ? convertedLeads : qualifiedLeads;
      return {
        ...member,
        qualifiedLeads,
        convertedLeads,
        selectedMetric,
        metricLabel: `${new Intl.NumberFormat("en-US").format(selectedMetric)} ${ownerMetricLabel}`,
        meta: ownerMetaParts.join(" · ")
      };
    })
    .sort((left, right) => {
      if (right[ownerMetricKey] !== left[ownerMetricKey]) {
        return right[ownerMetricKey] - left[ownerMetricKey];
      }
      if (right.openDeals !== left.openDeals) {
        return right.openDeals - left.openDeals;
      }
      return String(left.name || "").localeCompare(String(right.name || ""), undefined, { sensitivity: "base" });
    })
    .slice(0, 5);
  const topRepSeedMap = new Map();
  const seedTopRep = (idValue, nameValue) => {
    const repName = String(nameValue || "").trim();
    if (!repName) {
      return;
    }
    const repId = String(idValue || repName.toLowerCase()).trim() || repName.toLowerCase();
    if (topRepSeedMap.has(repId)) {
      return;
    }
    topRepSeedMap.set(repId, {
      id: repId,
      name: repName,
      initials: getDashboardInitials(repName)
    });
  };
  activeTeamMembers.forEach((member) => {
    seedTopRep(member?.id || member?.email || member?.name, member?.name);
  });
  leads.forEach((lead) => {
    seedTopRep(lead?.ownerId, lead?.owner);
  });
  deals.forEach((deal) => {
    seedTopRep(deal?.ownerId, deal?.owner);
  });
  const closedDealsTotal = Math.max(0, wonDealsInRange.length);
  const topRepFallbackNames = ["Katie Harlin", "Maria Whalen", "Andrew Hamblin", "Stan Warner", "Scott Plummer"];
  const topRepRows =
    topRepSeedMap.size > 0
      ? [...topRepSeedMap.values()]
          .map((rep) => {
            const dealsClosed = wonDealsInRange.filter((deal) =>
              dashboardMemberMatchesRecord({ id: rep.id, name: rep.name }, deal?.ownerId, deal?.owner)
            ).length;
            return {
              ...rep,
              dealsClosed,
              percent: closedDealsTotal ? Math.round((dealsClosed / closedDealsTotal) * 100) : 0,
              placeholder: false
            };
          })
          .sort((left, right) => {
            if (right.dealsClosed !== left.dealsClosed) {
              return right.dealsClosed - left.dealsClosed;
            }
            return String(left.name || "").localeCompare(String(right.name || ""), undefined, { sensitivity: "base" });
          })
          .slice(0, 5)
      : topRepFallbackNames.map((name, index) => ({
          id: `rep-fallback-${index + 1}`,
          name,
          initials: getDashboardInitials(name),
          dealsClosed: 0,
          percent: 0,
          placeholder: true
        }));
  const tomorrowIso = formatLocalIsoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const noFollowUpCount = leads.filter((lead) => !String(lead?.nextFollowUp || "").trim()).length;
  const followUpPressure = [
    {
      key: "today",
      label: "Today",
      count: leads.filter((lead) => String(lead?.nextFollowUp || "").trim() === todayIso).length,
      meta: dashboardCountLabel(callsToday.length, "scheduled call"),
      tone: "today"
    },
    {
      key: "tomorrow",
      label: "Tomorrow",
      count: leads.filter((lead) => String(lead?.nextFollowUp || "").trim() === tomorrowIso).length,
      meta: "Next queue",
      tone: "tomorrow"
    },
    {
      key: "overdue",
      label: "Overdue",
      count: overdueLeadFollowUps.length,
      meta: dashboardCountLabel(overdueTasks.length, "task"),
      tone: "overdue"
    },
    {
      key: "unscheduled",
      label: "Not set",
      count: noFollowUpCount,
      meta: "Needs ownership",
      tone: "unscheduled"
    }
  ];
  const recentActivity =
    Array.isArray(snapshot?.recentActivity) && snapshot.recentActivity.length
      ? snapshot.recentActivity.slice(0, 6).map((item) => ({
          id: `activity-${String(item?.createdAt || item?.actor || item?.headline || "")}`,
          actor: String(item?.actor || "System").trim() || "System",
          headline: String(item?.headline || "Updated the workspace").trim() || "Updated the workspace",
          createdAt: String(item?.createdAt || "")
        }))
      : buildDashboardRecentActivityFromData(data);
  const topDeals =
    hasSnapshot && Array.isArray(snapshot?.topDeals) && snapshot.topDeals.length
      ? snapshot.topDeals.slice(0, 3).map((deal) => ({
          id: String(deal?.id || deal?.account || "").trim() || "top-deal",
          title: String(deal?.account || "No account").trim() || "No account",
          meta: `${String(deal?.stage || "Open").trim() || "Open"} | ${String(deal?.contactName || "Unknown").trim() || "Unknown"}`,
          value: formatCompactMoney(deal?.value || 0),
          actionAttr: deal?.id ? `data-deal-open="${escapeHtml(String(deal.id))}"` : ""
        }))
      : openDeals
          .slice()
          .sort((left, right) => Number(right?.value || 0) - Number(left?.value || 0))
          .slice(0, 3)
          .map((deal) => ({
            id: String(deal?.id || deal?.name || deal?.account || "top-deal").trim(),
            title: String(deal?.name || "Untitled deal").trim() || "Untitled deal",
            meta: `${String(deal?.stage || "Open").trim() || "Open"} | ${String(deal?.account || "No account").trim() || "No account"}`,
            value: formatCompactMoney(deal?.value || 0),
            actionAttr: deal?.id ? `data-deal-open="${escapeHtml(String(deal.id))}"` : ""
          }));
  const dueTodayItems =
    hasSnapshot && Array.isArray(snapshot?.dueTasks?.items) && snapshot.dueTasks.items.length
      ? snapshot.dueTasks.items.slice(0, 3).map((task) => ({
          id: String(task?.id || task?.title || "due-task").trim(),
          title: String(task?.title || "Untitled task").trim() || "Untitled task",
          meta: `${String(task?.assignee || "Unassigned").trim() || "Unassigned"} | ${task?.dueDate ? formatShortDate(task.dueDate) : "No due date"}`,
          actionAttr: task?.id ? `data-task-open="${escapeHtml(String(task.id))}"` : ""
        }))
      : openTasks
          .filter((task) => String(task?.dueDate || "").trim())
          .slice()
          .sort((left, right) => String(left?.dueDate || "").localeCompare(String(right?.dueDate || "")))
          .slice(0, 3)
          .map((task) => ({
            id: String(task?.id || task?.title || "due-task").trim(),
            title: String(task?.title || "Untitled task").trim() || "Untitled task",
            meta: `${String(task?.assignee || "Unassigned").trim() || "Unassigned"} | ${task?.dueDate ? formatShortDate(task.dueDate) : "No due date"}`,
            actionAttr: task?.id ? `data-task-open="${escapeHtml(String(task.id))}"` : ""
          }));
  const dueTodayCount = Math.max(0, Number((hasSnapshot && snapshot?.dueTasks?.dueTodayCount) || dueTodayItems.length || 0));
  const todayStart = dashboardStartOfDay(todayIso) || dashboardStartOfDay(now) || new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const followUpQueue = [
    ...overdueLeadFollowUps.map((lead) => ({
      id: `follow-up-lead-${String(lead?.id || lead?.name || "lead").trim()}`,
      title: `Follow up with ${String(lead?.name || "this lead").trim() || "this lead"}`,
      meta: `${String(lead?.owner || "Unassigned").trim() || "Unassigned"} | ${lead?.nextFollowUp ? formatShortDate(lead.nextFollowUp) : "No date"}`,
      dueValue: lead?.nextFollowUp,
      actionAttr: lead?.id ? `data-lead-open="${escapeHtml(String(lead.id))}"` : "",
      placeholder: false
    })),
    ...openTasks.map((task) => ({
      id: `follow-up-task-${String(task?.id || task?.title || "task").trim()}`,
      title: String(task?.title || "Untitled task").trim() || "Untitled task",
      meta: `${String(task?.assignee || "Unassigned").trim() || "Unassigned"} | ${task?.dueDate ? formatShortDate(task.dueDate) : "No due date"}`,
      dueValue: task?.dueDate,
      actionAttr: task?.id
        ? `data-task-open="${escapeHtml(String(task.id))}" data-card-menu="task" data-id="${escapeHtml(String(task.id))}"`
        : "",
      placeholder: false
    }))
  ]
    .map((item) => {
      const dueDate = dashboardStartOfDay(item.dueValue);
      const dueTime = dueDate instanceof Date ? dueDate.getTime() : Number.MAX_SAFE_INTEGER;
      const diffDays = Number.isFinite(dueTime) ? Math.round((dueTime - todayStart.getTime()) / 86400000) : null;
      let chip = "Cold";
      let tone = "cold";
      let rank = 2;
      if (diffDays !== null && diffDays < 0) {
        chip = "Hot";
        tone = "hot";
        rank = 0;
      } else if (diffDays !== null && diffDays <= 1) {
        chip = "Warm";
        tone = "warm";
        rank = 1;
      }
      return {
        ...item,
        chip,
        tone,
        rank,
        sortTime: dueTime
      };
    })
    .sort((left, right) => {
      if (left.rank !== right.rank) {
        return left.rank - right.rank;
      }
      if (left.sortTime !== right.sortTime) {
        return left.sortTime - right.sortTime;
      }
      return String(left.title || "").localeCompare(String(right.title || ""), undefined, { sensitivity: "base" });
    });
  const followUpTaskRows = followUpQueue.length
    ? followUpQueue.slice(0, 4)
    : [
        {
          id: "follow-up-empty",
          title: "No follow-up tasks right now",
          meta: `${rangeMeta.label} queue is clear.`,
          chip: "Clear",
          tone: "clear",
          actionAttr: "",
          placeholder: true
        }
      ];
  const sourceRowsWithFallback = sourceRows.length
    ? sourceRows
    : [
        {
          key: "source-empty",
          label: "No source data",
          meta: `No new leads in ${rangeLabelLower}.`,
          selectedMetric: 0,
          metricLabel: "0",
          secondaryLabel: "Move the range or add leads to compare sources.",
          placeholder: true
        }
      ];
  const ownerRowsWithFallback = ownerRows.length
    ? ownerRows
    : [
        {
          id: "owner-empty",
          name: "No owner activity",
          initials: "--",
          meta: "",
          selectedMetric: 0,
          metricLabel: `0 ${ownerMetricLabel}`,
          placeholder: true
        }
      ];
  const ownerPanelNote = ownerRows.some((row) => Number(row.selectedMetric || 0) > 0)
    ? ""
    : `No ${ownerMetricLabel} leads in ${rangeLabelLower}.`;
  const sourceMax = Math.max(1, ...sourceRowsWithFallback.map((row) => Number(row.selectedMetric || 0)));
  const ownerMax = Math.max(1, ...ownerRowsWithFallback.map((row) => Number(row.selectedMetric || 0)));
  const hasSnapshotLeadSections =
    Array.isArray(snapshot?.leadStatusDistribution) ||
    Array.isArray(snapshot?.salesFunnel) ||
    Array.isArray(snapshot?.pipelineTrend?.points);
  const hasSnapshotDealSections = Array.isArray(snapshot?.topReps) || Array.isArray(snapshot?.pipelineStages);
  const hasSnapshotTaskSections = Array.isArray(snapshot?.followUpTasks) || Array.isArray(snapshot?.dueTasks?.items);
  const useSnapshotLeadSections = snapshotMatchesRange && hasSnapshot && (hasSnapshotLeadSections || leads.length === 0);
  const useSnapshotDealSections = snapshotMatchesRange && hasSnapshot && (hasSnapshotDealSections || deals.length === 0);
  const useSnapshotTaskSections = snapshotMatchesRange && hasSnapshot && (hasSnapshotTaskSections || tasks.length === 0);
  const snapshotLeadStatusByKey = new Map(
    Array.isArray(snapshot?.leadStatusDistribution)
      ? snapshot.leadStatusDistribution.map((item) => [String(item?.key || "").trim(), item])
      : []
  );
  const snapshotStatusDistribution = Array.isArray(snapshot?.leadStatusDistribution)
    ? statusDistributionOrder.map((item) => {
        const snapshotItem = snapshotLeadStatusByKey.get(item.key) || {};
        const count = Math.max(0, Number(snapshotItem.count || 0));
        return {
          ...item,
          label: String(snapshotItem.label || item.label).trim() || item.label,
          color: String(snapshotItem.color || item.color).trim() || item.color,
          count,
          percent: 0
        };
      })
    : null;
  const commandStatusDistributionBase =
    useSnapshotLeadSections && snapshotStatusDistribution ? snapshotStatusDistribution : statusDistribution;
  const commandStatusDistributionTotal = commandStatusDistributionBase.reduce(
    (sum, item) => sum + Math.max(0, Number(item.count || 0)),
    0
  );
  const commandStatusDistribution = commandStatusDistributionBase.map((item) => ({
    ...item,
    percent: commandStatusDistributionTotal ? Math.round((Math.max(0, Number(item.count || 0)) / commandStatusDistributionTotal) * 100) : 0
  }));
  const commandStatusDistributionFeatured =
    commandStatusDistribution.find((item) => item.count === Math.max(...commandStatusDistribution.map((entry) => entry.count))) ||
    commandStatusDistribution[0];
  const snapshotFunnelByKey = new Map(
    Array.isArray(snapshot?.salesFunnel) ? snapshot.salesFunnel.map((item) => [String(item?.key || "").trim(), item]) : []
  );
  const snapshotSalesFunnelStages = Array.isArray(snapshot?.salesFunnel)
    ? salesFunnelStages.map((stage) => {
        const snapshotStage = snapshotFunnelByKey.get(stage.key) || {};
        return {
          ...stage,
          label: String(snapshotStage.label || stage.label).trim() || stage.label,
          count: Math.max(0, Number(snapshotStage.count || 0)),
          tone: String(snapshotStage.tone || stage.tone).trim() || stage.tone
        };
      })
    : null;
  const commandSalesFunnelStages =
    useSnapshotLeadSections && snapshotSalesFunnelStages ? snapshotSalesFunnelStages : salesFunnelStages;
  const commandSalesFunnelRows = commandSalesFunnelStages.map((stage) => ({
    ...stage,
    barWidth: Math.max(
      0,
      Math.min(
        100,
        (Number(stage.count || 0) / Math.max(1, ...commandSalesFunnelStages.map((entry) => Number(entry.count || 0)))) * 100
      )
    )
  }));
  const commandSalesFunnelNote = commandSalesFunnelStages.some((stage) => Number(stage.count || 0) > 0)
    ? ""
    : salesFunnelNote;
  const snapshotPipelineTrendPoints =
    Array.isArray(snapshot?.pipelineTrend?.points) && snapshot.pipelineTrend.points.length
      ? snapshot.pipelineTrend.points.map((point, index) => {
          const fallbackPoint = pipelineTrendPoints[index] || rangeMeta.points[index] || {};
          const values = point?.values && typeof point.values === "object" ? point.values : {};
          return {
            ...fallbackPoint,
            key: String(point?.key || fallbackPoint.key || `snapshot-point-${index + 1}`).trim(),
            label: String(point?.label || fallbackPoint.label || "").trim(),
            shortLabel: String(point?.shortLabel || fallbackPoint.shortLabel || "").trim(),
            values: {
              new: Math.max(0, Number(values.new || 0)),
              contacted: Math.max(0, Number(values.contacted || 0)),
              qualified: Math.max(0, Number(values.qualified || 0)),
              won: Math.max(0, Number(values.won || 0))
            }
          };
        })
      : null;
  const commandPipelineTrendPoints =
    useSnapshotLeadSections && snapshotPipelineTrendPoints ? snapshotPipelineTrendPoints : pipelineTrendPoints;
  const commandCurrentStageMovements =
    useSnapshotLeadSections && snapshotPipelineTrendPoints
      ? Math.max(
          0,
          Number(
            snapshot?.pipelineTrend?.currentStageMovements ??
              commandPipelineTrendPoints.reduce(
                (sum, point) =>
                  sum + pipelineTrendSeries.reduce((seriesSum, entry) => seriesSum + Number(point.values?.[entry.key] || 0), 0),
                0
              )
          )
        )
      : currentStageMovements;
  const commandPreviousStageMovements =
    useSnapshotLeadSections && snapshotPipelineTrendPoints
      ? Math.max(0, Number(snapshot?.pipelineTrend?.previousStageMovements || 0))
      : previousStageMovements;
  const commandPipelineTrendMaxValue = Math.max(
    1,
    ...commandPipelineTrendPoints.flatMap((point) => pipelineTrendSeries.map((entry) => Number(point.values?.[entry.key] || 0)))
  );
  const commandNewLeadSparkPoints =
    useSnapshotLeadSections && snapshotPipelineTrendPoints
      ? commandPipelineTrendPoints.map((point) => ({
          label: String(point?.shortLabel || point?.label || "").trim(),
          value: Math.max(0, Number(point?.values?.new || 0))
        }))
      : newLeadSparkPoints;
  const commandWonSparkPoints =
    useSnapshotLeadSections && snapshotPipelineTrendPoints
      ? commandPipelineTrendPoints.map((point) => ({
          label: String(point?.shortLabel || point?.label || "").trim(),
          value: Math.max(0, Number(point?.values?.won || 0))
        }))
      : wonSparkPoints;
  const snapshotPipelineStages = Array.isArray(snapshot?.pipelineStages) ? snapshot.pipelineStages : [];
  const snapshotPipelineValue = snapshotPipelineStages
    .filter((stage) => !["Won", "Lost", "Closed Won", "Closed Lost"].includes(String(stage?.id || stage?.label || "").trim()))
    .reduce((sum, stage) => sum + Number(stage?.value || 0), 0);
  const snapshotTopRepRows = Array.isArray(snapshot?.topReps)
    ? snapshot.topReps.length
      ? snapshot.topReps.slice(0, 5).map((rep) => ({
          id: String(rep?.id || rep?.name || "snapshot-rep").trim(),
          name: String(rep?.name || "Unknown").trim() || "Unknown",
          initials: String(rep?.initials || getDashboardInitials(rep?.name)).trim() || getDashboardInitials(rep?.name),
          dealsClosed: Math.max(0, Number(rep?.dealsClosed || 0)),
          percent: Math.max(0, Number(rep?.percent || 0)),
          placeholder: false
        }))
      : topRepFallbackNames.map((name, index) => ({
          id: `rep-fallback-${index + 1}`,
          name,
          initials: getDashboardInitials(name),
          dealsClosed: 0,
          percent: 0,
          placeholder: true
        }))
    : null;
  const commandTopRepRows = useSnapshotDealSections && snapshotTopRepRows ? snapshotTopRepRows : topRepRows;
  const snapshotFollowUpSource = Array.isArray(snapshot?.followUpTasks)
    ? snapshot.followUpTasks
    : Array.isArray(snapshot?.dueTasks?.items)
      ? snapshot.dueTasks.items
      : null;
  const snapshotFollowUpQueue = Array.isArray(snapshotFollowUpSource)
    ? snapshotFollowUpSource.map((task) => {
        const dueDate = dashboardStartOfDay(task?.dueDate);
        const dueTime = dueDate instanceof Date ? dueDate.getTime() : Number.MAX_SAFE_INTEGER;
        const diffDays = Number.isFinite(dueTime) ? Math.round((dueTime - todayStart.getTime()) / 86400000) : null;
        let chip = "Cold";
        let tone = "cold";
        let rank = 2;
        if (diffDays !== null && diffDays < 0) {
          chip = "Hot";
          tone = "hot";
          rank = 0;
        } else if (diffDays !== null && diffDays <= 1) {
          chip = "Warm";
          tone = "warm";
          rank = 1;
        }
        return {
          id: `snapshot-follow-up-${String(task?.id || task?.title || "task").trim()}`,
          title: String(task?.title || "Untitled task").trim() || "Untitled task",
          meta: `${String(task?.assignee || "Unassigned").trim() || "Unassigned"} | ${task?.dueDate ? formatShortDate(task.dueDate) : "No due date"}`,
          chip,
          tone,
          rank,
          sortTime: dueTime,
          actionAttr: task?.id
            ? `data-task-open="${escapeHtml(String(task.id))}" data-card-menu="task" data-id="${escapeHtml(String(task.id))}"`
            : "",
          placeholder: false
        };
      })
    : null;
  const commandFollowUpTaskRows =
    useSnapshotTaskSections && snapshotFollowUpQueue
      ? snapshotFollowUpQueue.length
        ? snapshotFollowUpQueue.slice(0, 4)
        : [
            {
              id: "follow-up-empty",
              title: "No follow-up tasks right now",
              meta: `${rangeMeta.label} queue is clear.`,
              chip: "Clear",
              tone: "clear",
              actionAttr: "",
              placeholder: true
            }
          ]
      : followUpTaskRows;
  const commandFollowUpTaskCount =
    useSnapshotTaskSections && snapshotFollowUpQueue
      ? Math.max(snapshotFollowUpQueue.length, Number(snapshot?.dueTasks?.dueTodayCount || 0))
      : followUpQueue.length;
  const commandTotalLeadsValue = useSnapshotLeadSections
    ? snapshotKpiNumber("totalLeads")
    : leadsInRange.length;
  const commandTotalLeadsBaseline = useSnapshotLeadSections
    ? snapshotKpiNumber("totalLeads", "baseline")
    : leadsInPreviousRange.length;
  const commandPipelineValue = useSnapshotDealSections ? snapshotPipelineValue : pipelineValue;
  const commandOpenDealsCount = useSnapshotDealSections ? snapshotKpiNumber("openDeals") : openDeals.length;
  const commandWonValue = useSnapshotDealSections ? snapshotKpiNumber("revenue") : wonValueInRange;
  const commandWonBaseline = useSnapshotDealSections ? snapshotKpiNumber("revenue", "baseline") : wonValueInPreviousRange;
  const commandAtRiskCount = useSnapshotTaskSections && snapshotFollowUpQueue ? commandFollowUpTaskCount : atRiskCount;
  const currentUserName =
    String(data?.currentUser?.name || data?.currentUser?.fullName || data?.currentUser?.firstName || "").trim() ||
    String(data?.currentUser?.email || "").trim();
  const firstName = currentUserName ? currentUserName.split(/\s+/)[0].split("@")[0] : "";
  const currentHour = now.getHours();
  const dayGreeting = currentHour < 12 ? "Good Morning" : currentHour < 18 ? "Good Afternoon" : "Good Evening";
  const relativeGeneratedAt = hasSnapshot && snapshot?.generatedAt ? formatRelativeTime(snapshot.generatedAt) : "";
  const model = {
    toolbarHeading: firstName ? `${dayGreeting}, ${firstName}` : dayGreeting,
    toolbarSummary: "Your CRM performance this week",
    toolbarRangeLabel: rangeMeta.label,
    toolbarSyncLabel: relativeGeneratedAt
      ? `Last sync ${relativeGeneratedAt === "now" ? "just now" : `${relativeGeneratedAt} ago`}`
      : "Live local data",
    toolbarSyncTitle: hasSnapshot && snapshot?.generatedAt ? formatShortDate(snapshot.generatedAt) : "",
    quarterLabel: (hasSnapshot && String(snapshot?.quarterLabel || "").trim()) || rangeMeta.label,
    rangeOptions: [
      { id: "today", label: "Today", active: dashboardUiState.range === "today" },
      { id: "7d", label: "7D", active: dashboardUiState.range === "7d" },
      { id: "30d", label: "30D", active: dashboardUiState.range === "30d" },
      { id: "mtd", label: "MTD", active: dashboardUiState.range === "mtd" },
      { id: "qtd", label: "QTD", active: dashboardUiState.range === "qtd" }
    ],
    sourceMetric: dashboardUiState.sourceMetric,
    ownerMetric: dashboardUiState.ownerMetric,
    ownerPanelNote,
    kpis: [
      {
        id: "new-leads",
        icon: "bi-person-plus",
        label: "New Leads",
        value: new Intl.NumberFormat("en-US").format(commandTotalLeadsValue),
        note: rangeMeta.label,
        deltaLabel: formatDashboardDeltaBadge(commandTotalLeadsValue, commandTotalLeadsBaseline),
        deltaTone: commandTotalLeadsValue >= commandTotalLeadsBaseline ? "up" : "down",
        tone: "new-leads",
        sparkPoints: commandNewLeadSparkPoints
      },
      {
        id: "pipeline",
        icon: "bi-graph-up-arrow",
        label: "Open Pipeline Value",
        value: formatCompactMoney(commandPipelineValue),
        note: `${dashboardCountLabel(commandOpenDealsCount, "open deal")} across stages`,
        deltaLabel: dashboardCountLabel(commandCurrentStageMovements, "movement"),
        deltaTone: commandCurrentStageMovements > 0 ? "up" : "neutral",
        tone: "pipeline",
        sparkPoints: pipelineValueSparkPoints
      },
      {
        id: "won-value",
        icon: "bi-trophy",
        label: "Won Value",
        value: formatCompactMoney(commandWonValue),
        note: rangeMeta.label,
        deltaLabel: formatDashboardDeltaBadge(commandWonValue, commandWonBaseline),
        deltaTone: commandWonValue >= commandWonBaseline ? "up" : "down",
        tone: "won-month",
        sparkPoints: commandWonSparkPoints
      },
      {
        id: "at-risk",
        icon: "bi-exclamation-triangle",
        label: "At-Risk Follow-Ups",
        value: new Intl.NumberFormat("en-US").format(commandAtRiskCount),
        note: useSnapshotTaskSections
          ? `${dashboardCountLabel(commandFollowUpTaskCount, "open task")}`
          : `${dashboardCountLabel(overdueLeadFollowUps.length, "follow-up")} | ${dashboardCountLabel(overdueTasks.length, "task")}`,
        deltaLabel: `${new Intl.NumberFormat("en-US").format(staleDeals.length)} stale`,
        deltaTone: commandAtRiskCount > 0 ? "down" : "up",
        tone: "at-risk",
        sparkPoints: riskSparkPoints
      }
    ],
    pipelineTrendDataset: {
      points: commandPipelineTrendPoints,
      series: pipelineTrendSeries.map((entry) => ({
        ...entry,
        hidden: dashboardUiState.hiddenSeries.includes(entry.key)
      })),
      maxValue: commandPipelineTrendMaxValue
    },
    attentionCount,
    attentionItems,
    attentionSummary,
    statusDistribution: commandStatusDistribution,
    statusDistributionTotal: commandStatusDistributionTotal,
    statusDistributionFeatured: commandStatusDistributionFeatured,
    salesFunnelRows: commandSalesFunnelRows,
    salesFunnelNote: commandSalesFunnelNote,
    topRepRows: commandTopRepRows,
    followUpTaskRows: commandFollowUpTaskRows,
    followUpTaskCount: commandFollowUpTaskCount,
    sourceRows: sourceRowsWithFallback.map((row) => ({
      ...row,
      barWidth: row.placeholder ? 0 : Math.max(0, Math.min(100, (Number(row.selectedMetric || 0) / sourceMax) * 100))
    })),
    ownerRows: ownerRowsWithFallback.map((row) => ({
      ...row,
      barWidth: row.placeholder ? 0 : Math.max(0, Math.min(100, (Number(row.selectedMetric || 0) / ownerMax) * 100))
    })),
    followUpPressure,
    recentActivity: recentActivity.slice(0, 4),
    topDeals,
    dueTodayItems,
    dueTodayCount,
    callsTodayCount: callsToday.length,
    pipelineSummary: `${rangeMeta.label} | ${dashboardCountLabel(commandCurrentStageMovements, "stage movement")}`,
    pipelineTrendNote: buildDashboardRangeNote(
      commandCurrentStageMovements,
      commandPreviousStageMovements,
      rangeMeta.compareLabel,
      "No stage movement in this window."
    )
  };
  dashboardCommandModelMemo = {
    key: memoKey,
    model
  };
  return model;
}

function renderDashboardCommandShell(model) {
  const kpiCards = (model.kpis || [])
    .map(
      (kpi) => `
        <article class="dashboard-insight-kpi dashboard-command-kpi is-${escapeHtml(kpi.tone || kpi.id)}" data-live-key="kpi-${escapeHtml(String(kpi.id || kpi.label || ""))}">
          <div class="dashboard-command-kpi-top">
            <span class="dashboard-insight-kpi-icon" aria-hidden="true"><i class="bi ${escapeHtml(kpi.icon)}"></i></span>
            <span class="dashboard-command-kpi-delta is-${escapeHtml(kpi.deltaTone || "neutral")}">${escapeHtml(kpi.deltaLabel || "0")}</span>
          </div>
          <div class="dashboard-insight-kpi-copy">
            <p class="dashboard-insight-kpi-label">${escapeHtml(kpi.label)}</p>
            <p class="dashboard-insight-kpi-value">${escapeHtml(kpi.value)}</p>
            <p class="dashboard-insight-kpi-note">${escapeHtml(kpi.note)}</p>
          </div>
          <div class="dashboard-command-kpi-spark-shell">
            ${renderDashboardSparkline(kpi.sparkPoints, kpi.tone)}
          </div>
        </article>
      `
    )
    .join("");
  const pipelineTrendChart = renderDashboardPipelineTrendChart(
    model.pipelineTrendDataset,
    "No pipeline activity in this window."
  );
  const statusDistributionTotal = Math.max(0, Number(model.statusDistributionTotal || 0));
  let statusProgress = 0;
  const statusChartBackground =
    statusDistributionTotal > 0
      ? `conic-gradient(${(model.statusDistribution || [])
          .map((item) => {
            const start = statusProgress;
            const share = (Math.max(0, Number(item.count || 0)) / statusDistributionTotal) * 100;
            statusProgress += share;
            return `${item.color} ${start.toFixed(2)}% ${statusProgress.toFixed(2)}%`;
          })
          .join(", ")})`
      : "conic-gradient(#edf2f8 0 100%)";
  const statusFeatured = model.statusDistributionFeatured || {};
  const statusLegend = (model.statusDistribution || [])
    .map(
      (item) => `
        <span class="dashboard-command-status-legend-item">
          <span class="dashboard-command-status-swatch is-${escapeHtml(item.key || "")}" aria-hidden="true"></span>
          <span>${escapeHtml(item.label || "")}</span>
        </span>
      `
    )
    .join("");
  const sourceRows = (model.sourceRows || [])
    .map(
      (row) => `
        <article class="dashboard-command-bar-row ${row.placeholder ? "is-placeholder" : ""}" data-live-key="source-${escapeHtml(String(row.key || row.label || ""))}">
          <div class="dashboard-command-bar-head">
            <div class="dashboard-command-bar-copy">
              <strong>${escapeHtml(row.label || "No source data")}</strong>
              <span>${escapeHtml(row.meta || row.secondaryLabel || "")}</span>
            </div>
            <div class="dashboard-command-bar-metric">
              <strong>${escapeHtml(row.metricLabel || "0")}</strong>
              <span>${escapeHtml(row.secondaryLabel || "")}</span>
            </div>
          </div>
          <div class="dashboard-command-bar-track">
            <span class="dashboard-command-bar-fill is-source" style="width:${Math.max(0, Number(row.barWidth || 0)).toFixed(2)}%"></span>
          </div>
        </article>
      `
    )
    .join("");
  const salesFunnelRows = (model.salesFunnelRows || [])
    .map(
      (row) => `
        <article class="dashboard-command-funnel-row" data-live-key="sales-funnel-${escapeHtml(String(row.key || row.label || ""))}">
          <div class="dashboard-command-funnel-head">
            <span>${escapeHtml(row.label || "Stage")}</span>
            <strong>${escapeHtml(new Intl.NumberFormat("en-US").format(row.count || 0))}</strong>
          </div>
          <div class="dashboard-command-funnel-track">
            <span class="dashboard-command-funnel-fill is-${escapeHtml(row.tone || row.key || "")}" style="width:${Math.max(0, Number(row.barWidth || 0)).toFixed(2)}%"></span>
          </div>
        </article>
      `
    )
    .join("");
  const topRepRows = (model.topRepRows || [])
    .map(
      (row) => `
        <article class="dashboard-command-rep-row ${row.placeholder ? "is-placeholder" : ""}" data-live-key="top-rep-${escapeHtml(String(row.id || row.name || ""))}">
          <div class="dashboard-command-rep-main">
            <span class="dashboard-command-rep-avatar">${escapeHtml(row.initials || "--")}</span>
            <strong>${escapeHtml(row.name || "No owner data")}</strong>
          </div>
          <span class="dashboard-command-rep-metric">${escapeHtml(new Intl.NumberFormat("en-US").format(row.percent || 0))}%</span>
        </article>
      `
    )
    .join("");
  const followUpTaskRows = (model.followUpTaskRows || [])
    .map(
      (item) => `
        <article class="dashboard-command-task-row is-${escapeHtml(item.tone || "cold")} ${item.placeholder ? "is-placeholder" : ""}" ${item.actionAttr || ""} data-live-key="follow-up-${escapeHtml(String(item.id || item.title || ""))}">
          <span class="dashboard-command-task-check" aria-hidden="true"></span>
          <div class="dashboard-command-task-copy">
            <strong>${escapeHtml(item.title || "Untitled follow-up")}</strong>
            <span>${escapeHtml(item.meta || "")}</span>
          </div>
          <span class="dashboard-command-task-chip is-${escapeHtml(item.tone || "cold")}">${escapeHtml(item.chip || "Cold")}</span>
        </article>
      `
    )
    .join("");
  return {
    title: "Dashboard",
    subtitle: "Interactive pipeline, distribution, and follow-up flow",
    primaryAction: "Add Task",
    showWaitingPanel: false,
    html: `
      <section class="dashboard-v3 dashboard-insights dashboard-command-center" data-dashboard-live-root>
        <section class="dashboard-command-toolbar" data-dashboard-region="toolbar">
          <div class="dashboard-command-toolbar-shell" data-live-key="toolbar-shell">
            <div class="dashboard-command-toolbar-copy">
              <p class="dashboard-command-toolbar-eyebrow">Dashboard</p>
              <h2>${escapeHtml(model.toolbarHeading || "Workspace overview")}</h2>
              <p>${escapeHtml(model.toolbarSummary || "Track movement, ownership, and urgency from one place.")}</p>
            </div>
            <div class="dashboard-command-toolbar-actions">
              <div class="dashboard-command-range-group" aria-label="Dashboard range">
                ${(model.rangeOptions || [])
                  .map(
                    (option) => `
                      <button
                        type="button"
                        class="dashboard-command-range-btn ${option.active ? "is-active" : ""}"
                        data-action="dashboard-range"
                        data-id="${escapeHtml(option.id || "")}"
                        aria-pressed="${option.active ? "true" : "false"}"
                      >
                        ${escapeHtml(option.label || option.id || "")}
                      </button>
                    `
                  )
                  .join("")}
              </div>
              <div class="dashboard-command-toolbar-meta">
                <span class="dashboard-command-toolbar-pill" title="${escapeHtml(model.toolbarSyncTitle || "")}">${escapeHtml(model.toolbarSyncLabel || "Live local data")}</span>
                <span class="dashboard-command-toolbar-pill is-secondary">${escapeHtml(model.quarterLabel || model.toolbarRangeLabel || "")}</span>
              </div>
            </div>
          </div>
        </section>

        <section class="dashboard-insight-kpis dashboard-command-kpis" data-dashboard-region="kpis">
          ${kpiCards}
        </section>

        <section class="dashboard-command-main">
          <article class="dashboard-insight-panel dashboard-command-panel">
            <header class="dashboard-insight-head dashboard-command-panel-head">
              <div>
                <p class="dashboard-insight-kicker">Pipeline Trend</p>
                <h3>How stages are moving in ${escapeHtml(String(model.toolbarRangeLabel || "this window").toLowerCase())}</h3>
              </div>
              <span class="dashboard-insight-note" data-dashboard-region="pipeline-summary">${escapeHtml(model.pipelineSummary)}</span>
            </header>
            <div class="dashboard-pipeline-chart-shell dashboard-command-chart-shell" data-dashboard-region="funnel">
              <div data-live-key="funnel-shell">
                ${pipelineTrendChart}
              </div>
            </div>
            <footer class="dashboard-insight-footnote" data-dashboard-region="pipeline-footnote">${escapeHtml(model.pipelineTrendNote)}</footer>
          </article>

          <article class="dashboard-insight-panel dashboard-command-panel dashboard-command-focus-panel">
            <header class="dashboard-insight-head dashboard-command-panel-head">
              <div>
                <p class="dashboard-insight-kicker">Lead Distribution</p>
                <h3>Leads by status</h3>
              </div>
              <span class="dashboard-insight-note" data-dashboard-region="attention-note">${escapeHtml(new Intl.NumberFormat("en-US").format(statusDistributionTotal || 0))}</span>
            </header>
            <div class="dashboard-command-focus-shell-wrap" data-dashboard-region="attention">
              <div class="dashboard-command-focus-shell" data-live-key="attention-shell">
                <section class="dashboard-command-status-shell">
                  <div class="dashboard-command-status-head">
                    <strong>Leads by status</strong>
                    <span>Current distribution</span>
                  </div>
                  <div class="dashboard-command-status-donut-shell">
                    <div class="dashboard-command-status-donut" style="background:${escapeHtml(statusChartBackground)}">
                      <div class="dashboard-command-status-center">
                        <strong>${escapeHtml(statusDistributionTotal > 0 ? statusFeatured.label || "Leads" : "No data")}</strong>
                        <span>${escapeHtml(statusDistributionTotal > 0 ? `${new Intl.NumberFormat("en-US").format(statusFeatured.percent || 0)}% of leads` : "No lead status data")}</span>
                      </div>
                    </div>
                  </div>
                  <div class="dashboard-command-status-legend">
                    ${statusLegend}
                  </div>
                  ${statusDistributionTotal > 0 ? "" : "<p class='dashboard-command-status-empty'>No lead status data in this range.</p>"}
                </section>
              </div>
            </div>
          </article>
        </section>

        <section class="dashboard-command-ops">
          <article class="dashboard-insight-panel dashboard-command-panel">
            <header class="dashboard-insight-head dashboard-command-panel-head">
              <div>
                <p class="dashboard-insight-kicker">Sales Funnel</p>
                <h3>Conversion by stage</h3>
              </div>
            </header>
            <div class="dashboard-command-funnel-list" data-dashboard-region="sales-funnel">
              ${salesFunnelRows}
              ${model.salesFunnelNote ? `<p class="dashboard-command-region-note" data-live-key="sales-funnel-note">${escapeHtml(model.salesFunnelNote)}</p>` : ""}
            </div>
          </article>

          <article class="dashboard-insight-panel dashboard-command-panel">
            <header class="dashboard-insight-head dashboard-command-panel-head">
              <div>
                <p class="dashboard-insight-kicker">Top reps</p>
                <h3>By deals closed</h3>
              </div>
            </header>
            <div class="dashboard-command-rep-list" data-dashboard-region="top-reps">
              ${topRepRows}
            </div>
          </article>

          <article class="dashboard-insight-panel dashboard-command-panel">
            <header class="dashboard-insight-head dashboard-command-panel-head">
              <div>
                <h3>Follow-up tasks</h3>
              </div>
              <span class="dashboard-insight-note">${escapeHtml(model.followUpTaskCount ? `${new Intl.NumberFormat("en-US").format(model.followUpTaskCount)} open` : "Clear")}</span>
            </header>
            <div class="dashboard-command-task-list" data-dashboard-region="follow-up-tasks">
              ${followUpTaskRows}
            </div>
          </article>
        </section>
      </section>
    `
  };
}

function hasDashboardRenderableData(data) {
  return Boolean(
    Object.keys(data?.currentUser || {}).length ||
      (Array.isArray(data?.teamMembers) && data.teamMembers.length) ||
      (Array.isArray(data?.leads) && data.leads.length) ||
      (Array.isArray(data?.deals) && data.deals.length) ||
      (Array.isArray(data?.tasks) && data.tasks.length) ||
      (Array.isArray(data?.messages) && data.messages.length)
  );
}

export function renderDashboard(data, context = {}) {
  if (context.supabaseConfigured && context.dashboardLocked) {
    return renderDashboardLockedState();
  }
  const hasSourceData = hasDashboardRenderableData(data) || Boolean(context.dashboardSnapshot);
  if (context.supabaseConfigured && !hasSourceData && (context.authBootstrapPending || context.dashboardLoading)) {
    return renderDashboardLoadingState();
  }
  if (context.supabaseConfigured && !hasSourceData && context.dashboardSnapshotError) {
    return renderDashboardErrorState(context.dashboardSnapshotError);
  }
  return renderDashboardCommandShell(
    buildDashboardCommandModel(data || {}, context.dashboardSnapshot, context.dashboardUiState)
  );
}

function roleBadge(member) {
  const role = String(member?.role || "Member");
  const roleClass = role.toLowerCase().replaceAll(" ", "-");
  return `<span class="status-chip role-${roleClass}">${escapeHtml(role)}</span>`;
}

function teamStatusBadge(statusValue) {
  const status = normalizeTeamMemberStatus(statusValue || "Active");
  const tone = status.toLowerCase().replaceAll(" ", "-");
  return `<span class="team-status-chip is-${tone}">${escapeHtml(status)}</span>`;
}

function teamLastActiveSortValue(member) {
  const lastLogin = Date.parse(String(member?.lastLoginAt || ""));
  if (Number.isFinite(lastLogin)) {
    return lastLogin;
  }
  const inviteSent = Date.parse(String(member?.inviteLastSentAt || member?.invitedAt || ""));
  if (Number.isFinite(inviteSent)) {
    return inviteSent;
  }
  return 0;
}

function teamLastActiveLabel(member) {
  const lastLogin = Date.parse(String(member?.lastLoginAt || ""));
  if (Number.isFinite(lastLogin)) {
    return formatShortDate(lastLogin);
  }
  const inviteSent = Date.parse(String(member?.inviteLastSentAt || member?.invitedAt || ""));
  if (normalizeTeamMemberStatus(member?.status) === "Pending Invite" && Number.isFinite(inviteSent)) {
    return `Invited ${formatShortDate(inviteSent)}`;
  }
  return "Never";
}

function teamActionMenuItems(member, canManageTeam) {
  const status = normalizeTeamMemberStatus(member?.status);
  const items = [{ action: "team-open-profile", id: member.id, label: "Open Profile" }];
  if (!canManageTeam) {
    return items;
  }
  items.push({ action: "lead-ownership-manager", id: member.id, label: "Manage Leads" });
  items.push({ action: "team-edit", id: member.id, label: "Edit" });
  if (status === "Pending Invite") {
    items.push({ action: "team-resend-invite", id: member.id, label: "Resend Invite" });
    items.push({ action: "team-copy-invite-link", id: member.id, label: "Copy Invite Link" });
    items.push({ action: "team-cancel-invite", id: member.id, label: "Cancel Invite", danger: true });
    return items;
  }
  if (status === "Active") {
    items.push({ action: "team-reset-access", id: member.id, label: "Reset Access" });
    items.push({ action: "team-deactivate", id: member.id, label: "Deactivate", danger: true });
    return items;
  }
  items.push({ action: "team-reactivate", id: member.id, label: "Reactivate" });
  return items;
}

function teamMemberInitials(nameValue) {
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

function workloadToneClass(workloadValue) {
  const numeric = Number(workloadValue || 0);
  if (numeric >= 80) {
    return "is-high";
  }
  if (numeric >= 60) {
    return "is-medium";
  }
  return "is-normal";
}

export function renderTeam(data, context) {
  const rawSortKey = String(context.crmSortKey || "").trim();
  const sortDir = context.crmSortDir === "desc" ? "desc" : context.crmSortDir === "asc" ? "asc" : "none";
  const sortKey = Object.prototype.hasOwnProperty.call(TEAM_SORTERS, rawSortKey) ? rawSortKey : "";
  const teamView = context.teamView === "table" ? "table" : "cards";
  const canManageTeam = canManageTeamMembersByRole(data.currentUser?.role);
  const filteredMembers = data.teamMembers
    .filter((member) =>
      matchesSearch([member.name, member.email, member.team, member.role, member.status], context.searchTerm)
    );
  const sortedMembers = sortTeamRows(filteredMembers, sortKey, sortDir);

  const rows = sortedMembers
    .map(
      (member) => {
        const memberAvatarUrl = String(member.avatarUrl || "").trim();
        return `
        <tr data-team-open="${member.id}">
          <td>
            <div class="crm-name-cell">
              <span class="crm-inline-avatar" aria-hidden="true">
                ${
                  memberAvatarUrl
                    ? `<img src="${escapeHtml(memberAvatarUrl)}" alt="${escapeHtml(member.name || "Team member")}" />`
                    : escapeHtml(teamMemberInitials(member.name))
                }
              </span>
              <span class="crm-name-stack">
                <span class="crm-name-text">${escapeHtml(member.name || "-")}</span>
                <span class="crm-name-sub">${escapeHtml(member.email || "-")}</span>
              </span>
            </div>
          </td>
          <td>${roleBadge(member)}</td>
          <td>${escapeHtml(member.team || "-")}</td>
          <td>${teamStatusBadge(member.status)}</td>
          <td>${escapeHtml(teamLastActiveLabel(member))}</td>
          <td class="row-actions row-actions-table">
            ${tableActionMenu("More member actions", teamActionMenuItems(member, canManageTeam))}
          </td>
        </tr>
      `;
      }
    )
    .join("");

  const cards = sortedMembers
    .map((member) => {
      const workload = Math.max(0, Math.min(100, Number(member.workload || 0)));
      const workloadTone = workloadToneClass(workload);
      const memberAvatarUrl = String(member.avatarUrl || "").trim();
      return `
        <article class="team-card" data-team-open="${member.id}">
          <header class="team-card-head">
            <span class="team-card-avatar">
              ${
                memberAvatarUrl
                  ? `<img src="${escapeHtml(memberAvatarUrl)}" alt="${escapeHtml(member.name || "Team member")}" />`
                  : escapeHtml(teamMemberInitials(member.name))
              }
            </span>
            <div class="team-card-identity">
              <p class="team-card-name">${escapeHtml(member.name || "Unnamed Member")}</p>
              <p class="team-card-email">${escapeHtml(member.email || "No email")}</p>
            </div>
            <div class="team-card-actions">
              ${tableActionMenu("More member actions", teamActionMenuItems(member, canManageTeam))}
            </div>
          </header>
          <div class="team-card-meta">
            <span class="team-tag">${escapeHtml(member.team || "Unassigned")}</span>
            ${roleBadge(member)}
            ${teamStatusBadge(member.status)}
          </div>
          <div class="team-workload">
            <div class="team-workload-row">
              <span class="team-workload-label">${normalizeTeamMemberStatus(member.status) === "Pending Invite" ? "Invite Status" : "Workload"}</span>
              <strong class="team-workload-value">${escapeHtml(normalizeTeamMemberStatus(member.status) === "Pending Invite" ? teamLastActiveLabel(member) : `${Math.round(workload)}%`)}</strong>
            </div>
            <div class="team-workload-meter">
              <span class="${workloadTone}" style="width:${workload}%"></span>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  return {
    title: "Team Management",
    subtitle: "Invite-only access, roles, departments, and workspace ownership",
    primaryAction: canManageTeam ? "Invite Team Member" : "",
    showWaitingPanel: false,
    html: `
      <section class="view-block crm-list-v2">
        <div class="view-section-head team-section-head">
          <h3 class="block-title">Workspace Members</h3>
          <div class="team-head-actions">
            <div class="team-view-toggle" role="tablist" aria-label="Team view mode">
              <button
                class="team-view-toggle-btn ${teamView === "cards" ? "is-active" : ""}"
                type="button"
                role="tab"
                aria-selected="${teamView === "cards"}"
                data-action="team-view"
                data-id="cards"
              >
                Cards
              </button>
              <button
                class="team-view-toggle-btn ${teamView === "table" ? "is-active" : ""}"
                type="button"
                role="tab"
                aria-selected="${teamView === "table"}"
                data-action="team-view"
                data-id="table"
              >
                Table
              </button>
            </div>
            ${
              canManageTeam
                ? `
                  <button class="table-ops-columns-btn" type="button" data-action="view-add-record" data-id="create">
                    <i class="bi bi-person-plus" aria-hidden="true"></i>
                    <span>Invite Team Member</span>
                  </button>
                `
                : ""
            }
          </div>
        </div>
        ${
          teamView === "table"
            ? `
              <div class="data-table-shell">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>${teamHeaderSortButton("Member", "name", sortKey, sortDir)}</th>
                      <th>${teamHeaderSortButton("Role", "role", sortKey, sortDir)}</th>
                      <th>${teamHeaderSortButton("Department", "team", sortKey, sortDir)}</th>
                      <th>${teamHeaderSortButton("Status", "status", sortKey, sortDir)}</th>
                      <th>${teamHeaderSortButton("Last Active", "lastActive", sortKey, sortDir)}</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rows || "<tr><td colspan='6' class='task-meta'>No members found.</td></tr>"}
                  </tbody>
                </table>
              </div>
            `
            : `
              <div class="team-card-grid">
                ${cards || "<p class='team-card-empty'>No members found.</p>"}
              </div>
            `
        }
      </section>
    `
  };
}

function attendanceOpenBreak(record) {
  const breaks = Array.isArray(record?.breaks) ? record.breaks : [];
  return breaks.find((entry) => !String(entry?.endAt || "").trim()) || null;
}

function attendanceDefaultBreakTypes() {
  return [
    {
      id: "morning",
      label: "Morning Break",
      durationMinutes: 15,
      paid: true,
      maxPerDay: 1,
      minPerDay: 0,
      required: false,
      windowStart: "09:30",
      windowEnd: "11:30"
    },
    {
      id: "lunch",
      label: "Lunch Break",
      durationMinutes: 60,
      paid: false,
      maxPerDay: 1,
      minPerDay: 1,
      required: true,
      windowStart: "11:30",
      windowEnd: "14:30"
    },
    {
      id: "afternoon",
      label: "Afternoon Break",
      durationMinutes: 15,
      paid: true,
      maxPerDay: 1,
      minPerDay: 0,
      required: false,
      windowStart: "14:30",
      windowEnd: "17:30"
    }
  ];
}

function attendancePolicyBreakTypes(policy) {
  const fallback = attendanceDefaultBreakTypes();
  const source = Array.isArray(policy?.breakTypes) ? policy.breakTypes : fallback;
  return source
    .map((entry, index) => {
      const fallbackEntry = fallback[index] || fallback[0];
      const id = String(entry?.id || fallbackEntry?.id || `break_${index + 1}`).trim().toLowerCase();
      return {
        id,
        label: String(entry?.label || fallbackEntry?.label || "Break").trim() || "Break",
        durationMinutes: Math.max(1, Number(entry?.durationMinutes ?? fallbackEntry?.durationMinutes ?? 15) || 15),
        paid: entry?.paid === undefined ? Boolean(fallbackEntry?.paid) : Boolean(entry.paid),
        maxPerDay: Math.max(1, Number(entry?.maxPerDay ?? fallbackEntry?.maxPerDay ?? 1) || 1),
        minPerDay: Math.max(0, Number(entry?.minPerDay ?? fallbackEntry?.minPerDay ?? 0) || 0),
        required: entry?.required === undefined ? Boolean(fallbackEntry?.required) : Boolean(entry.required),
        windowStart: String(entry?.windowStart || fallbackEntry?.windowStart || "09:00"),
        windowEnd: String(entry?.windowEnd || fallbackEntry?.windowEnd || "18:00")
      };
    })
    .filter((entry, index, list) => entry.id && list.findIndex((item) => item.id === entry.id) === index);
}

function attendanceBreakTypeMap(policy) {
  return new Map(attendancePolicyBreakTypes(policy).map((entry) => [entry.id, entry]));
}

function attendanceTimeToMinutes(timeValue) {
  const raw = String(timeValue || "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return -1;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return -1;
  }
  return hours * 60 + minutes;
}

function attendanceResolvedTimeZone(policy) {
  const timeZone = String(policy?.timezone || "").trim();
  if (!timeZone || timeZone.toLowerCase() === "local") {
    return "";
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return "";
  }
}

function attendanceDateParts(value, timeZone = "") {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return null;
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone || undefined,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false
  });
  const parts = formatter.formatToParts(date).reduce((accumulator, part) => {
    if (part.type !== "literal") {
      accumulator[part.type] = part.value;
    }
    return accumulator;
  }, {});
  const weekdayMap = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  };
  return {
    hour: Number(parts.hour || 0),
    minute: Number(parts.minute || 0),
    weekDay: weekdayMap[parts.weekday] ?? -1,
    isoDate: parts.year && parts.month && parts.day ? `${parts.year}-${parts.month}-${parts.day}` : ""
  };
}

function attendanceMinutesFromInstant(value, timeZone = "") {
  const parts = attendanceDateParts(value, timeZone);
  if (!parts) {
    return -1;
  }
  return parts.hour * 60 + parts.minute;
}

function attendanceWithinWindow(currentMinutes, windowStart, windowEnd) {
  const start = attendanceTimeToMinutes(windowStart);
  const end = attendanceTimeToMinutes(windowEnd);
  if (start < 0 || end < 0) {
    return true;
  }
  if (end >= start) {
    return currentMinutes >= start && currentMinutes <= end;
  }
  return currentMinutes >= start || currentMinutes <= end;
}

function attendanceWindowDistance(currentMinutes, windowStart, windowEnd) {
  const start = attendanceTimeToMinutes(windowStart);
  const end = attendanceTimeToMinutes(windowEnd);
  if (start < 0 || end < 0 || currentMinutes < 0) {
    return Number.POSITIVE_INFINITY;
  }
  if (attendanceWithinWindow(currentMinutes, windowStart, windowEnd)) {
    return 0;
  }
  if (end >= start) {
    if (currentMinutes < start) {
      return start - currentMinutes;
    }
    return currentMinutes - end;
  }
  const toStart = (start - currentMinutes + 1440) % 1440;
  const toEnd = (currentMinutes - end + 1440) % 1440;
  return Math.min(toStart, toEnd);
}

function attendanceBreakStartMinutes(entry, timeZone = "") {
  const startMs = Date.parse(String(entry?.startAt || ""));
  if (!Number.isFinite(startMs)) {
    return -1;
  }
  return attendanceMinutesFromInstant(startMs, timeZone);
}

function attendanceBreakTypeForEntry(entry, policy, timeZone = attendanceResolvedTimeZone(policy)) {
  const typeMap = attendanceBreakTypeMap(policy);
  const rawTypeId = String(entry?.breakTypeId || "").trim().toLowerCase();
  if (rawTypeId && typeMap.has(rawTypeId)) {
    return typeMap.get(rawTypeId) || null;
  }
  const breakTypes = attendancePolicyBreakTypes(policy);
  if (!breakTypes.length) {
    return null;
  }
  const startMinutes = attendanceBreakStartMinutes(entry, timeZone);
  if (startMinutes < 0) {
    return breakTypes[0];
  }
  return breakTypes.reduce((best, candidate) => {
    if (!best) {
      return candidate;
    }
    const candidateDistance = attendanceWindowDistance(startMinutes, candidate.windowStart, candidate.windowEnd);
    const bestDistance = attendanceWindowDistance(startMinutes, best.windowStart, best.windowEnd);
    if (candidateDistance < bestDistance) {
      return candidate;
    }
    if (candidateDistance === bestDistance && candidate.required && !best.required) {
      return candidate;
    }
    return best;
  }, null);
}

function attendanceBreakUsage(record, policy, referenceIso = "", timeZone = attendanceResolvedTimeZone(policy)) {
  const breakTypes = attendancePolicyBreakTypes(policy);
  const usage = new Map(
    breakTypes.map((entry) => [
      entry.id,
      {
        ...entry,
        count: 0,
        minutes: 0
      }
    ])
  );
  if (!record) {
    return usage;
  }
  const referenceMs = Date.parse(String(referenceIso || new Date().toISOString()));
  const safeReferenceMs = Number.isFinite(referenceMs) ? referenceMs : Date.now();
  const clockOutMs = Date.parse(String(record.clockOutAt || ""));
  const breaks = Array.isArray(record.breaks) ? record.breaks : [];
  breaks.forEach((entry) => {
    const type = attendanceBreakTypeForEntry(entry, policy, timeZone);
    if (!type) {
      return;
    }
    const target = usage.get(type.id);
    if (!target) {
      return;
    }
    const startMs = Date.parse(String(entry?.startAt || ""));
    if (!Number.isFinite(startMs)) {
      return;
    }
    let endMs = Date.parse(String(entry?.endAt || ""));
    if (!Number.isFinite(endMs)) {
      endMs = Number.isFinite(clockOutMs) ? clockOutMs : safeReferenceMs;
    }
    if (endMs <= startMs) {
      return;
    }
    target.count += 1;
    target.minutes += Math.max(0, Math.round((endMs - startMs) / 60000));
  });
  return usage;
}

function attendanceStatusFromRecord(record) {
  if (!record || String(record.clockOutAt || "").trim()) {
    return "Off";
  }
  return attendanceOpenBreak(record) ? "On Break" : "Working";
}

function attendanceBreakMinutes(record, policy, referenceIso = "", paidFilter = null, timeZone = attendanceResolvedTimeZone(policy)) {
  if (!record) {
    return 0;
  }
  const referenceMs = Date.parse(String(referenceIso || new Date().toISOString()));
  const safeReferenceMs = Number.isFinite(referenceMs) ? referenceMs : Date.now();
  const clockOutMs = Date.parse(String(record.clockOutAt || ""));
  const breaks = Array.isArray(record.breaks) ? record.breaks : [];
  return breaks.reduce((sum, entry) => {
    const type = attendanceBreakTypeForEntry(entry, policy, timeZone);
    const isPaid = type ? Boolean(type.paid) : Boolean(entry?.paid);
    if (paidFilter === true && !isPaid) {
      return sum;
    }
    if (paidFilter === false && isPaid) {
      return sum;
    }
    const startMs = Date.parse(String(entry?.startAt || ""));
    if (!Number.isFinite(startMs)) {
      return sum;
    }
    let endMs = Date.parse(String(entry?.endAt || ""));
    if (!Number.isFinite(endMs)) {
      endMs = Number.isFinite(clockOutMs) ? clockOutMs : safeReferenceMs;
    }
    if (endMs <= startMs) {
      return sum;
    }
    return sum + Math.max(0, Math.round((endMs - startMs) / 60000));
  }, 0);
}

function attendanceWorkedMinutes(record, policy, referenceIso = "", timeZone = attendanceResolvedTimeZone(policy)) {
  if (!record) {
    return 0;
  }
  const startMs = Date.parse(String(record.clockInAt || ""));
  if (!Number.isFinite(startMs)) {
    return 0;
  }
  const endRaw = record.clockOutAt ? record.clockOutAt : referenceIso || new Date().toISOString();
  const endMs = Date.parse(String(endRaw));
  if (!Number.isFinite(endMs) || endMs <= startMs) {
    return 0;
  }
  const gross = Math.round((endMs - startMs) / 60000);
  return Math.max(0, gross - attendanceBreakMinutes(record, policy, referenceIso, false, timeZone));
}

function formatAttendanceTime(value, timeZone = "") {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return "--";
  }
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timeZone || undefined
  }).format(date);
}

function formatAttendanceMinutes(totalMinutes) {
  const safe = Math.max(0, Number(totalMinutes || 0));
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function attendancePrimaryAction(status) {
  if (status === "On Break") {
    return { id: "attendance-end-break", label: "End Break" };
  }
  if (status === "Working") {
    return { id: "attendance-start-break", label: "Start Break" };
  }
  return { id: "attendance-clock-in", label: "Clock In" };
}

function attendanceRoleValue(data) {
  const currentRole = String(data.currentUser?.role || "").trim();
  if (currentRole) {
    return currentRole;
  }
  const currentName = String(data.currentUser?.name || "").trim().toLowerCase();
  const memberRole =
    (data.teamMembers || []).find((member) => String(member.name || "").trim().toLowerCase() === currentName)?.role || "";
  return memberRole || "Member";
}

function canManageAttendance(role) {
  const normalized = String(role || "").trim().toLowerCase();
  return ["owner", "admin", "manager"].includes(normalized);
}

function attendanceUserMatcher(member, fallbackName) {
  const fallback = String(fallbackName || "").trim().toLowerCase();
  const memberId = String(member?.id || "").trim();
  const memberName = String(member?.name || "").trim().toLowerCase();
  return (record) => {
    const recordId = String(record?.userId || "").trim();
    const recordName = String(record?.userName || "").trim().toLowerCase();
    if (recordId && memberId && recordId === memberId) {
      return true;
    }
    if (recordName && memberName && recordName === memberName) {
      return true;
    }
    if (recordName && fallback && recordName === fallback) {
      return true;
    }
    return false;
  };
}

function attendanceStatusClass(status) {
  return String(status || "off")
    .trim()
    .toLowerCase()
    .replaceAll(" ", "-");
}

export function renderAttendance(data, context) {
  return renderAttendanceUpgrade(data, context);
  const currentName = String(data.currentUser?.name || "").trim();
  const currentId = String(data.currentUser?.id || "").trim();
  const role = attendanceRoleValue(data);
  const managerMode = canManageAttendance(role);
  const nowIso = String(context.attendanceNowIso || new Date().toISOString());
  const logs = Array.isArray(data.attendanceLogs) ? data.attendanceLogs : [];
  const requests = Array.isArray(data.attendanceRequests) ? data.attendanceRequests : [];
  const policy = {
    shiftStart: "09:00",
    shiftEnd: "18:00",
    graceMinutes: 10,
    lateAfterMinutes: 10,
    halfDayAfterMinutes: 120,
    autoAbsentAfterMinutes: 0,
    breakMinutes: 60,
    breakTypes: attendanceDefaultBreakTypes(),
    workDays: [1, 2, 3, 4, 5],
    timezone: "Local",
    ...(data.attendancePolicy && typeof data.attendancePolicy === "object" ? data.attendancePolicy : {})
  };
  const breakTypes = attendancePolicyBreakTypes(policy);
  policy.breakTypes = breakTypes;
  const shiftStartMinutes =
    Number(policy.shiftStart?.split(":")?.[0] || 9) * 60 + Number(policy.shiftStart?.split(":")?.[1] || 0);
  const lateAfterMinutes = Math.max(0, Number(policy.lateAfterMinutes ?? policy.graceMinutes ?? 10) || 0);
  const halfDayAfterMinutes = Math.max(0, Number(policy.halfDayAfterMinutes ?? 120) || 0);
  const autoAbsentAfterMinutes = Math.max(0, Number(policy.autoAbsentAfterMinutes ?? 0) || 0);
  const resolvedTimeZone = attendanceResolvedTimeZone(policy);
  const nowParts = attendanceDateParts(nowIso, resolvedTimeZone);
  const today = nowParts?.isoDate || formatLocalIsoDate(new Date(nowIso));
  const nowDate = new Date(nowIso);
  const nowMinutes = nowParts ? nowParts.hour * 60 + nowParts.minute : nowDate.getHours() * 60 + nowDate.getMinutes();
  const teamFilter = ["all", "late", "on-break", "absent"].includes(String(context.attendanceTeamFilter || "all"))
    ? String(context.attendanceTeamFilter || "all")
    : "all";

  const allMembers = Array.isArray(data.teamMembers) ? data.teamMembers : [];
  const currentMember =
    allMembers.find((member) => String(member.id || "").trim() === currentId) ||
    allMembers.find((member) => String(member.name || "").trim().toLowerCase() === currentName.toLowerCase()) ||
    null;
  const currentMatcher = attendanceUserMatcher(currentMember, currentName);

  const activeCurrentRecord = [...logs]
    .filter((record) => currentMatcher(record) && !String(record.clockOutAt || "").trim())
    .sort((left, right) => Date.parse(String(right.clockInAt || "")) - Date.parse(String(left.clockInAt || "")))[0] || null;
  const currentTodayRecord = [...logs]
    .filter((record) => currentMatcher(record) && String(record.date || "") === today)
    .sort((left, right) => Date.parse(String(right.clockInAt || "")) - Date.parse(String(left.clockInAt || "")))[0] || null;

  const currentStatus = attendanceStatusFromRecord(activeCurrentRecord);
  const currentPrimaryAction = attendancePrimaryAction(currentStatus);
  const summaryRecord = currentTodayRecord || activeCurrentRecord;
  const totalBreak = attendanceBreakMinutes(summaryRecord, policy, nowIso, null, resolvedTimeZone);
  const paidBreak = attendanceBreakMinutes(summaryRecord, policy, nowIso, true, resolvedTimeZone);
  const unpaidBreak = attendanceBreakMinutes(summaryRecord, policy, nowIso, false, resolvedTimeZone);
  const totalWorked = attendanceWorkedMinutes(summaryRecord, policy, nowIso, resolvedTimeZone);
  const breakUsageSummary = attendanceBreakUsage(summaryRecord, policy, nowIso, resolvedTimeZone);
  const breakPlanRows = breakTypes
    .map((entry) => {
      const usage = breakUsageSummary.get(entry.id) || { count: 0, minutes: 0 };
      const remaining = Math.max(0, Number(entry.maxPerDay || 1) - Number(usage.count || 0));
      const inWindow = attendanceWithinWindow(nowMinutes, entry.windowStart, entry.windowEnd);
      return `
        <div class="attendance-break-row">
          <div>
            <strong>${escapeHtml(entry.label)}</strong>
            <p>${escapeHtml(`${entry.durationMinutes} min · ${entry.paid ? "Paid" : "Unpaid"}`)}</p>
          </div>
          <div class="attendance-break-row-meta">
            <span class="attendance-break-chip">${escapeHtml(`${entry.windowStart}-${entry.windowEnd}`)}</span>
            <span class="attendance-break-chip">${escapeHtml(`Used ${usage.count}/${entry.maxPerDay}`)}</span>
            <span class="attendance-break-chip ${inWindow ? "is-open" : ""}">${inWindow ? "Window Open" : "Window Closed"}</span>
            <small>${remaining > 0 ? `${remaining} left` : "No remaining"}</small>
          </div>
        </div>
      `;
    })
    .join("");

  const timelineRows = [];
  if (summaryRecord?.clockInAt) {
    timelineRows.push({
      id: `${summaryRecord.id}_in`,
      label: "Clock In",
      detail: "Shift started",
      at: summaryRecord.clockInAt
    });
    (Array.isArray(summaryRecord.breaks) ? summaryRecord.breaks : []).forEach((entry, index) => {
      const breakType = attendanceBreakTypeForEntry(entry, policy, resolvedTimeZone);
      const breakLabel = breakType?.label || String(entry?.breakTypeLabel || "Break");
      const paidLabel = (breakType ? breakType.paid : Boolean(entry?.paid)) ? "Paid break" : "Unpaid break";
      if (entry?.startAt) {
        timelineRows.push({
          id: `${summaryRecord.id}_break_start_${index}`,
          label: `${breakLabel} Start`,
          detail: `${paidLabel} started`,
          at: entry.startAt
        });
      }
      if (entry?.endAt) {
        timelineRows.push({
          id: `${summaryRecord.id}_break_end_${index}`,
          label: `${breakLabel} End`,
          detail: "Back to work",
          at: entry.endAt
        });
      }
    });
    if (summaryRecord?.clockOutAt) {
      timelineRows.push({
        id: `${summaryRecord.id}_out`,
        label: "Clock Out",
        detail: "Shift ended",
        at: summaryRecord.clockOutAt
      });
    }
  }
  timelineRows.sort((left, right) => Date.parse(String(left.at || "")) - Date.parse(String(right.at || "")));

  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const workDays = (Array.isArray(policy.workDays) ? policy.workDays : [1, 2, 3, 4, 5])
    .map((day) => Number(day))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  const workDaySet = new Set(workDays);
  const isTodayWorkDay = workDaySet.has(nowParts?.weekDay ?? nowDate.getDay());
  const workDaysLabel = workDays
    .map((day) => dayLabels[day] || "")
    .filter(Boolean)
    .join(", ");

  const statusLabel = currentStatus === "On Break" ? "On Break" : currentStatus === "Working" ? "Working" : "Off Shift";
  const firstInLabel = summaryRecord?.clockInAt ? formatAttendanceTime(summaryRecord.clockInAt, resolvedTimeZone) : "--";
  const lastOutLabel = summaryRecord?.clockOutAt ? formatAttendanceTime(summaryRecord.clockOutAt, resolvedTimeZone) : "--";

  const teamRowsRaw = allMembers.map((member) => {
    const matchesMember = attendanceUserMatcher(member, "");
    const memberTodayRecord = [...logs]
      .filter((record) => matchesMember(record) && String(record.date || "") === today)
      .sort((left, right) => Date.parse(String(right.clockInAt || "")) - Date.parse(String(left.clockInAt || "")))[0] || null;
    const hasRecord = Boolean(memberTodayRecord);
    const absentThreshold = shiftStartMinutes + autoAbsentAfterMinutes;
    const isAutoAbsent = !hasRecord && isTodayWorkDay && autoAbsentAfterMinutes > 0 && nowMinutes >= absentThreshold;
    const memberStatus = hasRecord ? attendanceStatusFromRecord(memberTodayRecord) : isAutoAbsent ? "Absent" : "Off";
    const memberBreak = attendanceBreakMinutes(memberTodayRecord, policy, nowIso, null, resolvedTimeZone);
    const memberWorked = attendanceWorkedMinutes(memberTodayRecord, policy, nowIso, resolvedTimeZone);
    const memberUsage = attendanceBreakUsage(memberTodayRecord, policy, nowIso, resolvedTimeZone);
    const morning = memberUsage.get("morning") || { minutes: 0, count: 0 };
    const lunch = memberUsage.get("lunch") || { minutes: 0, count: 0 };
    const afternoon = memberUsage.get("afternoon") || { minutes: 0, count: 0 };
    const firstIn = memberTodayRecord?.clockInAt ? formatAttendanceTime(memberTodayRecord.clockInAt, resolvedTimeZone) : "--";
    const firstInMinutes = attendanceMinutesFromInstant(memberTodayRecord?.clockInAt, resolvedTimeZone);
    const isHalfDay = firstInMinutes >= 0 && halfDayAfterMinutes > 0 && firstInMinutes > shiftStartMinutes + halfDayAfterMinutes;
    const isLate = firstInMinutes >= 0 && !isHalfDay && firstInMinutes > shiftStartMinutes + lateAfterMinutes;
    const requiredBreaks = breakTypes.filter((entry) => entry.required || Number(entry.minPerDay || 0) > 0);
    const unresolvedRequired = requiredBreaks.filter((entry) => {
      const usage = memberUsage.get(entry.id);
      const needed = Math.max(entry.required ? 1 : 0, Number(entry.minPerDay || 0));
      return (usage?.count || 0) < needed;
    });
    const referenceMinutes = attendanceMinutesFromInstant(memberTodayRecord?.clockOutAt || nowIso, resolvedTimeZone);
    const missingRequired = unresolvedRequired.filter((entry) => {
      const windowEnd = attendanceTimeToMinutes(entry.windowEnd);
      if (windowEnd < 0) {
        return true;
      }
      return referenceMinutes > windowEnd;
    });
    const overBreak = breakTypes.filter((entry) => {
      const usage = memberUsage.get(entry.id) || { minutes: 0 };
      const allowed = Math.max(0, Number(entry.durationMinutes || 0) * Number(entry.maxPerDay || 0));
      return allowed > 0 && Number(usage.minutes || 0) > allowed;
    });

    let compliance = "Compliant";
    let complianceTone = "ok";
    if (memberStatus === "Absent") {
      compliance = "Auto absent";
      complianceTone = "issue";
    } else if (!hasRecord) {
      compliance = isTodayWorkDay ? (nowMinutes >= shiftStartMinutes ? "Pending clock in" : "Before shift start") : "-";
      complianceTone = isTodayWorkDay ? "pending" : "ok";
    } else if (overBreak.length) {
      compliance = `Over break ${overBreak.map((entry) => entry.label).join(", ")}`;
      complianceTone = "issue";
    } else if (missingRequired.length) {
      compliance = `Missing ${missingRequired.map((entry) => entry.label).join(", ")}`;
      complianceTone = "issue";
    } else if (unresolvedRequired.length) {
      compliance = "Pending break window";
      complianceTone = "pending";
    }

    let punctualityTone = "none";
    let punctualityLabel = "-";
    if (memberStatus === "Absent") {
      punctualityTone = "absent";
      punctualityLabel = "Absent";
    } else if (hasRecord) {
      if (isHalfDay) {
        punctualityTone = "half-day";
        punctualityLabel = "Half day";
      } else if (isLate) {
        punctualityTone = "late";
        punctualityLabel = "Late";
      } else {
        punctualityTone = "on-time";
        punctualityLabel = "On time";
      }
    }

    return {
      member,
      status: memberStatus,
      firstIn,
      breakLabel: formatAttendanceMinutes(memberBreak),
      workedLabel: formatAttendanceMinutes(memberWorked),
      morningLabel: `${formatAttendanceMinutes(morning.minutes)} (${morning.count})`,
      lunchLabel: `${formatAttendanceMinutes(lunch.minutes)} (${lunch.count})`,
      afternoonLabel: `${formatAttendanceMinutes(afternoon.minutes)} (${afternoon.count})`,
      compliance,
      complianceTone,
      isLate,
      isHalfDay,
      punctualityTone,
      punctualityLabel
    };
  });

  const teamRows = teamRowsRaw.filter((row) => {
    if (teamFilter === "late") {
      return row.isLate || row.isHalfDay;
    }
    if (teamFilter === "on-break") {
      return row.status === "On Break";
    }
    if (teamFilter === "absent") {
      return row.status === "Absent";
    }
    return true;
  });

  const visibleRequests = (managerMode ? requests : requests.filter((entry) => {
    const entryName = String(entry.userName || "").trim().toLowerCase();
    const entryId = String(entry.userId || "").trim();
    return (currentId && entryId && entryId === currentId) || (currentName && entryName === currentName.toLowerCase());
  }))
    .slice()
    .sort((left, right) => Date.parse(String(right.createdAt || "")) - Date.parse(String(left.createdAt || "")));

  const availableTabs = managerMode ? ["today", "team", "requests", "policy"] : ["today", "requests", "policy"];
  const requestedTab = String(context.attendanceTab || "today").toLowerCase();
  const activeTab = availableTabs.includes(requestedTab) ? requestedTab : "today";

  return {
    title: "Attendance",
    subtitle: "Time in/out, breaks, and team attendance visibility",
    primaryAction: "Request Fix",
    showWaitingPanel: false,
    html: `
      <section class="view-block attendance-view attendance-v2">
        <header class="attendance-v2-statusbar">
          <div class="attendance-v2-status-main">
            <span class="attendance-status-pill is-${attendanceStatusClass(currentStatus)}">${escapeHtml(statusLabel)}</span>
            <strong class="attendance-v2-status-time">${escapeHtml(formatAttendanceMinutes(totalWorked))} worked</strong>
            <p class="task-meta">
              ${escapeHtml(formatAttendanceMinutes(totalBreak))} break
              <span aria-hidden="true">&middot;</span>
              In ${escapeHtml(firstInLabel)}
              <span aria-hidden="true">&middot;</span>
              Out ${escapeHtml(lastOutLabel)}
            </p>
          </div>
          <div class="attendance-head-actions">
            <button class="table-ops-columns-btn" type="button" data-action="attendance-primary" data-id="${currentPrimaryAction.id}">
              <i class="bi bi-clock-history" aria-hidden="true"></i>
              <span>${escapeHtml(currentPrimaryAction.label)}</span>
            </button>
            <button type="button" class="mini-btn" data-action="attendance-clock-out" ${currentStatus === "Working" ? "" : "disabled"}>Clock Out</button>
            <button type="button" class="mini-btn" data-action="attendance-request-create">Request Fix</button>
          </div>
        </header>

        <nav class="attendance-v2-tabs" aria-label="Attendance sections">
          <button type="button" class="attendance-tab-btn ${activeTab === "today" ? "is-active" : ""}" data-action="attendance-tab" data-id="today">Today</button>
          ${
            managerMode
              ? `<button type="button" class="attendance-tab-btn ${activeTab === "team" ? "is-active" : ""}" data-action="attendance-tab" data-id="team">Team</button>`
              : ""
          }
          <button type="button" class="attendance-tab-btn ${activeTab === "requests" ? "is-active" : ""}" data-action="attendance-tab" data-id="requests">${
            managerMode ? "Requests" : "My Requests"
          }</button>
          <button type="button" class="attendance-tab-btn ${activeTab === "policy" ? "is-active" : ""}" data-action="attendance-tab" data-id="policy">Policy</button>
        </nav>

        <div class="attendance-v2-panels">
          ${
            activeTab === "today"
              ? `
                <section class="attendance-panel">
                  <header class="attendance-panel-head">
                    <p class="attendance-card-eyebrow">Today Snapshot</p>
                  </header>
                  <div class="attendance-summary-grid">
                    <div>
                      <p>First In</p>
                      <strong>${escapeHtml(firstInLabel)}</strong>
                    </div>
                    <div>
                      <p>Last Out</p>
                      <strong>${escapeHtml(lastOutLabel)}</strong>
                    </div>
                    <div>
                      <p>Break</p>
                      <strong>${escapeHtml(formatAttendanceMinutes(totalBreak))}</strong>
                    </div>
                    <div>
                      <p>Worked</p>
                      <strong>${escapeHtml(formatAttendanceMinutes(totalWorked))}</strong>
                    </div>
                    <div>
                      <p>Paid Break</p>
                      <strong>${escapeHtml(formatAttendanceMinutes(paidBreak))}</strong>
                    </div>
                    <div>
                      <p>Unpaid Break</p>
                      <strong>${escapeHtml(formatAttendanceMinutes(unpaidBreak))}</strong>
                    </div>
                  </div>
                </section>

                <section class="attendance-panel">
                  <header class="attendance-panel-head">
                    <p class="attendance-card-eyebrow">My Timeline</p>
                  </header>
                  <div class="attendance-timeline-list">
                    ${
                      timelineRows.length
                        ? timelineRows
                            .map(
                              (entry) => `
                                <div class="attendance-timeline-item">
                                  <div>
                                    <strong>${escapeHtml(entry.label)}</strong>
                                    <p>${escapeHtml(entry.detail)}</p>
                                  </div>
                                  <span>${escapeHtml(formatAttendanceTime(entry.at, resolvedTimeZone))}</span>
                                </div>
                              `
                            )
                            .join("")
                        : "<p class='task-meta'>No attendance log yet today.</p>"
                    }
                  </div>
                </section>
              `
              : ""
          }

          ${
            activeTab === "team" && managerMode
              ? `
                <section class="attendance-panel">
                  <header class="attendance-panel-head">
                    <p class="attendance-card-eyebrow">Team Attendance</p>
                    <div class="attendance-team-filters">
                      <button type="button" class="mini-btn ${teamFilter === "all" ? "is-active" : ""}" data-action="attendance-team-filter" data-id="all">All</button>
                      <button type="button" class="mini-btn ${teamFilter === "late" ? "is-active" : ""}" data-action="attendance-team-filter" data-id="late">Late</button>
                      <button type="button" class="mini-btn ${teamFilter === "on-break" ? "is-active" : ""}" data-action="attendance-team-filter" data-id="on-break">On Break</button>
                      <button type="button" class="mini-btn ${teamFilter === "absent" ? "is-active" : ""}" data-action="attendance-team-filter" data-id="absent">Absent</button>
                    </div>
                  </header>
                  <div class="data-table-shell">
                    <table class="data-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Status</th>
                          <th>First In</th>
                          <th>Morning</th>
                          <th>Lunch</th>
                          <th>Afternoon</th>
                          <th>Break</th>
                          <th>Worked</th>
                          <th>Compliance</th>
                          <th>Late</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${
                          teamRows.length
                            ? teamRows
                                .map(
                                  (row) => `
                                    <tr>
                                      <td>${escapeHtml(row.member.name || "-")}</td>
                                      <td><span class="attendance-status-pill is-${attendanceStatusClass(row.status)}">${escapeHtml(row.status)}</span></td>
                                      <td>${escapeHtml(row.firstIn)}</td>
                                      <td>${escapeHtml(row.morningLabel)}</td>
                                      <td>${escapeHtml(row.lunchLabel)}</td>
                                      <td>${escapeHtml(row.afternoonLabel)}</td>
                                      <td>${escapeHtml(row.breakLabel)}</td>
                                      <td>${escapeHtml(row.workedLabel)}</td>
                                      <td><span class="attendance-compliance ${
                                        row.complianceTone === "pending"
                                          ? "is-pending"
                                          : row.complianceTone === "ok"
                                            ? "is-ok"
                                            : "is-issue"
                                      }">${escapeHtml(row.compliance)}</span></td>
                                      <td>${
                                        row.punctualityTone === "late"
                                          ? "<span class='attendance-late-flag'>Late</span>"
                                          : row.punctualityTone === "half-day"
                                            ? "<span class='attendance-late-flag is-half-day'>Half day</span>"
                                            : row.punctualityTone === "absent"
                                              ? "<span class='attendance-late-flag is-absent'>Absent</span>"
                                              : row.punctualityTone === "on-time"
                                                ? "<span class='task-meta'>On time</span>"
                                                : "<span class='task-meta'>-</span>"
                                      }</td>
                                    </tr>
                                  `
                                )
                                .join("")
                            : "<tr><td colspan='10' class='task-meta'>No members for this filter.</td></tr>"
                        }
                      </tbody>
                    </table>
                  </div>
                </section>
              `
              : ""
          }

          ${
            activeTab === "requests"
              ? `
                <section class="attendance-panel">
                  <header class="attendance-panel-head">
                    <p class="attendance-card-eyebrow">${managerMode ? "Adjustment Requests" : "My Requests"}</p>
                  </header>
                  <div class="data-table-shell">
                    <table class="data-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Member</th>
                          <th>Type</th>
                          <th>Reason</th>
                          <th>Status</th>
                          ${managerMode ? "<th>Actions</th>" : ""}
                        </tr>
                      </thead>
                      <tbody>
                        ${
                          visibleRequests.length
                            ? visibleRequests
                                .map((entry) => {
                                  const status = String(entry.status || "Pending");
                                  const statusTone = status.toLowerCase().replaceAll(" ", "-");
                                  return `
                                    <tr>
                                      <td>${escapeHtml(String(entry.date || "-"))}</td>
                                      <td>${escapeHtml(String(entry.userName || "-"))}</td>
                                      <td>${escapeHtml(String(entry.type || "Missing Punch"))}</td>
                                      <td>${escapeHtml(String(entry.reason || "-"))}</td>
                                      <td><span class="attendance-status-pill is-${escapeHtml(statusTone)}">${escapeHtml(status)}</span></td>
                                      ${
                                        managerMode
                                          ? `
                                            <td>
                                              ${
                                                status === "Pending"
                                                  ? `
                                                    <div class="attendance-request-actions">
                                                      <button type="button" class="mini-btn" data-action="attendance-request-approve" data-id="${escapeHtml(String(entry.id || ""))}">Approve</button>
                                                      <button type="button" class="mini-btn mini-btn-danger" data-action="attendance-request-reject" data-id="${escapeHtml(String(entry.id || ""))}">Reject</button>
                                                    </div>
                                                  `
                                                  : "<span class='task-meta'>Reviewed</span>"
                                              }
                                            </td>
                                          `
                                          : ""
                                      }
                                    </tr>
                                  `;
                                })
                                .join("")
                            : `<tr><td colspan="${managerMode ? "6" : "5"}" class="task-meta">No requests yet.</td></tr>`
                        }
                      </tbody>
                    </table>
                  </div>
                </section>
              `
              : ""
          }

          ${
            activeTab === "policy"
              ? `
                <section class="attendance-panel">
                  <header class="attendance-panel-head">
                    <p class="attendance-card-eyebrow">Attendance Policy</p>
                    ${
                      managerMode
                        ? `<button type="button" class="mini-btn" data-action="attendance-policy-edit">Set Work Time</button>`
                        : ""
                    }
                  </header>
                  <div class="attendance-policy-grid">
                    <p><span>Shift</span><strong>${escapeHtml(policy.shiftStart)} - ${escapeHtml(policy.shiftEnd)}</strong></p>
                    <p><span>Late After</span><strong>${escapeHtml(`${lateAfterMinutes} min`)}</strong></p>
                    <p><span>Half-day</span><strong>${escapeHtml(`${halfDayAfterMinutes} min`)}</strong></p>
                    <p><span>Auto Absent</span><strong>${autoAbsentAfterMinutes > 0 ? escapeHtml(`${autoAbsentAfterMinutes} min`) : "Disabled"}</strong></p>
                    <p><span>Unpaid Break</span><strong>${escapeHtml(`${policy.breakMinutes} min`)}</strong></p>
                    <p><span>Work Days</span><strong>${escapeHtml(workDaysLabel || "Mon-Fri")}</strong></p>
                    <p><span>Timezone</span><strong>${escapeHtml(policy.timezone || "Local")}</strong></p>
                  </div>
                  <div class="attendance-break-plan">
                    ${breakPlanRows}
                  </div>
                </section>
              `
              : ""
          }
        </div>
      </section>
    `
  };
}

export function formatTimeLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatRelativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return "";
  }

  const diffMs = Date.now() - date.valueOf();
  if (diffMs < 0) {
    return formatTimeLabel(value);
  }

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) {
    return "now";
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d`;
  }

  const weeks = Math.floor(days / 7);
  if (weeks < 5) {
    return `${weeks}w`;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(date);
}

export function parseConversationKey(value) {
  const [targetType, ...rest] = String(value || "").split(":");
  return { targetType, targetId: rest.join(":") };
}

function getWorkspaceMemberNameSet(data) {
  return new Set(
    [data.currentUser?.name, ...(data.teamMembers || []).map((member) => member?.name)]
      .map((value) => normalizeForMatch(value))
      .filter(Boolean)
  );
}

export function isWorkspaceDirectThread(data, thread) {
  const workspaceNames = getWorkspaceMemberNameSet(data);
  const members = Array.isArray(thread?.members) ? thread.members : [];
  const normalizedMembers = members.map((value) => normalizeForMatch(value)).filter(Boolean);
  if (normalizedMembers.length) {
    return normalizedMembers.every((memberName) => workspaceNames.has(memberName));
  }
  return workspaceNames.has(normalizeForMatch(thread?.name));
}

function crmConversationEntityLabel(entityType) {
  const normalized = String(entityType || "").trim().toLowerCase();
  if (normalized === "lead") {
    return "Lead";
  }
  if (normalized === "account") {
    return "Account";
  }
  if (normalized === "deal") {
    return "Deal";
  }
  return "CRM";
}

export function collectConversations(data) {
  const crmConversations = (data.crmConversations || []).map((conversation) => {
    const entityLabel = crmConversationEntityLabel(conversation.entityType);
    const accountName = String(conversation.accountName || "").trim();
    const ownerName = String(conversation.owner || "").trim();
    const subtitleParts = [entityLabel];
    if (accountName && accountName !== String(conversation.title || "").trim()) {
      subtitleParts.push(accountName);
    }
    return {
      targetType: "crm",
      targetId: conversation.id,
      name: conversation.title,
      subtitle: subtitleParts.join(" • "),
      detail: ownerName ? `Owner: ${ownerName}` : `${entityLabel} conversation`,
      entityType: String(conversation.entityType || "").trim().toLowerCase(),
      unread: Number(conversation.unread || 0),
      pinned: Boolean(conversation.pinned),
      muted: Boolean(conversation.muted),
      sortAt: String(conversation.updatedAt || conversation.createdAt || ""),
      status: String(conversation.status || "").trim().toLowerCase()
    };
  });

  const channels = (data.channels || []).map((channel) => ({
    targetType: "channel",
    targetId: channel.id,
    name: channel.name,
    subtitle: "Workspace GC",
    channelType: channel.type,
    detail: channel.topic || "",
    memberIds: Array.isArray(channel.memberIds) ? channel.memberIds : [],
    presence: channel.presence || null,
    unread: Number(channel.unread || 0),
    pinned: Boolean(channel.pinned),
    muted: Boolean(channel.muted),
    sortAt: "",
    latestMessage: channel.latestMessage || null
  }));

  const directs = (data.directThreads || []).map((thread) => ({
    targetType: "direct",
    targetId: thread.id,
    name: thread.name,
    subtitle: "Direct message",
    members: Array.isArray(thread.members) ? thread.members : [],
    detail: Array.isArray(thread.members) ? thread.members.join(", ") : "",
    memberIds: Array.isArray(thread.memberIds) ? thread.memberIds : [],
    presence: thread.presence || null,
    unread: Number(thread.unread || 0),
    pinned: Boolean(thread.pinned),
    muted: Boolean(thread.muted),
    sortAt: "",
    latestMessage: thread.latestMessage || null
  }));

  return [...channels, ...directs].sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }
    if (b.unread !== a.unread) {
      return b.unread - a.unread;
    }
    const left = Date.parse(String(a.sortAt || ""));
    const right = Date.parse(String(b.sortAt || ""));
    const safeLeft = Number.isFinite(left) ? left : 0;
    const safeRight = Number.isFinite(right) ? right : 0;
    return safeRight - safeLeft;
  });
}

export function messageBelongsToConversation(message, conversation) {
  if (!conversation) {
    return false;
  }
  const targetType = message.targetType || (message.channelId ? "channel" : "direct");
  const targetId = message.targetId || message.channelId || "";
  return targetType === conversation.targetType && targetId === conversation.targetId;
}

function messageTypeClass(messageType) {
  return String(messageType || "update").toLowerCase().replaceAll(" ", "-");
}

export function highlightMentions(text) {
  return escapeHtml(text).replace(/(@[a-zA-Z0-9._-]{2,64})/g, "<span class='mention-token'>$1</span>");
}

export function formatBytesCompact(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
}

export function uniqueByKey(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = conversationKey(item.targetType, item.targetId);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isLowSignalMessengerText(value) {
  const text = String(value || "").trim();
  return Boolean(text) && text.length <= 2 && /^[\W_]+$/u.test(text);
}

function getMessengerPresenceMembers(conversation, options = {}) {
  const presenceMembers = Array.isArray(conversation?.presence?.members) ? conversation.presence.members : [];
  if (!presenceMembers.length) {
    return [];
  }
  const currentUserId = String(options.currentUserId || "").trim();
  return presenceMembers
    .map((entry) => ({
      memberId: String(entry?.memberId || entry?.id || "").trim(),
      presenceStatus: String(entry?.presenceStatus || "").trim().toLowerCase(),
      activeConversationId: String(entry?.activeConversationId || "").trim(),
      lastSeenAt: String(entry?.lastSeenAt || entry?.updatedAt || "").trim()
    }))
    .filter((entry) => {
      if (!entry.memberId) {
        return false;
      }
      if (conversation?.targetType === "direct" && currentUserId && entry.memberId === currentUserId) {
        return false;
      }
      return true;
  });
}

export function buildMessengerPresenceSummary(conversation, options = {}) {
  const members = getMessengerPresenceMembers(conversation, options);
  if (!members.length) {
    return { label: "Presence unavailable", tone: "is-unavailable" };
  }

  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const activeThresholdMs = Math.max(15000, Number(options.activeThresholdMs || 45000));
  const recentThresholdMs = Math.max(activeThresholdMs, Number(options.recentThresholdMs || 5 * 60 * 1000));

  const classified = members.map((entry) => {
    const seenAtMs = Date.parse(entry.lastSeenAt || "");
    const hasSeenAt = Number.isFinite(seenAtMs);
    const ageMs = hasSeenAt ? Math.max(0, nowMs - seenAtMs) : Number.POSITIVE_INFINITY;
    const active = entry.presenceStatus === "active" && ageMs <= activeThresholdMs;
    const recent = active || (hasSeenAt && ageMs <= recentThresholdMs);
    return {
      ...entry,
      seenAtMs,
      ageMs,
      active,
      recent
    };
  });

  if (conversation?.targetType === "direct") {
    const other = classified[0] || null;
    if (!other) {
      return { label: "Presence unavailable", tone: "is-unavailable" };
    }
    if (other.active) {
      return { label: "Active now", tone: "is-active" };
    }
    if (other.recent) {
      return { label: "Recently active", tone: "is-recent" };
    }
    if (Number.isFinite(other.seenAtMs)) {
      return { label: `Last seen ${formatRelativeTime(other.lastSeenAt)}`, tone: "is-offline" };
    }
    return { label: "Offline", tone: "is-offline" };
  }

  const activeCount = classified.filter((entry) => entry.active).length;
  const recentCount = classified.filter((entry) => entry.recent).length;
  const latestSeenAt = classified.reduce((latest, entry) => {
    if (!Number.isFinite(entry.seenAtMs)) {
      return latest;
    }
    return !latest || entry.seenAtMs > latest.seenAtMs ? entry : latest;
  }, null);

  if (activeCount > 0) {
    return {
      label: activeCount === 1 ? "1 active now" : `${activeCount} active now`,
      tone: "is-active"
    };
  }
  if (recentCount > 0) {
    return {
      label: recentCount === 1 ? "Recently active" : `${recentCount} recently active`,
      tone: "is-recent"
    };
  }
  if (latestSeenAt && Number.isFinite(latestSeenAt.seenAtMs)) {
    return {
      label: `Last seen ${formatRelativeTime(latestSeenAt.lastSeenAt)}`,
      tone: "is-offline"
    };
  }
  return { label: "Offline", tone: "is-offline" };
}

function buildMessengerRowPreview(conversation, latest, options = {}) {
  const currentUserId = String(options.currentUserId || "").trim();
  const currentUserName = String(options.currentUserName || "").trim().toLowerCase();
  const latestSenderId = String(latest?.senderId || "").trim();
  const latestSenderName = String(latest?.sender || "").trim();
  const latestSenderKey = latestSenderName.toLowerCase();
  const isCurrentUser =
    (latestSenderId && currentUserId && latestSenderId === currentUserId) ||
    (latestSenderKey && currentUserName && latestSenderKey === currentUserName);
  const latestText = String(latest?.text || latest?.body || "").replaceAll("\n", " ").trim();
  const latestAttachmentCount = Array.isArray(latest?.attachments)
    ? latest.attachments.length
    : Math.max(0, Number(latest?.attachmentCount || 0));
  const latestDeletedAt = String(latest?.deletedAt || "").trim();

  let body = "";
  if (latestDeletedAt) {
    body = "Message deleted";
  } else if (latestText && !isLowSignalMessengerText(latestText)) {
    body = latestText;
  } else if (latestAttachmentCount > 0) {
    body = latestAttachmentCount === 1 ? "Sent an attachment" : `Sent ${latestAttachmentCount} attachments`;
  } else if (latestText) {
    body = "Sent a message";
  } else {
    body = "No messages yet.";
  }

  if (conversation.targetType === "direct") {
    return isCurrentUser ? `You: ${body}` : body;
  }

  const senderLabel = isCurrentUser ? "You" : latestSenderName || "Someone";
  return latest ? `${senderLabel}: ${body}` : body;
}

function commsSkeletonBar(width, extraClass = "") {
  const safeWidth = Number.isFinite(Number(width)) ? `${Math.max(24, Number(width))}px` : "72px";
  return `<span class="comms-skeleton-bar${extraClass ? ` ${extraClass}` : ""}" style="width:${safeWidth}" aria-hidden="true"></span>`;
}

export function renderMessengerRailSkeleton(count = 7) {
  return Array.from({ length: count }, (_, index) => {
    const cycle = index % 4;
    const nameWidth = [126, 142, 118, 134][cycle];
    const detailWidth = [92, 108, 84, 98][cycle];
    const previewWidth = [164, 186, 152, 176][cycle];
    const showDetail = index % 3 === 0;
    return `
      <article class="conversation-item is-messenger is-skeleton" aria-hidden="true">
        <div class="conversation-main-hit conversation-main-hit-skeleton">
          <span class="comms-skeleton-avatar"></span>
          <span class="conversation-main">
            <span class="conversation-topline">
              ${commsSkeletonBar(nameWidth, "is-name")}
              ${commsSkeletonBar(30, "is-time")}
            </span>
            ${showDetail ? `<span class="conversation-subline">${commsSkeletonBar(detailWidth, "is-subline")}</span>` : ""}
            ${commsSkeletonBar(previewWidth, "is-preview")}
          </span>
        </div>
        <span class="conversation-right conversation-right-skeleton">
          <span class="comms-skeleton-icon is-dot"></span>
        </span>
      </article>
    `;
  }).join("");
}

export function renderMessengerThreadHeaderSkeleton() {
  return `
    <div class="messenger-thread-head-shell messenger-thread-head-shell-skeleton" aria-hidden="true">
      <div class="messenger-thread-head-copy-skeleton">
        ${commsSkeletonBar(168, "is-title")}
        ${commsSkeletonBar(110, "is-subtitle")}
      </div>
    </div>
  `;
}

export function renderMessengerThreadSkeleton(count = 6) {
  return `
    <div class="messenger-message-feed messenger-message-feed-skeleton" aria-hidden="true">
      ${Array.from({ length: count }, (_, index) => {
        const isSelf = index % 3 === 2;
        const cycle = index % 4;
        const labelWidth = [54, 68, 62, 58][cycle];
        const timeWidth = [36, 42, 34, 40][cycle];
        const lineSets = [
          [188, 142],
          [228, 168, 116],
          [152, 96],
          [206, 154]
        ];
        return `
          <article class="message-row messenger-skeleton-message ${isSelf ? "is-self" : "is-peer"}">
            <div class="message-bubble messenger-skeleton-bubble">
              ${lineSets[cycle]
                .map((width, lineIndex) =>
                  commsSkeletonBar(width, lineIndex === lineSets[cycle].length - 1 ? "is-line-tail" : "")
                )
                .join("")}
            </div>
            <div class="message-foot messenger-skeleton-foot">
              <div class="message-meta messenger-skeleton-meta">
                ${commsSkeletonBar(labelWidth, "is-label")}
                ${commsSkeletonBar(timeWidth, "is-time")}
              </div>
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

export function renderMessengerComposerSkeleton() {
  return `
    <div class="comms-composer comms-composer-skeleton" aria-hidden="true">
      <section class="comms-mode-surface messenger-surface messenger-surface-skeleton">
        <div class="messenger-toolbar messenger-toolbar-skeleton">
          <span class="comms-skeleton-icon"></span>
          <span class="comms-skeleton-icon"></span>
          <span class="comms-skeleton-icon"></span>
        </div>
        <div class="messenger-compose-row messenger-compose-row-skeleton">
          <span class="comms-skeleton-input"></span>
          <span class="comms-skeleton-button"></span>
        </div>
      </section>
    </div>
  `;
}

export function renderMessengerInlineState(title, message) {
  return `
    <div class="email-empty-thread messenger-inline-state">
      <p class="task-title">${escapeHtml(title)}</p>
      <p class="task-meta">${escapeHtml(message)}</p>
    </div>
  `;
}

export function renderMessengerThreadState(title, message) {
  return `
    <div class="messenger-thread-head-shell messenger-thread-head-shell-status">
      <div class="messenger-thread-head-copy-status">
        <h3 class="block-title">${escapeHtml(title)}</h3>
        <p class="task-meta">${escapeHtml(message)}</p>
      </div>
    </div>
  `;
}

export function renderConversationRows(items, selectedKey, iconClass, emptyLabel, options = {}) {
  if (!items.length) {
    return `<p class="task-meta">${emptyLabel}</p>`;
  }

  const variant = options.variant || "default";
  const latestMessageByKey = options.latestMessageByKey || new Map();

  if (variant === "messenger") {
    const displayNameByKey = options.displayNameByKey || new Map();
    return items
      .map((conversation) => {
        const key = conversationKey(conversation.targetType, conversation.targetId);
        const latest = latestMessageByKey.get(key) || conversation.latestMessage;
        const presence = buildMessengerPresenceSummary(conversation, {
          currentUserId: options.currentUserId,
          nowMs: options.nowMs
        });
        const displayName = String(displayNameByKey.get(key) || conversation.name || "Conversation").trim() || "Conversation";
        const avatarLabel = escapeHtml(
          String(displayName || "")
            .replace("#", "")
            .trim()
            .slice(0, 1)
            .toUpperCase() || "C"
        );
        const timeLabel = latest ? formatRelativeTime(latest.createdAt) : "";
        const preview = escapeHtml(
          buildMessengerRowPreview(conversation, latest, {
            currentUserId: options.currentUserId,
            currentUserName: options.currentUserName
          })
        );
        const badgeLabel = "";
        const badgeMarkup = badgeLabel
          ? `<span class="conversation-record-badge is-${escapeHtml(String(conversation.entityType || "").trim().toLowerCase())}">${escapeHtml(badgeLabel)}</span>`
          : "";
        const subtitleMarkup =
          conversation.targetType === "channel" && conversation.detail
            ? `<span class="conversation-subline">${escapeHtml(conversation.detail)}</span>`
            : "";
        const presenceAvatarMarkup = presence
          ? `<span class="conversation-avatar-status ${escapeHtml(presence.tone)}" aria-hidden="true"></span>`
          : "";
        const readToggleAction = conversation.unread > 0 ? "comm-mark-read" : "comm-mark-unread";
        const readToggleLabel = conversation.unread > 0 ? "Mark read" : "Mark unread";
        const pinToggleLabel = conversation.pinned ? "Unpin" : "Pin";
        const muteToggleLabel = conversation.muted ? "Unmute" : "Mute";
        return `
          <article class="conversation-item is-messenger ${selectedKey === key ? "is-active" : ""}">
            <button
              class="conversation-main-hit"
              data-action="comm-select-conversation"
              data-id="${key}"
              type="button"
              aria-label="Open conversation ${escapeHtml(displayName)}"
            >
              <span class="conversation-avatar">${avatarLabel}${presenceAvatarMarkup}</span>
              <span class="conversation-main">
                <span class="conversation-topline">
                  <span class="conversation-name">${escapeHtml(displayName)}</span>
                  ${badgeMarkup}
                  ${timeLabel ? `<span class="conversation-time">${timeLabel}</span>` : ""}
                </span>
                ${subtitleMarkup}
                <span class="conversation-preview">${preview}</span>
              </span>
            </button>
            <span class="conversation-right">
              <span class="conversation-indicators">
                ${conversation.pinned ? "<i class='bi bi-pin-angle-fill conversation-pin' aria-hidden='true'></i>" : ""}
                ${conversation.unread > 0 ? "<span class='conversation-unread-dot' aria-label='Unread'></span>" : ""}
              </span>
              <details class="conversation-row-menu">
                <summary class="conversation-row-menu-toggle" aria-label="Conversation actions" title="Conversation actions">
                  <i class="bi bi-three-dots" aria-hidden="true"></i>
                </summary>
                <div class="conversation-row-dropdown">
                  <button type="button" class="conversation-row-item" data-action="${readToggleAction}" data-id="${key}">${readToggleLabel}</button>
                  <button type="button" class="conversation-row-item" data-action="comm-pin-toggle" data-id="${key}">${pinToggleLabel}</button>
                  <button type="button" class="conversation-row-item" data-action="comm-mute-toggle" data-id="${key}">${muteToggleLabel}</button>
                  <button type="button" class="conversation-row-item is-danger" data-action="comm-delete-conversation" data-id="${key}">Delete</button>
                </div>
              </details>
            </span>
          </article>
        `;
      })
      .join("");
  }

  if (variant === "email") {
    return items
      .map((conversation) => {
        const key = conversationKey(conversation.targetType, conversation.targetId);
        const latest = latestMessageByKey.get(key);
        const avatarLabel = escapeHtml(
          String(conversation.name || "")
            .replace("#", "")
            .trim()
            .slice(0, 1)
            .toUpperCase() || "M"
        );
        const messageSender = String(latest?.sender || "").trim();
        const messageText = String(latest?.text || "")
          .replaceAll("\n", " ")
          .replace(/\s+/g, " ")
          .trim();
        const subjectRaw =
          String(latest?.emailSubject || "").trim() ||
          String(latest?.linkedLabel || "").trim() ||
          (messageText ? messageText.slice(0, 72) : "No subject");
        const subjectLabel = escapeHtml(subjectRaw || "No subject");
        const previewLabel = escapeHtml(
          messageText ? `${messageSender ? `${messageSender}: ` : ""}${messageText}` : "No messages yet."
        );
        const linkedType = String(latest?.linkedType || "").trim();
        const linkedBadge = linkedType ? `<span class="conversation-email-link">${escapeHtml(linkedType)}</span>` : "";
        const timeLabel = latest ? formatRelativeTime(latest.createdAt) : "";
        const unreadClass = conversation.unread > 0 ? "is-unread" : "";
        return `
          <button
            class="conversation-item is-email ${selectedKey === key ? "is-active" : ""} ${unreadClass}"
            data-action="comm-select-conversation"
            data-id="${key}"
            type="button"
          >
            <span class="conversation-email-avatar">${avatarLabel}</span>
            <span class="conversation-email-main">
              <span class="conversation-email-topline">
                <strong class="conversation-email-name">${escapeHtml(conversation.name)}</strong>
                ${linkedBadge}
                ${timeLabel ? `<span class="conversation-email-time">${timeLabel}</span>` : ""}
              </span>
              <span class="conversation-email-line">
                <span class="conversation-email-subject">${subjectLabel}</span>
                <span class="conversation-email-divider">-</span>
                <span class="conversation-email-preview">${previewLabel}</span>
              </span>
            </span>
            <span class="conversation-email-right">
              ${conversation.unread > 0 ? `<span class='conversation-email-unread'>${conversation.unread}</span>` : ""}
            </span>
          </button>
        `;
      })
      .join("");
  }

  if (variant === "sms") {
    const smsMetaByKey = options.smsMetaByKey || new Map();
    return items
      .map((conversation) => {
        const key = conversationKey(conversation.targetType, conversation.targetId);
        const latest = latestMessageByKey.get(key);
        const smsMeta = smsMetaByKey.get(key) || {};
        const avatarLabel = escapeHtml(
          String(conversation.name || "")
            .replace("#", "")
            .trim()
            .slice(0, 1)
            .toUpperCase() || "S"
        );
        const previewSource = latest
          ? `${latest.sender || ""}${latest.sender ? ": " : ""}${latest.text || ""}`
          : "No SMS in this thread yet.";
        const preview = escapeHtml(String(previewSource).replaceAll("\n", " ").trim());
        const timeLabel = latest ? formatRelativeTime(latest.createdAt) : "";
        const tone =
          smsMeta.latestStatus === "failed"
            ? "is-failed"
            : smsMeta.latestStatus === "scheduled"
              ? "is-scheduled"
              : smsMeta.needsReply
                ? "is-needs-reply"
                : "is-sent";
        const statusLabel =
          smsMeta.latestStatus === "failed"
            ? "Failed"
            : smsMeta.latestStatus === "scheduled"
              ? "Scheduled"
              : smsMeta.needsReply
                ? "Needs reply"
                : "Active";
        return `
          <button
            class="conversation-item is-sms ${selectedKey === key ? "is-active" : ""}"
            data-action="comm-select-conversation"
            data-id="${key}"
            type="button"
          >
            <span class="conversation-avatar">${avatarLabel}</span>
            <span class="conversation-main">
              <span class="conversation-topline">
                <span class="conversation-name">${escapeHtml(conversation.name)}</span>
                ${timeLabel ? `<span class="conversation-time">${timeLabel}</span>` : ""}
              </span>
              <span class="conversation-preview">${preview}</span>
            </span>
            <span class="sms-thread-status ${tone}">${statusLabel}</span>
          </button>
        `;
      })
      .join("");
  }

  return items
    .map((conversation) => {
      const key = conversationKey(conversation.targetType, conversation.targetId);
      const icon =
        iconClass || (conversation.targetType === "channel" ? "bi bi-people-fill" : "bi bi-at");
      return `
        <button
          class="conversation-item ${selectedKey === key ? "is-active" : ""}"
          data-action="comm-select-conversation"
          data-id="${key}"
          type="button"
        >
          <div class="conversation-row">
            <span class="task-title"><i class="${icon}" aria-hidden="true"></i> ${escapeHtml(conversation.name)}</span>
            ${conversation.pinned ? "<i class='bi bi-pin-angle-fill' aria-hidden='true'></i>" : ""}
          </div>
          <span class="task-meta">${escapeHtml(conversation.subtitle)}</span>
          <span class="task-meta">${escapeHtml(conversation.detail || "\u00A0")}</span>
          <div class="conversation-meta">
            ${conversation.muted ? "<span class='status-chip'>Muted</span>" : ""}
            <span class="status-chip">${conversation.unread} unread</span>
          </div>
        </button>
      `;
    })
    .join("");
}

function isEmailMailboxMessage(message) {
  if (!message || typeof message !== "object") {
    return false;
  }
  const commMode = String(message.commMode || "")
    .trim()
    .toLowerCase();
  return Boolean(
    commMode === "email" ||
      String(message.emailFolder || "").trim() ||
      String(message.emailSubject || "").trim() ||
      String(message.emailTo || "").trim()
  );
}

function getEmailMailboxMessageKey(message) {
  const targetType = String(message?.targetType || (message?.channelId ? "channel" : "direct")).trim();
  const targetId = String(message?.targetId || message?.channelId || "").trim();
  return conversationKey(targetType || "direct", targetId);
}

function resolveEmailMailboxFolderId(message, currentUserName = "") {
  const rawFolder = String(message?.emailFolder || "")
    .trim()
    .toLowerCase();
  if (rawFolder === "sent" || rawFolder === "drafts" || rawFolder === "spam" || rawFolder === "trash") {
    return rawFolder;
  }
  if (rawFolder === "inbox" || rawFolder === "unread") {
    return "inbox";
  }
  const sender = String(message?.sender || "")
    .trim()
    .toLowerCase();
  if (sender && currentUserName && sender === currentUserName) {
    return "sent";
  }
  return "inbox";
}

function emailLocalPartLabel(value, fallback = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return String(fallback || "").trim();
  }
  const atIndex = raw.indexOf("@");
  if (atIndex <= 0) {
    return raw;
  }
  return raw.slice(0, atIndex).trim() || String(fallback || "").trim();
}

function resolveEmailMailboxPrimaryLabel(folderId, senderLabel, recipient) {
  const normalizedFolderId = String(folderId || "").trim().toLowerCase();
  if (normalizedFolderId === "sent") {
    const recipientLabel = emailLocalPartLabel(recipient, recipient || "recipient");
    return `To: ${recipientLabel || "recipient"}`;
  }
  if (normalizedFolderId === "drafts") {
    return "Draft";
  }
  const sender = String(senderLabel || "").trim();
  return emailLocalPartLabel(sender, sender || "Unknown sender") || "Unknown sender";
}

function renderEmailBodyMarkup(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "<p>No body content available.</p>";
  }
  return text
    .split(/\r?\n\r?\n/u)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br />")}</p>`)
    .join("");
}

function getLinkedContext(data, conversation, messages) {
  const latestWithLink = [...messages].reverse().find((item) => item.linkedType);
  if (latestWithLink) {
    return {
      type: latestWithLink.linkedType,
      label: latestWithLink.linkedLabel || latestWithLink.linkedType
    };
  }

  if (conversation?.targetType === "channel" && conversation.channelType) {
    const possible = conversation.channelType.toLowerCase();
    if (possible === "deal" || possible === "lead" || possible === "account" || possible === "project") {
      const label = conversation.name.includes(":")
        ? conversation.name.split(":").slice(1).join(":").trim()
        : conversation.name;
      return {
        type: conversation.channelType,
        label
      };
    }
  }

  return {
    type: "",
    label: ""
  };
}

export function getParticipants(data, conversation) {
  if (!conversation) {
    return [];
  }

  const normalizedTargetType = String(conversation.targetType || conversation.type || "").trim().toLowerCase();
  const isDirectConversation =
    normalizedTargetType === "direct" ||
    (Array.isArray(conversation.members) && conversation.members.length > 0 && !String(conversation.channelType || "").trim());

  if (isDirectConversation) {
    const teamMembersById = new Map(
      (Array.isArray(data.teamMembers) ? data.teamMembers : [])
        .map((member) => [String(member?.id || "").trim(), String(member?.name || "").trim()])
        .filter(([id, name]) => Boolean(id) && Boolean(name))
    );
    const currentUserName = String(data?.currentUser?.name || "").trim();
    const directMessageSenders = (Array.isArray(data.messages) ? data.messages : [])
      .filter((message) => messageBelongsToConversation(message, conversation))
      .map((message) => String(message?.sender || "").trim())
      .filter(Boolean);
    const directMembers = [
      String(conversation.name || "").trim(),
      currentUserName,
      ...(Array.isArray(conversation.members) ? conversation.members : []),
      ...(Array.isArray(conversation.memberIds) ? conversation.memberIds : [])
        .map((memberId) => teamMembersById.get(String(memberId || "").trim()) || ""),
      ...directMessageSenders
    ]
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    const directParticipantNames = [...new Set(directMembers)];
    if (directParticipantNames.length) {
      return directParticipantNames;
    }

    const directFallbackNames = [String(conversation.name || "").trim(), currentUserName].filter(Boolean);
    if (directFallbackNames.length) {
      return [...new Set(directFallbackNames)];
    }

    return String(conversation.detail || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  const fallback = (data.teamMembers || []).map((member) => member.name).slice(0, 6);
  if (conversation.channelType === "Team") {
    return fallback;
  }

  return fallback.slice(0, 4);
}

function normalizeMessengerNicknameKey(value) {
  return String(value || "").trim().toLowerCase();
}

export function getMessengerParticipantNickname(conversationKeyValue, participantName, nicknamesByConversationKey = {}) {
  const normalizedConversationKey = String(conversationKeyValue || "").trim();
  const normalizedParticipantName = normalizeMessengerNicknameKey(participantName);
  if (!normalizedConversationKey || !normalizedParticipantName) {
    return "";
  }
  const conversationNicknames = nicknamesByConversationKey[normalizedConversationKey];
  if (!conversationNicknames || typeof conversationNicknames !== "object") {
    return "";
  }
  const exactMatch = Object.entries(conversationNicknames).find(
    ([name]) => normalizeMessengerNicknameKey(name) === normalizedParticipantName
  );
  return String(exactMatch?.[1] || "").trim();
}

export function getMessengerConversationDisplayName(conversation, options = {}) {
  if (!conversation) {
    return "";
  }
  const key = conversationKey(conversation.targetType, conversation.targetId);
  const nicknamesByConversationKey = options.messengerNicknamesByConversationKey || {};
  if (String(conversation.targetType || "").trim() === "direct") {
    const directNickname = getMessengerParticipantNickname(
      key,
      conversation.name,
      nicknamesByConversationKey
    );
    return directNickname || String(conversation.name || "").trim();
  }
  return String(conversation.name || "").trim();
}

export function buildMessengerConversationDisplayNameMap(items, options = {}) {
  const displayNameByKey = new Map();
  (Array.isArray(items) ? items : []).forEach((conversation) => {
    const key = conversationKey(conversation.targetType, conversation.targetId);
    if (!key) {
      return;
    }
    displayNameByKey.set(key, getMessengerConversationDisplayName(conversation, options));
  });
  return displayNameByKey;
}

function routeForLinkedType(linkedType) {
  const normalized = String(linkedType || "").toLowerCase();
  if (normalized === "deal") {
    return "deals";
  }
  if (normalized === "lead") {
    return "leads";
  }
  if (normalized === "account") {
    return "accounts";
  }
  if (normalized === "contact") {
    return "contacts";
  }
  if (normalized === "project") {
    return "projects";
  }
  if (normalized === "task") {
    return "my-work";
  }
  return "";
}

function normalizePhoneDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function callSessionStatusLabel(status) {
  if (status === "dialing") {
    return "Dialing";
  }
  if (status === "ringing") {
    return "Ringing";
  }
  if (status === "connected") {
    return "Connected";
  }
  if (status === "wrapup") {
    return "Wrap-up";
  }
  if (status === "ended") {
    return "Ended";
  }
  return "Idle";
}

function callLogStatusLabel(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "queued") {
    return "Queued";
  }
  if (normalized === "dialing") {
    return "Dialing";
  }
  if (normalized === "ringing" || normalized === "inbound") {
    return "Ringing";
  }
  if (normalized === "connected") {
    return "Connected";
  }
  if (normalized === "hold") {
    return "On hold";
  }
  if (normalized === "transferring") {
    return "Transferring";
  }
  if (normalized === "wrapup") {
    return "Wrap-up";
  }
  if (normalized === "completed") {
    return "Completed";
  }
  if (normalized === "missed") {
    return "Missed";
  }
  if (normalized === "voicemail") {
    return "Voicemail";
  }
  if (normalized === "declined") {
    return "Declined";
  }
  if (normalized === "failed") {
    return "Failed";
  }
  if (normalized === "canceled") {
    return "Canceled";
  }
  return "Call";
}

function callLogToneClass(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (["queued", "dialing", "ringing", "inbound", "hold", "transferring"].includes(normalized)) {
    return "outcome-live";
  }
  if (normalized === "voicemail") {
    return "outcome-voicemail";
  }
  if (["missed", "declined", "failed", "canceled"].includes(normalized)) {
    return "outcome-missed";
  }
  if (normalized === "contact") {
    return "outcome-contact";
  }
  return "outcome-connected";
}

function formatCallDurationValue(totalSeconds) {
  const safe = Math.max(0, Number(totalSeconds || 0));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getCallPrimaryNumber(callLike) {
  if (!callLike || typeof callLike !== "object") {
    return "";
  }
  const direction = String(callLike.direction || "").trim().toLowerCase();
  if (direction === "inbound") {
    return String(callLike.fromNumber || callLike.toNumber || "").trim();
  }
  return String(callLike.toNumber || callLike.fromNumber || "").trim();
}

function findCallContactMatch(contacts, phoneValue, displayName = "") {
  const phoneDigits = normalizePhoneDigits(phoneValue);
  const displayKey = normalizeForMatch(displayName);
  return (
    (Array.isArray(contacts) ? contacts : []).find((contact) => {
      const contactDigits = normalizePhoneDigits(contact.phone || "");
      const contactKey = normalizeForMatch(contact.name);
      return (
        (phoneDigits && contactDigits && (contactDigits.endsWith(phoneDigits) || phoneDigits.endsWith(contactDigits))) ||
        (displayKey && contactKey === displayKey)
      );
    }) || null
  );
}

function getLinkedRecordAction(linkedType) {
  const normalized = String(linkedType || "").trim().toLowerCase();
  if (normalized === "lead") {
    return "lead-open";
  }
  if (normalized === "contact") {
    return "contact-open";
  }
  if (normalized === "account") {
    return "account-open";
  }
  if (normalized === "deal") {
    return "deal-open";
  }
  return "";
}

function getCallDurationLabel(session) {
  const connectedAt = session?.connectedAt ? Date.parse(session.connectedAt) : NaN;
  if (!Number.isFinite(connectedAt)) {
    return "00:00";
  }
  const endedAt = session?.endedAt ? Date.parse(session.endedAt) : Date.now();
  const effectiveEnd = Number.isFinite(endedAt) ? endedAt : Date.now();
  const totalSeconds = Math.max(0, Math.floor((effectiveEnd - connectedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function getCommsLockedMeta(mode, role) {
  const normalizedMode = String(mode || "internal").trim().toLowerCase();
  const normalizedRole = String(role || "Member").trim() || "Member";
  if (normalizedMode === "email") {
    return {
      title: "Email",
      icon: "bi bi-envelope-paper",
      eyebrow: "Locked",
      headline: "Email is being rolled out in phases",
      description: `${normalizedRole} access does not include Email yet. Workspace admins can finish setup while Comms remains locked for everyone else.`,
      ctaLabel: "Open Dashboard"
    };
  }
  if (normalizedMode === "sms") {
    return {
      title: "SMS",
      icon: "bi bi-chat-square-text",
      eyebrow: "Coming Soon",
      headline: "SMS is available to admins only for now",
      description: `${normalizedRole} access is currently locked while messaging rollout and provider setup continue.`,
      ctaLabel: "Open Dashboard"
    };
  }
  if (normalizedMode === "call") {
    return {
      title: "Calls",
      icon: "bi bi-telephone-forward",
      eyebrow: "Locked",
      headline: "Calls are restricted right now",
      description: `${normalizedRole} access does not include the Calls workspace yet. This keeps live calling and queue setup limited to admins during rollout.`,
      ctaLabel: "Open Dashboard"
    };
  }
  return {
    title: "Messenger",
    icon: "bi bi-chat-dots",
    eyebrow: "Locked",
    headline: "Messenger is available to admins only for now",
    description: `${normalizedRole} access is currently limited while Comms rolls out in phases. Contact a workspace admin if you need this enabled later.`,
    ctaLabel: "Open Dashboard"
  };
}

export function renderCommunications(data, context) {
  const query = context.searchTerm || "";
  const filter = context.commsFilter || "inbox";
  const mode = context.commsMode || "internal";
  const advancedOpen = Boolean(context.commsAdvancedOpen);
  const modeClass = mode === "call" ? "calls" : mode;
  const isMessengerMode = mode === "internal";
  const isEmailMode = mode === "email";
  const isSmsMode = mode === "sms";
  const isCallsMode = mode === "call";
  const currentUserRole = String(context.currentUserRole || data.currentUser?.role || "Member").trim() || "Member";
  if (context.commsLocked) {
    const lockedMeta = getCommsLockedMeta(mode, currentUserRole);
    return {
      title: lockedMeta.title,
      subtitle: "Available to admins only for now",
      showWaitingPanel: false,
      html: `
        <section class="view-block comms-locked-view">
          <div class="settings-access-card comms-access-card">
            <div class="settings-access-card-icon comms-access-card-icon">
              <i class="${lockedMeta.icon}" aria-hidden="true"></i>
            </div>
            <div class="settings-access-card-copy">
              <p class="settings-card-eyebrow">${escapeHtml(lockedMeta.eyebrow)}</p>
              <h4>${escapeHtml(lockedMeta.headline)}</h4>
              <p>${escapeHtml(lockedMeta.description)}</p>
              <p class="task-meta">Your role: ${escapeHtml(currentUserRole)}</p>
            </div>
            <div class="settings-form-actions">
              <button type="button" class="table-ops-columns-btn" data-route="dashboard">
                <i class="bi bi-speedometer2" aria-hidden="true"></i>
                <span>${escapeHtml(lockedMeta.ctaLabel)}</span>
              </button>
            </div>
          </div>
        </section>
      `
    };
  }
  const messengerSnapshotReady = !isMessengerMode || Boolean(context.messengerSnapshotReady);
  const messengerSnapshotError = isMessengerMode ? String(context.messengerSnapshotError || "").trim() : "";
  const currentUserName = String(data.currentUser?.name || "").trim().toLowerCase();
  const editMessageId = isMessengerMode ? String(context.messengerEditMessageId || "").trim() : "";
  const editDraft = isMessengerMode ? String(context.messengerEditDraft || "") : "";
  const isEditingMessage = Boolean(editMessageId);
  const activeFilter = isMessengerMode
    ? ["all", "direct", "gc"].includes(filter)
      ? filter
      : "all"
    : isSmsMode
      ? ["all", "needs-reply", "scheduled", "failed", "contacts"].includes(filter)
        ? filter
        : "all"
    : isCallsMode
      ? ["recents", "missed", "voicemail", "contacts"].includes(filter)
        ? filter
        : "recents"
      : isEmailMode
        ? ["inbox", "unread", "sent", "drafts", "spam", "trash", "linked"].includes(filter)
          ? filter
          : "inbox"
        : ["inbox", "unread", "pinned", "channels", "direct"].includes(filter)
          ? filter
          : "inbox";

  const allConversations = collectConversations(data);
  const messengerConversations = allConversations.filter(
    (conversation) =>
      conversation.targetType === "channel" ||
      (conversation.targetType === "direct" && isWorkspaceDirectThread(data, conversation))
  );
  const scopedConversations = isMessengerMode
    ? messengerConversations
    : isEmailMode || isSmsMode
    ? allConversations.filter((conversation) => conversation.targetType === "direct")
    : allConversations;

  const scopedMessages = (data.messages || []).filter((message) => {
    const commMode = String(message.commMode || "").trim().toLowerCase();
    if (isMessengerMode) {
      return !commMode || commMode === "internal";
    }
    if (isEmailMode) {
      return commMode === "email";
    }
    if (isSmsMode) {
      return commMode === "sms";
    }
    if (isCallsMode) {
      return commMode === "call";
    }
    return true;
  });

  const messagesByConversationKey = new Map();
  scopedMessages.forEach((message) => {
    const targetType = message.targetType || (message.channelId ? "channel" : "direct");
    const targetId = message.targetId || message.channelId || "";
    if (!targetId) {
      return;
    }
    const key = conversationKey(targetType, targetId);
    if (!messagesByConversationKey.has(key)) {
      messagesByConversationKey.set(key, []);
    }
    messagesByConversationKey.get(key).push(message);
  });

  const latestMessageByKey = new Map();
  messagesByConversationKey.forEach((threadMessages, key) => {
    const sorted = [...threadMessages].sort((a, b) => new Date(a.createdAt).valueOf() - new Date(b.createdAt).valueOf());
    const latest = sorted[sorted.length - 1];
    if (latest) {
      latestMessageByKey.set(key, latest);
    }
  });

  const smsThreadMetaByKey = new Map();
  if (isSmsMode) {
    scopedConversations.forEach((conversation) => {
      const key = conversationKey(conversation.targetType, conversation.targetId);
      const threadMessages = [...(messagesByConversationKey.get(key) || [])].sort(
        (a, b) => new Date(a.createdAt).valueOf() - new Date(b.createdAt).valueOf()
      );
      const smsMessages = threadMessages.filter((message) => String(message.commMode || "").toLowerCase() === "sms");
      const latestAny = threadMessages[threadMessages.length - 1] || null;
      const latestSms = smsMessages[smsMessages.length - 1] || null;
      const latestMessage = latestSms || latestAny || null;
      const latestStatus = String(latestSms?.smsStatus || "").trim().toLowerCase();
      const hasFailed = smsMessages.some((message) => String(message.smsStatus || "").trim().toLowerCase() === "failed");
      const hasScheduled = smsMessages.some(
        (message) => String(message.smsStatus || "").trim().toLowerCase() === "scheduled"
      );
      const latestSender = String(latestMessage?.sender || "")
        .trim()
        .toLowerCase();
      const needsReply = Boolean(latestMessage && latestSender && latestSender !== currentUserName);
      smsThreadMetaByKey.set(key, {
        hasSms: smsMessages.length > 0,
        latestStatus,
        hasFailed,
        hasScheduled,
        needsReply
      });
      if (latestMessage) {
        latestMessageByKey.set(key, latestMessage);
      }
    });
  }

  const emailDraft = isEmailMode && context.emailComposeDraft ? context.emailComposeDraft : {};
  const emailDraftHasContent = isEmailMode
    ? [emailDraft.to, emailDraft.cc, emailDraft.bcc, emailDraft.subject, emailDraft.text, emailDraft.linkedType, emailDraft.linkedLabel].some(
        (value) => Boolean(String(value || "").trim())
      )
    : false;
  const emailDraftThreadKey = emailDraftHasContent ? String(context.selectedConversationKey || "") : "";
  const emailThreadMetaByKey = new Map();
  if (isEmailMode) {
    scopedConversations.forEach((conversation) => {
      const key = conversationKey(conversation.targetType, conversation.targetId);
      const threadMessages = messagesByConversationKey.get(key) || [];
      const hasSent = threadMessages.some((message) => {
        const folder = String(message.emailFolder || "").toLowerCase();
        if (folder === "sent") {
          return true;
        }
        if (String(message.commMode || "").toLowerCase() !== "email") {
          return false;
        }
        if (folder && folder !== "inbox") {
          return false;
        }
        const sender = String(message.sender || "").trim().toLowerCase();
        return Boolean(sender) && sender === currentUserName;
      });
      const isSpam = threadMessages.some((message) => String(message.emailFolder || "").toLowerCase() === "spam");
      const isTrash = threadMessages.some((message) => String(message.emailFolder || "").toLowerCase() === "trash");
      const hasLinked = threadMessages.some((message) => Boolean(String(message.linkedType || "").trim()));
      const hasDraft = emailDraftThreadKey === key;
      emailThreadMetaByKey.set(key, {
        hasSent,
        hasDraft,
        isSpam,
        isTrash,
        hasLinked
      });
    });
  }

  const conversationSearchTerm = isMessengerMode ? "" : query;
  const searchableConversations = scopedConversations.filter((conversation) =>
    matchesSearch(
      [conversation.name, conversation.subtitle, conversation.detail, String(conversation.unread)],
      conversationSearchTerm
    )
  );

  let filteredConversations = searchableConversations;
  if (isEmailMode) {
    if (activeFilter === "unread") {
      filteredConversations = searchableConversations.filter((conversation) => conversation.unread > 0);
    } else if (activeFilter === "sent") {
      filteredConversations = searchableConversations.filter((conversation) =>
        Boolean(emailThreadMetaByKey.get(conversationKey(conversation.targetType, conversation.targetId))?.hasSent)
      );
    } else if (activeFilter === "drafts") {
      filteredConversations = searchableConversations.filter((conversation) =>
        Boolean(emailThreadMetaByKey.get(conversationKey(conversation.targetType, conversation.targetId))?.hasDraft)
      );
    } else if (activeFilter === "spam") {
      filteredConversations = searchableConversations.filter((conversation) =>
        Boolean(emailThreadMetaByKey.get(conversationKey(conversation.targetType, conversation.targetId))?.isSpam)
      );
    } else if (activeFilter === "trash") {
      filteredConversations = searchableConversations.filter((conversation) =>
        Boolean(emailThreadMetaByKey.get(conversationKey(conversation.targetType, conversation.targetId))?.isTrash)
      );
    } else if (activeFilter === "linked") {
      filteredConversations = searchableConversations.filter((conversation) =>
        Boolean(emailThreadMetaByKey.get(conversationKey(conversation.targetType, conversation.targetId))?.hasLinked)
      );
    } else {
      filteredConversations = searchableConversations.filter((conversation) => {
        const meta = emailThreadMetaByKey.get(conversationKey(conversation.targetType, conversation.targetId));
        return !meta?.isSpam && !meta?.isTrash;
      });
    }
  } else if (isSmsMode) {
    if (activeFilter === "needs-reply") {
      filteredConversations = searchableConversations.filter((conversation) =>
        Boolean(smsThreadMetaByKey.get(conversationKey(conversation.targetType, conversation.targetId))?.needsReply)
      );
    } else if (activeFilter === "scheduled") {
      filteredConversations = searchableConversations.filter((conversation) =>
        Boolean(smsThreadMetaByKey.get(conversationKey(conversation.targetType, conversation.targetId))?.hasScheduled)
      );
    } else if (activeFilter === "failed") {
      filteredConversations = searchableConversations.filter((conversation) =>
        Boolean(smsThreadMetaByKey.get(conversationKey(conversation.targetType, conversation.targetId))?.hasFailed)
      );
    } else if (activeFilter === "contacts") {
      filteredConversations = searchableConversations;
    } else {
      filteredConversations = searchableConversations;
    }
  } else if (isMessengerMode) {
    if (activeFilter === "direct") {
      filteredConversations = searchableConversations.filter((conversation) => conversation.targetType === "direct");
    } else if (activeFilter === "gc") {
      filteredConversations = searchableConversations.filter((conversation) => conversation.targetType === "channel");
    } else {
      filteredConversations = searchableConversations;
    }
  } else if (activeFilter === "pinned") {
    filteredConversations = searchableConversations.filter((conversation) => conversation.pinned);
  } else if (activeFilter === "channels") {
    filteredConversations = searchableConversations.filter((conversation) => conversation.targetType === "channel");
  } else if (activeFilter === "direct") {
    filteredConversations = searchableConversations.filter((conversation) => conversation.targetType === "direct");
  }

  const selectedFromContext = parseConversationKey(context.selectedConversationKey);
  const selectedFromState = scopedConversations.find(
    (conversation) =>
      conversation.targetType === selectedFromContext.targetType &&
      conversation.targetId === selectedFromContext.targetId
  );
  const selectedVisible =
    selectedFromState &&
    filteredConversations.some(
      (conversation) =>
        conversation.targetType === selectedFromState.targetType &&
        conversation.targetId === selectedFromState.targetId
    )
      ? selectedFromState
      : null;
  const selectedConversation =
    selectedVisible ||
    filteredConversations[0] ||
    (isEmailMode && activeFilter !== "inbox" ? null : scopedConversations[0]) ||
    null;

  const selectedConversationKey = selectedConversation
    ? conversationKey(selectedConversation.targetType, selectedConversation.targetId)
    : "";

  const typingIndicatorMarkup =
    isMessengerMode && selectedConversation
      ? (() => {
          const rawTyping = Array.isArray(context.messengerTyping) ? context.messengerTyping : [];
          const activeTyping = rawTyping.filter((entry) => {
            if (!entry || entry.conversationId !== selectedConversation.targetId) {
              return false;
            }
            if (String(entry.memberId || "") === String(data.currentUser?.id || "")) {
              return false;
            }
            const updatedAt = Date.parse(String(entry.updatedAt || ""));
            return Number.isFinite(updatedAt) && Date.now() - updatedAt < 12000;
          });
          if (!activeTyping.length) {
            return "";
          }
          const memberNameMap = new Map(
            (data.teamMembers || []).map((member) => [String(member.id || ""), String(member.name || "").trim()])
          );
          const names = activeTyping
            .map((entry) => memberNameMap.get(String(entry.memberId || "")) || "Someone")
            .filter(Boolean);
          const uniqueNames = [...new Set(names)];
          if (!uniqueNames.length) {
            return "";
          }
          let label = "";
          if (uniqueNames.length === 1) {
            label = `${uniqueNames[0]} is typing...`;
          } else if (uniqueNames.length === 2) {
            label = `${uniqueNames[0]} and ${uniqueNames[1]} are typing...`;
          } else {
            label = `${uniqueNames[0]} and ${uniqueNames.length - 1} others are typing...`;
          }
          return `<p class=\"messenger-typing-indicator\">${escapeHtml(label)}</p>`;
        })()
      : "";

  const messagesForConversation = scopedMessages
    .filter((message) => {
      if (!messageBelongsToConversation(message, selectedConversation)) {
        return false;
      }
      if (!query) {
        return true;
      }
      return matchesSearch(
        [
          message.sender,
          message.text,
          message.createdAt,
          message.messageType || "Update",
          message.linkedType || "",
          message.linkedLabel || ""
        ],
        query
      );
    })
    .sort((a, b) => new Date(a.createdAt).valueOf() - new Date(b.createdAt).valueOf());

  const showMessengerBootstrapSkeleton = isMessengerMode && !messengerSnapshotReady && !messengerSnapshotError;
  const showMessengerLoadError = isMessengerMode && !messengerSnapshotReady && Boolean(messengerSnapshotError);
  const showMessengerRailSkeleton = showMessengerBootstrapSkeleton;
  const showMessengerThreadSkeleton = showMessengerBootstrapSkeleton;
  const showMessengerHeaderSkeleton = showMessengerBootstrapSkeleton;

  const messageRows =
    mode === "email"
      ? messagesForConversation
          .map((message) => {
            const preview = String(message.text || "").replaceAll("\n", " ").trim();
            const subject = String(message.emailSubject || "").trim() || preview.slice(0, 78) || "No subject";
            const body = preview.slice(0, 180);
            const initials = String(message.sender || "").trim().slice(0, 1).toUpperCase() || "U";
            const sender = String(message.sender || "").trim().toLowerCase();
            const folder = String(message.emailFolder || "").toLowerCase();
            const outbound = folder === "sent" || (sender && sender === currentUserName);
            return `
              <article class="email-thread-item ${outbound ? "is-outbound" : "is-inbound"}">
                <span class="email-row-check" aria-hidden="true"></span>
                <span class="email-row-star" aria-hidden="true">
                  <i class="bi ${message.important ? "bi-star-fill" : "bi-star"}" aria-hidden="true"></i>
                </span>
                <span class="email-thread-avatar">${escapeHtml(initials)}</span>
                <div class="email-thread-main">
                  <div class="email-thread-head">
                    <strong>${escapeHtml(message.sender)}</strong>
                    <span class="email-thread-time">${formatTimeLabel(message.createdAt)}</span>
                  </div>
                  <p class="email-thread-subject">${escapeHtml(subject)}</p>
                  <p class="task-meta">${escapeHtml(body)}${preview.length > 180 ? "..." : ""}</p>
                </div>
              </article>
            `;
          })
          .join("")
      : mode === "sms"
        ? messagesForConversation
            .map((message) => {
              const isSelf =
                String(message.sender || "").toLowerCase() === String(data.currentUser.name || "").toLowerCase();
              const statusToken = String(message.smsStatus || "")
                .trim()
                .toLowerCase();
              const statusLabel =
                statusToken === "failed"
                  ? "Failed"
                  : statusToken === "scheduled"
                    ? "Scheduled"
                    : statusToken === "delivered"
                      ? "Delivered"
                      : statusToken === "sent"
                        ? "Sent"
                        : isSelf
                          ? "Sent"
                          : "Received";
              const statusClass =
                statusToken === "failed"
                  ? "is-failed"
                  : statusToken === "scheduled"
                    ? "is-scheduled"
                    : statusToken === "delivered"
                      ? "is-delivered"
                      : "is-sent";
              const messageText = String(message.text || "").trim();
              return `
                <article class="message-row sms-message-row ${isSelf ? "is-self" : "is-peer"}">
                  <div class="message-bubble sms-message-bubble ${isSelf ? "is-outbound" : "is-inbound"}">
                    <p class="message-text">${highlightMentions(messageText || "No message body")}</p>
                  </div>
                  <div class="message-foot sms-message-foot">
                    <div class="message-meta">
                      <strong>${escapeHtml(message.sender)}</strong>
                      <span>${formatTimeLabel(message.createdAt)}</span>
                      <span class="sms-status-pill ${statusClass}">${statusLabel}</span>
                    </div>
                  </div>
                </article>
              `;
            })
            .join("")
      : mode === "call"
        ? [...messagesForConversation]
            .reverse()
            .map((message) => {
              const note = String(message.text || "").slice(0, 160);
              return `
                <article class="call-log-item">
                  <div class="call-log-head">
                    <span class="call-dot"><i class="bi bi-telephone" aria-hidden="true"></i></span>
                    <div>
                      <p class="task-title">${escapeHtml(message.sender)} call log</p>
                      <p class="task-meta">${formatTimeLabel(message.createdAt)}</p>
                    </div>
                  </div>
                  <p class="task-meta">${escapeHtml(note)}${String(message.text || "").length > 160 ? "..." : ""}</p>
                </article>
              `;
            })
            .join("")
        : messagesForConversation
            .map((message) => {
              const isSelf =
                String(message.sender || "").toLowerCase() === String(data.currentUser.name || "").toLowerCase();
              const isDeleted = Boolean(message.deletedAt);
              const canEdit = String(message.senderId || "") === String(data.currentUser?.id || "");
              const messageText = isDeleted ? "" : String(message.text || "").trim();
              const attachments = !isDeleted && Array.isArray(message.attachments) ? message.attachments : [];
              const attachmentMarkup = attachments.length
                ? `
                  <div class="message-attachments">
                    ${attachments
                      .map((file) => {
                        const fileName = String(file?.name || "Attachment").trim() || "Attachment";
                        const fileType = String(file?.type || "File").trim() || "File";
                        const fileSize = formatBytesCompact(file?.size);
                        const storagePath = String(file?.storagePath || "");
                        return `
                          <button
                            type="button"
                            class="message-attachment-pill"
                            data-action="messenger-attachment-open"
                            data-id="${message.id}"
                            data-storage-path="${escapeHtml(storagePath)}"
                            title="${escapeHtml(`${fileType} - ${fileSize}`)}"
                          >
                            <i class="bi bi-paperclip" aria-hidden="true"></i>
                            <span>${escapeHtml(fileName)}</span>
                          </button>
                        `;
                      })
                      .join("")}
                  </div>
                `
                : "";
              const reactions = Array.isArray(message.reactions) ? message.reactions : [];
              const reactionMarkup = reactions.length
                ? `
                  <div class="message-reaction-bar">
                    ${reactions
                      .map((reaction) => {
                        const emoji = reaction?.emoji || "";
                        const count = Number(reaction?.count || 0);
                        const reacted = Boolean(reaction?.reacted);
                        return `
                          <button
                            type="button"
                            class="message-reaction-pill ${reacted ? "is-active" : ""}"
                            data-action="message-reaction-toggle"
                            data-id="${message.id}"
                            data-emoji="${escapeHtml(emoji)}"
                          >
                            <span>${escapeHtml(emoji)}</span>
                            <small>${count}</small>
                          </button>
                        `;
                      })
                      .join("")}
                  </div>
                `
                : "";
              const reactionPicker = isDeleted
                ? ""
                : `
                  <details class="message-reaction-picker">
                    <summary class="message-icon-btn" aria-label="Add reaction" title="Add reaction">
                      <i class="bi bi-emoji-smile" aria-hidden="true"></i>
                    </summary>
                    <div class="message-reaction-menu">
                      ${["👍", "❤️", "😂", "😮", "🎉"]
                        .map(
                          (emoji) => `
                            <button type="button" class="emoji-chip-btn" data-action="message-reaction-toggle" data-id="${message.id}" data-emoji="${emoji}">
                              ${emoji}
                            </button>
                          `
                        )
                        .join("")}
                    </div>
                  </details>
                `;

              return `
                <article class="message-row ${isSelf ? "is-self" : "is-peer"} ${isDeleted ? "is-deleted" : ""}">
                  <div class="message-bubble ${isDeleted ? "is-deleted" : ""}">
                    ${
                      isDeleted
                        ? "<p class='message-text is-muted'>Message deleted</p>"
                        : messageText
                          ? `<p class="message-text">${highlightMentions(messageText)}</p>`
                          : attachments.length
                            ? "<p class='message-text is-muted'>Attachment</p>"
                            : ""
                    }
                    ${attachmentMarkup}
                  </div>
                  ${reactionMarkup}
                  <div class="message-foot">
                    <div class="message-meta">
                      <strong>${escapeHtml(message.sender)}</strong>
                      <span>${formatTimeLabel(message.createdAt)}</span>
                      ${message.editedAt && !isDeleted ? "<span class='message-pill is-edited'>Edited</span>" : ""}
                    </div>
                    <div class="message-inline-actions">
                      ${reactionPicker}
                      ${
                        !isDeleted && canEdit
                          ? `<button class="message-icon-btn" data-action="message-edit" data-id="${message.id}" title="Edit message" aria-label="Edit message">
                              <i class="bi bi-pencil" aria-hidden="true"></i>
                            </button>`
                          : ""
                      }
                      ${
                        !isDeleted && canEdit
                          ? `<button class="message-icon-btn is-danger" data-action="message-delete" data-id="${message.id}" title="Delete message" aria-label="Delete message">
                              <i class="bi bi-trash3" aria-hidden="true"></i>
                            </button>`
                          : ""
                      }
                    </div>
                  </div>
                </article>
              `;
            })
            .join("");

  const unreadConversations = uniqueByKey(searchableConversations.filter((conversation) => conversation.unread > 0));
  const pinnedConversations = uniqueByKey(searchableConversations.filter((conversation) => conversation.pinned));
  const inboxConversations = uniqueByKey(filteredConversations);

  const linkedContext = getLinkedContext(data, selectedConversation, messagesForConversation);
  const linkedRoute = routeForLinkedType(linkedContext.type);
  const participants = getParticipants(data, selectedConversation);
  const recentActivityRows = [...messagesForConversation]
    .reverse()
    .slice(0, 5)
    .map(
      (message) => `
        <article class="comms-activity-item">
          <p class="task-title">${escapeHtml(message.sender)} <span class="task-meta">${formatTimeLabel(message.createdAt)}</span></p>
          <p class="task-meta">${escapeHtml((message.text || "").slice(0, 74))}${(message.text || "").length > 74 ? "..." : ""}</p>
        </article>
      `
    )
    .join("");

  if (isCallsMode) {
    const contacts = Array.isArray(data.contacts) ? data.contacts : [];
    const accounts = Array.isArray(data.accounts) ? data.accounts : [];
    const callLogs = Array.isArray(context.callLogs) ? context.callLogs : [];
    const voicemails = Array.isArray(context.voicemails) ? context.voicemails : [];
    const callQueues = Array.isArray(context.callQueues) ? context.callQueues : [];
    const callsLoading = Boolean(context.callsLoading);
    const callsLiveLocked = Boolean(context.callsLiveLocked);
    const callSession = context.callSession && typeof context.callSession === "object" ? context.callSession : {};
    const rawCallsView = String(context.callsView || "").trim().toLowerCase();
    const callsView = ["live", "scheduler", "performance"].includes(rawCallsView) ? rawCallsView : "live";
    const callsSubviewTabs = `
      <div class="calls-subview-tabs" role="tablist" aria-label="Calls workspace view">
        <button type="button" class="mini-btn ${callsView === "live" ? "is-active" : ""}" data-action="calls-view" data-id="live">Live</button>
        <button type="button" class="mini-btn ${callsView === "scheduler" ? "is-active" : ""}" data-action="calls-view" data-id="scheduler">Scheduler</button>
        <button type="button" class="mini-btn ${callsView === "performance" ? "is-active" : ""}" data-action="calls-view" data-id="performance">Performance</button>
      </div>
    `;
    const schedulerMarkup = renderCallsSchedulerView(data, context);
    const performanceMarkup = renderCallsPerformanceView(data, context);

    if (callsView === "scheduler") {
      return {
        title: "Calls",
        subtitle: "Week scheduler for planned calls and callbacks",
        primaryAction: "Schedule Call",
        showWaitingPanel: false,
        html: `
          <section class="view-block calls-workspace-shell">
            ${callsSubviewTabs}
            ${schedulerMarkup}
          </section>
        `
      };
    }

    if (callsView === "performance") {
      return {
        title: "Calls",
        subtitle: "Daily contact activity and quota monitoring",
        primaryAction: callsLiveLocked ? "" : "Start Call",
        showWaitingPanel: false,
        html: `
          <section class="view-block calls-workspace-shell">
            ${callsSubviewTabs}
            <div class="calls-workspace-body calls-performance-body">
              ${performanceMarkup}
            </div>
          </section>
        `
      };
    }

    const callRows = callLogs.map((callLog) => {
      const primaryNumber = getCallPrimaryNumber(callLog);
      const matchedContact = findCallContactMatch(contacts, primaryNumber, callLog.counterpartyName || callLog.linkedLabel);
      return {
        id: String(callLog.id || ""),
        phone: primaryNumber,
        name: matchedContact?.name || callLog.counterpartyName || primaryNumber || "Unknown caller",
        account: matchedContact?.account || callLog.queueName || "Unlinked call",
        status: String(callLog.status || "").trim().toLowerCase(),
        lastAt: callLog.endedAt || callLog.answeredAt || callLog.startedAt || callLog.createdAt || "",
        detail: `${callLog.direction === "inbound" ? "Inbound" : "Outbound"} | ${formatCallDurationValue(callLog.durationSeconds || 0)}`,
        callLog
      };
    });

    const voicemailRows = voicemails.map((voicemail) => {
      const matchedContact = findCallContactMatch(contacts, voicemail.fromNumber, voicemail.callerName || "");
      const linkedCall = voicemail.callLogId
        ? callLogs.find((callLog) => String(callLog.id || "") === String(voicemail.callLogId || ""))
        : null;
      return {
        id: String(voicemail.id || ""),
        phone: String(voicemail.fromNumber || voicemail.toNumber || "").trim(),
        name: matchedContact?.name || voicemail.callerName || voicemail.fromNumber || "Unknown caller",
        account: matchedContact?.account || "Voicemail",
        status: "voicemail",
        lastAt: voicemail.receivedAt || voicemail.createdAt || "",
        detail: `${formatCallDurationValue(voicemail.durationSeconds || 0)}${voicemail.isRead ? " | Played" : " | New"}`,
        voicemail,
        linkedCall
      };
    });

    const sortRowsByLastTouch = (a, b) => {
      const aTime = Date.parse(a?.lastAt || "");
      const bTime = Date.parse(b?.lastAt || "");
      const safeA = Number.isFinite(aTime) ? aTime : 0;
      const safeB = Number.isFinite(bTime) ? bTime : 0;
      if (safeB !== safeA) {
        return safeB - safeA;
      }
      return String(a?.name || "").localeCompare(String(b?.name || ""), undefined, { sensitivity: "base" });
    };

    const searchQuery = String(query || "").trim().toLowerCase();
    const matchesCallsSearch = (row) =>
      [row?.name, row?.account, row?.phone, row?.detail].join(" ").toLowerCase().includes(searchQuery);
    const filterWorkspaceRows = (rows) => (searchQuery ? rows.filter((row) => matchesCallsSearch(row)) : rows);
    const historyRows = [...callRows].sort(sortRowsByLastTouch);
    const voicemailHistoryRows = [...voicemailRows].sort(sortRowsByLastTouch);

    const draftToValue = String(context.callDraftTo || "");
    const draftTo = escapeHtml(draftToValue);
    const draftMatch = findCallContactMatch(contacts, draftToValue, "");
    let matchText = "Start typing at least 4 digits to match a contact.";
    if (normalizePhoneDigits(draftToValue).length >= 4 && !draftMatch) {
      matchText = "No contact match yet. You can still place the call.";
    }
    const contactMatchMarkup = draftMatch
      ? `
        <button type="button" class="calls-suggested-contact" data-action="call-fill-number" data-id="${escapeHtml(draftMatch.phone || "")}">
          <span class="calls-suggested-avatar">${escapeHtml(String(draftMatch.name || "").slice(0, 1).toUpperCase() || "?")}</span>
          <span class="calls-suggested-copy">
            <small>Suggested contact</small>
            <strong>${escapeHtml(draftMatch.name || "Matched contact")}</strong>
            <span>${escapeHtml(draftMatch.account || "CRM contact")} | ${escapeHtml(draftMatch.phone || "")}</span>
          </span>
          <i class="bi bi-person-check" aria-hidden="true"></i>
        </button>
      `
      : `
        <div class="calls-suggested-contact is-empty">
          <i class="bi bi-person-lines-fill" aria-hidden="true"></i>
          <span>${escapeHtml(matchText)}</span>
        </div>
      `;

    const latestCallByContactKey = new Map();
    historyRows.forEach((row) => {
      const matchedContact = findCallContactMatch(contacts, row.phone, row.name || "");
      const key = matchedContact?.id ? `contact:${matchedContact.id}` : normalizeForMatch(row.name || row.phone || "");
      if (key && !latestCallByContactKey.has(key)) {
        latestCallByContactKey.set(key, row.callLog || null);
      }
    });

    const contactRows = contacts
      .map((contact) => {
        const key = contact.id ? `contact:${contact.id}` : normalizeForMatch(contact.name);
        const latestCall = latestCallByContactKey.get(key) || null;
        return {
          itemType: "contact",
          itemKey: `contact:${contact.id}`,
          id: String(contact.id || ""),
          name: String(contact.name || "Unknown contact").trim(),
          phone: String(contact.phone || "").trim(),
          account: String(contact.account || "No account").trim(),
          role: String(contact.role || "").trim(),
          status: latestCall ? String(latestCall.status || "").trim().toLowerCase() : "contact",
          lastAt: latestCall?.endedAt || latestCall?.answeredAt || latestCall?.startedAt || latestCall?.createdAt || "",
          detail: latestCall ? `${callLogStatusLabel(latestCall.status)} | ${formatCallDurationValue(latestCall.durationSeconds || 0)}` : "No calls yet",
          latestCall
        };
      })
      .sort(sortRowsByLastTouch);

    const recentsRows = historyRows.map((row) => ({ ...row, itemType: "call", itemKey: `call:${row.id}` }));
    const missedRows = recentsRows.filter((row) => ["missed", "declined", "failed", "canceled"].includes(row.status));
    const voicemailListRows = voicemailHistoryRows.map((row) => ({ ...row, itemType: "voicemail", itemKey: `voicemail:${row.id}` }));
    const contactsListRows = contactRows;
    const visibleLeftRows = filterWorkspaceRows(
      activeFilter === "missed" ? missedRows : activeFilter === "voicemail" ? voicemailListRows : activeFilter === "contacts" ? contactsListRows : recentsRows
    );
    const currentSelectionKey =
      context.selectedCallWorkspaceItemType && context.selectedCallWorkspaceItemId
        ? `${context.selectedCallWorkspaceItemType}:${context.selectedCallWorkspaceItemId}`
        : "";
    const selectedLeftRow = visibleLeftRows.find((row) => row.itemKey === currentSelectionKey) || visibleLeftRows[0] || null;
    const selectedItemType = String(selectedLeftRow?.itemType || "").trim();
    const selectedPhone = String(selectedLeftRow?.phone || "").trim();
    const selectedName = String(selectedLeftRow?.name || "").trim();
    const selectedContact =
      selectedItemType === "contact"
        ? contacts.find((contact) => String(contact.id || "") === String(selectedLeftRow?.id || "")) || null
        : findCallContactMatch(contacts, selectedPhone, selectedName) || null;
    const selectedAccount = selectedContact
      ? accounts.find((account) => normalizeForMatch(account.name) === normalizeForMatch(selectedContact.account || "")) || null
      : null;
    const selectedCallLog =
      selectedItemType === "call"
        ? selectedLeftRow?.callLog || null
        : selectedItemType === "voicemail"
          ? selectedLeftRow?.linkedCall || null
          : selectedLeftRow?.latestCall || null;
    const selectedVoicemail = selectedItemType === "voicemail" ? selectedLeftRow?.voicemail || null : null;
    const relatedCallRows = (selectedContact
      ? recentsRows.filter((row) => {
          const matched = findCallContactMatch(contacts, row.phone, row.name || "");
          return matched && String(matched.id || "") === String(selectedContact.id || "");
        })
      : selectedPhone
        ? recentsRows.filter((row) => normalizePhoneDigits(row.phone) === normalizePhoneDigits(selectedPhone))
        : recentsRows
    ).slice(0, 6);
    const selectedStatusRaw =
      selectedItemType === "voicemail"
        ? "voicemail"
        : selectedItemType === "contact"
          ? selectedLeftRow?.status || "contact"
          : selectedCallLog?.status || selectedLeftRow?.status || "contact";
    const selectedStatusLabel =
      selectedItemType === "voicemail" ? "Voicemail" : selectedItemType === "contact" ? "Contact" : callLogStatusLabel(selectedStatusRaw);
    const selectedToneClass = callLogToneClass(selectedItemType === "voicemail" ? "voicemail" : selectedStatusRaw);
    const leftTabItems = [
      { id: "recents", label: "Recents", count: recentsRows.length },
      { id: "missed", label: "Missed", count: missedRows.length },
      { id: "voicemail", label: "Voicemail", count: voicemailListRows.length },
      { id: "contacts", label: "Contacts", count: contactsListRows.length }
    ];
    const leftTabsMarkup = leftTabItems
      .map(
        (item) => `
          <button type="button" class="mini-btn ${activeFilter === item.id ? "is-active" : ""}" data-action="comm-set-filter" data-id="${item.id}">
            <span>${escapeHtml(item.label)}</span>
            <small>${escapeHtml(String(item.count || 0))}</small>
          </button>
        `
      )
      .join("");
    const renderLeftListRows = (rows, emptyLabel) => {
      if (!rows.length) {
        return `<div class="calls-left-empty"><p>${escapeHtml(emptyLabel)}</p></div>`;
      }
      return rows
        .map((row) => {
          const isSelected = Boolean(selectedLeftRow) && row.itemKey === selectedLeftRow.itemKey;
          const rowStatus = row.itemType === "voicemail" ? "voicemail" : row.status || "contact";
          const rowStatusLabel = row.itemType === "voicemail" ? "Voicemail" : row.itemType === "contact" ? "Contact" : callLogStatusLabel(rowStatus);
          const rowToneClass = callLogToneClass(row.itemType === "voicemail" ? "voicemail" : rowStatus);
          const timeLabel = row.lastAt ? formatRelativeTime(row.lastAt) : "No calls yet";
          const detailLine =
            row.itemType === "contact"
              ? `${row.account || "No account"}${row.phone ? ` | ${row.phone}` : ""}`
              : row.account || row.phone || "Unlinked";
          const menuId = `${String(row.itemType || "").trim()}:${String(row.id || "").trim()}`;
          return `
            <article class="calls-left-row ${isSelected ? "is-selected" : ""}" data-card-menu="calls-row" data-id="${escapeHtml(menuId)}">
              <button type="button" class="calls-left-row-main" data-action="calls-select-item" data-id="${escapeHtml(row.id || "")}" data-kind="${escapeHtml(row.itemType || "")}">
                <span class="calls-left-avatar">${escapeHtml(String(row.name || "?").slice(0, 1).toUpperCase() || "?")}</span>
                <span class="calls-left-row-copy">
                  <span class="calls-left-row-head">
                    <strong>${escapeHtml(row.name || "Unknown caller")}</strong>
                    <small>${escapeHtml(timeLabel)}</small>
                  </span>
                  <span class="calls-left-row-meta">${escapeHtml(detailLine)}</span>
                  <span class="calls-left-row-foot">
                    <span class="calls-outcome-pill ${rowToneClass}">${escapeHtml(rowStatusLabel)}</span>
                    <span>${escapeHtml(row.detail || "")}</span>
                  </span>
                </span>
              </button>
              <button type="button" class="calls-left-row-call" data-action="call-fill-number" data-id="${escapeHtml(row.phone || "")}" ${row.phone ? "" : "disabled"} aria-label="Send ${escapeHtml(row.name || row.phone || "number")} to dialer">
                <i class="bi bi-telephone" aria-hidden="true"></i>
              </button>
            </article>
          `;
        })
        .join("");
    };
    const loadingMarkup = callsLoading ? `<span class="calls-sync-chip"><i class="bi bi-arrow-repeat" aria-hidden="true"></i> Syncing</span>` : "";
    const selectedHeading = selectedLeftRow
      ? selectedItemType === "contact"
        ? "Contact workspace"
        : selectedItemType === "voicemail"
          ? "Voicemail details"
          : "Call details"
      : activeFilter === "voicemail"
        ? "Voicemail"
        : activeFilter === "contacts"
          ? "Contacts"
          : "Calls";
    const selectedSubcopy = selectedLeftRow
      ? selectedItemType === "contact"
        ? "Recent call activity and quick actions for this contact."
        : selectedItemType === "voicemail"
          ? "Playback, transcript, and callback actions."
          : "Review the selected interaction and take the next step."
      : "Select an item from the left to work from.";
    const selectedActionButtons = selectedLeftRow
      ? `
        <div class="calls-detail-actions">
          <button type="button" class="btn btn-accent" data-action="call-start-number" data-id="${escapeHtml(selectedPhone || "")}" ${selectedPhone ? "" : "disabled"}>
            <i class="bi bi-telephone-plus" aria-hidden="true"></i>
            <span>Call back</span>
          </button>
          <button type="button" class="mini-btn" data-action="call-fill-number" data-id="${escapeHtml(selectedPhone || "")}" ${selectedPhone ? "" : "disabled"}>
            <i class="bi bi-grid-3x3-gap" aria-hidden="true"></i>
            <span>Send to dialer</span>
          </button>
          ${
            selectedContact
              ? `<button type="button" class="mini-btn" data-action="contact-open" data-id="${escapeHtml(selectedContact.id || "")}"><i class="bi bi-person" aria-hidden="true"></i><span>Open contact</span></button>`
              : selectedAccount
                ? `<button type="button" class="mini-btn" data-action="account-open" data-id="${escapeHtml(selectedAccount.id || "")}"><i class="bi bi-building" aria-hidden="true"></i><span>Open account</span></button>`
                : ""
          }
        </div>
      `
      : "";
    const relatedCallsMarkup = relatedCallRows.length
      ? relatedCallRows
          .map(
            (row) => `
              <article class="calls-related-row">
                <div>
                  <p class="task-title">${escapeHtml(row.name || "Call")}</p>
                  <p class="task-meta">${escapeHtml(row.direction === "inbound" ? "Inbound" : "Outbound")} | ${escapeHtml(callLogStatusLabel(row.status))} | ${escapeHtml(formatCallDurationValue(row.callLog?.durationSeconds || 0))}</p>
                </div>
                <span class="task-meta">${escapeHtml(formatRelativeTime(row.lastAt || ""))}</span>
              </article>
            `
          )
          .join("")
      : "<p class='task-meta'>No related call activity yet.</p>";
    const middleWorkspaceMarkup = !selectedLeftRow
      ? `
        <div class="calls-workspace-empty">
          <i class="bi bi-telephone" aria-hidden="true"></i>
          <p>${escapeHtml(searchQuery ? "No calls match this search." : "Select a call, voicemail, or contact to continue.")}</p>
        </div>
      `
      : `
        <div class="calls-detail-stack">
          <article class="calls-detail-hero">
            <div class="calls-detail-hero-copy">
              <p class="task-meta">${escapeHtml(selectedHeading)}</p>
              <h3>${escapeHtml(selectedLeftRow.name || "Unknown caller")}</h3>
              <p class="task-meta">${escapeHtml(selectedLeftRow.account || selectedPhone || "No linked account")} ${selectedPhone ? `| ${escapeHtml(selectedPhone)}` : ""}</p>
            </div>
            <div class="calls-detail-hero-meta">
              <span class="calls-outcome-pill ${selectedToneClass}">${escapeHtml(selectedStatusLabel)}</span>
              <span class="task-meta">${escapeHtml(selectedLeftRow.lastAt ? formatRelativeTime(selectedLeftRow.lastAt) : "No recent activity")}</span>
            </div>
          </article>
          ${selectedActionButtons}
          <article class="calls-detail-card">
            <header class="calls-workspace-card-head">
              <div>
                <p class="task-title">${escapeHtml(selectedSubcopy)}</p>
                <p class="task-meta">${escapeHtml(selectedLeftRow.detail || "")}</p>
              </div>
            </header>
            ${
              selectedItemType === "voicemail"
                ? `
                  <div class="calls-detail-body">
                    <div class="calls-detail-meta-grid">
                      <div><p class="task-meta">Duration</p><p class="task-title">${escapeHtml(formatCallDurationValue(selectedVoicemail?.durationSeconds || 0))}</p></div>
                      <div><p class="task-meta">Received</p><p class="task-title">${escapeHtml(selectedLeftRow.lastAt ? formatRelativeTime(selectedLeftRow.lastAt) : "Just now")}</p></div>
                    </div>
                    ${selectedVoicemail?.transcription ? `<p class="task-meta">${escapeHtml(selectedVoicemail.transcription)}</p>` : "<p class='task-meta'>No transcription available.</p>"}
                    ${selectedVoicemail?.accessUrl ? `<audio controls preload='none' class='calls-voicemail-audio' src='${escapeHtml(selectedVoicemail.accessUrl)}'></audio>` : ""}
                  </div>
                `
                : selectedItemType === "contact"
                  ? `
                    <div class="calls-detail-body">
                      <div class="calls-detail-meta-grid">
                        <div><p class="task-meta">Phone</p><p class="task-title">${escapeHtml(selectedPhone || "No phone")}</p></div>
                        <div><p class="task-meta">Company</p><p class="task-title">${escapeHtml(selectedLeftRow.account || "No account")}</p></div>
                      </div>
                      <p class="task-meta">${escapeHtml(selectedLeftRow.role || "No contact role set.")}</p>
                    </div>
                  `
                  : `
                    <div class="calls-detail-body">
                      <div class="calls-detail-meta-grid">
                        <div><p class="task-meta">Direction</p><p class="task-title">${escapeHtml(selectedCallLog?.direction === "inbound" ? "Inbound" : "Outbound")}</p></div>
                        <div><p class="task-meta">Duration</p><p class="task-title">${escapeHtml(formatCallDurationValue(selectedCallLog?.durationSeconds || 0))}</p></div>
                        <div><p class="task-meta">Started</p><p class="task-title">${escapeHtml(selectedCallLog?.startedAt ? formatRelativeTime(selectedCallLog.startedAt) : "Unknown")}</p></div>
                        <div><p class="task-meta">Outcome</p><p class="task-title">${escapeHtml(selectedStatusLabel)}</p></div>
                      </div>
                      ${
                        selectedCallLog?.wrapupNotes
                          ? `<div class="calls-detail-note"><p class="task-meta">Wrap-up note</p><p>${escapeHtml(selectedCallLog.wrapupNotes)}</p></div>`
                          : "<p class='task-meta'>No wrap-up note saved for this call.</p>"
                      }
                    </div>
                  `
            }
          </article>
          <article class="calls-detail-card">
            <header class="calls-workspace-card-head">
              <div>
                <p class="task-title">Related activity</p>
                <p class="task-meta">Recent interactions for this number or contact.</p>
              </div>
            </header>
            <div class="calls-related-list">${relatedCallsMarkup}</div>
          </article>
        </div>
      `;
    return {
      title: "Calls",
      subtitle: "Live call inbox, voicemail, and dialer workspace",
      primaryAction: callsLiveLocked ? "" : "Start Call",
      showWaitingPanel: false,
      html: `
        <section class="view-block calls-workspace-shell">
          ${callsSubviewTabs}
          <div class="calls-live-lock-shell ${callsLiveLocked ? "is-locked" : ""}">
            <section class="calls-layout ${callsLiveLocked ? "is-live-locked" : ""}">
              <aside class="calls-rail calls-list-rail">
                <div class="calls-rail-head calls-list-head">
                  <div class="calls-list-tabs">
                    ${leftTabsMarkup}
                  </div>
                  <input class="search comms-search messenger-search" id="commsSearch" value="${escapeHtml(query)}" placeholder="Search calls and contacts" />
                </div>
                <div class="calls-contact-list calls-left-list">
                  ${renderLeftListRows(
                    visibleLeftRows,
                    activeFilter === "missed"
                      ? "No missed calls found."
                      : activeFilter === "voicemail"
                        ? "No voicemail found."
                        : activeFilter === "contacts"
                          ? "No contacts match this search."
                          : "No calls yet."
                  )}
                </div>
              </aside>
              <section class="calls-center calls-workspace-column">
                <header class="calls-workspace-head">
                  <div>
                    <p class="task-title">${escapeHtml(selectedHeading)}</p>
                    <p class="task-meta">${escapeHtml(selectedSubcopy)}</p>
                  </div>
                  <div class="calls-workspace-head-actions">
                    ${loadingMarkup}
                    <button type="button" class="mini-btn calls-sync-btn" data-action="call-sync-provider" data-id="sync">
                      <i class="bi bi-arrow-clockwise" aria-hidden="true"></i>
                      <span>Refresh</span>
                    </button>
                  </div>
                </header>
                <div class="calls-workspace-body">
                  ${middleWorkspaceMarkup}
                </div>
              </section>
              <aside class="calls-dialer-column">
                <article class="calls-dialer-card">
                  <header class="calls-dialer-head">
                    <div>
                      <p class="task-title">Dialer</p>
                      <p class="task-meta">Enter a number and place a call.</p>
                    </div>
                  </header>
                  <div class="calls-number-area">
                    <label class="calls-number-wrap">
                      <i class="bi bi-telephone" aria-hidden="true"></i>
                      <input id="callsDialInput" type="text" inputmode="tel" placeholder="+1 555 000 0000" value="${draftTo}" />
                    </label>
                    ${contactMatchMarkup}
                  </div>
                  <div class="calls-keypad-grid">
                    ${[
                    ["1", ""],
                    ["2", "ABC"],
                    ["3", "DEF"],
                    ["4", "GHI"],
                    ["5", "JKL"],
                    ["6", "MNO"],
                    ["7", "PQRS"],
                    ["8", "TUV"],
                    ["9", "WXYZ"],
                    ["*", ""],
                    ["0", "+"],
                    ["#", ""]
                  ]
                    .map(
                      ([digit, letters]) => `
                        <button type="button" class="calls-key-btn" data-action="call-dial-digit" data-id="${digit}">
                          <span class="calls-key-digit">${digit}</span>
                          <span class="calls-key-letters">${letters || "&nbsp;"}</span>
                        </button>
                      `
                    )
                      .join("")}
                  </div>
                  <div class="calls-dialer-actions">
                    <button type="button" class="mini-btn calls-dialer-icon-btn" data-action="call-dial-backspace" data-id="backspace" aria-label="Backspace" title="Backspace">
                      <i class="bi bi-backspace" aria-hidden="true"></i>
                    </button>
                    <button type="button" class="mini-btn calls-dialer-icon-btn" data-action="call-dial-clear" data-id="clear" aria-label="Clear" title="Clear">
                      <i class="bi bi-x-circle" aria-hidden="true"></i>
                    </button>
                    <button type="button" class="mini-btn calls-dialer-icon-btn" data-action="call-paste-number" data-id="paste" aria-label="Paste number" title="Paste">
                      <i class="bi bi-clipboard" aria-hidden="true"></i>
                    </button>
                    <button type="button" class="btn btn-accent calls-start-call-btn" data-action="call-start" data-id="start">
                      <i class="bi bi-telephone-plus" aria-hidden="true"></i>
                      <span>Start Call</span>
                    </button>
                  </div>
                </article>
              </aside>
            </section>
            ${
              callsLiveLocked
                ? `
                  <div class="calls-live-lock-overlay" aria-hidden="true">
                    <div class="calls-live-lock-card">
                      <span class="calls-live-lock-icon"><i class="bi bi-shield-lock" aria-hidden="true"></i></span>
                      <h3>Live Calls Locked</h3>
                      <p>Dialer, live call handling, and recent interactions are disabled for your role.</p>
                    </div>
                  </div>
                `
                : ""
            }
          </div>
        </section>
      `
    };
  }

  const defaultMessageType = mode === "internal" ? "Update" : "Announcement";
  const filterLabels =
    mode === "internal"
      ? {
          all: "All",
          direct: "Direct",
          gc: "GC"
        }
      : mode === "email"
      ? { inbox: "Inbox", unread: "Unread", sent: "Sent", drafts: "Drafts", spam: "Spam", trash: "Trash", linked: "Linked" }
      : mode === "sms"
        ? {
            all: "All",
            needsReply: "Needs Reply",
            scheduled: "Scheduled",
            failed: "Failed",
            contacts: "Contacts"
          }
        : mode === "call"
          ? { inbox: "All Calls", unread: "Missed", pinned: "Priority", channels: "Teams", direct: "Direct" }
          : { inbox: "Inbox", unread: "Unread", pinned: "Pinned", channels: "Channels", direct: "DM" };
  const modeHelp =
    mode === "internal"
      ? "Internal workspace chat for direct messages and group chats."
      : mode === "email"
        ? "Gmail-style compose. Sent email is logged back to this thread."
        : mode === "sms"
          ? "SMS drafting workspace. Open your messaging app, then log the conversation back to this thread."
          : "Handle live calls, voicemail, and queue activity inside Joynosync.";
  const emailBackendReady = Boolean(context.supabaseConfigured);
  const emailSignedIn = Boolean(context.signedInUser);
  const emailIntegrationStatus =
    context.emailIntegrationStatus && typeof context.emailIntegrationStatus === "object" ? context.emailIntegrationStatus : {};
  const emailIntegrationLoading = Boolean(emailIntegrationStatus.loading);
  const emailConnected = Boolean(emailIntegrationStatus.connected);
  const emailConnectedAddress = String(emailIntegrationStatus.email || "").trim();
  const emailConnectDisabled = !emailBackendReady || !emailSignedIn || emailIntegrationLoading;
  const emailConnectLabel = !emailBackendReady
    ? "Backend Off"
    : !emailSignedIn
      ? "Sign In First"
      : emailIntegrationLoading
        ? "Checking..."
        : emailConnected
          ? "Reconnect Gmail"
          : "Connect Gmail";
  const emailStatusLabel = !emailBackendReady
    ? "Demo send (local)"
    : !emailSignedIn
      ? "Not signed in"
      : emailIntegrationLoading
        ? "Checking Gmail..."
        : emailConnected
          ? "Gmail connected"
          : "No Gmail connected";
  const emailStatusDetail = !emailBackendReady
    ? "Emails stay local in demo mode."
    : !emailSignedIn
      ? "Sign in to use live Gmail send."
      : emailIntegrationLoading
        ? "Checking the current Gmail connection..."
        : emailConnected
          ? `Connected as ${escapeHtml(emailConnectedAddress || "your Gmail account")}`
          : "Connect Gmail to enable live send.";
  const emailComposeOpen = isEmailMode ? Boolean(context.emailComposeOpen) : false;
  const emailComposeMinimized = isEmailMode ? Boolean(context.emailComposeMinimized) : false;
  const emailDraftTo = escapeHtml(emailDraft.to || "");
  const emailDraftCc = escapeHtml(emailDraft.cc || "");
  const emailDraftBcc = escapeHtml(emailDraft.bcc || "");
  const emailDraftSubject = escapeHtml(emailDraft.subject || "");
  const emailDraftText = escapeHtml(emailDraft.text || "");
  const emailDraftLinkedType = String(emailDraft.linkedType || "");
  const emailDraftLinkedLabel = escapeHtml(emailDraft.linkedLabel || "");
  const emailDraftSubjectPreview = escapeHtml(String(emailDraft.subject || "New Message").slice(0, 42));
  const emailCcbccOpen = Boolean(String(emailDraft.cc || "").trim() || String(emailDraft.bcc || "").trim());
  const emailCrmOpen = Boolean(
    String(emailDraft.linkedType || "").trim() || String(emailDraft.linkedLabel || "").trim()
  );
  const emailLinkedTypeOptions = ["None", "Lead", "Contact", "Account", "Deal", "Project", "Task"]
    .map((option) => {
      const value = option === "None" ? "" : option;
      const selected = value === emailDraftLinkedType ? "selected" : "";
      return `<option value="${value}" ${selected}>${option}</option>`;
    })
    .join("");
  const emailFolderDefinitions = [
    { id: "inbox", label: "Inbox", icon: "bi-inbox" },
    { id: "unread", label: "Unread", icon: "bi-envelope" },
    { id: "sent", label: "Sent", icon: "bi-send" },
    { id: "drafts", label: "Drafts", icon: "bi-file-earmark-text" },
    { id: "spam", label: "Spam", icon: "bi-exclamation-triangle" },
    { id: "trash", label: "Trash", icon: "bi-trash3" }
  ];
  const emailFolderCountById = {
    inbox: 0,
    unread: 0,
    sent: 0,
    drafts: 0,
    spam: 0,
    trash: 0
  };
  const activeEmailFolderId =
    isEmailMode && emailFolderDefinitions.some((folder) => folder.id === activeFilter) ? activeFilter : "inbox";
  const emailMailboxState =
    isEmailMode && context.emailMailbox && typeof context.emailMailbox === "object" ? context.emailMailbox : null;
  const useLiveEmailMailbox = Boolean(isEmailMode && context.supabaseConfigured && context.emailIntegrationStatus?.connected);
  const emailMailboxLoading = Boolean(useLiveEmailMailbox && emailMailboxState?.loading);
  const emailMailboxError = String(useLiveEmailMailbox ? emailMailboxState?.error || "" : "").trim();
  const emailMailboxReconnectRequired = Boolean(useLiveEmailMailbox && emailMailboxState?.reconnectRequired);
  const emailConversationByKey = isEmailMode
    ? new Map(
        scopedConversations.map((conversation) => [
          conversationKey(conversation.targetType, conversation.targetId),
          conversation
        ])
      )
    : new Map();
  const latestEmailMessageIdByConversation = new Map();
  const emailMailboxRecordsAll = [];
  if (isEmailMode) {
    const sortedEmailMessages = [...scopedMessages]
      .filter((message) => isEmailMailboxMessage(message))
      .sort((left, right) => new Date(right.createdAt).valueOf() - new Date(left.createdAt).valueOf());
    const localDraftMessages = sortedEmailMessages.filter(
      (message) => String(message.emailFolder || "").trim().toLowerCase() === "drafts"
    );
    const sourceEmailMessages = useLiveEmailMailbox
      ? activeEmailFolderId === "drafts"
        ? localDraftMessages
        : Array.isArray(emailMailboxState?.items)
          ? emailMailboxState.items
          : []
      : sortedEmailMessages;
    sourceEmailMessages.forEach((message) => {
      const key = getEmailMailboxMessageKey(message);
      if (key && !latestEmailMessageIdByConversation.has(key)) {
        latestEmailMessageIdByConversation.set(key, String(message.id || ""));
      }
    });
    sourceEmailMessages.forEach((message) => {
      const folderId = resolveEmailMailboxFolderId(message, currentUserName);
      const key = getEmailMailboxMessageKey(message);
      const conversation = emailConversationByKey.get(key);
      const previewRaw = String(message.emailSnippet || message.text || "")
        .replaceAll("\n", " ")
        .replace(/\s+/g, " ")
        .trim();
      const senderLabel = String(message.sender || message.emailTo || "Unknown sender").trim() || "Unknown sender";
      const subject = String(message.emailSubject || "").trim() || (previewRaw ? previewRaw.slice(0, 72) : "No subject");
      const isUnread =
        folderId === "inbox" &&
        (String(message.emailFolder || "")
          .trim()
          .toLowerCase() === "unread" ||
          (Number(conversation?.unread || 0) > 0 &&
            latestEmailMessageIdByConversation.get(key) === String(message.id || "")));
      emailMailboxRecordsAll.push({
        id: String(message.id || ""),
        folderId,
        isUnread,
        key,
        sender: senderLabel,
        primaryLabel: resolveEmailMailboxPrimaryLabel(folderId, senderLabel, String(message.emailTo || "").trim()),
        subject,
        preview: previewRaw,
        timeLabel: formatRelativeTime(message.createdAt),
        detailTimeLabel: formatTimeLabel(message.createdAt),
        bodyMarkup: renderEmailBodyMarkup(message.text || ""),
        bodyText: String(message.text || ""),
        initials: senderLabel.slice(0, 1).toUpperCase() || "E",
        linkedType: String(message.linkedType || "").trim(),
        recipient: String(message.emailTo || "").trim(),
        createdAt: String(message.createdAt || ""),
        message
      });
    });
    if (useLiveEmailMailbox) {
      emailFolderCountById.inbox = Number(emailMailboxState?.counts?.inbox || 0) || 0;
      emailFolderCountById.unread = Number(emailMailboxState?.counts?.unread || 0) || 0;
      emailFolderCountById.sent = Number(emailMailboxState?.counts?.sent || 0) || 0;
      emailFolderCountById.drafts = localDraftMessages.length;
      emailFolderCountById.spam = Number(emailMailboxState?.counts?.spam || 0) || 0;
      emailFolderCountById.trash = Number(emailMailboxState?.counts?.trash || 0) || 0;
    } else {
      emailMailboxRecordsAll.forEach((record) => {
        if (record.folderId === "inbox") {
          emailFolderCountById.inbox += 1;
        }
        if (record.folderId === "sent") {
          emailFolderCountById.sent += 1;
        }
        if (record.folderId === "drafts") {
          emailFolderCountById.drafts += 1;
        }
        if (record.folderId === "spam") {
          emailFolderCountById.spam += 1;
        }
        if (record.folderId === "trash") {
          emailFolderCountById.trash += 1;
        }
        if (record.isUnread) {
          emailFolderCountById.unread += 1;
        }
      });
    }
  }
  const emailMailboxRecords = isEmailMode
    ? emailMailboxRecordsAll.filter((record) => {
        if (activeEmailFolderId === "unread") {
          if (!record.isUnread) {
            return false;
          }
        } else if (record.folderId !== activeEmailFolderId) {
          return false;
        }
        if (!query) {
          return true;
        }
        return matchesSearch(
          [record.sender, record.subject, record.preview, record.recipient, record.linkedType, record.createdAt],
          query
        );
      })
    : [];
  const emailFolderMenuMarkup = isEmailMode
    ? emailFolderDefinitions
        .map((folderItem) => {
          const count = Number(emailFolderCountById[folderItem.id] || 0);
          return `
            <button
              class="email-folder-btn ${activeFilter === folderItem.id ? "is-active" : ""}"
              type="button"
              data-action="comm-set-filter"
              data-id="${folderItem.id}"
            >
              <span class="email-folder-left">
                <i class="bi ${folderItem.icon}" aria-hidden="true"></i>
                <span>${folderItem.label}</span>
              </span>
              <span class="email-folder-count">${count}</span>
            </button>
          `;
        })
        .join("")
    : "";
  const threadComposeStateClass = isEmailMode
    ? emailComposeOpen
      ? emailComposeMinimized
        ? "is-email-compose-minimized"
        : "is-email-compose-open"
      : "is-email-compose-closed"
    : "";

  const modeComposer =
    mode === "internal"
      ? `
        <section class="comms-mode-surface messenger-surface">
          <input type="file" id="commAttachInput" name="attachments" multiple hidden />
          ${
            isEditingMessage
              ? `<div class="messenger-edit-banner">
                  <span>Editing message</span>
                  <button type="button" class="mini-btn" data-action="messenger-edit-cancel">Cancel</button>
                </div>`
              : ""
          }
          <div class="messenger-toolbar">
            <button type="button" class="message-icon-btn" data-action="comm-attach-trigger" data-id="attach" aria-label="Attach file" title="Attach file" ${isEditingMessage ? "disabled" : ""}>
              <i class="bi bi-paperclip" aria-hidden="true"></i>
            </button>
            <button type="button" class="message-icon-btn" data-action="comm-toggle-emoji-picker" data-id="toggle" aria-label="Insert emoji" title="Insert emoji">
              <i class="bi bi-emoji-smile" aria-hidden="true"></i>
            </button>
            <button type="button" class="message-icon-btn" data-action="comm-quick-template" data-id="template" aria-label="Quick template" title="Quick template">
              <i class="bi bi-lightning-charge" aria-hidden="true"></i>
            </button>
          </div>
          <div class="messenger-emoji-picker" data-comm-emoji-picker hidden>
            ${[
              "\u{1F600}",
              "\u{1F44D}",
              "\u{1F525}",
              "\u{2705}",
              "\u{1F389}",
              "\u{1F64F}",
              "\u{1F91D}",
              "\u{1F4AC}",
              "\u{1F4CC}",
              "\u{1F680}"
            ]
              .map(
                (emoji) =>
                  `<button type="button" class="emoji-chip-btn" data-action="comm-insert-emoji" data-id="${emoji}" aria-label="Insert ${emoji}" title="Insert ${emoji}">${emoji}</button>`
              )
              .join("")}
          </div>
          <div class="messenger-attachment-list" data-comm-attach-list hidden></div>
          <div class="messenger-attachment-actions" data-comm-attach-hint hidden>
            <span class="task-meta" data-comm-attach-count></span>
            <button type="button" class="mini-btn" data-action="comm-clear-attachments" data-id="clear">Clear</button>
          </div>
          <div class="messenger-compose-row">
            <textarea id="commComposerText" name="text" rows="2" placeholder="Message ${escapeHtml(selectedConversation?.name || "")}... Use @mention for teammates.">${escapeHtml(isEditingMessage ? editDraft : "")}</textarea>
            <button class="btn btn-accent messenger-send-btn" type="submit">
              <i class="bi bi-send" aria-hidden="true"></i>
              <span>${isEditingMessage ? "Save" : "Send"}</span>
            </button>
          </div>
        </section>
      `
      : mode === "email"
        ? `
          <section class="comms-mode-surface email-surface gmail-compose-card">
            <header class="compose-sheet-head gmail-compose-head">
              <div>
                <p class="task-title">${emailComposeMinimized ? emailDraftSubjectPreview : "New Message"}</p>
                <p class="task-meta">${
                  emailComposeMinimized ? "Draft minimized" : "Send via Gmail and auto-log to this CRM thread"
                }</p>
              </div>
              <div class="gmail-compose-head-actions gmail-compose-window-actions">
                <button type="button" class="message-icon-btn" data-action="email-compose-minimize" data-id="toggle" aria-label="${
                  emailComposeMinimized ? "Expand composer" : "Minimize composer"
                }" title="${emailComposeMinimized ? "Expand" : "Minimize"}">
                  <i class="bi ${emailComposeMinimized ? "bi-arrows-angle-expand" : "bi-dash-lg"}" aria-hidden="true"></i>
                </button>
                <details class="gmail-compose-menu">
                  <summary class="message-icon-btn gmail-compose-menu-toggle" aria-label="More compose actions" title="More">
                    <i class="bi bi-three-dots-vertical" aria-hidden="true"></i>
                  </summary>
                  <div class="gmail-compose-menu-dropdown">
                    <button type="button" class="gmail-compose-menu-item" aria-label="Attach file">
                      <i class="bi bi-paperclip" aria-hidden="true"></i>
                      <span>Attach file</span>
                    </button>
                    <button type="button" class="gmail-compose-menu-item" aria-label="Insert template">
                      <i class="bi bi-lightning-charge" aria-hidden="true"></i>
                      <span>Insert template</span>
                    </button>
                    <button type="button" class="gmail-compose-menu-item" aria-label="Insert link">
                      <i class="bi bi-link-45deg" aria-hidden="true"></i>
                      <span>Insert link</span>
                    </button>
                  </div>
                </details>
                <button type="button" class="message-icon-btn" data-action="email-compose-close" data-id="close" aria-label="Close composer" title="Close composer">
                  <i class="bi bi-x-lg" aria-hidden="true"></i>
                </button>
              </div>
            </header>

            <label class="gmail-compose-line">
              <span>To</span>
              <input type="email" name="emailTo" placeholder="person@company.com" value="${emailDraftTo}" required />
            </label>

            <details class="gmail-ccbcc" ${emailCcbccOpen ? "open" : ""}>
              <summary>Cc / Bcc</summary>
              <div class="gmail-ccbcc-grid">
                <label class="gmail-compose-line">
                  <span>Cc</span>
                  <input type="text" name="emailCc" placeholder="Optional, comma-separated" value="${emailDraftCc}" />
                </label>
                <label class="gmail-compose-line">
                  <span>Bcc</span>
                  <input type="text" name="emailBcc" placeholder="Optional, comma-separated" value="${emailDraftBcc}" />
                </label>
              </div>
            </details>

            <label class="gmail-compose-line">
              <span>Subject</span>
              <input type="text" name="emailSubject" placeholder="Write a clear subject" value="${emailDraftSubject}" required />
            </label>

            <label class="compose-body gmail-compose-body">
              <textarea id="commComposerText" name="text" rows="9" placeholder="Compose email..." required>${emailDraftText}</textarea>
            </label>

            <details class="gmail-crm-strip" ${emailCrmOpen ? "open" : ""}>
              <summary>
                <span><i class="bi bi-diagram-3" aria-hidden="true"></i> Link to CRM record</span>
                <small>Optional</small>
              </summary>
              <div class="gmail-crm-grid">
                <label class="form-field">
                  <span>Module</span>
                  <select name="linkedType">
                    ${emailLinkedTypeOptions}
                  </select>
                </label>
                <label class="form-field">
                  <span>Record Name</span>
                  <input type="text" name="linkedLabel" placeholder="Optional record name" value="${emailDraftLinkedLabel}" />
                </label>
              </div>
            </details>

            <div class="compose-sheet-foot gmail-compose-foot">
              <div class="gmail-send-actions">
                <button class="btn btn-accent" type="submit">
                  <i class="bi bi-send" aria-hidden="true"></i>
                  <span>Send</span>
                </button>
                <button class="mini-btn" type="button" disabled>
                  <i class="bi bi-clock-history" aria-hidden="true"></i>
                  <span>Schedule</span>
                </button>
                <button class="mini-btn" type="button" data-action="email-compose-minimize" data-id="toggle">
                  <i class="bi bi-save2" aria-hidden="true"></i>
                  <span>Save & Minimize</span>
                </button>
              </div>
              ${
                isMessengerMode
                  ? ""
                  : `<p class="task-meta">${
                emailConnected
                  ? "Gmail API send + CRM timeline log"
                  : emailBackendReady
                    ? "Connect Gmail to enable live send + CRM timeline log"
                    : "Demo send only: local thread + CRM timeline log"
                    }</p>`
              }
            </div>
          </section>
        `
        : mode === "sms"
          ? `
            <section class="comms-mode-surface sms-surface">
              <header class="compose-sheet-head sms-compose-head">
                <p class="task-title">Reply via SMS</p>
                <p class="task-meta">Open your SMS app with a prefilled draft, then keep the thread logged here</p>
              </header>
              <div class="sms-compose-topline">
                <label class="form-field sms-recipient-field">
                  <span>To</span>
                  <input type="text" name="phoneTo" placeholder="+1-555-000-0000" value="${escapeHtml(
                    (data.contacts || []).find(
                      (contact) =>
                        String(contact.name || "").trim().toLowerCase() ===
                        String(selectedConversation?.name || "").trim().toLowerCase()
                    )?.phone || ""
                  )}" required />
                </label>
                <button class="mini-btn sms-schedule-btn" type="button" disabled title="Scheduled SMS is not available in the external composer flow yet.">
                  <i class="bi bi-clock-history" aria-hidden="true"></i>
                  <span>Schedule</span>
                </button>
              </div>
              <label class="form-field sms-text-field">
                <span>Message</span>
                <textarea id="commComposerText" name="text" rows="3" maxlength="640" placeholder="Type SMS..."></textarea>
              </label>
              <div class="sms-template-row">
                <button type="button" class="mini-btn" data-action="sms-template-insert" data-id="followup">Follow-up</button>
                <button type="button" class="mini-btn" data-action="sms-template-insert" data-id="meeting">Meeting</button>
                <button type="button" class="mini-btn" data-action="sms-template-insert" data-id="nudge">Nudge</button>
                <button type="button" class="mini-btn" data-action="sms-template-insert" data-id="confirmation">Confirmation</button>
              </div>
              <div class="compose-sheet-foot sms-compose-foot">
                <p class="task-meta sms-counter" id="commCharCount" data-max="640" data-segment="160">0/640 (1 segment)</p>
                <div class="sms-send-actions">
                  <button class="btn btn-accent" type="submit">
                    <i class="bi bi-send" aria-hidden="true"></i>
                    <span>Send SMS</span>
                  </button>
                </div>
              </div>
            </section>
          `
          : `
            <section class="comms-mode-surface call-surface">
              <header class="compose-sheet-head">
                <p class="task-title">Start Call</p>
                <p class="task-meta">Start a live Joynosync call and keep this record linked for wrap-up.</p>
              </header>
              <label class="form-field">
                <span>Dial Number</span>
                <input class="call-input" type="text" name="phoneTo" placeholder="+1-555-000-0000" required />
              </label>
              <label class="form-field">
                <span>Call Note (optional)</span>
                <textarea name="callNote" rows="3" placeholder="Agenda, context, or required outcome..."></textarea>
              </label>
              <label class="call-check">
                <input type="checkbox" name="callRecord" value="true" checked />
                <span>Enable call recording for this session.</span>
              </label>
              <div class="compose-sheet-foot">
                <button class="btn btn-accent" type="submit">Start Call</button>
                <p class="task-meta">Call history and wrap-up will sync into Joynosync.</p>
              </div>
            </section>
          `;

  const crmFields = advancedOpen
    ? `
      <section class="comms-log-panel">
        <div class="comms-compose-grid">
          <label class="form-field">
            <span>Message Type</span>
            <select name="messageType">
              <option value="Update" ${defaultMessageType === "Update" ? "selected" : ""}>Update</option>
              <option value="Question">Question</option>
              <option value="Blocker">Blocker</option>
              <option value="Announcement" ${defaultMessageType === "Announcement" ? "selected" : ""}>Announcement</option>
            </select>
          </label>
          <label class="form-field">
            <span>Priority</span>
            <select name="important">
              <option value="false">Normal</option>
              <option value="true">Important</option>
            </select>
          </label>
          <label class="form-field">
            <span>Linked Module</span>
            <select name="linkedType">
              <option value="">None</option>
              <option value="Lead">Lead</option>
              <option value="Contact">Contact</option>
              <option value="Account">Account</option>
              <option value="Deal">Deal</option>
              <option value="Project">Project</option>
              <option value="Task">Task</option>
            </select>
          </label>
          <label class="form-field">
            <span>Linked Record</span>
            <input type="text" name="linkedLabel" placeholder="Optional record name" />
          </label>
        </div>
      </section>
    `
    : `
      <input type="hidden" name="messageType" value="${defaultMessageType}" />
      <input type="hidden" name="important" value="false" />
      <input type="hidden" name="linkedType" value="" />
      <input type="hidden" name="linkedLabel" value="" />
    `;

  const composerMarkup =
    isMessengerMode && showMessengerThreadSkeleton
      ? renderMessengerComposerSkeleton()
      : isMessengerMode && showMessengerLoadError
        ? ""
        : isEmailMode
          ? emailComposeOpen
            ? `
              <form class="comms-composer is-email ${emailComposeMinimized ? "is-minimized" : "is-open"}" id="commComposerForm">
                <input type="hidden" name="mode" value="${mode}" />
                <input type="hidden" name="messageType" value="Announcement" />
                <input type="hidden" name="important" value="false" />
                ${modeComposer}
              </form>
            `
            : ""
          : selectedConversation
            ? `
              <form class="comms-composer" id="commComposerForm">
                <input type="hidden" name="mode" value="${mode}" />
                ${modeComposer}
                ${
                  isMessengerMode
                    ? ""
                    : `<div class="comms-log-row">
                        <p class="task-meta">${modeHelp}</p>
                        <button type="button" class="mini-btn ${advancedOpen ? "is-active" : ""}" data-action="comm-toggle-advanced" data-id="advanced">
                          ${advancedOpen ? "Hide CRM Fields" : "CRM Fields"}
                        </button>
                      </div>`
                }
                ${isMessengerMode ? "" : crmFields}
              </form>
            `
            : ""
        ;

  const isCommsParent = context.routeId === "communications";
  const viewMeta =
    mode === "email"
      ? { title: "Email", subtitle: "Mailbox workflow with Inbox, Sent, Drafts, Spam, and Trash", action: "Compose Email" }
      : mode === "sms"
        ? { title: "SMS", subtitle: "Draft messages, launch your SMS app, and keep the thread context in CRM", action: "Send SMS" }
        : mode === "call"
          ? { title: "Calls", subtitle: "Live calling, voicemail, and queue handling in Joynosync", action: "Start Call" }
          : {
              title: isCommsParent ? "Communications" : "Messenger",
              subtitle: "Internal workspace chat for direct messages and group chats",
              action: "Compose"
            };

  if (isEmailMode) {
    const activeEmailFolder = emailFolderDefinitions.find((folder) => folder.id === activeEmailFolderId) || emailFolderDefinitions[0];
    const selectedEmailRecord =
      emailMailboxRecords.find((record) => record.id === String(context.selectedEmailMessageId || "").trim()) || null;
    const emailMailboxBody =
      emailMailboxRecords.length > 0
        ? `
          <div class="email-mailbox-list">
            ${emailMailboxRecords
              .map((record) => {
                const previewLabel = record.preview || "No preview available.";
                return `
                  <button
                    class="conversation-item is-email email-mailbox-row ${record.isUnread ? "is-unread" : ""}"
                    data-action="comm-open-email"
                    data-id="${escapeHtml(record.id)}"
                    type="button"
                  >
                    <span class="conversation-email-name">${escapeHtml(record.primaryLabel)}</span>
                    <span class="conversation-email-line">
                      <span class="conversation-email-subject">${escapeHtml(record.subject || "No subject")}</span>
                      <span class="conversation-email-divider">-</span>
                      <span class="conversation-email-preview">${escapeHtml(previewLabel)}</span>
                    </span>
                    <span class="conversation-email-time">${escapeHtml(record.timeLabel || "")}</span>
                  </button>
                `;
              })
              .join("")}
          </div>
        `
        : emailMailboxLoading
          ? `
            <div class="email-empty-thread email-mailbox-empty">
              <p class="task-title">Loading ${escapeHtml(activeEmailFolder.label)}...</p>
              <p class="task-meta">Syncing the latest Gmail mailbox items.</p>
            </div>
          `
          : emailMailboxError
            ? `
              <div class="email-empty-thread email-mailbox-empty">
                <p class="task-title">Could not load ${escapeHtml(activeEmailFolder.label)}.</p>
                <p class="task-meta">${escapeHtml(emailMailboxError)}</p>
                ${
                  emailMailboxReconnectRequired
                    ? `<div class="empty-state-actions">
                         <button class="btn btn-accent" type="button" data-action="email-connect-google" ${emailConnectDisabled ? "disabled" : ""}>
                           ${escapeHtml(emailConnectLabel || "Reconnect Gmail")}
                         </button>
                       </div>`
                    : ""
                }
              </div>
            `
        : `
          <div class="email-empty-thread email-mailbox-empty">
            <p class="task-title">No emails in ${escapeHtml(activeEmailFolder.label)}.</p>
            <p class="task-meta">Choose another folder or use Compose from the left.</p>
          </div>
        `;
    const selectedEmailAttachments = Array.isArray(selectedEmailRecord?.message?.attachments)
      ? selectedEmailRecord.message.attachments.filter((item) => item && String(item.name || "").trim())
      : [];
    const emailReaderMarkup = selectedEmailRecord
      ? `
        <div class="email-reader">
          <article class="email-reader-card">
            <header class="email-reader-card-head">
              <div>
                <p class="task-title">${escapeHtml(selectedEmailRecord.subject)}</p>
                <p class="task-meta">${escapeHtml(selectedEmailRecord.detailTimeLabel)}</p>
              </div>
              ${selectedEmailRecord.linkedType ? `<span class="conversation-email-link">${escapeHtml(selectedEmailRecord.linkedType)}</span>` : ""}
            </header>
            <div class="email-reader-from">
              <span class="email-thread-avatar">${escapeHtml(selectedEmailRecord.initials)}</span>
              <div class="email-reader-from-copy">
                <p class="task-title">${escapeHtml(selectedEmailRecord.sender)}</p>
                <p class="task-meta">${
                  selectedEmailRecord.folderId === "sent"
                    ? `To ${escapeHtml(selectedEmailRecord.recipient || "recipient")}`
                    : selectedEmailRecord.recipient
                      ? `To ${escapeHtml(selectedEmailRecord.recipient)}`
                      : "Received email"
                }</p>
              </div>
            </div>
            <div class="email-reader-body">${selectedEmailRecord.bodyMarkup}</div>
            ${
              selectedEmailAttachments.length
                ? `
                  <div class="email-reader-attachments">
                    ${selectedEmailAttachments
                      .map(
                        (attachment) => `
                          <span class="composer-attachment-pill">
                            <i class="bi bi-paperclip" aria-hidden="true"></i>
                            <span>${escapeHtml(String(attachment.name || ""))}</span>
                            <small>${escapeHtml(formatBytesCompact(attachment.size || 0))}</small>
                          </span>
                        `
                      )
                      .join("")}
                  </div>
                `
                : ""
            }
          </article>
        </div>
      `
      : emailMailboxBody;

    return {
      title: viewMeta.title,
      subtitle: viewMeta.subtitle,
      primaryAction: viewMeta.action,
      showWaitingPanel: false,
      html: `
        <section class="view-block comms-layout comms-mode-${modeClass} comms-mode-email-mailbox">
          <aside class="comms-rail">
            <div class="comms-rail-head">
              <button class="btn btn-accent email-compose-btn" type="button" data-action="email-compose-open" data-id="open">
                <i class="bi bi-pencil-square" aria-hidden="true"></i>
                <span>Compose</span>
              </button>
              <input class="search comms-search" id="commsSearch" value="${escapeHtml(query)}" placeholder="Search emails" />
              <nav class="email-folder-menu" aria-label="Email folders">
                ${emailFolderMenuMarkup}
              </nav>
            </div>
          </aside>
          <section class="comms-thread ${threadComposeStateClass}">
            <header class="comms-thread-head email-mailbox-head">
              ${
                selectedEmailRecord
                  ? `
                    <div class="email-reader-head-copy">
                      <button class="mini-btn email-mailbox-back" type="button" data-action="comm-back-email-list" data-id="back">
                        <i class="bi bi-arrow-left" aria-hidden="true"></i>
                        <span>${escapeHtml(activeEmailFolder.label)}</span>
                      </button>
                      <div>
                        <h3 class="block-title">${escapeHtml(selectedEmailRecord.subject)}</h3>
                        <p class="task-meta">${escapeHtml(selectedEmailRecord.sender)} • ${escapeHtml(selectedEmailRecord.detailTimeLabel)}</p>
                      </div>
                    </div>
                  `
                  : `
                    <div class="email-mailbox-head-copy">
                      <h3 class="block-title">${escapeHtml(activeEmailFolder.label)}</h3>
                      <p class="task-meta">${emailMailboxRecords.length} email${emailMailboxRecords.length === 1 ? "" : "s"}</p>
                    </div>
                  `
              }
            </header>
            <div class="message-list email-mailbox-pane" id="commMessageList">
              ${emailReaderMarkup}
            </div>
            ${composerMarkup}
          </section>
        </section>
      `
    };
  }

  const messengerListMarkup = `
    <section>
      <div class="conversation-list messenger-list ${showMessengerRailSkeleton ? "is-skeleton" : ""}">
        ${
          showMessengerRailSkeleton
            ? renderMessengerRailSkeleton()
            : showMessengerLoadError
              ? renderMessengerInlineState("Could not load conversations.", messengerSnapshotError)
            : renderConversationRows(inboxConversations, selectedConversationKey, "", "No conversations found.", {
                variant: "messenger",
                latestMessageByKey,
                currentUserId: String(data.currentUser?.id || ""),
                currentUserName: currentUserName
              })
        }
      </div>
    </section>
  `;

  const emailListMarkup = `
    <section class="email-rail-section">
      <h3 class="block-title email-threads-title">Threads</h3>
      <div class="conversation-list email-list">
        ${renderConversationRows(inboxConversations, selectedConversationKey, "", "No conversations found.", {
          variant: "email",
          latestMessageByKey
        })}
      </div>
    </section>
  `;

  const smsListMarkup = `
    <section class="sms-rail-section">
      <h3 class="block-title sms-threads-title">SMS Threads</h3>
      <div class="conversation-list sms-list">
        ${renderConversationRows(inboxConversations, selectedConversationKey, "", "No SMS threads found.", {
          variant: "sms",
          latestMessageByKey,
          smsMetaByKey: smsThreadMetaByKey
        })}
      </div>
    </section>
  `;

  const standardListMarkup = `
    ${activeFilter === "inbox"
      ? `
        <section>
          <h3 class="block-title">Unread</h3>
          <div class="conversation-list">
            ${renderConversationRows(unreadConversations.slice(0, 6), selectedConversationKey, "", "No unread conversations.")}
          </div>
        </section>`
      : ""}
    ${activeFilter === "inbox"
      ? `
        <section>
          <h3 class="block-title">Pinned</h3>
          <div class="conversation-list">
            ${renderConversationRows(pinnedConversations.slice(0, 6), selectedConversationKey, "", "No pinned conversations.")}
          </div>
        </section>`
      : ""}
    <section>
      <h3 class="block-title">${
        activeFilter === "unread"
          ? filterLabels.unread
          : activeFilter === "pinned"
            ? filterLabels.pinned
            : activeFilter === "channels"
              ? filterLabels.channels
              : activeFilter === "direct"
                ? filterLabels.direct
                : filterLabels.inbox
      }</h3>
      <div class="conversation-list">
        ${renderConversationRows(inboxConversations, selectedConversationKey, "", "No conversations found.")}
      </div>
    </section>
  `;

  const selectedSmsContact =
    isSmsMode && selectedConversation
      ? (data.contacts || []).find(
          (contact) =>
            String(contact.name || "").trim().toLowerCase() ===
            String(selectedConversation.name || "").trim().toLowerCase()
        ) || null
      : null;
  const smsThreadSubtitle = selectedSmsContact
    ? `${selectedSmsContact.account || "No account"} | ${selectedSmsContact.phone || "No phone"}`
    : selectedConversation?.detail || selectedConversation?.subtitle || "";
  const smsQuickActionsMarkup =
    isSmsMode && selectedConversation
      ? `
        <div class="sms-thread-quick-actions">
          <button class="mini-btn" type="button" data-action="sms-open-calls" data-id="${selectedConversationKey}">
            <i class="bi bi-telephone" aria-hidden="true"></i>
            <span>Call</span>
          </button>
          <button class="mini-btn" type="button" data-action="sms-open-contact" data-id="${selectedConversationKey}">
            <i class="bi bi-person" aria-hidden="true"></i>
            <span>Contact</span>
          </button>
          <button class="mini-btn" type="button" data-action="sms-open-deals" data-id="${selectedConversationKey}">
            <i class="bi bi-graph-up" aria-hidden="true"></i>
            <span>Deals</span>
          </button>
        </div>
      `
      : "";

  return {
    title: viewMeta.title,
    subtitle: viewMeta.subtitle,
    primaryAction: viewMeta.action,
    showWaitingPanel: false,
    html: `
      <section class="view-block comms-layout comms-mode-${modeClass} ${!isMessengerMode && context.commsContextCollapsed ? "is-context-collapsed" : ""}">
        <aside class="comms-rail">
          <div class="comms-rail-head">
            ${
              isEmailMode
                ? `
                  <button class="btn btn-accent email-compose-btn" type="button" data-action="email-compose-open" data-id="open">
                    <i class="bi bi-pencil-square" aria-hidden="true"></i>
                    <span>Compose</span>
                  </button>
                  <div class="email-rail-meta">
                    <div class="email-rail-status">
                      <span class="status-chip">${emailStatusLabel}</span>
                      <span class="task-meta">${emailStatusDetail}</span>
                    </div>
                    <button class="mini-btn" type="button" data-action="email-connect-google" ${emailConnectDisabled ? "disabled" : ""}>
                      ${emailConnectLabel}
                    </button>
                  </div>
                  <input class="search comms-search" id="commsSearch" value="${escapeHtml(query)}" placeholder="Search email threads" />
                  <nav class="email-folder-menu" aria-label="Email folders">
                    ${emailFolderMenuMarkup}
                  </nav>
                `
                : `
                  <div class="comms-filter-row ${isSmsMode ? "sms-filter-row" : ""}">
                    ${
                      isMessengerMode
                        ? `
                          <div class="messenger-filter-bar">
                            <div class="messenger-scope-row">
                              <button class="mini-btn ${activeFilter === "all" ? "is-active" : ""}" data-action="comm-set-filter" data-id="all">${filterLabels.all}</button>
                              <button class="mini-btn ${activeFilter === "gc" ? "is-active" : ""}" data-action="comm-set-filter" data-id="gc">${filterLabels.gc}</button>
                              <button class="mini-btn ${activeFilter === "direct" ? "is-active" : ""}" data-action="comm-set-filter" data-id="direct">${filterLabels.direct}</button>
                            </div>
                            <details class="messenger-create-menu">
                              <summary class="message-icon-btn messenger-create-toggle" aria-label="Start new chat" title="Start new chat">
                                <i class="bi bi-pencil-square" aria-hidden="true"></i>
                              </summary>
                              <div class="messenger-create-dropdown">
                                <button type="button" class="messenger-create-item" data-action="comm-new-direct" data-id="direct">
                                  <i class="bi bi-person-plus" aria-hidden="true"></i>
                                  <span>New Direct</span>
                                </button>
                                <button type="button" class="messenger-create-item" data-action="comm-new-gc" data-id="gc">
                                  <i class="bi bi-people" aria-hidden="true"></i>
                                  <span>New GC</span>
                                </button>
                              </div>
                            </details>
                          </div>
                          <input class="search comms-search messenger-search" id="commsSearch" value="${escapeHtml(query)}" placeholder="Search this thread" />
                        `
                        : isSmsMode
                          ? `
                            <input class="search comms-search" id="commsSearch" value="${escapeHtml(query)}" placeholder="Search SMS threads" />
                            <button class="mini-btn ${activeFilter === "all" ? "is-active" : ""}" data-action="comm-set-filter" data-id="all">${filterLabels.all}</button>
                            <button class="mini-btn ${activeFilter === "needs-reply" ? "is-active" : ""}" data-action="comm-set-filter" data-id="needs-reply">${filterLabels.needsReply}</button>
                            <button class="mini-btn ${activeFilter === "scheduled" ? "is-active" : ""}" data-action="comm-set-filter" data-id="scheduled">${filterLabels.scheduled}</button>
                            <button class="mini-btn ${activeFilter === "failed" ? "is-active" : ""}" data-action="comm-set-filter" data-id="failed">${filterLabels.failed}</button>
                            <button class="mini-btn ${activeFilter === "contacts" ? "is-active" : ""}" data-action="comm-set-filter" data-id="contacts">${filterLabels.contacts}</button>
                          `
                        : `
                          <input class="search comms-search" id="commsSearch" value="${escapeHtml(query)}" placeholder="Search conversations" />
                          <button class="mini-btn ${activeFilter === "inbox" ? "is-active" : ""}" data-action="comm-set-filter" data-id="inbox">${filterLabels.inbox}</button>
                          <button class="mini-btn ${activeFilter === "unread" ? "is-active" : ""}" data-action="comm-set-filter" data-id="unread">${filterLabels.unread}</button>
                          <button class="mini-btn ${activeFilter === "pinned" ? "is-active" : ""}" data-action="comm-set-filter" data-id="pinned">${filterLabels.pinned}</button>
                          <button class="mini-btn ${activeFilter === "channels" ? "is-active" : ""}" data-action="comm-set-filter" data-id="channels">${filterLabels.channels}</button>
                          <button class="mini-btn ${activeFilter === "direct" ? "is-active" : ""}" data-action="comm-set-filter" data-id="direct">${filterLabels.direct}</button>
                        `
                    }
                  </div>
                `
            }
          </div>
          ${isMessengerMode ? messengerListMarkup : isEmailMode ? emailListMarkup : isSmsMode ? smsListMarkup : standardListMarkup}
        </aside>
        <section class="comms-thread ${threadComposeStateClass}">
          <header class="comms-thread-head">
            ${
              showMessengerHeaderSkeleton
                ? renderMessengerThreadHeaderSkeleton()
                : showMessengerLoadError
                  ? renderMessengerThreadState("Could not load conversations.", messengerSnapshotError)
                : `
                  <div class="${isMessengerMode ? "messenger-thread-head-shell" : ""}">
              <h3 class="block-title">${selectedConversation ? escapeHtml(selectedConversation.name) : "No Conversation Selected"}</h3>
              ${
                isMessengerMode
                  ? typingIndicatorMarkup
                  : `<p class="task-meta">${
                selectedConversation
                  ? escapeHtml(
                      isSmsMode
                        ? smsThreadSubtitle
                        : selectedConversation.targetType === "crm"
                          ? [selectedConversation.subtitle, selectedConversation.detail].filter(Boolean).join(" • ")
                          : selectedConversation.detail || selectedConversation.subtitle
                    )
                  : isEmailMode
                    ? "Choose an email thread from the left."
                    : isSmsMode
                      ? "Choose an SMS thread from the left."
                    : "Pick a GC or direct message."
                    }</p>`
              }
                    ${smsQuickActionsMarkup}
                  </div>
                `
            }
            ${
              selectedConversation && !(isMessengerMode && !messengerSnapshotReady)
                ? `
                  <div class="thread-head-actions">
                    <details class="thread-actions-menu">
                      <summary class="thread-menu-toggle" aria-label="Conversation actions">
                        <i class="bi bi-three-dots-vertical" aria-hidden="true"></i>
                      </summary>
                      <div class="thread-actions-dropdown">
                        <button class="thread-menu-item" data-action="comm-mark-${selectedConversation.unread > 0 ? "read" : "unread"}" data-id="${selectedConversationKey}" type="button">
                          Mark ${selectedConversation.unread > 0 ? "Read" : "Unread"}
                        </button>
                        <button class="thread-menu-item" data-action="comm-pin-toggle" data-id="${selectedConversationKey}" type="button">
                          ${selectedConversation.pinned ? "Unpin" : "Pin"}
                        </button>
                        <button class="thread-menu-item" data-action="comm-mute-toggle" data-id="${selectedConversationKey}" type="button">
                          ${selectedConversation.muted ? "Unmute" : "Mute"}
                        </button>
                        ${
                          isMessengerMode
                            ? ""
                            : `<button class="thread-menu-item" data-action="comm-open-linked" data-id="${selectedConversationKey}" ${linkedRoute ? "" : "disabled"} type="button">
                                Open Linked
                              </button>`
                        }
                      </div>
                    </details>
                  </div>
                `
                : ""
            }
          </header>
          <div class="message-list ${showMessengerThreadSkeleton ? "is-skeleton" : ""}" id="commMessageList" ${showMessengerThreadSkeleton ? 'aria-busy="true"' : ""}>
            ${
              isMessengerMode
                ? showMessengerThreadSkeleton
                  ? renderMessengerThreadSkeleton()
                  : showMessengerLoadError
                    ? renderMessengerInlineState("Could not load messages.", messengerSnapshotError)
                  : `<div class="messenger-message-feed">${messageRows || "<p class='task-meta'>No messages in this conversation yet.</p>"}</div>`
                : `${
                    messageRows ||
                    (isEmailMode && selectedConversation
                      ? `
                        <div class="email-empty-thread">
                          <p class="task-title">No emails in this thread yet.</p>
                          <p class="task-meta">Use the Compose button on the left to start this conversation and log it in CRM.</p>
                        </div>
                      `
                      : isSmsMode && selectedConversation
                        ? `
                          <div class="email-empty-thread sms-empty-thread">
                            <p class="task-title">No SMS in this thread yet.</p>
                            <p class="task-meta">Send a message below to start and log it in CRM.</p>
                          </div>
                        `
                      : "<p class='task-meta'>No messages in this conversation yet.</p>")
                  }`
            }
          </div>
          ${composerMarkup}
        </section>
        ${
          isMessengerMode
            ? ""
            : `<aside class="comms-context ${context.commsContextCollapsed ? "is-collapsed" : ""}">
          <header class="comms-context-head">
            <h3 class="block-title">Context</h3>
            <button class="panel-toggle-btn" type="button" data-action="comm-toggle-context" data-id="context" aria-label="${context.commsContextCollapsed ? "Expand context panel" : "Collapse context panel"}">
              <i class="bi ${context.commsContextCollapsed ? "bi-chevron-left" : "bi-chevron-right"}" aria-hidden="true"></i>
            </button>
          </header>
          <div class="comms-context-body">
            <section class="comms-context-block">
              <p class="task-meta">Linked CRM Record</p>
              ${
                linkedContext.type
                  ? `
                    <p class="task-title">${escapeHtml(linkedContext.type)}: ${escapeHtml(linkedContext.label)}</p>
                    <button class="mini-btn" data-action="comm-open-linked" data-id="${selectedConversationKey}" ${linkedRoute ? "" : "disabled"}>
                      Open in CRM
                    </button>
                  `
                  : "<p class='task-meta'>No linked record on this thread yet.</p>"
              }
            </section>
            <section class="comms-context-block">
              <p class="task-meta">Participants</p>
              <div class="comms-participant-list">
                ${
                  participants.length
                    ? participants
                        .map(
                          (name) => `
                            <div class="comms-participant">
                              <span class="participant-avatar">${escapeHtml(name.slice(0, 1).toUpperCase())}</span>
                              <span>${escapeHtml(name)}</span>
                            </div>
                          `
                        )
                        .join("")
                    : "<p class='task-meta'>No participants found.</p>"
                }
              </div>
            </section>
            <section class="comms-context-block">
              <p class="task-meta">Recent Activity</p>
              <div class="comms-activity-list">
                ${recentActivityRows || "<p class='task-meta'>No activity yet.</p>"}
              </div>
            </section>
          </div>
        </aside>`
        }
      </section>
    `
  };
}

export function renderCommsEmail(data, context) {
  return renderCommunications(data, { ...context, commsMode: "email" });
}

export function renderCommsSms(data, context) {
  return renderCommunications(data, { ...context, commsMode: "sms" });
}

export function renderCommsCalls(data, context) {
  return renderCommunications(data, { ...context, commsMode: "call" });
}

