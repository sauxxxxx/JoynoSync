import { formatMoney } from "../utils/format.js";
import { compareText } from "../utils/sort.js";
import { escapeHtml } from "../utils/text.js";
import { viewSectionHead } from "../utils/ui.js";
import { canTaskDelete, canTaskEditCore, canTaskUpdateProgress } from "../modules/task-rbac.js";
import { canonicalTaskType, isCallTaskType } from "../modules/task-call.js";

const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const TASK_STATUS_SORT_ORDER = new Map([
  ["New", 0],
  ["Scheduled", 1],
  ["In progress", 2],
  ["Completed", 3]
]);
const TABLE_SORT_KEYS = new Set([
  "priority",
  "taskDate",
  "accountName",
  "taskType",
  "status",
  "description",
  "initials"
]);

function parseIsoDateLocal(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.valueOf())) {
    return null;
  }
  return date;
}

function parseDateTimeLocal(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{1,2}:\d{2})$/);
  if (!match) {
    return null;
  }
  const date = parseIsoDateLocal(match[1]);
  const time = String(match[2] || "");
  const timeMatch = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!date || !timeMatch) {
    return null;
  }
  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function timeToMinutes(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return -1;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function getTaskDay(task) {
  if (task.dueDate) {
    const parsed = parseIsoDateLocal(task.dueDate);
    if (parsed) {
      const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      return labels[parsed.getDay()] || task.day || "";
    }
  }
  return String(task.day || "").slice(0, 3);
}

function getTaskTimeLabel(task) {
  const formatClock = (timeValue) => {
    const parsed = parseDateTimeLocal(`${task.dueDate || "2026-01-01"}T${timeValue}`);
    if (!parsed) {
      return "";
    }
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit"
    }).format(parsed);
  };
  const startTimeValue = String(task.startTime || "").trim();
  const endTimeValue = String(task.endTime || "").trim();
  if (startTimeValue && endTimeValue) {
    const startLabel = formatClock(startTimeValue);
    const endLabel = formatClock(endTimeValue);
    if (startLabel && endLabel) {
      return `${startLabel} - ${endLabel}`;
    }
  }
  if (task.deadlineAt) {
    const parsed = parseDateTimeLocal(task.deadlineAt);
    if (parsed) {
      return new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit"
      }).format(parsed);
    }
  }
  const start = String(task.startTime || "").trim();
  if (start) {
    const parsed = parseDateTimeLocal(`${task.dueDate || "2026-01-01"}T${start}`);
    if (parsed) {
      return new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit"
      }).format(parsed);
    }
  }
  return String(task.time || "");
}

function getTaskDateLabel(task) {
  if (!task.dueDate) {
    return task.day || "-";
  }
  const parsed = parseIsoDateLocal(task.dueDate);
  if (!parsed) {
    return task.dueDate;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    weekday: "short"
  }).format(parsed);
}

function isTaskOverdue(task) {
  if (String(task.status || "") === "Completed") {
    return false;
  }
  if (task.deadlineAt) {
    const parsed = parseDateTimeLocal(task.deadlineAt);
    if (parsed) {
      return parsed.valueOf() < Date.now();
    }
  }
  if (!task.dueDate) {
    return false;
  }
  const date = parseIsoDateLocal(task.dueDate);
  if (!date) {
    return false;
  }
  const startMinutes = timeToMinutes(task.startTime || "");
  if (startMinutes >= 0) {
    date.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
  } else {
    date.setHours(23, 59, 59, 999);
  }
  return date.valueOf() < Date.now();
}

function includesSearch(task, query) {
  if (!query) {
    return true;
  }
  const haystack = [
    task.title,
    task.assignee,
    task.status,
    task.day,
    task.priority,
    task.dueDate,
    task.projectName,
    task.accountName,
    task.taskType,
    task.callPhone,
    task.linkLabel,
    task.recurrence,
    task.notes
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function sortTasksBySchedule(tasks) {
  return [...tasks].sort((a, b) => {
    const deadlineA = parseDateTimeLocal(a.deadlineAt);
    const deadlineB = parseDateTimeLocal(b.deadlineAt);
    if (deadlineA && deadlineB) {
      return deadlineA.valueOf() - deadlineB.valueOf();
    }
    if (deadlineA && !deadlineB) {
      return -1;
    }
    if (!deadlineA && deadlineB) {
      return 1;
    }
    const dateA = a.dueDate || "";
    const dateB = b.dueDate || "";
    if (dateA !== dateB) {
      return dateA.localeCompare(dateB);
    }
    const timeA = timeToMinutes(a.startTime || "");
    const timeB = timeToMinutes(b.startTime || "");
    return timeA - timeB;
  });
}

function statusClass(status) {
  return String(status || "new")
    .toLowerCase()
    .replaceAll(" ", "-");
}

function statusCode(status) {
  if (status === "In progress") {
    return "IP";
  }
  return String(status || "N")
    .slice(0, 1)
    .toUpperCase();
}

function getTaskQuickAction(task) {
  if (!canTaskUpdateProgress(task)) {
    return null;
  }
  const status = String(task?.status || "").trim();
  if (status === "Completed") {
    return { label: "Reopen", action: "task-reopen" };
  }
  if (status === "In progress") {
    return { label: "Mark Done", action: "task-mark-done" };
  }
  return { label: "Start", action: "task-start" };
}

function initialsFromName(value) {
  const parts = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) {
    return "--";
  }
  const first = parts[0]?.[0] || "";
  const second = parts.length > 1 ? parts[1]?.[0] || "" : parts[0]?.[1] || "";
  return `${first}${second}`.toUpperCase();
}

function normalizeTaskPriority(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "high" || raw === "medium" || raw === "low") {
    return raw;
  }
  return "low";
}

function priorityLabel(value) {
  const normalized = normalizeTaskPriority(value);
  if (normalized === "high") {
    return "High";
  }
  if (normalized === "medium") {
    return "Med";
  }
  return "Low";
}

function taskTypeLabel(task) {
  const explicit = canonicalTaskType(task.taskType, "");
  if (explicit) {
    return explicit;
  }
  const recurrence = String(task.recurrence || "").toLowerCase();
  if (recurrence === "daily" || recurrence === "weekly" || recurrence === "monthly") {
    return "Recurring";
  }
  if (task.projectName) {
    return "Project";
  }
  return "General";
}

function taskDescriptionLabel(task) {
  const notes = String(task.notes || "").trim();
  if (notes) {
    return notes;
  }
  return String(task.title || "").trim();
}

function prioritySortRank(value) {
  const normalized = normalizeTaskPriority(value);
  if (normalized === "high") {
    return 3;
  }
  if (normalized === "medium") {
    return 2;
  }
  return 1;
}

function taskDateSortValue(task) {
  const deadline = parseDateTimeLocal(task.deadlineAt);
  if (deadline) {
    return { missing: false, value: deadline.valueOf() };
  }
  const dueDate = parseIsoDateLocal(task.dueDate);
  if (dueDate) {
    dueDate.setHours(23, 59, 59, 999);
    return { missing: false, value: dueDate.valueOf() };
  }
  return { missing: true, value: 0 };
}

function compareNumberWithMissing(a, b) {
  if (a.missing && b.missing) {
    return 0;
  }
  if (a.missing) {
    return 1;
  }
  if (b.missing) {
    return -1;
  }
  return a.value - b.value;
}

function compareTasksForSort(a, b, sortKey) {
  if (sortKey === "priority") {
    return prioritySortRank(a.priority) - prioritySortRank(b.priority);
  }
  if (sortKey === "taskDate") {
    return compareNumberWithMissing(taskDateSortValue(a), taskDateSortValue(b));
  }
  if (sortKey === "accountName") {
    return compareText(a.accountName || a.projectName || "", b.accountName || b.projectName || "");
  }
  if (sortKey === "taskType") {
    return compareText(taskTypeLabel(a), taskTypeLabel(b));
  }
  if (sortKey === "status") {
    const rankA = TASK_STATUS_SORT_ORDER.get(String(a.status || "").trim()) ?? 999;
    const rankB = TASK_STATUS_SORT_ORDER.get(String(b.status || "").trim()) ?? 999;
    return rankA - rankB;
  }
  if (sortKey === "description") {
    return compareText(taskDescriptionLabel(a), taskDescriptionLabel(b));
  }
  if (sortKey === "initials") {
    return compareText(initialsFromName(a.assignee), initialsFromName(b.assignee));
  }
  return 0;
}

function sortTasksForTable(tasks, sortKey, sortDir) {
  if (!TABLE_SORT_KEYS.has(sortKey) || sortDir === "none") {
    return tasks;
  }
  const direction = sortDir === "desc" ? -1 : 1;
  return [...tasks].sort((a, b) => {
    const compared = compareTasksForSort(a, b, sortKey);
    if (compared !== 0) {
      return compared * direction;
    }
    const titleCompared = compareText(a.title, b.title);
    if (titleCompared !== 0) {
      return titleCompared;
    }
    return compareText(a.id, b.id);
  });
}

function tableSortIconClass(sortKey, activeKey, sortDir) {
  if (sortKey !== activeKey || sortDir === "none") {
    return "bi-arrow-down-up";
  }
  return sortDir === "desc" ? "bi-sort-down" : "bi-sort-up";
}

function tableHeaderSortButton(label, sortKey, activeKey, sortDir) {
  const isActive = sortKey === activeKey && sortDir !== "none";
  return `
    <button
      type="button"
      class="table-sort-btn ${isActive ? "is-active" : ""}"
      data-action="table-sort"
      data-id="${sortKey}"
      aria-label="Sort by ${label}"
    >
      <span>${label}</span>
      <i class="bi ${tableSortIconClass(sortKey, activeKey, sortDir)}" aria-hidden="true"></i>
    </button>
  `;
}

function taskProjectLabel(task) {
  const linked = String(task.linkLabel || "").trim();
  if (linked) {
    return linked;
  }
  const project = String(task.projectName || "").trim();
  if (project) {
    return project;
  }
  return "";
}

function compactTaskCardContent(task, titleClassName) {
  const taskTitle = String(task.title || "").trim() || "Untitled task";
  const assigneeName = String(task.assignee || "").trim() || "Unassigned";
  const assigneeInitials = initialsFromName(assigneeName);
  const project = taskProjectLabel(task);
  const time = String(getTaskTimeLabel(task) || "").trim() || "--";
  const callMeta = isCallTaskType(task.taskType) ? taskTypeLabel(task) : "";
  const status = statusClass(task.status);
  const statusLabel = String(task.status || "New").trim() || "New";
  const rawDescription = String(task.notes || "").trim() || project || "No description";
  const compactDescription = rawDescription.replace(/\s+/g, " ");
  return `
    <div class="task-card-headline">
      <p class="${titleClassName} task-card-title" title="${escapeHtml(taskTitle)}">${escapeHtml(taskTitle)}</p>
      <p class="task-card-time">
        <span class="task-status-dot status-${status}" title="${escapeHtml(statusLabel)}" aria-label="${escapeHtml(statusLabel)}"></span>
        <span>${escapeHtml(time)}</span>
      </p>
    </div>
    <p class="task-card-desc" title="${escapeHtml(rawDescription)}">${escapeHtml(compactDescription)}</p>
    <div class="task-card-footer">
      ${
        project
          ? `<span class="task-card-project-pill" title="${escapeHtml(project)}">${escapeHtml(project)}</span>`
          : ""
      }
      ${callMeta ? `<span class="task-card-project-pill task-card-call-pill">${escapeHtml(callMeta)}</span>` : ""}
      <span class="task-card-assignee" title="${escapeHtml(assigneeName)}">
        <span class="task-card-assignee-avatar" aria-hidden="true">${escapeHtml(assigneeInitials)}</span>
      </span>
    </div>
  `;
}

function taskCard(task, options = {}) {
  const status = statusClass(task.status);
  const draggableAttrs = options.draggable
    ? `draggable="true" data-drag-type="task-status" data-id="${task.id}"`
    : "";
  const draggableClass = options.draggable ? "is-draggable" : "";
  const overdueClass = isTaskOverdue(task) ? "is-overdue" : "";

  return `
    <article
      class="task-card task-compact-card status-${status} ${draggableClass} ${overdueClass}"
      ${draggableAttrs}
      data-card-menu="task"
      data-id="${task.id}"
      data-task-open="${task.id}"
    >
      ${compactTaskCardContent(task, "task-title")}
    </article>
  `;
}

function kanbanTaskCard(task) {
  const status = statusClass(task.status);
  const draggable = canTaskUpdateProgress(task);
  const dragAttrs = draggable ? `draggable="true" data-drag-type="task-status" data-id="${task.id}"` : "";
  return `
    <article
      class="kanban-task-card task-compact-card status-${status} ${draggable ? "is-draggable" : ""}"
      ${dragAttrs}
      data-card-menu="task"
      data-task-open="${task.id}"
    >
      ${compactTaskCardContent(task, "kanban-task-title")}
    </article>
  `;
}

function buildSchedule(tasks) {
  return WEEK_DAYS.map((day) => {
    const dayTasks = tasks.filter((task) => getTaskDay(task) === day);
    const cards = dayTasks.length ? dayTasks.map(taskCard).join("") : "<p class='task-meta'>No tasks yet.</p>";

    return `
      <section class="day-column">
        <h4>${day}</h4>
        ${cards}
      </section>
    `;
  }).join("");
}

function toIsoDateLocal(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysLocal(baseDate, dayOffset) {
  const next = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  next.setDate(next.getDate() + Number(dayOffset || 0));
  return next;
}

function getWeekStartMondayLocal(value) {
  const base = value instanceof Date ? value : new Date(value);
  const day = base.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  return addDaysLocal(base, diffToMonday);
}

function formatMonthYearLabel(value) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric"
  }).format(value);
}

function formatMonthDayShort(value) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(value);
}

function buildCalendarMiniMonthGrid(monthDate, selectedIso, todayIsoValue) {
  const firstOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const startOffset = firstOfMonth.getDay();
  const gridStart = addDaysLocal(firstOfMonth, -startOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const cellDate = addDaysLocal(gridStart, index);
    const iso = toIsoDateLocal(cellDate);
    const inMonth = cellDate.getMonth() === monthDate.getMonth();
    const classNames = [
      "calendar-mini-day",
      inMonth ? "is-in-month" : "is-outside-month",
      iso === todayIsoValue ? "is-today" : "",
      iso === selectedIso ? "is-selected" : ""
    ]
      .filter(Boolean)
      .join(" ");
    return `
      <button
        type="button"
        class="${classNames}"
        data-action="calendar-day"
        data-id="${iso}"
        aria-label="Select ${iso}"
      >
        ${cellDate.getDate()}
      </button>
    `;
  }).join("");
}

function calendarWeekTaskCard(task) {
  const status = statusClass(task.status);
  return `
    <article class="calendar-week-task task-compact-card status-${status}" data-task-open="${task.id}" data-card-menu="task" data-id="${task.id}">
      ${compactTaskCardContent(task, "calendar-week-task-title")}
    </article>
  `;
}

function calendarAgendaRow(task) {
  const status = statusClass(task.status);
  const overdueClass = isTaskOverdue(task) ? "is-overdue" : "";
  const linkMeta = task.linkLabel || task.projectName || task.accountName || "-";
  return `
    <article class="calendar-agenda-item ${overdueClass}" data-task-open="${task.id}" data-card-menu="task" data-id="${task.id}">
      <div class="calendar-agenda-time">${escapeHtml(getTaskTimeLabel(task) || "--")}</div>
      <div class="calendar-agenda-content">
        <p class="calendar-agenda-title">${escapeHtml(task.title)}</p>
        <p class="task-meta">${escapeHtml(task.assignee)} | ${escapeHtml(linkMeta)}</p>
      </div>
      <span class="calendar-agenda-status status-${status}">${escapeHtml(task.status || "New")}</span>
    </article>
  `;
}

function filteredTasks(data, context) {
  const matches = data.tasks.filter((task) => includesSearch(task, context.searchTerm));
  return sortTasksBySchedule(matches);
}

function normalizeKanbanFilterValue(value, fallback = "all") {
  const normalized = String(value || fallback).trim().toLowerCase();
  return normalized || fallback;
}

function buildKanbanAssigneeOptions(data) {
  const seen = new Set();
  const options = [{ value: "all", label: "All assignees" }];
  const currentUserId = String(data.currentUser?.id || "").trim();
  const currentUserName = String(data.currentUser?.name || "").trim();
  if (currentUserId || currentUserName) {
    options.push({ value: "mine", label: "Mine" });
  }
  [data.currentUser, ...(Array.isArray(data.teamMembers) ? data.teamMembers : [])]
    .filter((member) => member && typeof member === "object")
    .forEach((member) => {
      const id = String(member.id || "").trim();
      const name = String(member.name || "").trim();
      if (!id || !name || seen.has(id)) {
        return;
      }
      seen.add(id);
      options.push({ value: id, label: name });
    });
  return options.sort((left, right) => {
    if (left.value === "all") return -1;
    if (right.value === "all") return 1;
    if (left.value === "mine") return -1;
    if (right.value === "mine") return 1;
    return compareText(left.label, right.label);
  });
}

function matchesKanbanAssigneeFilter(task, data, assigneeFilter) {
  const normalized = String(assigneeFilter || "all").trim();
  if (!normalized || normalized === "all") {
    return true;
  }
  if (normalized === "mine") {
    return taskMatchesMember(task, data.currentUser?.id, data.currentUser?.name);
  }
  const assigneeId = String(task.assigneeId || "").trim();
  if (assigneeId) {
    return assigneeId === normalized;
  }
  const match =
    [data.currentUser, ...(Array.isArray(data.teamMembers) ? data.teamMembers : [])]
      .filter((member) => member && typeof member === "object")
      .find((member) => String(member.id || "").trim() === normalized) || null;
  if (!match) {
    return true;
  }
  return String(task.assignee || "").trim().toLowerCase() === String(match.name || "").trim().toLowerCase();
}

function matchesKanbanTypeFilter(task, filterValue) {
  const normalized = normalizeKanbanFilterValue(filterValue);
  if (normalized === "all") {
    return true;
  }
  const typeLabel = taskTypeLabel(task).toLowerCase();
  if (normalized === "call") {
    return typeLabel === "call";
  }
  if (normalized === "recurring") {
    return typeLabel === "recurring";
  }
  if (normalized === "project") {
    return typeLabel === "project";
  }
  if (normalized === "general") {
    return typeLabel === "general";
  }
  return true;
}

function matchesKanbanPriorityFilter(task, filterValue) {
  const normalized = normalizeKanbanFilterValue(filterValue);
  if (normalized === "all") {
    return true;
  }
  return normalizeTaskPriority(task.priority) === normalized;
}

function matchesKanbanDateFilter(task, filterValue) {
  const normalized = normalizeKanbanFilterValue(filterValue);
  if (normalized === "all") {
    return true;
  }
  const dueDate = String(task.dueDate || "").trim();
  const today = toIsoDateLocal(new Date());
  if (normalized === "overdue") {
    return isTaskOverdue(task);
  }
  if (normalized === "unscheduled") {
    return !dueDate;
  }
  if (!dueDate) {
    return false;
  }
  if (normalized === "today") {
    return dueDate === today;
  }
  if (normalized === "week") {
    const date = parseIsoDateLocal(dueDate);
    if (!date) {
      return false;
    }
    const weekStart = getWeekStartMonday(new Date());
    const nextWeek = new Date(weekStart);
    nextWeek.setDate(nextWeek.getDate() + 7);
    return date >= weekStart && date < nextWeek;
  }
  return true;
}

function getKanbanActiveFilterCount(context) {
  return [
    String(context.kanbanFilterAssignee || "all").trim().toLowerCase() !== "all",
    String(context.kanbanFilterType || "all").trim().toLowerCase() !== "all",
    String(context.kanbanFilterPriority || "all").trim().toLowerCase() !== "all",
    String(context.kanbanFilterDate || "all").trim().toLowerCase() !== "all",
    Boolean(String(context.kanbanFilterSearch || "").trim())
  ].filter(Boolean).length;
}

function filteredKanbanTasks(data, context) {
  const baseTasks = filteredTasks(data, context);
  const search = String(context.kanbanFilterSearch || "").trim();
  return baseTasks.filter((task) =>
    (!search || includesSearch(task, search)) &&
    matchesKanbanAssigneeFilter(task, data, context.kanbanFilterAssignee) &&
    matchesKanbanTypeFilter(task, context.kanbanFilterType) &&
    matchesKanbanPriorityFilter(task, context.kanbanFilterPriority) &&
    matchesKanbanDateFilter(task, context.kanbanFilterDate)
  );
}

function taskMatchesMember(task, memberId, memberName) {
  const normalizedMemberId = String(memberId || "").trim();
  const normalizedTaskAssigneeId = String(task.assigneeId || "").trim();
  if (normalizedMemberId && normalizedTaskAssigneeId) {
    return normalizedTaskAssigneeId === normalizedMemberId;
  }
  const normalizedMemberName = String(memberName || "").trim().toLowerCase();
  const normalizedTaskAssigneeName = String(task.assignee || "").trim().toLowerCase();
  return Boolean(normalizedMemberName) && normalizedTaskAssigneeName === normalizedMemberName;
}

function getMyWorkTasks(data, context) {
  const currentUserId = String(data.currentUser?.id || "").trim();
  const currentUserName = String(data.currentUser?.name || "").trim();
  return filteredTasks(data, context).filter((task) => taskMatchesMember(task, currentUserId, currentUserName));
}

function getTaskDueDateValue(task) {
  return parseIsoDateLocal(String(task.dueDate || "").trim());
}

function getTaskScheduledAt(task) {
  const dueDate = String(task.dueDate || "").trim();
  if (!dueDate) {
    return null;
  }
  const startTime = String(task.startTime || "").trim() || "09:00";
  return parseDateTimeLocal(`${dueDate}T${startTime}`);
}

function isUpcomingMeetingTask(task) {
  const title = String(task.title || "").trim();
  return Boolean(String(task.dueDate || "").trim()) &&
    (isCallTaskType(task.taskType) || /meeting|demo|standup|review|sync|zoom|video/i.test(title));
}

function isTaskCompletedThisWeek(task, weekStartIso, nextWeekStartIso) {
  if (String(task.status || "") !== "Completed") {
    return false;
  }
  const completedIso = toIsoDateLocal(String(task.completedAt || "").trim() || String(task.updatedAt || "").trim() || String(task.dueDate || "").trim());
  return Boolean(completedIso) && completedIso >= weekStartIso && completedIso < nextWeekStartIso;
}

function buildMyWorkTaskRows(tasks, todayIso) {
  if (!tasks.length) {
    return "<p class='task-meta my-work-empty-state' data-live-key='tasks-empty'>No personal tasks assigned right now.</p>";
  }

  return tasks
    .map((task) => {
      const isComplete = String(task.status || "") === "Completed";
      const isOverdue = !isComplete && isTaskOverdue(task);
      const dueDate = getTaskDueDateValue(task);
      const timeLabel = getTaskTimeLabel(task);
      const sideLabel = isOverdue
        ? "Overdue"
        : String(task.dueDate || "") === todayIso && timeLabel
          ? timeLabel
          : dueDate
            ? formatMonthDayShort(dueDate)
            : isComplete
              ? "Done"
              : "No date";
      const metaLabel = [String(task.accountName || task.projectName || "").trim(), taskTypeLabel(task)]
        .filter(Boolean)
        .join(" | ");
      return `
        <article class="my-work-task-row ${isComplete ? "is-complete" : ""}" data-task-open="${task.id}" data-live-key="task-${escapeHtml(String(task.id || task.title || ""))}">
          <span class="my-work-task-row-check ${isComplete ? "is-complete" : ""}" aria-hidden="true">
            ${isComplete ? '<i class="bi bi-check-lg"></i>' : ""}
          </span>
          <div class="my-work-task-row-main">
            <p class="my-work-task-row-title">${escapeHtml(task.title)}</p>
            <p class="my-work-task-row-meta">${escapeHtml(metaLabel || (isComplete ? "Completed task" : "Assigned to you"))}</p>
          </div>
          <span class="my-work-task-row-side ${isOverdue ? "is-overdue" : ""}">${escapeHtml(sideLabel)}</span>
        </article>
      `;
    })
    .join("");
}

function buildMyWorkSnapshotRows(metrics, totalTasks) {
  return metrics
    .map((metric) => {
      const width = totalTasks > 0 ? Math.max(metric.value > 0 ? 14 : 0, Math.round((metric.value / totalTasks) * 100)) : 0;
      return `
        <article class="my-work-snapshot-row tone-${metric.tone}" data-live-key="snapshot-${escapeHtml(String(metric.tone || metric.label || ""))}">
          <div class="my-work-snapshot-row-head">
            <p>${escapeHtml(metric.label)}</p>
            <strong>${escapeHtml(String(metric.value))}</strong>
          </div>
          <div class="my-work-snapshot-track" aria-hidden="true">
            <span style="width:${width}%"></span>
          </div>
          <p class="my-work-snapshot-caption">${escapeHtml(metric.caption)}</p>
        </article>
      `;
    })
    .join("");
}

function buildMyWorkMeetingRows(tasks, now, todayIso) {
  if (!tasks.length) {
    return "<p class='task-meta my-work-empty-state' data-live-key='meetings-empty'>No upcoming meetings or calls on your schedule.</p>";
  }

  return tasks
    .map((task) => {
      const scheduledAt = getTaskScheduledAt(task);
      const timeLabel = getTaskTimeLabel(task);
      const dueDate = getTaskDueDateValue(task);
      const badgeDayLabel = dueDate
        ? String(dueDate.getDate())
        : "--";
      const badgeMetaLabel = dueDate
        ? new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(dueDate).toUpperCase()
        : "TASK";
      let pillLabel = String(task.status || "Scheduled");
      let pillTone = "scheduled";
      if (scheduledAt && scheduledAt > now) {
        const diffHours = Math.round((scheduledAt.getTime() - now.getTime()) / 3600000);
        if (String(task.dueDate || "") === todayIso && diffHours >= 0 && diffHours <= 12) {
          pillLabel = diffHours <= 1 ? "Soon" : `In ${diffHours}h`;
          pillTone = "upcoming";
        }
      }
      if (String(task.status || "") === "In progress") {
        pillLabel = "In Progress";
        pillTone = "progress";
      } else if (String(task.status || "") === "Completed") {
        pillLabel = "Completed";
        pillTone = "complete";
      }
      const metaParts = [
        String(task.dueDate || "") === todayIso ? "Today" : dueDate ? formatMonthDayShort(dueDate) : "",
        timeLabel,
        String(task.accountName || task.projectName || task.linkLabel || "").trim()
      ].filter(Boolean);
      return `
        <article class="my-work-meeting-row" data-task-open="${task.id}" data-live-key="meeting-${escapeHtml(String(task.id || task.title || ""))}">
          <span class="my-work-meeting-badge" aria-hidden="true">
            <strong>${escapeHtml(badgeDayLabel)}</strong>
            <small>${escapeHtml(badgeMetaLabel)}</small>
          </span>
          <div class="my-work-meeting-main">
            <p class="my-work-meeting-title">${escapeHtml(task.title)}</p>
            <p class="my-work-meeting-meta">${escapeHtml(metaParts.join(" | "))}</p>
          </div>
          <span class="my-work-meeting-pill tone-${pillTone}">${escapeHtml(pillLabel)}</span>
        </article>
      `;
    })
    .join("");
}

function myWorkTaskCard(task, options = {}) {
  const status = statusClass(task.status);
  const overdueClass = isTaskOverdue(task) ? "is-overdue" : "";
  const draggable = Boolean(options.draggable);
  const dragType = String(options.dragType || "");
  const dragAttrs =
    draggable && dragType
      ? `draggable="true" data-drag-type="${dragType}" data-id="${task.id}"`
      : "";
  return `
    <article
      class="my-work-task-card task-compact-card status-${status} ${overdueClass} ${draggable ? "is-draggable" : ""}"
      ${dragAttrs}
      data-card-menu="task"
      data-id="${task.id}"
      data-task-open="${task.id}"
    >
      ${compactTaskCardContent(task, "my-work-task-title")}
    </article>
  `;
}

function renderMyWorkQueueSection(title, tasks, emptyLabel) {
  return `
    <section class="my-work-queue-section">
      <header class="my-work-queue-head">
        <h4>${title}</h4>
        <span>${tasks.length}</span>
      </header>
      <div class="my-work-queue-list">
        ${tasks.length ? tasks.map((task) => myWorkTaskCard(task, { draggable: canTaskEditCore(task), dragType: "task-day" })).join("") : `<p class='task-meta'>${emptyLabel}</p>`}
      </div>
    </section>
  `;
}

export function renderMyWork(data, context) {
  const tasks = getMyWorkTasks(data, context);
  const now = new Date();
  const todayIso = toIsoDateLocal(now);
  const openTasks = tasks.filter((task) => String(task.status || "") !== "Completed");
  const overdueTasks = openTasks.filter((task) => isTaskOverdue(task));
  const todayTasks = openTasks.filter((task) => String(task.dueDate || "") === todayIso && !isTaskOverdue(task));
  const unscheduledTasks = openTasks.filter((task) => !String(task.dueDate || "").trim());
  const inProgressCount = openTasks.filter((task) => String(task.status || "") === "In progress").length;
  const weekStart = getWeekStartMondayLocal(now);
  const weekStartIso = toIsoDateLocal(weekStart);
  const nextWeekStartIso = toIsoDateLocal(addDaysLocal(weekStart, 7));
  const completedThisWeekCount = tasks.filter((task) => isTaskCompletedThisWeek(task, weekStartIso, nextWeekStartIso)).length;
  const recentCompletedTasks = [...tasks]
    .filter((task) => String(task.status || "") === "Completed")
    .sort((left, right) =>
      String(right.completedAt || right.updatedAt || right.dueDate || "").localeCompare(
        String(left.completedAt || left.updatedAt || left.dueDate || "")
      )
    );
  const myTaskPreview = [...openTasks.slice(0, 5)];
  if (myTaskPreview.length < 6) {
    myTaskPreview.push(...recentCompletedTasks.slice(0, 6 - myTaskPreview.length));
  }
  const snapshotMetrics = [
    { label: "Overdue", value: overdueTasks.length, caption: overdueTasks.length ? "Needs attention now" : "Nothing overdue", tone: "overdue" },
    { label: "Due Today", value: todayTasks.length, caption: todayTasks.length ? "Scheduled for today" : "No tasks due today", tone: "today" },
    { label: "In Progress", value: inProgressCount, caption: inProgressCount ? "Already moving" : "Nothing in progress", tone: "progress" },
    { label: "Completed This Week", value: completedThisWeekCount, caption: completedThisWeekCount ? "Closed out this week" : "No completed tasks this week", tone: "done" }
  ];
  const upcomingMeetings = tasks
    .filter((task) => String(task.status || "") !== "Completed")
    .filter((task) => isUpcomingMeetingTask(task))
    .filter((task) => String(task.dueDate || "").trim() >= todayIso)
    .slice(0, 4);
  const snapshotTone = overdueTasks.length ? "at-risk" : "on-track";
  const snapshotBadge = overdueTasks.length ? "Needs attention" : "On Track";
  const hasTaskPreview = myTaskPreview.length > 0;
  const hasUpcomingMeetings = upcomingMeetings.length > 0;

  return {
    title: "My Work",
    subtitle: "Personal dashboard for your assigned tasks and meetings",
    primaryAction: "",
    showWaitingPanel: false,
    html: `
      <section class="view-block my-work-v2" data-my-work-live-root>
        <section class="my-work-grid">
          <article class="my-work-card my-work-card-tasks ${hasTaskPreview ? "" : "is-empty"}" data-my-work-card="tasks">
            <header class="my-work-card-head">
              <div class="my-work-card-heading">
                <span class="my-work-card-icon tone-tasks" aria-hidden="true"><i class="bi bi-list-check"></i></span>
                <div class="my-work-card-title-wrap">
                  <h3>My Tasks</h3>
                </div>
              </div>
              <div class="my-work-card-head-actions">
                <button class="btn btn-accent" type="button" data-action="table-add-task" data-id="create-task">
                  <i class="bi bi-plus-lg" aria-hidden="true"></i>
                  <span>Add Task</span>
                </button>
              </div>
            </header>
            <div class="my-work-task-list ${hasTaskPreview ? "" : "is-empty"}" data-my-work-region="tasks-list">
              ${buildMyWorkTaskRows(myTaskPreview, todayIso)}
            </div>
          </article>
          <article class="my-work-card my-work-card-snapshot">
            <header class="my-work-card-head">
              <div class="my-work-card-heading">
                <span class="my-work-card-icon tone-snapshot" aria-hidden="true"><i class="bi bi-bar-chart-line"></i></span>
                <div class="my-work-card-title-wrap">
                  <h3>My Snapshot</h3>
                </div>
              </div>
              <span class="my-work-card-badge tone-${snapshotTone}" data-my-work-region="snapshot-badge">${escapeHtml(snapshotBadge)}</span>
            </header>
            <div class="my-work-snapshot-list" data-my-work-region="snapshot-list">
              ${buildMyWorkSnapshotRows(snapshotMetrics, Math.max(tasks.length, 1))}
            </div>
            <footer class="my-work-card-foot" data-my-work-region="snapshot-foot">
              <p class="task-meta">${escapeHtml(`${unscheduledTasks.length} unscheduled | ${tasks.length} total assigned`)}</p>
            </footer>
          </article>
        </section>
        <article class="my-work-card my-work-card-meetings ${hasUpcomingMeetings ? "" : "is-empty"}" data-my-work-card="meetings">
          <header class="my-work-card-head">
            <div class="my-work-card-heading">
              <span class="my-work-card-icon tone-meetings" aria-hidden="true"><i class="bi bi-calendar-event"></i></span>
              <div class="my-work-card-title-wrap">
                <h3>Upcoming Meetings</h3>
              </div>
            </div>
          </header>
          <div class="my-work-meeting-list ${hasUpcomingMeetings ? "" : "is-empty"}" data-my-work-region="meetings-list">
            ${buildMyWorkMeetingRows(upcomingMeetings, now, todayIso)}
          </div>
        </article>
      </section>
    `
  };
}

export function renderCalendar(data, context) {
  const tasks = filteredTasks(data, context);
  const selectedDate = parseIsoDateLocal(context.calendarDate) || new Date();
  const selectedIso = toIsoDateLocal(selectedDate);
  const monthDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
  const todayIsoValue = toIsoDateLocal(new Date());
  const mode = context.calendarMode === "agenda" ? "agenda" : "week";
  const miniCollapsed = Boolean(context.calendarMiniCollapsed);
  const sideCollapsed = Boolean(context.calendarSideCollapsed);
  const weekStart = getWeekStartMondayLocal(selectedDate);
  const weekDates = Array.from({ length: 5 }, (_, index) => addDaysLocal(weekStart, index));
  const weekStartIso = toIsoDateLocal(weekDates[0]);
  const weekEndIso = toIsoDateLocal(weekDates[weekDates.length - 1]);
  const weekTasksByIso = new Map(weekDates.map((date) => [toIsoDateLocal(date), []]));

  tasks.forEach((task) => {
    const dueDate = String(task.dueDate || "").trim();
    if (weekTasksByIso.has(dueDate)) {
      weekTasksByIso.get(dueDate).push(task);
    }
  });

  const weekColumns = weekDates
    .map((date) => {
      const iso = toIsoDateLocal(date);
      const dayLabel = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date).toUpperCase();
      const dateLabel = formatMonthDayShort(date);
      const dayTasks = weekTasksByIso.get(iso) || [];
      return `
        <section class="calendar-week-column ${iso === selectedIso ? "is-selected" : ""}">
          <header class="calendar-week-column-head">
            <button type="button" class="calendar-week-day-btn" data-action="calendar-day" data-id="${iso}">
              <span>${dayLabel}</span>
              <strong>${dateLabel}</strong>
            </button>
            <button type="button" class="calendar-week-add-btn" data-action="calendar-quick-add" data-id="${iso}" aria-label="Add task on ${iso}">
              <i class="bi bi-plus"></i>
            </button>
          </header>
          <div class="calendar-week-column-body">
            ${dayTasks.length ? dayTasks.map(calendarWeekTaskCard).join("") : "<p class='task-meta'>No tasks.</p>"}
          </div>
        </section>
      `;
    })
    .join("");

  const selectedDayTasks = weekTasksByIso.get(selectedIso) || [];
  const laterWeekTasks = weekDates
    .map((date) => toIsoDateLocal(date))
    .filter((iso) => iso !== selectedIso)
    .flatMap((iso) => weekTasksByIso.get(iso) || []);

  const agendaSelectedSection = `
    <section class="calendar-agenda-section">
      <header class="calendar-agenda-head">
        <h4>${selectedIso === todayIsoValue ? "Today" : "Selected Day"}</h4>
        <button type="button" class="mini-btn mini-btn-primary" data-action="calendar-quick-add" data-id="${selectedIso}">Add Task</button>
      </header>
      <div class="calendar-agenda-list">
        ${selectedDayTasks.length ? selectedDayTasks.map(calendarAgendaRow).join("") : "<p class='task-meta'>No tasks on this day.</p>"}
      </div>
    </section>
  `;

  const agendaLaterSection = `
    <section class="calendar-agenda-section">
      <header class="calendar-agenda-head">
        <h4>Later This Week</h4>
      </header>
      <div class="calendar-agenda-list">
        ${laterWeekTasks.length ? laterWeekTasks.map(calendarAgendaRow).join("") : "<p class='task-meta'>No upcoming tasks this week.</p>"}
      </div>
    </section>
  `;

  const followUps = [...(data.leads || [])]
    .filter((lead) => parseIsoDateLocal(lead.nextFollowUp))
    .sort((a, b) => String(a.nextFollowUp || "").localeCompare(String(b.nextFollowUp || "")))
    .slice(0, 6);

  const followUpItems = followUps.length
    ? followUps
        .map((lead) => {
          const date = parseIsoDateLocal(lead.nextFollowUp);
          const label = date ? formatMonthDayShort(date) : lead.nextFollowUp;
          return `
            <article class="calendar-side-item">
              <p class="calendar-side-item-title">${escapeHtml(lead.name)} @ ${escapeHtml(lead.company)}</p>
              <p class="task-meta">${escapeHtml(lead.owner)} | ${escapeHtml(label)}</p>
            </article>
          `;
        })
        .join("")
    : "<p class='task-meta'>No lead follow-ups.</p>";

  const waitingItems = (data.waitingList || []).slice(0, 6);
  const waitingRows = waitingItems.length
    ? waitingItems
        .map(
          (item) => `
            <article class="calendar-side-item">
              <p class="calendar-side-item-title">${escapeHtml(item.title)}</p>
              <p class="task-meta">${escapeHtml(item.owner)} | ${escapeHtml(item.linkedType)}</p>
            </article>
          `
        )
        .join("")
    : "<p class='task-meta'>No waiting items.</p>";

  return {
    title: "Calendar",
    subtitle: "Hybrid planner with week and agenda views",
    primaryAction: "Add Task",
    showWaitingPanel: false,
      html: `
        <section class="view-block calendar-hybrid ${miniCollapsed ? "is-mini-collapsed" : ""}">
          <aside class="calendar-mini-rail">
          <div class="calendar-mini-toggle-row">
            <button
              type="button"
              class="calendar-mini-toggle-btn"
              data-action="calendar-mini-toggle"
              data-id="toggle"
              aria-label="${miniCollapsed ? "Expand mini-month panel" : "Collapse mini-month panel"}"
              title="${miniCollapsed ? "Expand mini-month panel" : "Collapse mini-month panel"}"
            >
              <i class="bi bi-calendar3" aria-hidden="true"></i>
            </button>
          </div>
          <div class="calendar-mini-content" ${miniCollapsed ? "hidden" : ""}>
            <header class="calendar-mini-head">
              <button type="button" class="calendar-nav-btn" data-action="calendar-month-nav" data-id="prev" aria-label="Previous month">
                <i class="bi bi-chevron-left"></i>
              </button>
              <strong>${escapeHtml(formatMonthYearLabel(monthDate))}</strong>
              <button type="button" class="calendar-nav-btn" data-action="calendar-month-nav" data-id="next" aria-label="Next month">
                <i class="bi bi-chevron-right"></i>
              </button>
            </header>
            <div class="calendar-mini-weekdays">
              <span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span>
            </div>
            <div class="calendar-mini-grid">
              ${buildCalendarMiniMonthGrid(monthDate, selectedIso, todayIsoValue)}
            </div>
            <button type="button" class="mini-btn mini-btn-primary calendar-today-btn" data-action="calendar-jump-today" data-id="today">
              Jump to Today
            </button>
          </div>
        </aside>
        <section class="calendar-main-pane">
          <header class="calendar-main-head">
            <div>
              <h3 class="block-title">Week of ${escapeHtml(formatMonthDayShort(weekDates[0]))} - ${escapeHtml(formatMonthDayShort(weekDates[4]))}</h3>
              <p class="task-meta">Selected date: ${escapeHtml(formatMonthDayShort(selectedDate))}</p>
            </div>
            <div class="calendar-mode-switch" role="tablist" aria-label="Calendar mode">
              <button type="button" class="calendar-mode-btn ${mode === "week" ? "is-active" : ""}" data-action="calendar-mode" data-id="week">Week</button>
              <button type="button" class="calendar-mode-btn ${mode === "agenda" ? "is-active" : ""}" data-action="calendar-mode" data-id="agenda">Agenda</button>
            </div>
          </header>
            ${
              mode === "week"
                ? `
                  <div class="calendar-week-grid stagger">
                    ${weekColumns}
                </div>
              `
              : `
                <div class="calendar-agenda-wrap stagger">
                  ${agendaSelectedSection}
                  ${agendaLaterSection}
                </div>
                `
            }
          </section>
        </section>
      `
    };
  }

export function renderKanban(data, context) {
  const statuses = ["New", "Scheduled", "In progress", "Completed"];
  const tasks = filteredKanbanTasks(data, context);
  const assigneeOptions = buildKanbanAssigneeOptions(data)
    .map((option) => {
      const selected = String(context.kanbanFilterAssignee || "all").trim() === option.value ? "selected" : "";
      return `<option value="${escapeHtml(option.value)}" ${selected}>${escapeHtml(option.label)}</option>`;
    })
    .join("");
  const countsByStatus = new Map(
    statuses.map((status) => [status, tasks.filter((task) => task.status === status).length])
  );
  const maxCount = Math.max(1, ...[...countsByStatus.values()]);
  const activeFilterCount = getKanbanActiveFilterCount(context);
  const filterPopover = context.kanbanFiltersOpen
    ? `
      <form id="kanbanFilterForm" class="kanban-filter-popover" autocomplete="off">
        <div class="kanban-filter-popover-head">
          <div class="kanban-filter-popover-copy">
            <h4>Filters</h4>
            <p>Narrow the board without leaving Kanban.</p>
          </div>
          <button type="button" class="mini-btn" data-action="kanban-filters-close" data-id="close">Close</button>
        </div>
        <div class="kanban-filter-popover-grid">
          <label class="kanban-filter-popover-field is-full">
            <span>Search</span>
            <div class="kanban-filter-search">
              <i class="bi bi-search" aria-hidden="true"></i>
              <input
                type="search"
                name="searchTerm"
                value="${escapeHtml(String(context.kanbanFilterSearch || ""))}"
                placeholder="Search tasks, links, or assignees"
              />
            </div>
          </label>
          <label class="kanban-filter-popover-field">
            <span>Assignee</span>
            <div class="kanban-filter-select">
              <select name="assignee">
                ${assigneeOptions}
              </select>
              <i class="bi bi-chevron-down" aria-hidden="true"></i>
            </div>
          </label>
          <label class="kanban-filter-popover-field">
            <span>Type</span>
            <div class="kanban-filter-select">
              <select name="taskType">
                <option value="all" ${normalizeKanbanFilterValue(context.kanbanFilterType) === "all" ? "selected" : ""}>All types</option>
                <option value="task" ${normalizeKanbanFilterValue(context.kanbanFilterType) === "task" ? "selected" : ""}>Task</option>
                <option value="call" ${normalizeKanbanFilterValue(context.kanbanFilterType) === "call" ? "selected" : ""}>Call</option>
                <option value="recurring" ${normalizeKanbanFilterValue(context.kanbanFilterType) === "recurring" ? "selected" : ""}>Recurring</option>
                <option value="project" ${normalizeKanbanFilterValue(context.kanbanFilterType) === "project" ? "selected" : ""}>Project</option>
              </select>
              <i class="bi bi-chevron-down" aria-hidden="true"></i>
            </div>
          </label>
          <label class="kanban-filter-popover-field">
            <span>Priority</span>
            <div class="kanban-filter-select">
              <select name="priority">
                <option value="all" ${normalizeKanbanFilterValue(context.kanbanFilterPriority) === "all" ? "selected" : ""}>All priorities</option>
                <option value="high" ${normalizeKanbanFilterValue(context.kanbanFilterPriority) === "high" ? "selected" : ""}>High</option>
                <option value="medium" ${normalizeKanbanFilterValue(context.kanbanFilterPriority) === "medium" ? "selected" : ""}>Medium</option>
                <option value="low" ${normalizeKanbanFilterValue(context.kanbanFilterPriority) === "low" ? "selected" : ""}>Low</option>
              </select>
              <i class="bi bi-chevron-down" aria-hidden="true"></i>
            </div>
          </label>
          <label class="kanban-filter-popover-field">
            <span>Date</span>
            <div class="kanban-filter-select">
              <select name="dateFilter">
                <option value="all" ${normalizeKanbanFilterValue(context.kanbanFilterDate) === "all" ? "selected" : ""}>All dates</option>
                <option value="today" ${normalizeKanbanFilterValue(context.kanbanFilterDate) === "today" ? "selected" : ""}>Today</option>
                <option value="week" ${normalizeKanbanFilterValue(context.kanbanFilterDate) === "week" ? "selected" : ""}>This week</option>
                <option value="overdue" ${normalizeKanbanFilterValue(context.kanbanFilterDate) === "overdue" ? "selected" : ""}>Overdue</option>
              </select>
              <i class="bi bi-chevron-down" aria-hidden="true"></i>
            </div>
          </label>
        </div>
        <div class="kanban-filter-popover-actions">
          <button type="button" class="ghost-btn" data-action="kanban-filters-clear" data-id="clear">Reset</button>
          <button type="submit" class="btn btn-accent">Apply</button>
        </div>
      </form>
    `
    : "";

  const columns = statuses
    .map((status) => {
      const statusToken = statusClass(status);
      const statusTasks = tasks.filter((task) => task.status === status);
      const cards = statusTasks.map((task) => kanbanTaskCard(task)).join("");
      const count = countsByStatus.get(status) || 0;
      const trackWidth = count ? Math.max(12, Math.round((count / maxCount) * 100)) : 0;
      const empty = !statusTasks.length;

      return `
        <section
          class="kanban-column status-${statusToken}"
          data-drop-type="task-status"
          data-drop-value="${status}"
        >
          <header class="kanban-column-head">
            <div class="kanban-column-title-row">
              <h4 class="kanban-column-title">${status}</h4>
              <span class="kanban-column-count">${count}</span>
            </div>
            <div class="kanban-column-track">${trackWidth ? `<span style="width:${trackWidth}%"></span>` : ""}</div>
          </header>
          <div class="kanban-column-body ${empty ? "is-empty" : ""}">
            ${cards || "<div class='kanban-column-empty'><p>No tasks.</p></div>"}
          </div>
        </section>
      `;
    })
    .join("");

  return {
    title: "Kanban",
    subtitle: "Task workflow by status (drag and drop)",
    primaryAction: "Add Task",
    showWaitingPanel: true,
    waitingTitle: "Waiting List",
    waitingSubtitle: "Drag into a column when ready",
    waitingItems: data.waitingList,
    html: `
      <section class="view-block kanban-board-v2">
        <div class="view-section-head">
          <div class="kanban-board-heading">
            <h3 class="block-title">Board</h3>
            <p class="task-meta">${escapeHtml(String(tasks.length))} visible task${tasks.length === 1 ? "" : "s"}</p>
          </div>
          <div class="kanban-board-actions">
            <div class="kanban-filter-shell">
              <button class="mini-btn kanban-filter-btn ${activeFilterCount ? "is-active" : ""}" type="button" data-action="kanban-open-filters" data-id="open" aria-expanded="${context.kanbanFiltersOpen ? "true" : "false"}">
                <i class="bi bi-funnel" aria-hidden="true"></i>
                <span>Filters</span>
                ${activeFilterCount ? `<small>${escapeHtml(String(activeFilterCount))}</small>` : ""}
              </button>
              ${filterPopover}
            </div>
            <button class="table-ops-columns-btn" type="button" data-action="view-add-record" data-id="create">
              <i class="bi bi-plus-lg" aria-hidden="true"></i>
              <span>Add Task</span>
            </button>
          </div>
        </div>
        <div class="kanban-grid stagger">
          ${columns}
        </div>
      </section>
    `
  };
}

export function renderTable(data, context) {
  const currentUserName = String(data.currentUser?.name || "").trim().toLowerCase();
  const scope = String(context.tableScope || "all").toLowerCase();
  const currentOnly = Boolean(context.tableCurrentOnly);
  const rawSortKey = String(context.tableSortKey || "").trim();
  const sortKey = TABLE_SORT_KEYS.has(rawSortKey) ? rawSortKey : "";
  const sortDir = context.tableSortDir === "desc" ? "desc" : context.tableSortDir === "asc" ? "asc" : "none";
  const pageSize = [10, 20, 50].includes(Number(context.tablePageSize)) ? Number(context.tablePageSize) : 20;
  const visibleTasks = filteredTasks(data, context).filter((task) => {
    if (scope === "open" && String(task.status || "") === "Completed") {
      return false;
    }
    if (scope === "completed" && String(task.status || "") !== "Completed") {
      return false;
    }
    if (currentOnly) {
      return String(task.assignee || "").trim().toLowerCase() === currentUserName;
    }
    return true;
  });
  const tasks = sortTasksForTable(visibleTasks, sortKey, sortDir);
  const selectedSet = new Set(context.selectedTaskIds || []);
  const selectedTasks = tasks.filter((task) => selectedSet.has(task.id));
  const selectedCount = selectedTasks.length;
  const allVisibleSelected = tasks.length > 0 && tasks.every((task) => selectedSet.has(task.id));
  const bulkStatusDisabled = !selectedCount || !selectedTasks.every((task) => canTaskUpdateProgress(task)) ? "disabled" : "";
  const bulkShiftDisabled = !selectedCount || !selectedTasks.every((task) => canTaskEditCore(task)) ? "disabled" : "";
  const bulkDeleteDisabled = !selectedCount || !selectedTasks.every((task) => canTaskDelete(task)) ? "disabled" : "";
  const totalRecords = tasks.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const currentPage = Math.min(totalPages, Math.max(1, Number(context.tablePage || 1)));
  const startIndex = (currentPage - 1) * pageSize;
  const pagedTasks = tasks.slice(startIndex, startIndex + pageSize);
  const fromRecord = totalRecords ? startIndex + 1 : 0;
  const toRecord = totalRecords ? Math.min(totalRecords, startIndex + pageSize) : 0;

  const rows = pagedTasks
    .map((task) => {
      const quick = getTaskQuickAction(task);
      const checked = selectedSet.has(task.id) ? "checked" : "";
      const dueDate = parseIsoDateLocal(task.dueDate);
      const taskDate = dueDate
        ? `${String(dueDate.getDate()).padStart(2, "0")}-${dueDate.toLocaleString("en-US", { month: "short" })}-${dueDate.getFullYear()}`
        : "-";
      const accountName = String(task.accountName || task.projectName || "").trim() || "-";
      const taskType = taskTypeLabel(task);
      const description = taskDescriptionLabel(task) || "-";
      const initials = initialsFromName(task.assignee);

      return `
        <tr data-task-open="${task.id}">
          <td class="table-col-check">
            <input type="checkbox" name="taskSelect" value="${task.id}" ${checked} aria-label="Select ${escapeHtml(task.title)}" />
          </td>
          <td><span class="priority-pill priority-${normalizeTaskPriority(task.priority)}">${priorityLabel(task.priority)}</span></td>
          <td>${taskDate}</td>
          <td>${escapeHtml(accountName)}</td>
          <td>${escapeHtml(taskType)}</td>
          <td class="table-status-text">${escapeHtml(task.status || "-")}</td>
          <td class="table-col-description">${escapeHtml(description)}</td>
          <td class="table-col-initials">${escapeHtml(initials)}</td>
          <td class="row-actions row-actions-table">
            <details class="table-actions-menu">
              <summary class="table-menu-toggle" aria-label="Task actions">
                <i class="bi bi-three-dots-vertical" aria-hidden="true"></i>
              </summary>
              <div class="table-actions-dropdown">
                <button class="table-menu-item" type="button" data-action="task-open" data-id="${task.id}">Open</button>
                ${
                  quick
                    ? `<button class="table-menu-item" type="button" data-action="${quick.action}" data-id="${task.id}">${quick.label}</button>`
                    : ""
                }
                ${
                  canTaskUpdateProgress(task)
                    ? `<button class="table-menu-item" type="button" data-action="task-next-status" data-id="${task.id}">Next Status</button>`
                    : ""
                }
                ${
                  canTaskDelete(task)
                    ? `<button class="table-menu-item is-danger" type="button" data-action="task-delete" data-id="${task.id}">Delete</button>`
                    : ""
                }
              </div>
            </details>
          </td>
        </tr>
      `;
    })
    .join("");

  return {
    title: "Table",
    subtitle: "Operations task list",
    primaryAction: "",
    showWaitingPanel: false,
    html: `
      <section class="view-block table-ops-shell">
        <div class="table-ops-controls">
          <label class="table-ops-field">
            <select id="tableTaskScope">
              <option value="all" ${scope === "all" ? "selected" : ""}>All Tasks</option>
              <option value="open" ${scope === "open" ? "selected" : ""}>Open Tasks</option>
              <option value="completed" ${scope === "completed" ? "selected" : ""}>Completed</option>
            </select>
          </label>
          <label class="table-ops-checkbox">
            <input type="checkbox" id="tableCurrentOnly" ${currentOnly ? "checked" : ""} />
            <span>Current Only</span>
          </label>
          <label class="table-ops-search">
            <input type="search" id="tableInlineSearch" placeholder="Search" value="${escapeHtml(context.searchTerm || "")}" />
            <i class="bi bi-search" aria-hidden="true"></i>
          </label>
          <button class="table-ops-columns-btn" type="button" data-action="table-add-task" data-id="create-task">
            <i class="bi bi-plus-lg" aria-hidden="true"></i>
            <span>Add Task</span>
          </button>
        </div>
        ${
          selectedCount
            ? `
              <div class="table-bulk-toolbar">
                <p class="task-meta"><strong>${selectedCount}</strong> selected</p>
                <div class="row-actions">
                  <button class="mini-btn" type="button" data-action="task-bulk-status" data-id="Scheduled" ${bulkStatusDisabled}>Set Scheduled</button>
                  <button class="mini-btn" type="button" data-action="task-bulk-status" data-id="In progress" ${bulkStatusDisabled}>Set In Progress</button>
                  <button class="mini-btn" type="button" data-action="task-bulk-status" data-id="Completed" ${bulkStatusDisabled}>Set Completed</button>
                  <button class="mini-btn" type="button" data-action="task-bulk-shift" data-id="1" ${bulkShiftDisabled}>+1 Day</button>
                  <button class="mini-btn" type="button" data-action="task-bulk-shift" data-id="-1" ${bulkShiftDisabled}>-1 Day</button>
                  <button class="mini-btn" type="button" data-action="task-bulk-clear-selection">Clear</button>
                  <button class="mini-btn mini-btn-danger" type="button" data-action="task-bulk-delete" data-id="selected" ${bulkDeleteDisabled}>Delete</button>
                </div>
              </div>
            `
            : ""
        }
        <div class="table-ops-wrap">
          <table class="data-table data-table-ops">
            <thead>
              <tr>
                <th class="table-col-check">
                  <input
                    id="taskSelectAll"
                    type="checkbox"
                    aria-label="Select all visible tasks"
                    ${allVisibleSelected ? "checked" : ""}
                  />
                </th>
                <th>${tableHeaderSortButton("Priority", "priority", sortKey, sortDir)}</th>
                <th>${tableHeaderSortButton("Task Date", "taskDate", sortKey, sortDir)}</th>
                <th>${tableHeaderSortButton("Account Name", "accountName", sortKey, sortDir)}</th>
                <th>${tableHeaderSortButton("Task Type", "taskType", sortKey, sortDir)}</th>
                <th>${tableHeaderSortButton("Task Status", "status", sortKey, sortDir)}</th>
                <th>${tableHeaderSortButton("Description", "description", sortKey, sortDir)}</th>
                <th>${tableHeaderSortButton("Initials", "initials", sortKey, sortDir)}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${rows || "<tr><td colspan='9' class='task-meta'>No tasks found.</td></tr>"}
            </tbody>
          </table>
        </div>
        <footer class="table-ops-footer">
          <label class="table-ops-page-size">
            <span>Show</span>
            <select id="tablePageSize">
              <option value="10" ${pageSize === 10 ? "selected" : ""}>10</option>
              <option value="20" ${pageSize === 20 ? "selected" : ""}>20</option>
              <option value="50" ${pageSize === 50 ? "selected" : ""}>50</option>
            </select>
            <span>records</span>
          </label>
          <p class="task-meta">Records ${fromRecord} to ${toRecord} of ${totalRecords}</p>
          <div class="table-ops-pages">
            <span>${totalPages} page${totalPages === 1 ? "" : "s"}</span>
            <button type="button" data-action="table-page" data-id="${currentPage - 1}" ${currentPage <= 1 ? "disabled" : ""}><i class="bi bi-chevron-left" aria-hidden="true"></i></button>
            <button type="button" class="is-active" data-action="table-page" data-id="${currentPage}">${currentPage}</button>
            <button type="button" data-action="table-page" data-id="${currentPage + 1}" ${currentPage >= totalPages ? "disabled" : ""}><i class="bi bi-chevron-right" aria-hidden="true"></i></button>
          </div>
        </footer>
      </section>
    `
  };
}

const PROJECT_FILTERS = new Set(["all", "mine", "at-risk", "completed"]);
const PROJECT_SORT_OPTIONS = new Set([
  "recent:desc",
  "name:asc",
  "name:desc",
  "owner:asc",
  "progress:desc",
  "progress:asc",
  "deadline:asc",
  "risk:desc"
]);

function normalizeProjectStatus(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "blocked") {
    return "Blocked";
  }
  if (normalized === "needs focus") {
    return "Needs Focus";
  }
  return "On Track";
}

function projectStatusClass(value) {
  const status = normalizeProjectStatus(value);
  if (status === "Blocked") {
    return "project-status-blocked";
  }
  if (status === "Needs Focus") {
    return "project-status-needs-focus";
  }
  return "project-status-on-track";
}

function projectRiskRank(value) {
  const status = normalizeProjectStatus(value);
  if (status === "Blocked") {
    return 2;
  }
  if (status === "Needs Focus") {
    return 1;
  }
  return 0;
}

function normalizeProjectProgress(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function parseProjectDate(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }
  const parsed = parseIsoDateLocal(raw);
  if (parsed) {
    return parsed;
  }
  const fallback = new Date(raw);
  if (Number.isNaN(fallback.valueOf())) {
    return null;
  }
  return fallback;
}

function formatProjectDeadline(value) {
  const parsed = parseProjectDate(value);
  if (!parsed) {
    return "No deadline";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(parsed);
}

function formatProjectActivityTime(value) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) {
    return "";
  }
  const elapsedMs = Date.now() - parsed;
  if (elapsedMs < 60_000) {
    return "just now";
  }
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`;
  }
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours}h ago`;
  }
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) {
    return `${elapsedDays}d ago`;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(new Date(parsed));
}

function isTaskLinkedToProject(task, project) {
  if (!task || !project) {
    return false;
  }
  const projectId = String(project.id || "").trim();
  const projectName = String(project.name || "").trim().toLowerCase();
  const taskProjectId = String(task.projectId || "").trim();
  const taskProjectName = String(task.projectName || "")
    .trim()
    .toLowerCase();
  const taskLinkType = String(task.linkType || "").trim().toLowerCase();
  const taskLinkId = String(task.linkId || "").trim();
  const taskLinkLabel = String(task.linkLabel || "")
    .trim()
    .toLowerCase();
  if (taskProjectId && projectId && taskProjectId === projectId) {
    return true;
  }
  if (taskLinkType === "project" && taskLinkId && projectId && taskLinkId === projectId) {
    return true;
  }
  if (taskProjectName && projectName && taskProjectName === projectName) {
    return true;
  }
  if (taskLinkType === "project" && taskLinkLabel && projectName && taskLinkLabel === projectName) {
    return true;
  }
  return false;
}

function getProjectTasks(data, project) {
  const tasks = (Array.isArray(data.tasks) ? data.tasks : []).filter((task) =>
    isTaskLinkedToProject(task, project)
  );
  return sortTasksBySchedule(tasks);
}

function getProjectTaskStats(tasks) {
  const total = tasks.length;
  const completed = tasks.filter((task) => String(task.status || "") === "Completed").length;
  const overdue = tasks.filter((task) => isTaskOverdue(task)).length;
  const open = total - completed;
  return { total, completed, open, overdue };
}

function projectMatchesSearch(project, query, tasks = []) {
  if (!query) {
    return true;
  }
  const taskHints = tasks
    .slice(0, 6)
    .map((task) => [task.title, task.assignee, task.notes].join(" "))
    .join(" ");
  const haystack = [
    project.name,
    project.owner,
    project.status,
    project.description,
    project.accountName,
    project.account,
    project.risks,
    taskHints
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function compareProjectRows(a, b, sortKey) {
  if (sortKey === "name") {
    return compareText(a.project.name, b.project.name);
  }
  if (sortKey === "owner") {
    return compareText(a.project.owner, b.project.owner);
  }
  if (sortKey === "progress") {
    return a.progress - b.progress;
  }
  if (sortKey === "risk") {
    return projectRiskRank(a.status) - projectRiskRank(b.status);
  }
  if (sortKey === "deadline") {
    const aDeadline = parseProjectDate(a.project.deadline);
    const bDeadline = parseProjectDate(b.project.deadline);
    if (!aDeadline && !bDeadline) {
      return 0;
    }
    if (!aDeadline) {
      return 1;
    }
    if (!bDeadline) {
      return -1;
    }
    return aDeadline.valueOf() - bDeadline.valueOf();
  }
  const aRecent = Date.parse(String(a.project.updatedAt || a.project.createdAt || "")) || 0;
  const bRecent = Date.parse(String(b.project.updatedAt || b.project.createdAt || "")) || 0;
  return aRecent - bRecent;
}

function sortProjectRows(rows, sortToken) {
  const normalized = PROJECT_SORT_OPTIONS.has(sortToken) ? sortToken : "recent:desc";
  const [sortKey, directionToken] = normalized.split(":");
  const direction = directionToken === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const compared = compareProjectRows(a, b, sortKey);
    if (compared !== 0) {
      return compared * direction;
    }
    const fallback = compareText(a.project.name, b.project.name);
    if (fallback !== 0) {
      return fallback;
    }
    return compareText(a.project.id, b.project.id);
  });
}

function getProjectTeam(project, projectTasks) {
  const members = new Set();
  const owner = String(project.owner || "").trim();
  if (owner) {
    members.add(owner);
  }
  (Array.isArray(project.teamMembers) ? project.teamMembers : []).forEach((member) => {
    const normalized = String(member || "").trim();
    if (normalized) {
      members.add(normalized);
    }
  });
  projectTasks.forEach((task) => {
    const assignee = String(task.assignee || "").trim();
    if (assignee) {
      members.add(assignee);
    }
  });
  return [...members];
}

function buildProjectActivity(data, project, projectTasks) {
  const projectEvents = (Array.isArray(project.activity) ? project.activity : []).map((entry) => ({
    at: String(entry.createdAt || "").trim(),
    title: String(entry.text || "").trim() || "Project updated",
    meta: String(entry.actor || "System").trim() || "System"
  }));

  const taskEvents = (Array.isArray(projectTasks) ? projectTasks : [])
    .flatMap((task) =>
      (Array.isArray(task.activity) ? task.activity : []).map((entry) => ({
        at: String(entry.createdAt || "").trim(),
        title: String(entry.text || "").trim() || "Task updated",
        meta: [
          String(entry.actor || "System").trim() || "System",
          String(task.title || "").trim() || "Task"
        ]
          .filter(Boolean)
          .join(" | ")
      }))
    );

  const lifecycleRows = [];
  if (!projectEvents.length && String(project.createdAt || "").trim()) {
    lifecycleRows.push({
      at: String(project.createdAt || "").trim(),
      title: "Project created",
      meta: String(project.owner || "").trim() || "Owner not set"
    });
  }

  return [...projectEvents, ...taskEvents, ...lifecycleRows]
    .filter((entry) => String(entry.at || "").trim())
    .sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))
    .slice(0, 8);
}

function projectTaskPreviewRow(task) {
  const status = statusClass(task.status);
  const dueLabel = getTaskDateLabel(task);
  const timeLabel = getTaskTimeLabel(task) || "--";
  const ownerLabel = String(task.assignee || "").trim() || "Unassigned";
  return `
    <article class="project-task-row" data-task-open="${task.id}" data-card-menu="task" data-id="${task.id}">
      <div class="project-task-main">
        <p class="project-task-title" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</p>
        <p class="task-meta">${escapeHtml(dueLabel)} | ${escapeHtml(timeLabel)} | ${escapeHtml(ownerLabel)}</p>
      </div>
      <span class="status-chip status-${status}">${escapeHtml(task.status || "New")}</span>
    </article>
  `;
}

export function renderProjects(data, context) {
  const quickFilter = PROJECT_FILTERS.has(String(context.projectsQuickFilter || "all"))
    ? String(context.projectsQuickFilter || "all")
    : "all";
  const sortToken = PROJECT_SORT_OPTIONS.has(String(context.projectsSort || "recent:desc"))
    ? String(context.projectsSort || "recent:desc")
    : "recent:desc";
  const currentUser = String(data.currentUser?.name || "")
    .trim()
    .toLowerCase();
  const globalSearch = String(context.searchTerm || "").trim();
  const localSearch = String(context.projectsSearchTerm || "").trim();
  const activeSearchTokens = [globalSearch, localSearch].filter(Boolean);

  const rows = (Array.isArray(data.projects) ? data.projects : []).map((project, index) => {
    const tasks = getProjectTasks(data, project);
    const progress = normalizeProjectProgress(project.progress);
    const status = normalizeProjectStatus(project.status);
    const stats = getProjectTaskStats(tasks);
    return {
      index,
      project,
      tasks,
      progress,
      status,
      stats
    };
  });

  const scopedRows = rows.filter((row) => {
    if (quickFilter === "mine") {
      const owner = String(row.project.owner || "")
        .trim()
        .toLowerCase();
      if (!owner || owner !== currentUser) {
        return false;
      }
    }
    if (quickFilter === "at-risk") {
      if (!["Needs Focus", "Blocked"].includes(row.status) && row.stats.overdue === 0) {
        return false;
      }
    }
    if (quickFilter === "completed") {
      if (row.progress < 100) {
        return false;
      }
    }
    return activeSearchTokens.every((query) => projectMatchesSearch(row.project, query, row.tasks));
  });

  const sortedRows = sortProjectRows(scopedRows, sortToken);
  const sortOptions = [
    { value: "recent:desc", label: "Recently updated" },
    { value: "name:asc", label: "Name A-Z" },
    { value: "name:desc", label: "Name Z-A" },
    { value: "owner:asc", label: "Owner A-Z" },
    { value: "progress:desc", label: "Progress high-low" },
    { value: "progress:asc", label: "Progress low-high" },
    { value: "deadline:asc", label: "Nearest deadline" },
    { value: "risk:desc", label: "Highest risk" }
  ];
  const activeSort = sortOptions.find((option) => option.value === sortToken) || sortOptions[0];
  const selectedFromContext = String(context.selectedProjectId || "").trim();
  const selectedRow =
    sortedRows.find((row) => row.project.id === selectedFromContext) || sortedRows[0] || null;

  const listRows = sortedRows
    .map((row) => {
      const isSelected = selectedRow && selectedRow.project.id === row.project.id;
      return `
        <article
          class="project-list-row ${isSelected ? "is-selected" : ""}"
          data-action="project-select"
          data-id="${row.project.id}"
          data-card-menu="project"
        >
          <div class="project-list-top">
            <p class="project-list-title" title="${escapeHtml(row.project.name)}">${escapeHtml(row.project.name)}</p>
            <strong class="project-list-progress-label">${row.progress}%</strong>
          </div>
          <p class="project-list-meta">${escapeHtml(row.project.owner)} | ${escapeHtml(row.status)}</p>
          <div class="project-list-progress"><span style="width:${row.progress}%"></span></div>
          <div class="project-list-foot">
            <span>${row.stats.open} open</span>
            <span>${escapeHtml(formatProjectDeadline(row.project.deadline))}</span>
          </div>
        </article>
      `;
    })
    .join("");

  const detailContent = (() => {
    if (!selectedRow) {
      return `
        <section class="projects-detail-empty">
          <p class="task-title">No project selected</p>
          <p class="task-meta">Create a new project or clear filters to continue.</p>
          <button class="table-ops-columns-btn" type="button" data-action="view-add-record" data-id="create">
            <i class="bi bi-plus-lg" aria-hidden="true"></i>
            <span>Add Project</span>
          </button>
        </section>
      `;
    }

    const project = selectedRow.project;
    const taskRows = selectedRow.tasks.slice(0, 8).map((task) => projectTaskPreviewRow(task)).join("");
    const teamMembers = getProjectTeam(project, selectedRow.tasks);
    const activityRows = buildProjectActivity(data, project, selectedRow.tasks)
      .map(
        (entry) => `
          <article class="project-activity-row">
            <p class="project-activity-title">${escapeHtml(entry.title)}</p>
            <p class="task-meta">${escapeHtml(entry.meta)}</p>
            <span class="project-activity-time">${escapeHtml(formatProjectActivityTime(entry.at) || "")}</span>
          </article>
        `
      )
      .join("");
    const accountName = String(project.accountName || project.account || "").trim() || "No account linked";
    const description = String(project.description || "").trim();
    const risks = String(project.risks || "").trim();

    return `
      <section class="projects-detail-pane">
        <header class="projects-detail-head">
          <div class="projects-detail-title-wrap">
            <h3 class="projects-detail-title">${escapeHtml(project.name)}</h3>
            <p class="task-meta">Owner: ${escapeHtml(project.owner)} | Account: ${escapeHtml(accountName)}</p>
          </div>
          <div class="projects-detail-head-actions">
            <span class="status-chip ${projectStatusClass(project.status)}">${escapeHtml(selectedRow.status)}</span>
            <button type="button" class="mini-btn mini-btn-primary" data-action="project-create-task" data-id="${project.id}">
              <i class="bi bi-plus-lg" aria-hidden="true"></i>
              <span>Add Task</span>
            </button>
            <button type="button" class="mini-btn" data-action="project-edit" data-id="${project.id}">Edit</button>
            <button type="button" class="mini-btn" data-action="project-progress" data-id="${project.id}">+10%</button>
          </div>
        </header>
        <section class="projects-detail-progress">
          <div class="projects-detail-progress-head">
            <span>Progress</span>
            <strong>${selectedRow.progress}% complete</strong>
          </div>
          <div class="projects-detail-progress-track"><span style="width:${selectedRow.progress}%"></span></div>
        </section>
        <section class="projects-detail-stats">
          <article class="projects-stat-card">
            <p class="task-meta">Open Tasks</p>
            <strong>${selectedRow.stats.open}</strong>
          </article>
          <article class="projects-stat-card">
            <p class="task-meta">Completed</p>
            <strong>${selectedRow.stats.completed}</strong>
          </article>
          <article class="projects-stat-card">
            <p class="task-meta">Overdue</p>
            <strong>${selectedRow.stats.overdue}</strong>
          </article>
          <article class="projects-stat-card">
            <p class="task-meta">Deadline</p>
            <strong>${escapeHtml(formatProjectDeadline(project.deadline))}</strong>
          </article>
        </section>
        <section class="projects-detail-grid">
          <article class="projects-detail-section">
            <header class="projects-detail-section-head">
              <h4>Linked Tasks</h4>
              <span>${selectedRow.tasks.length}</span>
            </header>
            <div class="projects-detail-scroll">
              ${taskRows || "<p class='task-meta'>No linked tasks yet.</p>"}
            </div>
          </article>
          <article class="projects-detail-section">
            <header class="projects-detail-section-head">
              <h4>Team</h4>
              <span>${teamMembers.length}</span>
            </header>
            <div class="project-team-stack">
              ${
                teamMembers.length
                  ? teamMembers
                      .map(
                        (member) => `
                          <div class="project-team-row">
                            <span class="project-team-avatar">${escapeHtml(initialsFromName(member))}</span>
                            <span class="project-team-name">${escapeHtml(member)}</span>
                          </div>
                        `
                      )
                      .join("")
                  : "<p class='task-meta'>No team members yet.</p>"
              }
            </div>
          </article>
          <article class="projects-detail-section">
            <header class="projects-detail-section-head">
              <h4>Project Notes</h4>
            </header>
            <p class="task-meta projects-detail-note">${escapeHtml(description || "No description yet.")}</p>
            <p class="task-meta projects-detail-note is-risk">${escapeHtml(risks || "No active risks logged.")}</p>
          </article>
          <article class="projects-detail-section">
            <header class="projects-detail-section-head">
              <h4>Recent Activity</h4>
            </header>
            <div class="project-activity-stack">
              ${activityRows || "<p class='task-meta'>No activity yet.</p>"}
            </div>
          </article>
        </section>
      </section>
    `;
  })();

  return {
    title: "Projects",
    subtitle: "Structured project workspace with linked execution",
    primaryAction: "Add Project",
    showWaitingPanel: true,
    waitingTitle: "Project Backlog",
    waitingSubtitle: "Ideas to schedule this week",
    waitingItems: (Array.isArray(data.waitingList) ? data.waitingList : []).filter(
      (item) => item.linkedType === "Project"
    ),
    html: `
      <section class="view-block projects-workspace-shell">
        ${viewSectionHead("Projects", "Add Project")}
        <section class="projects-workspace">
          <aside class="projects-sidebar">
            <div class="projects-sidebar-controls">
              <div class="projects-filter-row">
                <button type="button" class="mini-btn ${quickFilter === "all" ? "is-active" : ""}" data-action="project-filter" data-id="all">All</button>
                <button type="button" class="mini-btn ${quickFilter === "mine" ? "is-active" : ""}" data-action="project-filter" data-id="mine">My Projects</button>
                <button type="button" class="mini-btn ${quickFilter === "at-risk" ? "is-active" : ""}" data-action="project-filter" data-id="at-risk">At Risk</button>
                <button type="button" class="mini-btn ${quickFilter === "completed" ? "is-active" : ""}" data-action="project-filter" data-id="completed">Completed</button>
              </div>
              <label class="projects-search">
                <input
                  id="projectsInlineSearch"
                  type="search"
                  placeholder="Search projects"
                  value="${escapeHtml(localSearch)}"
                />
                <i class="bi bi-search" aria-hidden="true"></i>
              </label>
              <div class="projects-sort">
                <span>Sort</span>
                <details class="projects-sort-menu">
                  <summary class="projects-sort-trigger">
                    <span>${escapeHtml(activeSort.label)}</span>
                    <i class="bi bi-chevron-down" aria-hidden="true"></i>
                  </summary>
                  <div class="projects-sort-dropdown">
                    ${sortOptions
                      .map(
                        (option) => `
                          <button
                            type="button"
                            class="projects-sort-option ${option.value === sortToken ? "is-active" : ""}"
                            data-action="project-sort"
                            data-id="${option.value}"
                          >
                            ${escapeHtml(option.label)}
                          </button>
                        `
                      )
                      .join("")}
                  </div>
                </details>
              </div>
            </div>
            <div class="projects-list">
              ${listRows || "<p class='task-meta'>No projects match this filter.</p>"}
            </div>
          </aside>
          <div class="projects-detail">
            ${detailContent}
          </div>
        </section>
      </section>
    `
  };
}
