export const WORKDAY_OPTIONS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" }
];

export const WORKSPACE_DATE_FORMATS = ["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY"];
export const WORKSPACE_CURRENCIES = ["USD", "EUR", "GBP", "CNY", "SGD", "PHP", "AED"];
export const WORKSPACE_WEEK_START_OPTIONS = ["Sun", "Mon"];
export const PIPELINE_STAGE_OPTIONS = ["Prospecting", "Qualified", "Proposal", "Negotiation", "Won"];
export const PROFILE_SCOPE_OPTIONS = ["own", "team", "all"];
export const PROFILE_PERMISSION_ACTIONS = ["view", "create", "edit", "delete", "export"];
export const PROFILE_PERMISSION_MODULES = [
  { id: "dashboard", label: "Dashboard" },
  { id: "my-work", label: "My Work" },
  { id: "calendar", label: "Calendar" },
  { id: "kanban", label: "Kanban" },
  { id: "table", label: "Table" },
  { id: "projects", label: "Projects" },
  { id: "leads", label: "Leads" },
  { id: "contacts", label: "Contacts" },
  { id: "accounts", label: "Accounts" },
  { id: "deals", label: "Deals" },
  { id: "messenger", label: "Messenger" },
  { id: "calls", label: "Calls" },
  { id: "sms", label: "SMS" },
  { id: "email", label: "Email" },
  { id: "team", label: "Team" },
  { id: "settings", label: "Settings" }
];
export const PROFILE_LANGUAGE_OPTIONS = ["English", "Spanish", "Filipino", "Chinese"];
export const PROFILE_AVAILABILITY_OPTIONS = ["Online", "Away", "Offline"];

export const ATTENDANCE_TIMEZONE_OPTIONS = (() => {
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  const defaults = [
    "Local",
    "UTC",
    browserTz,
    "Asia/Shanghai",
    "Asia/Singapore",
    "Asia/Manila",
    "Asia/Tokyo",
    "Asia/Dubai",
    "Australia/Sydney",
    "Europe/London",
    "Europe/Berlin",
    "Europe/Paris",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Toronto",
    "America/Sao_Paulo"
  ];
  return [...new Set(defaults.map((item) => String(item || "").trim()).filter(Boolean))];
})();
