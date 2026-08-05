export const VALID_RESULTS = new Set(["ready", "update", "duplicate", "review"]);
export const VALID_STATUSES = new Set(["New", "Contacted", "Qualified", "Unqualified", "Converted"]);
export const VALID_SOURCES = new Set(["Inbound", "Referral", "Outbound", "Event"]);

export type ImportRow = {
  rowNumber: number;
  result: string;
  duplicateLeadId: string;
  values: {
    leadId: string;
    updatedAt: string;
    name: string;
    company: string;
    email: string;
    phone: string;
    secondaryPhone: string;
    interest: string;
    owner: string;
    source: string;
    status: string;
    nextFollowUp: string;
    role: string;
    tags: string[];
    notes: string;
    archived: string;
  };
  provided: Record<string, boolean>;
};

export function normalizeText(value: unknown) {
  return String(value || "").trim();
}

export function normalizeEmail(value: unknown) {
  return normalizeText(value).toLowerCase();
}

export function normalizePhoneDigits(value: unknown) {
  return normalizeText(value).replace(/\D+/g, "");
}

export function normalizeMatch(value: unknown) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, " ");
}

export function normalizeStatus(value: unknown) {
  const status = normalizeText(value);
  return VALID_STATUSES.has(status) ? status : "New";
}

export function normalizeSource(value: unknown) {
  const source = normalizeText(value);
  return VALID_SOURCES.has(source) ? source : "";
}

export function normalizeDateOnly(value: unknown) {
  const text = normalizeText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export function normalizeTagArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => normalizeText(item)).filter(Boolean);
}

export function normalizeBooleanMap(value: unknown) {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    leadId: Boolean(source.leadId),
    updatedAt: Boolean(source.updatedAt),
    name: Boolean(source.name),
    company: Boolean(source.company),
    email: Boolean(source.email),
    phone: Boolean(source.phone),
    secondaryPhone: Boolean(source.secondaryPhone),
    interest: Boolean(source.interest),
    owner: Boolean(source.owner),
    source: Boolean(source.source),
    status: Boolean(source.status),
    nextFollowUp: Boolean(source.nextFollowUp),
    role: Boolean(source.role),
    tags: Boolean(source.tags),
    notes: Boolean(source.notes),
    archived: Boolean(source.archived)
  };
}

export function sanitizeImportRow(row: unknown): ImportRow | null {
  const source = row && typeof row === "object" ? row as Record<string, unknown> : null;
  if (!source) {
    return null;
  }
  const result = normalizeText(source.result).toLowerCase();
  if (!VALID_RESULTS.has(result)) {
    return null;
  }
  const values = source.values && typeof source.values === "object" ? source.values as Record<string, unknown> : {};
  return {
    rowNumber: Number(source.rowNumber || 0) || 0,
    result,
    duplicateLeadId: normalizeText(source.duplicateLeadId),
    values: {
      leadId: normalizeText(values.leadId),
      updatedAt: normalizeText(values.updatedAt),
      name: normalizeText(values.name),
      company: normalizeText(values.company),
      email: normalizeEmail(values.email),
      phone: normalizeText(values.phone),
      secondaryPhone: normalizeText(values.secondaryPhone),
      interest: normalizeText(values.interest),
      owner: normalizeText(values.owner),
      source: normalizeSource(values.source),
      status: normalizeStatus(values.status),
      nextFollowUp: normalizeText(values.nextFollowUp),
      role: normalizeText(values.role),
      tags: normalizeTagArray(values.tags),
      notes: normalizeText(values.notes),
      archived: normalizeText(values.archived)
    },
    provided: normalizeBooleanMap(source.provided)
  };
}

export function sanitizeImportRows(rows: unknown) {
  return (Array.isArray(rows) ? rows : []).map(sanitizeImportRow).filter(Boolean) as ImportRow[];
}
