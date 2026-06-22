const TASK_TYPE_CANONICAL_MAP = new Map([
  ["general", "General"],
  ["call", "Call"],
  ["callback", "Callback"],
  ["project", "Project"],
  ["recurring", "Recurring"],
  ["lead", "Lead"],
  ["contact", "Contact"],
  ["account", "Account"],
  ["deal", "Deal"],
  ["task", "Task"]
]);

export const TASK_COMPOSER_TYPE_OPTIONS = [
  { value: "General", label: "General task", icon: "bi-list-check" },
  { value: "Call", label: "Scheduled call", icon: "bi-telephone" },
  { value: "Callback", label: "Callback", icon: "bi-telephone-inbound" }
];

export function canonicalTaskType(value, fallback = "General") {
  const raw = String(value || "").trim();
  if (!raw) {
    return fallback;
  }
  return TASK_TYPE_CANONICAL_MAP.get(raw.toLowerCase()) || raw;
}

export function isCallTaskType(value) {
  const type = canonicalTaskType(value, "");
  return type === "Call" || type === "Callback";
}

export function isCallbackTaskType(value) {
  return canonicalTaskType(value, "") === "Callback";
}

export function getTaskScheduleMode(task) {
  if (!isCallTaskType(task?.taskType)) {
    return "exact";
  }
  return String(task?.endTime || "").trim() ? "window" : "exact";
}
