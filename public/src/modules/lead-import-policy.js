export const LEAD_IMPORT_MODE_NEW = "new";
export const LEAD_IMPORT_MODE_UPDATE = "update-exported";
export const LEAD_IMPORT_MAX_ROWS = 10_000;
export const LEAD_IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;

export const LEAD_IMPORT_STATUS_OPTIONS = ["New", "Contacted", "Qualified", "Unqualified", "Converted"];

export const LEAD_IMPORT_DUPLICATE_OPTIONS = [
  { value: "skip", label: "Skip duplicates", detail: "Ignore rows that match existing leads." },
  { value: "update", label: "Update matching leads", detail: "Apply provided values to one confidently matched lead." },
  { value: "create", label: "Create reviewed duplicates", detail: "Create only duplicate rows explicitly approved during review." }
];

export const LEAD_IMPORT_FIELDS = [
  { key: "leadId", label: "Lead ID", updateOnly: true },
  { key: "updatedAt", label: "Exported version", updateOnly: true },
  { key: "name", label: "Lead name", required: true },
  { key: "company", label: "Company" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "secondaryPhone", label: "Secondary phone" },
  { key: "interest", label: "Interest" },
  { key: "owner", label: "Owner" },
  { key: "source", label: "Source" },
  { key: "status", label: "Status" },
  { key: "nextFollowUp", label: "Next follow-up" },
  { key: "role", label: "Role" },
  { key: "tags", label: "Tags" },
  { key: "notes", label: "Notes" },
  { key: "archived", label: "Archived", updateOnly: true }
];

export const LEAD_IMPORT_HEADER_ALIASES = {
  leadId: ["lead id", "lead_id", "id"],
  updatedAt: ["updated at", "updated_at", "exported version", "record version"],
  name: ["lead name", "name", "full name", "contact name", "lead"],
  company: ["company", "account", "organization", "organisation", "business", "company name"],
  email: ["email", "email address", "mail", "work email"],
  phone: ["phone", "phone number", "mobile", "telephone", "cell"],
  secondaryPhone: ["phone 2", "secondary phone", "alt phone", "alternate phone", "phonenum2"],
  interest: ["interest", "product interest", "campaign interest", "title", "book title"],
  owner: ["owner", "assignee", "assigned to", "sales rep", "representative", "agent"],
  source: ["source", "lead source", "channel", "origin"],
  status: ["status", "lead status", "qualification status"],
  nextFollowUp: ["next follow up", "next follow-up", "follow up", "follow-up", "next touch", "followup date", "next action date"],
  role: ["role", "title", "job title", "position"],
  tags: ["tags", "tag", "labels", "segments"],
  notes: ["notes", "note", "description", "remarks", "comment", "comments"],
  archived: ["archived", "archive status", "is archived"]
};

export const LEAD_ROUND_TRIP_EXPORT_HEADERS = [
  "Lead ID",
  "Updated At",
  "Lead Name",
  "Company",
  "Email",
  "Phone",
  "Secondary Phone",
  "Source",
  "Status",
  "Interest",
  "Owner",
  "Next Follow-up",
  "Role",
  "Tags",
  "Notes",
  "Archived"
];

export function normalizeLeadImportHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function inferLeadImportMode(headers = []) {
  const normalized = new Set(headers.map(normalizeLeadImportHeader));
  const hasLeadId = LEAD_IMPORT_HEADER_ALIASES.leadId.some((alias) => normalized.has(alias));
  return hasLeadId ? LEAD_IMPORT_MODE_UPDATE : LEAD_IMPORT_MODE_NEW;
}

export function isLeadUpdateImport(mode) {
  return String(mode || "").trim() === LEAD_IMPORT_MODE_UPDATE;
}

export function resolveImportedStatus(rawStatus, options = {}) {
  const matched = LEAD_IMPORT_STATUS_OPTIONS.find(
    (status) => normalizeLeadImportHeader(status) === normalizeLeadImportHeader(rawStatus)
  );
  if (matched) {
    return { value: matched, provided: true, warning: "" };
  }
  if (String(rawStatus || "").trim()) {
    return { value: "New", provided: true, warning: `Unknown status "${String(rawStatus).trim()}". Set to New.` };
  }
  if (isLeadUpdateImport(options.mode)) {
    return {
      value: options.resetBlankStatus ? "New" : "",
      provided: Boolean(options.resetBlankStatus),
      warning: options.resetBlankStatus ? "Blank status will be reset to New." : ""
    };
  }
  return { value: "New", provided: true, warning: "" };
}

export function validateManualLeadIdentity(values = {}) {
  const errors = [];
  if (!String(values.name || "").trim()) {
    errors.push("Lead name is required.");
  }
  if (!String(values.email || "").trim() && !String(values.phone || "").replace(/\D+/g, "")) {
    errors.push("Add at least an email or phone.");
  }
  return errors;
}

export function assertLeadImportFileLimits(file, rowCount = 0) {
  if (Number(file?.size || 0) > LEAD_IMPORT_MAX_FILE_BYTES) {
    throw new Error("The import file is larger than 10 MB.");
  }
  if (Number(rowCount || 0) > LEAD_IMPORT_MAX_ROWS) {
    throw new Error(`The import contains more than ${LEAD_IMPORT_MAX_ROWS.toLocaleString()} rows. Split it into smaller files.`);
  }
}
