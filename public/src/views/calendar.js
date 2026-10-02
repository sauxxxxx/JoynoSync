import { canonicalTaskType, isCallTaskType } from "../modules/task-call.js";
import {
  getTaskTimeLabel,
  initialsFromName,
  isTaskOverdue,
  parseIsoDateLocal,
  sortTasksBySchedule,
  statusClass
} from "../modules/task-view-helpers.js";
import { escapeHtml } from "../utils/text.js";

function toIsoDateLocal(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
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
  return addDaysLocal(base, day === 0 ? -6 : 1 - day);
}

function formatMonthYearLabel(value) {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(value);
}

function formatMonthDayShort(value) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(value);
}

function includesSearch(task, query) {
  if (!query) return true;
  return [
    task.title,
    task.assignee,
    task.status,
    task.day,
    task.priority,
    task.dueDate,
    task.accountName,
    task.taskType,
    task.callPhone,
    task.linkLabel,
    task.recurrence,
    task.notes
  ].join(" ").toLowerCase().includes(query.toLowerCase());
}

function taskTypeLabel(task) {
  const explicit = canonicalTaskType(task.taskType, "");
  if (explicit) return explicit;
  const recurrence = String(task.recurrence || "").toLowerCase();
  if (["daily", "weekly", "monthly"].includes(recurrence)) return "Recurring";
  return "General";
}

function compactTaskCardContent(task) {
  const taskTitle = String(task.title || "").trim() || "Untitled task";
  const assigneeName = String(task.assignee || "").trim() || "Unassigned";
  const time = String(getTaskTimeLabel(task) || "").trim() || "--";
  const callMeta = isCallTaskType(task.taskType) ? taskTypeLabel(task) : "";
  const status = statusClass(task.status);
  const statusLabel = String(task.status || "New").trim() || "New";
  const rawDescription = String(task.notes || "").trim() || "No description";
  return `
    <div class="task-card-headline">
      <p class="calendar-week-task-title task-card-title" title="${escapeHtml(taskTitle)}">${escapeHtml(taskTitle)}</p>
      <p class="task-card-time">
        <span class="task-status-dot status-${status}" title="${escapeHtml(statusLabel)}" aria-label="${escapeHtml(statusLabel)}"></span>
        <span>${escapeHtml(time)}</span>
      </p>
    </div>
    <p class="task-card-desc" title="${escapeHtml(rawDescription)}">${escapeHtml(rawDescription.replace(/\s+/g, " "))}</p>
    <div class="task-card-footer">
      ${callMeta ? `<span class="task-card-meta-pill task-card-call-pill">${escapeHtml(callMeta)}</span>` : ""}
      <span class="task-card-assignee" title="${escapeHtml(assigneeName)}">
        <span class="task-card-assignee-avatar" aria-hidden="true">${escapeHtml(initialsFromName(assigneeName))}</span>
      </span>
    </div>`;
}

function buildCalendarMiniMonthGrid(monthDate, selectedIso, todayIso) {
  const firstOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const gridStart = addDaysLocal(firstOfMonth, -firstOfMonth.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const cellDate = addDaysLocal(gridStart, index);
    const iso = toIsoDateLocal(cellDate);
    const classes = [
      "calendar-mini-day",
      cellDate.getMonth() === monthDate.getMonth() ? "is-in-month" : "is-outside-month",
      iso === todayIso ? "is-today" : "",
      iso === selectedIso ? "is-selected" : ""
    ].filter(Boolean).join(" ");
    return `<button type="button" class="${classes}" data-action="calendar-day" data-id="${iso}" aria-label="Select ${iso}">${cellDate.getDate()}</button>`;
  }).join("");
}

function calendarWeekTaskCard(task) {
  return `<article class="calendar-week-task task-compact-card status-${statusClass(task.status)}" data-task-open="${task.id}" data-card-menu="task" data-id="${task.id}">${compactTaskCardContent(task)}</article>`;
}

function calendarAgendaRow(task) {
  const linkMeta = task.linkLabel || task.accountName || "-";
  return `
    <article class="calendar-agenda-item ${isTaskOverdue(task) ? "is-overdue" : ""}" data-task-open="${task.id}" data-card-menu="task" data-id="${task.id}">
      <div class="calendar-agenda-time">${escapeHtml(getTaskTimeLabel(task) || "--")}</div>
      <div class="calendar-agenda-content">
        <p class="calendar-agenda-title">${escapeHtml(task.title)}</p>
        <p class="task-meta">${escapeHtml(task.assignee)} | ${escapeHtml(linkMeta)}</p>
      </div>
      <span class="calendar-agenda-status status-${statusClass(task.status)}">${escapeHtml(task.status || "New")}</span>
    </article>`;
}

export function renderCalendar(data, context) {
  const tasks = sortTasksBySchedule((data.tasks || []).filter((task) => includesSearch(task, context.searchTerm)));
  const selectedDate = parseIsoDateLocal(context.calendarDate) || new Date();
  const selectedIso = toIsoDateLocal(selectedDate);
  const monthDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
  const todayIso = toIsoDateLocal(new Date());
  const mode = context.calendarMode === "agenda" ? "agenda" : "week";
  const miniCollapsed = Boolean(context.calendarMiniCollapsed);
  const weekStart = getWeekStartMondayLocal(selectedDate);
  const weekDates = Array.from({ length: 5 }, (_, index) => addDaysLocal(weekStart, index));
  const weekTasksByIso = new Map(weekDates.map((date) => [toIsoDateLocal(date), []]));
  tasks.forEach((task) => {
    const dueDate = String(task.dueDate || "").trim();
    if (weekTasksByIso.has(dueDate)) weekTasksByIso.get(dueDate).push(task);
  });

  const weekColumns = weekDates.map((date) => {
    const iso = toIsoDateLocal(date);
    const dayTasks = weekTasksByIso.get(iso) || [];
    return `
      <section class="calendar-week-column ${iso === selectedIso ? "is-selected" : ""}">
        <header class="calendar-week-column-head">
          <button type="button" class="calendar-week-day-btn" data-action="calendar-day" data-id="${iso}">
            <span>${new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date).toUpperCase()}</span>
            <strong>${formatMonthDayShort(date)}</strong>
          </button>
          <button type="button" class="calendar-week-add-btn" data-action="calendar-quick-add" data-id="${iso}" aria-label="Add task on ${iso}"><i class="bi bi-plus"></i></button>
        </header>
        <div class="calendar-week-column-body">${dayTasks.length ? dayTasks.map(calendarWeekTaskCard).join("") : "<p class='calendar-day-empty'>Nothing scheduled</p>"}</div>
      </section>`;
  }).join("");

  const selectedDayTasks = weekTasksByIso.get(selectedIso) || [];
  const laterWeekTasks = weekDates.map(toIsoDateLocal).filter((iso) => iso !== selectedIso).flatMap((iso) => weekTasksByIso.get(iso) || []);
  const agendaSection = (title, items, emptyCopy, canAdd = false) => `
    <section class="calendar-agenda-section">
      <header class="calendar-agenda-head"><h4>${title}</h4>${canAdd ? `<button type="button" class="mini-btn mini-btn-primary" data-action="calendar-quick-add" data-id="${selectedIso}">Add Task</button>` : ""}</header>
      <div class="calendar-agenda-list">${items.length ? items.map(calendarAgendaRow).join("") : `<p class='task-meta'>${emptyCopy}</p>`}</div>
    </section>`;

  return {
    title: "Calendar",
    subtitle: "Hybrid planner with week and agenda views",
    primaryAction: "Add Task",
    showWaitingPanel: false,
    html: `
      <section class="view-block calendar-hybrid ${miniCollapsed ? "is-mini-collapsed" : ""}">
        <aside class="calendar-mini-rail">
          <div class="calendar-mini-toggle-row"><button type="button" class="calendar-mini-toggle-btn" data-action="calendar-mini-toggle" data-id="toggle" aria-label="${miniCollapsed ? "Expand mini-month panel" : "Collapse mini-month panel"}" title="${miniCollapsed ? "Expand mini-month panel" : "Collapse mini-month panel"}"><i class="bi bi-calendar3" aria-hidden="true"></i></button></div>
          <div class="calendar-mini-content" ${miniCollapsed ? "hidden" : ""}>
            <header class="calendar-mini-head">
              <button type="button" class="calendar-nav-btn" data-action="calendar-month-nav" data-id="prev" aria-label="Previous month"><i class="bi bi-chevron-left"></i></button>
              <strong>${escapeHtml(formatMonthYearLabel(monthDate))}</strong>
              <button type="button" class="calendar-nav-btn" data-action="calendar-month-nav" data-id="next" aria-label="Next month"><i class="bi bi-chevron-right"></i></button>
            </header>
            <div class="calendar-mini-weekdays"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>
            <div class="calendar-mini-grid">${buildCalendarMiniMonthGrid(monthDate, selectedIso, todayIso)}</div>
            <button type="button" class="calendar-today-btn" data-action="calendar-jump-today" data-id="today"><i class="bi bi-arrow-return-right" aria-hidden="true"></i><span>Today</span></button>
          </div>
        </aside>
        <section class="calendar-main-pane">
          <header class="calendar-main-head">
            <div><p class="calendar-main-kicker">Calendar</p><h3 class="block-title">${escapeHtml(formatMonthDayShort(weekDates[0]))} – ${escapeHtml(formatMonthDayShort(weekDates[4]))}</h3><p class="task-meta">Selected · ${escapeHtml(formatMonthDayShort(selectedDate))}</p></div>
            <div class="calendar-mode-switch" role="tablist" aria-label="Calendar mode">
              <button type="button" role="tab" aria-selected="${mode === "week"}" class="calendar-mode-btn ${mode === "week" ? "is-active" : ""}" data-action="calendar-mode" data-id="week">Week</button>
              <button type="button" role="tab" aria-selected="${mode === "agenda"}" class="calendar-mode-btn ${mode === "agenda" ? "is-active" : ""}" data-action="calendar-mode" data-id="agenda">Agenda</button>
            </div>
          </header>
          ${mode === "week" ? `<div class="calendar-week-grid stagger">${weekColumns}</div>` : `<div class="calendar-agenda-wrap stagger">${agendaSection(selectedIso === todayIso ? "Today" : "Selected Day", selectedDayTasks, "No tasks on this day.", true)}${agendaSection("Later This Week", laterWeekTasks, "No upcoming tasks this week.")}</div>`}
        </section>
      </section>`
  };
}
