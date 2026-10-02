import { canTaskUpdateProgress } from "../modules/task-rbac.js";
import { canonicalTaskType } from "../modules/task-call.js";
import { escapeHtml } from "../utils/text.js";

const STATUSES = ["New", "Scheduled", "In progress", "Completed"];
const PROPERTY_OPTIONS = [
  ["assignee", "Assignee"],
  ["due", "Due date"],
  ["priority", "Priority"]
];

function statusToken(value) {
  return String(value || "New").trim().toLowerCase().replaceAll(" ", "-");
}

function initials(value) {
  const parts = String(value || "Unassigned").trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] || "U"}${parts.length > 1 ? parts.at(-1)?.[0] || "" : ""}`.toUpperCase();
}

function formatDate(value) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "No due date";
  const [year, month, day] = raw.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.valueOf())
    ? raw
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function isOverdue(task) {
  const due = String(task?.dueDate || "").trim();
  if (!due || String(task?.status || "") === "Completed") return false;
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return due < todayIso;
}

function taskType(task) {
  return canonicalTaskType(task?.taskType, "") || "Task";
}

function priority(task) {
  const value = String(task?.priority || "low").trim().toLowerCase();
  return ["high", "medium", "low"].includes(value) ? value : "low";
}

function matchesSearch(task, query) {
  if (!query) return true;
  return [task.title, task.notes, task.assignee, task.accountName, task.linkLabel, task.status]
    .join(" ")
    .toLowerCase()
    .includes(query.toLowerCase());
}

function matchesDate(task, value) {
  if (value === "all") return true;
  const due = String(task.dueDate || "").trim();
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (value === "today") return due === todayIso;
  if (value === "overdue") return isOverdue(task);
  if (value === "week" && due) {
    const end = new Date(today);
    end.setDate(end.getDate() + 7);
    const endIso = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
    return due >= todayIso && due <= endIso;
  }
  return false;
}

function filterTasks(data, context) {
  const assignee = String(context.kanbanFilterAssignee || "all");
  const type = String(context.kanbanFilterType || "all").toLowerCase();
  const wantedPriority = String(context.kanbanFilterPriority || "all").toLowerCase();
  const date = String(context.kanbanFilterDate || "all").toLowerCase();
  const query = String(context.kanbanFilterSearch || "").trim();
  const currentUser = data.currentUser || {};
  const filtered = (data.tasks || []).filter((task) => {
    const assigneeMatch = assignee === "all"
      || (assignee === "mine" && (String(task.assigneeId || "") === String(currentUser.id || "") || String(task.assignee || "") === String(currentUser.name || "")))
      || String(task.assigneeId || "") === assignee;
    return assigneeMatch
      && (type === "all" || taskType(task).toLowerCase() === type)
      && (wantedPriority === "all" || priority(task) === wantedPriority)
      && matchesDate(task, date)
      && matchesSearch(task, query);
  });
  const sort = String(context.kanbanSort || "due-asc");
  return filtered.sort((left, right) => {
    if (sort === "title") return String(left.title || "").localeCompare(String(right.title || ""));
    const result = String(left.dueDate || "9999-99-99").localeCompare(String(right.dueDate || "9999-99-99"));
    return sort === "due-desc" ? -result : result;
  });
}

function assigneeOptions(data, selectedValue) {
  const members = [data.currentUser, ...(data.teamMembers || [])].filter(Boolean);
  const seen = new Set();
  const seenNames = new Set();
  const options = [{ value: "all", label: "All assignees" }, { value: "mine", label: "Mine" }];
  members.forEach((member) => {
    const id = String(member.id || "").trim();
    const name = String(member.name || "").trim();
    const normalizedName = name.toLowerCase();
    if (id && name && !seen.has(id) && !seenNames.has(normalizedName)) {
      seen.add(id);
      seenNames.add(normalizedName);
      options.push({ value: id, label: name });
    }
  });
  return options.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === selectedValue ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("");
}

function activeFilterCount(context) {
  return [
    context.kanbanFilterAssignee && context.kanbanFilterAssignee !== "all",
    context.kanbanFilterType && context.kanbanFilterType !== "all",
    context.kanbanFilterPriority && context.kanbanFilterPriority !== "all",
    context.kanbanFilterDate && context.kanbanFilterDate !== "all",
    Boolean(String(context.kanbanFilterSearch || "").trim())
  ].filter(Boolean).length;
}

function filterPopover(data, context) {
  if (!context.kanbanFiltersOpen) return "";
  const selectedAssignee = String(context.kanbanFilterAssignee || "all");
  const selectedType = String(context.kanbanFilterType || "all").toLowerCase();
  const selectedPriority = String(context.kanbanFilterPriority || "all").toLowerCase();
  const selectedDate = String(context.kanbanFilterDate || "all").toLowerCase();
  return `
    <form id="kanbanFilterForm" class="kanban-n-filter-popover" autocomplete="off">
      <div class="kanban-n-popover-head"><strong>Filter tasks</strong><button type="button" data-action="kanban-filters-close" aria-label="Close filters"><i class="bi bi-x-lg"></i></button></div>
      <label class="kanban-n-filter-field is-wide"><span>Search</span><input type="search" name="searchTerm" value="${escapeHtml(String(context.kanbanFilterSearch || ""))}" placeholder="Task or assignee" autofocus></label>
      <div class="kanban-n-filter-grid">
        <label class="kanban-n-filter-field"><span>Assignee</span><select name="assignee">${assigneeOptions(data, selectedAssignee)}</select></label>
        <label class="kanban-n-filter-field"><span>Type</span><select name="taskType">${["all", "task", "call", "recurring"].map((value) => `<option value="${value}" ${selectedType === value ? "selected" : ""}>${value === "all" ? "All types" : value[0].toUpperCase() + value.slice(1)}</option>`).join("")}</select></label>
        <label class="kanban-n-filter-field"><span>Priority</span><select name="priority">${["all", "high", "medium", "low"].map((value) => `<option value="${value}" ${selectedPriority === value ? "selected" : ""}>${value === "all" ? "All priorities" : value[0].toUpperCase() + value.slice(1)}</option>`).join("")}</select></label>
        <label class="kanban-n-filter-field"><span>Due date</span><select name="dateFilter">${[["all", "Any time"], ["today", "Today"], ["week", "Next 7 days"], ["overdue", "Overdue"]].map(([value, label]) => `<option value="${value}" ${selectedDate === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
      </div>
      <div class="kanban-n-popover-actions"><button type="button" data-action="kanban-filters-clear" data-id="clear">Reset</button><button class="is-primary" type="submit">Apply</button></div>
    </form>`;
}

function propertiesPopover(context) {
  if (!context.kanbanPropertiesOpen) return "";
  const hidden = new Set(context.kanbanHiddenProperties || []);
  return `<div class="kanban-n-properties-popover" role="menu" aria-label="Card properties">
    <div class="kanban-n-popover-head"><strong>Properties</strong><button type="button" data-action="kanban-properties-close" aria-label="Close properties"><i class="bi bi-x-lg"></i></button></div>
    ${PROPERTY_OPTIONS.map(([id, label]) => `<button type="button" data-action="kanban-property-toggle" data-id="${id}" role="menuitemcheckbox" aria-checked="${hidden.has(id) ? "false" : "true"}"><i class="bi ${hidden.has(id) ? "bi-square" : "bi-check-square-fill"}"></i><span>${label}</span></button>`).join("")}
  </div>`;
}

function taskCard(task, detailed, hidden) {
  const draggable = canTaskUpdateProgress(task);
  const show = (property) => !hidden.has(property);
  const due = formatDate(task.dueDate);
  return `<article class="kanban-n-card ${detailed ? "is-detailed" : ""} ${isOverdue(task) ? "is-overdue" : ""}" data-task-open="${escapeHtml(task.id)}" data-card-menu="task" data-id="${escapeHtml(task.id)}" ${draggable ? `draggable="true" data-drag-type="task-status"` : ""} tabindex="0">
    <div class="kanban-n-card-title-row"><h3>${escapeHtml(task.title || "Untitled task")}</h3><button type="button" class="kanban-n-card-menu" data-action="task-open" data-id="${escapeHtml(task.id)}" aria-label="Open task details"><i class="bi bi-arrow-up-right"></i></button></div>
    ${detailed ? `<div class="kanban-n-card-detail">
      ${show("assignee") ? `<span><i class="bi bi-person"></i>${escapeHtml(task.assignee || "Unassigned")}</span>` : ""}
      ${show("due") ? `<span class="${isOverdue(task) ? "is-overdue" : ""}"><i class="bi bi-calendar3"></i>${escapeHtml(due)}</span>` : ""}
      ${show("priority") ? `<span><i class="bi bi-flag"></i><span class="kanban-n-priority is-${priority(task)}">${escapeHtml(priority(task))}</span></span>` : ""}
      <span><i class="bi bi-link-45deg"></i>${escapeHtml(String(task.linkLabel || task.accountName || "No linked record"))}</span>
    </div>` : `<div class="kanban-n-card-footer">
      ${show("assignee") ? `<span class="kanban-n-assignee"><span class="kanban-n-avatar">${escapeHtml(initials(task.assignee))}</span>${escapeHtml(task.assignee || "Unassigned")}</span>` : ""}
      ${show("due") ? `<span class="kanban-n-due ${isOverdue(task) ? "is-overdue" : ""}"><i class="bi bi-calendar3"></i>${escapeHtml(due)}</span>` : ""}
    </div>`}
  </article>`;
}

function boardView(tasks, context, detailed = false) {
  const hidden = new Set(context.kanbanHiddenProperties || []);
  return `<div class="kanban-n-board ${detailed ? "is-detailed" : ""}">
    ${STATUSES.map((status) => {
      const items = tasks.filter((task) => String(task.status || "New") === status);
      const token = statusToken(status);
      return `<section class="kanban-n-column status-${token}" data-drop-type="task-status" data-drop-value="${status}">
        <header class="kanban-n-column-head"><span class="kanban-n-status"><i></i>${escapeHtml(status)}</span><span class="kanban-n-count">${items.length}</span></header>
        <div class="kanban-n-column-body">${items.map((task) => taskCard(task, detailed, hidden)).join("") || `<p class="kanban-n-empty-column">No tasks</p>`}<button class="kanban-n-new-task" type="button" data-action="view-add-record" data-id="create"><i class="bi bi-plus-lg"></i>New task</button></div>
      </section>`;
    }).join("")}
  </div>`;
}

function tableView(tasks, context) {
  const hidden = new Set(context.kanbanHiddenProperties || []);
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(tasks.length / pageSize));
  const page = Math.min(totalPages, Math.max(1, Number(context.tablePage || 1)));
  const rows = tasks.slice((page - 1) * pageSize, page * pageSize);
  const cell = (property, markup) => hidden.has(property) ? "" : markup;
  return `<div class="kanban-n-table-wrap">
    <div class="kanban-n-table-scroll"><table class="kanban-n-table"><thead><tr><th>Task</th><th>Status</th>${cell("assignee", "<th>Assignee</th>")}${cell("due", "<th>Due date</th>")}${cell("priority", "<th>Priority</th>")}</tr></thead>
      <tbody>${rows.map((task) => `<tr data-task-open="${escapeHtml(task.id)}" tabindex="0"><td><strong>${escapeHtml(task.title || "Untitled task")}</strong><small>${escapeHtml(taskType(task))}</small></td><td><span class="kanban-n-status status-${statusToken(task.status)}"><i></i>${escapeHtml(task.status || "New")}</span></td>${cell("assignee", `<td><span class="kanban-n-assignee"><span class="kanban-n-avatar">${escapeHtml(initials(task.assignee))}</span>${escapeHtml(task.assignee || "Unassigned")}</span></td>`)}${cell("due", `<td class="${isOverdue(task) ? "is-overdue" : ""}">${escapeHtml(formatDate(task.dueDate))}</td>`)}${cell("priority", `<td><span class="kanban-n-priority is-${priority(task)}">${escapeHtml(priority(task))}</span></td>`)}</tr>`).join("") || `<tr><td colspan="5" class="kanban-n-empty-table">No tasks match these filters.</td></tr>`}</tbody></table></div>
    <footer class="kanban-n-table-footer"><span>Showing ${tasks.length ? (page - 1) * pageSize + 1 : 0}–${Math.min(tasks.length, page * pageSize)} of ${tasks.length} tasks</span><div><button type="button" data-action="table-page" data-id="${page - 1}" ${page <= 1 ? "disabled" : ""} aria-label="Previous page"><i class="bi bi-chevron-left"></i></button><span>${page} / ${totalPages}</span><button type="button" data-action="table-page" data-id="${page + 1}" ${page >= totalPages ? "disabled" : ""} aria-label="Next page"><i class="bi bi-chevron-right"></i></button></div></footer>
  </div>`;
}

export function renderKanban(data, context) {
  const view = ["board", "detailed", "table"].includes(context.kanbanView) ? context.kanbanView : "board";
  const tasks = filterTasks(data, context);
  const filters = activeFilterCount(context);
  const body = view === "table" ? tableView(tasks, context) : boardView(tasks, context, view === "detailed");
  const sortLabel = context.kanbanSort === "due-desc" ? "Newest due" : context.kanbanSort === "title" ? "Task name" : "Earliest due";
  return {
    title: "Tasks",
    subtitle: "Move work through each stage",
    primaryAction: "",
    showWaitingPanel: false,
    html: `<section class="kanban-n-workspace">
      <header class="kanban-n-page-head"><div><h1>Tasks</h1><p>Move work through each stage</p></div><button class="kanban-n-add" type="button" data-action="view-add-record" data-id="create"><i class="bi bi-plus-lg"></i>Add task</button></header>
      <div class="kanban-n-viewbar">
        <nav aria-label="Task views">${[["board", "bi-kanban", "Board"], ["detailed", "bi-view-stacked", "Detailed"], ["table", "bi-table", "Table"]].map(([id, icon, label]) => `<button type="button" class="${view === id ? "is-active" : ""}" data-action="kanban-view" data-id="${id}" aria-current="${view === id ? "page" : "false"}"><i class="bi ${icon}"></i>${label}</button>`).join("")}</nav>
        <div class="kanban-n-tools">
          <div class="kanban-n-popover-shell"><button type="button" data-action="kanban-open-filters" data-id="open"><i class="bi bi-search"></i><span>Search</span></button></div>
          <div class="kanban-n-popover-shell kanban-filter-shell"><button type="button" class="${filters ? "is-active" : ""}" data-action="kanban-open-filters" data-id="open" aria-expanded="${Boolean(context.kanbanFiltersOpen)}"><i class="bi bi-funnel"></i><span>Filter</span>${filters ? `<small>${filters}</small>` : ""}</button>${filterPopover(data, context)}</div>
          <button type="button" data-action="kanban-sort" data-id="next" title="${escapeHtml(sortLabel)}"><i class="bi bi-arrow-down-up"></i><span>Sort</span></button>
          <div class="kanban-n-popover-shell"><button type="button" data-action="kanban-properties" data-id="open" aria-expanded="${Boolean(context.kanbanPropertiesOpen)}"><i class="bi bi-sliders"></i><span>Properties</span></button>${propertiesPopover(context)}</div>
        </div>
      </div>
      <div class="kanban-n-content">${body}</div>
    </section>`
  };
}
