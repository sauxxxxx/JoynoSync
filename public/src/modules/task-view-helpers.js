export function parseIsoDateLocal(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.valueOf()) ? null : date;
}

function parseDateTimeLocal(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{1,2}:\d{2})$/);
  if (!match) return null;
  const date = parseIsoDateLocal(match[1]);
  const timeMatch = String(match[2] || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!date || !timeMatch) return null;
  date.setHours(Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);
  return date;
}

function timeToMinutes(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : -1;
}

export function getTaskTimeLabel(task) {
  const formatClock = (timeValue) => {
    const parsed = parseDateTimeLocal(`${task.dueDate || "2026-01-01"}T${timeValue}`);
    return parsed
      ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(parsed)
      : "";
  };
  const startTime = String(task.startTime || "").trim();
  const endTime = String(task.endTime || "").trim();
  if (startTime && endTime) {
    const startLabel = formatClock(startTime);
    const endLabel = formatClock(endTime);
    if (startLabel && endLabel) return `${startLabel} - ${endLabel}`;
  }
  if (task.deadlineAt) {
    const parsed = parseDateTimeLocal(task.deadlineAt);
    if (parsed) {
      return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(parsed);
    }
  }
  if (startTime) {
    const label = formatClock(startTime);
    if (label) return label;
  }
  return String(task.time || "");
}

export function getTaskDateLabel(task) {
  if (!task.dueDate) return task.day || "-";
  const parsed = parseIsoDateLocal(task.dueDate);
  if (!parsed) return task.dueDate;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    weekday: "short"
  }).format(parsed);
}

export function isTaskOverdue(task) {
  if (String(task.status || "") === "Completed") return false;
  if (task.deadlineAt) {
    const parsed = parseDateTimeLocal(task.deadlineAt);
    if (parsed) return parsed.valueOf() < Date.now();
  }
  const date = parseIsoDateLocal(task.dueDate);
  if (!date) return false;
  const startMinutes = timeToMinutes(task.startTime || "");
  if (startMinutes >= 0) {
    date.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
  } else {
    date.setHours(23, 59, 59, 999);
  }
  return date.valueOf() < Date.now();
}

export function sortTasksBySchedule(tasks) {
  return [...tasks].sort((left, right) => {
    const leftDeadline = parseDateTimeLocal(left.deadlineAt);
    const rightDeadline = parseDateTimeLocal(right.deadlineAt);
    if (leftDeadline && rightDeadline) return leftDeadline.valueOf() - rightDeadline.valueOf();
    if (leftDeadline) return -1;
    if (rightDeadline) return 1;
    const dateCompared = String(left.dueDate || "").localeCompare(String(right.dueDate || ""));
    if (dateCompared) return dateCompared;
    return timeToMinutes(left.startTime || "") - timeToMinutes(right.startTime || "");
  });
}

export function statusClass(status) {
  return String(status || "new").toLowerCase().replaceAll(" ", "-");
}

export function initialsFromName(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "--";
  const first = parts[0]?.[0] || "";
  const second = parts.length > 1 ? parts[1]?.[0] || "" : parts[0]?.[1] || "";
  return `${first}${second}`.toUpperCase();
}
