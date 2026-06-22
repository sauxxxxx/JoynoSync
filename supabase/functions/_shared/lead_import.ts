import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export const MANAGE_ROLES = new Set(["Owner", "Admin"]);
export const VALID_RESULTS = new Set(["ready", "update", "duplicate", "review"]);
export const VALID_STATUSES = new Set(["New", "Contacted", "Qualified", "Unqualified", "Converted"]);
export const VALID_SOURCES = new Set(["Inbound", "Referral", "Outbound", "Event"]);

export type CallerMember = {
  id: string;
  workspace_id: string;
  name: string;
  email: string;
  role: string;
  status: string;
};

export type ImportRow = {
  rowNumber: number;
  result: string;
  duplicateLeadId: string;
  values: {
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
  };
  provided: Record<string, boolean>;
};

export type LeadImportContext = {
  teamMembers: Array<Record<string, unknown>>;
  activeAssignableMembers: Array<Record<string, unknown>>;
  accountIdByName: Map<string, string>;
  existingLeadById: Map<string, Record<string, unknown>>;
};

export type LeadImportRowResult = {
  created: number;
  updated: number;
  skipped: number;
  assigned: number;
  leftUnassigned: number;
};

const LEAD_IMPORT_DUPLICATE_SELECT =
  "id,workspace_id,name,company_name,email,phone,secondary_phone,role,interest,source,status,owner_member_id,next_follow_up_date,notes,tags,meta,account_id,active_pool";

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
    notes: Boolean(source.notes)
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
  const valuesSource = source.values && typeof source.values === "object" ? source.values as Record<string, unknown> : {};
  return {
    rowNumber: Number(source.rowNumber || 0) || 0,
    result,
    duplicateLeadId: normalizeText(source.duplicateLeadId),
    values: {
      name: normalizeText(valuesSource.name),
      company: normalizeText(valuesSource.company),
      email: normalizeEmail(valuesSource.email),
      phone: normalizeText(valuesSource.phone),
      secondaryPhone: normalizeText(valuesSource.secondaryPhone),
      interest: normalizeText(valuesSource.interest),
      owner: normalizeText(valuesSource.owner),
      source: normalizeSource(valuesSource.source),
      status: normalizeStatus(valuesSource.status),
      nextFollowUp: normalizeText(valuesSource.nextFollowUp),
      role: normalizeText(valuesSource.role),
      tags: normalizeTagArray(valuesSource.tags),
      notes: normalizeText(valuesSource.notes)
    },
    provided: normalizeBooleanMap(source.provided)
  };
}

export function sanitizeImportRows(rows: unknown) {
  return (Array.isArray(rows) ? rows : []).map(sanitizeImportRow).filter(Boolean) as ImportRow[];
}

function teamMemberStatusRank(status: unknown) {
  const normalized = normalizeText(status).toLowerCase();
  if (normalized === "active") {
    return 0;
  }
  if (normalized === "pending invite") {
    return 1;
  }
  if (normalized === "inactive") {
    return 2;
  }
  return 3;
}

function choosePreferredMember(rows: Record<string, unknown>[]) {
  if (!Array.isArray(rows) || !rows.length) {
    return null;
  }
  return [...rows].sort((left, right) => {
    const statusDiff = teamMemberStatusRank(left.status) - teamMemberStatusRank(right.status);
    if (statusDiff !== 0) {
      return statusDiff;
    }
    const leftTime = Date.parse(String(left.updated_at || left.invite_last_sent_at || left.invited_at || ""));
    const rightTime = Date.parse(String(right.updated_at || right.invite_last_sent_at || right.invited_at || ""));
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  })[0];
}

export async function resolveCallerMember(
  serviceClient: SupabaseClient,
  caller: { uid: string; email: string },
  workspaceId: string
) {
  const uid = normalizeText(caller.uid);
  const email = normalizeEmail(caller.email);

  if (uid) {
    const { data, error } = await serviceClient
      .from("team_members")
      .select("id,workspace_id,name,email,role,status,updated_at,invite_last_sent_at,invited_at")
      .eq("workspace_id", workspaceId)
      .eq("auth_user_id", uid)
      .order("updated_at", { ascending: false });
    if (error) {
      throw error;
    }
    const preferred = choosePreferredMember((data || []) as Record<string, unknown>[]);
    if (preferred) {
      return preferred as CallerMember;
    }
  }

  if (email) {
    const { data, error } = await serviceClient
      .from("team_members")
      .select("id,workspace_id,name,email,role,status,updated_at,invite_last_sent_at,invited_at")
      .eq("workspace_id", workspaceId)
      .eq("email", email)
      .order("updated_at", { ascending: false });
    if (error) {
      throw error;
    }
    const preferred = choosePreferredMember((data || []) as Record<string, unknown>[]);
    if (preferred) {
      return preferred as CallerMember;
    }
  }

  return null;
}

export function matchMemberByName(name: string, members: Array<Record<string, unknown>>) {
  const normalizedName = normalizeMatch(name);
  if (!normalizedName) {
    return null;
  }
  const exact = members.find((member) => normalizeMatch(member.name) === normalizedName) || null;
  if (exact) {
    return exact;
  }
  return (
    members.find((member) => {
      const memberName = normalizeMatch(member.name);
      const firstName = memberName.split(" ")[0] || "";
      return (
        firstName === normalizedName ||
        memberName.startsWith(`${normalizedName} `) ||
        normalizedName.startsWith(`${firstName} `)
      );
    }) || null
  );
}

export async function fetchLeadImportContext(
  serviceClient: SupabaseClient,
  workspaceId: string,
  updateLeadIds: string[]
): Promise<LeadImportContext> {
  const { data: workspaceMembers, error: workspaceMembersError } = await serviceClient
    .from("team_members")
    .select("id,name,email,role,status")
    .eq("workspace_id", workspaceId)
    .order("name", { ascending: true });
  if (workspaceMembersError) {
    throw workspaceMembersError;
  }
  const teamMembers = (workspaceMembers || []) as Array<Record<string, unknown>>;
  const activeAssignableMembers = teamMembers.filter((member) => {
    return normalizeText(member.status) === "Active" && normalizeText(member.role) !== "Guest";
  });

  const { data: accountRows, error: accountError } = await serviceClient
    .from("accounts")
    .select("id,name")
    .eq("workspace_id", workspaceId)
    .is("archived_at", null);
  if (accountError) {
    throw accountError;
  }
  const accountIdByName = new Map<string, string>();
  (accountRows || []).forEach((account) => {
    const key = normalizeMatch(account.name);
    const id = normalizeText(account.id);
    if (key && id && !accountIdByName.has(key)) {
      accountIdByName.set(key, id);
    }
  });

  const existingLeadById = new Map<string, Record<string, unknown>>();
  if (updateLeadIds.length) {
    const { data: existingLeads, error: existingLeadError } = await serviceClient
      .from("leads")
      .select(LEAD_IMPORT_DUPLICATE_SELECT)
      .eq("workspace_id", workspaceId)
      .in("id", updateLeadIds);
    if (existingLeadError) {
      throw existingLeadError;
    }
    (existingLeads || []).forEach((lead) => {
      const id = normalizeText(lead.id);
      if (id) {
        existingLeadById.set(id, lead as Record<string, unknown>);
      }
    });
  }

  return {
    teamMembers,
    activeAssignableMembers,
    accountIdByName,
    existingLeadById
  };
}

async function fetchLeadById(
  serviceClient: SupabaseClient,
  workspaceId: string,
  leadId: string
) {
  const normalizedLeadId = normalizeText(leadId);
  if (!normalizedLeadId) {
    return null;
  }
  const { data, error } = await serviceClient
    .from("leads")
    .select(LEAD_IMPORT_DUPLICATE_SELECT)
    .eq("workspace_id", workspaceId)
    .eq("id", normalizedLeadId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data ? (data as Record<string, unknown>) : null;
}

async function findExistingLeadDuplicate(
  serviceClient: SupabaseClient,
  workspaceId: string,
  row: ImportRow,
  existingLeadById: Map<string, Record<string, unknown>>
) {
  const duplicateLeadId = normalizeText(row.duplicateLeadId);
  if (duplicateLeadId) {
    const cached = existingLeadById.get(duplicateLeadId);
    if (cached) {
      return cached;
    }
    const fetched = await fetchLeadById(serviceClient, workspaceId, duplicateLeadId);
    if (fetched) {
      existingLeadById.set(duplicateLeadId, fetched);
      return fetched;
    }
  }

  const emailKey = normalizeEmail(row.values.email);
  if (emailKey) {
    const { data, error } = await serviceClient
      .from("leads")
      .select(LEAD_IMPORT_DUPLICATE_SELECT)
      .eq("workspace_id", workspaceId)
      .eq("email", emailKey)
      .limit(1);
    if (error) {
      throw error;
    }
    const match = Array.isArray(data) ? data[0] : null;
    if (match) {
      existingLeadById.set(normalizeText(match.id), match as Record<string, unknown>);
      return match as Record<string, unknown>;
    }
  }

  const phoneKeys = [...new Set([normalizePhoneDigits(row.values.phone), normalizePhoneDigits(row.values.secondaryPhone)].filter(Boolean))];
  for (const phoneKey of phoneKeys) {
    const { data, error } = await serviceClient
      .from("leads")
      .select(LEAD_IMPORT_DUPLICATE_SELECT)
      .eq("workspace_id", workspaceId)
      .or(`phone.eq.${phoneKey},secondary_phone.eq.${phoneKey}`)
      .limit(1);
    if (error) {
      throw error;
    }
    const match = Array.isArray(data) ? data[0] : null;
    if (match) {
      existingLeadById.set(normalizeText(match.id), match as Record<string, unknown>);
      return match as Record<string, unknown>;
    }
  }

  const exactName = normalizeText(row.values.name);
  const exactCompany = normalizeText(row.values.company);
  if (exactName && exactCompany) {
    const { data, error } = await serviceClient
      .from("leads")
      .select(LEAD_IMPORT_DUPLICATE_SELECT)
      .eq("workspace_id", workspaceId)
      .eq("name", exactName)
      .eq("company_name", exactCompany)
      .limit(1);
    if (error) {
      throw error;
    }
    const match = Array.isArray(data) ? data[0] : null;
    if (match) {
      existingLeadById.set(normalizeText(match.id), match as Record<string, unknown>);
      return match as Record<string, unknown>;
    }
  }

  return null;
}

export async function processLeadImportRow(
  serviceClient: SupabaseClient,
  options: {
    workspaceId: string;
    callerMember: CallerMember;
    row: ImportRow;
    teamMembers: Array<Record<string, unknown>>;
    accountIdByName: Map<string, string>;
    existingLeadById: Map<string, Record<string, unknown>>;
    duplicateMode: string;
    distributionMode: string;
    assignedMember: Record<string, unknown> | null;
    batchId: string;
    nowIso: string;
  }
): Promise<LeadImportRowResult> {
  const {
    workspaceId,
    callerMember,
    row,
    teamMembers,
    accountIdByName,
    existingLeadById,
    duplicateMode,
    distributionMode,
    assignedMember,
    batchId,
    nowIso
  } = options;

  if (row.result === "review" || (row.result === "duplicate" && !normalizeText(row.duplicateLeadId))) {
    return {
      created: 0,
      updated: 0,
      skipped: 1,
      assigned: 0,
      leftUnassigned: 0
    };
  }

  const normalizedDuplicateMode = normalizeText(duplicateMode).toLowerCase();
  const existingLead =
    row.result === "update" || row.result === "duplicate" || row.result === "ready"
      ? await findExistingLeadDuplicate(serviceClient, workspaceId, row, existingLeadById)
      : null;

  if (existingLead && normalizedDuplicateMode === "skip" && row.result !== "update") {
    return {
      created: 0,
      updated: 0,
      skipped: 1,
      assigned: 0,
      leftUnassigned: 0
    };
  }

  if (existingLead && normalizedDuplicateMode === "update") {
    const nextCompanyName = row.provided.company ? row.values.company : normalizeText(existingLead.company_name);
    const nextOwner = row.provided.owner ? matchMemberByName(row.values.owner, teamMembers) : null;
    const updatePayload: Record<string, unknown> = {
      updated_by_member_id: normalizeText(callerMember.id)
    };

    if (row.provided.name) {
      updatePayload.name = row.values.name;
    }
    if (row.provided.company) {
      updatePayload.company_name = nextCompanyName;
      updatePayload.account_id = accountIdByName.get(normalizeMatch(nextCompanyName)) || null;
    }
    if (row.provided.email) {
      updatePayload.email = row.values.email;
    }
    if (row.provided.phone) {
      updatePayload.phone = row.values.phone;
    }
    if (row.provided.secondaryPhone) {
      updatePayload.secondary_phone = row.values.secondaryPhone;
    }
    if (row.provided.interest) {
      updatePayload.interest = row.values.interest;
    }
    if (row.provided.owner) {
      updatePayload.owner_member_id = normalizeText(nextOwner?.id) || normalizeText(existingLead.owner_member_id) || null;
      if (normalizeText(updatePayload.owner_member_id)) {
        updatePayload.active_pool = true;
      }
    }
    if (row.provided.source && normalizeSource(row.values.source)) {
      updatePayload.source = normalizeSource(row.values.source);
    }
    if (row.provided.status) {
      updatePayload.status = normalizeStatus(row.values.status);
    }
    if (row.provided.nextFollowUp) {
      updatePayload.next_follow_up_date = normalizeDateOnly(row.values.nextFollowUp);
    }
    if (row.provided.role) {
      updatePayload.role = row.values.role;
    }
    if (row.provided.tags) {
      updatePayload.tags = row.values.tags;
    }
    if (row.provided.notes) {
      updatePayload.notes = row.values.notes;
    }

    const { error } = await serviceClient
      .from("leads")
      .update(updatePayload)
      .eq("workspace_id", workspaceId)
      .eq("id", normalizeText(existingLead.id));
    if (error) {
      throw error;
    }
    return {
      created: 0,
      updated: 1,
      skipped: 0,
      assigned: 0,
      leftUnassigned: 0
    };
  }

  const companyName = row.values.company;
  const assignmentMeta =
    distributionMode === "auto-assign" && assignedMember
      ? {
          assignmentState: "assigned",
          assignedAt: nowIso,
          assignedBy: normalizeText(callerMember.name),
          assignmentBatchId: batchId
        }
      : {
          assignmentState: "unassigned",
          assignedAt: "",
          assignedBy: "",
          assignmentBatchId: ""
        };

  const insertPayload = {
    workspace_id: workspaceId,
    account_id: accountIdByName.get(normalizeMatch(companyName)) || null,
    name: row.values.name,
    company_name: companyName,
    email: row.values.email,
    phone: row.values.phone,
    secondary_phone: row.values.secondaryPhone,
    role: row.values.role,
    interest: row.values.interest,
    source: row.provided.source ? normalizeSource(row.values.source) : "",
    status: normalizeStatus(row.values.status),
    owner_member_id: normalizeText(assignedMember?.id) || null,
    active_pool: Boolean(distributionMode === "auto-assign" && assignedMember),
    next_follow_up_date: normalizeDateOnly(row.values.nextFollowUp),
    notes: row.values.notes,
    tags: row.values.tags,
    meta: assignmentMeta,
    created_by_member_id: normalizeText(callerMember.id),
    updated_by_member_id: normalizeText(callerMember.id)
  };

  const { error } = await serviceClient.from("leads").insert(insertPayload);
  if (error) {
    throw error;
  }

  const assigned = distributionMode === "auto-assign" && assignedMember ? 1 : 0;
  return {
    created: 1,
    updated: 0,
    skipped: 0,
    assigned,
    leftUnassigned: assigned ? 0 : 1
  };
}
