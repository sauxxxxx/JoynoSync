import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  type ImportRow,
  normalizeDateOnly,
  normalizeEmail,
  normalizeMatch,
  normalizePhoneDigits,
  normalizeSource,
  normalizeStatus,
  normalizeText
} from "./lead_import_policy.ts";
export {
  type ImportRow,
  normalizeDateOnly,
  normalizeEmail,
  normalizeMatch,
  normalizePhoneDigits,
  normalizeSource,
  normalizeStatus,
  normalizeText,
  sanitizeImportRow,
  sanitizeImportRows
} from "./lead_import_policy.ts";

export const MANAGE_ROLES = new Set(["Owner", "Admin"]);

export type CallerMember = {
  id: string;
  workspace_id: string;
  name: string;
  email: string;
  role: string;
  status: string;
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
  operation?: "created" | "updated" | "skipped";
  leadId?: string;
  reason?: string;
  before?: Record<string, unknown> | null;
};

const LEAD_IMPORT_DUPLICATE_SELECT =
  "id,workspace_id,name,company_name,email,phone,secondary_phone,role,interest,source,status,owner_member_id,next_follow_up_date,notes,tags,meta,account_id,active_pool,archived_at,updated_at";


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
      .ilike("email", emailKey)
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
      .or(`phone_digits.eq.${phoneKey},secondary_phone_digits.eq.${phoneKey}`)
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
      .eq("name_match", normalizeMatch(exactName))
      .eq("company_match", normalizeMatch(exactCompany))
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
    importMode?: string;
    restoreArchived?: boolean;
    importJobId?: string;
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
    nowIso,
    importMode = "new",
    restoreArchived = false,
    importJobId = ""
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
  const updateByLeadId = normalizeText(importMode) === "update-exported";
  const existingLead = updateByLeadId
    ? await fetchLeadById(serviceClient, workspaceId, normalizeText(row.values.leadId))
    : row.result === "update" || row.result === "duplicate" || row.result === "ready"
      ? await findExistingLeadDuplicate(serviceClient, workspaceId, row, existingLeadById)
      : null;

  if (updateByLeadId && !existingLead) {
    return { created: 0, updated: 0, skipped: 1, assigned: 0, leftUnassigned: 0, operation: "skipped", reason: "Lead ID was not found." };
  }
  const exportedVersion = normalizeText(row.values.updatedAt);
  if (updateByLeadId && exportedVersion && normalizeText(existingLead?.updated_at) !== exportedVersion) {
    return {
      created: 0,
      updated: 0,
      skipped: 1,
      assigned: 0,
      leftUnassigned: 0,
      operation: "skipped",
      leadId: normalizeText(existingLead?.id),
      reason: "Lead changed after it was exported."
    };
  }

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
    if (updateByLeadId && restoreArchived) {
      updatePayload.archived_at = null;
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
      leftUnassigned: 0,
      operation: "updated",
      leadId: normalizeText(existingLead.id),
      before: existingLead
    };
  }

  const companyName = row.values.company;
  const importKey = importJobId ? `${importJobId}:${row.rowNumber}` : "";
  if (importKey) {
    const { data: priorRows, error: priorError } = await serviceClient
      .from("leads")
      .select("id")
      .eq("workspace_id", workspaceId)
      .contains("meta", { importKey })
      .limit(1);
    if (priorError) {
      throw priorError;
    }
    const priorLead = Array.isArray(priorRows) ? priorRows[0] : null;
    if (priorLead) {
      return {
        created: 1,
        updated: 0,
        skipped: 0,
        assigned: distributionMode === "auto-assign" && assignedMember ? 1 : 0,
        leftUnassigned: distributionMode === "auto-assign" && assignedMember ? 0 : 1,
        operation: "created",
        leadId: normalizeText(priorLead.id)
      };
    }
  }
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
    meta: {
      ...assignmentMeta,
      ...(importJobId ? { importJobId, importRowNumber: row.rowNumber, importKey } : {})
    },
    created_by_member_id: normalizeText(callerMember.id),
    updated_by_member_id: normalizeText(callerMember.id)
  };

  const { data: insertedLead, error } = await serviceClient.from("leads").insert(insertPayload).select("id").single();
  if (error) {
    throw error;
  }

  const assigned = distributionMode === "auto-assign" && assignedMember ? 1 : 0;
  return {
    created: 1,
    updated: 0,
    skipped: 0,
    assigned,
    leftUnassigned: assigned ? 0 : 1,
    operation: "created",
    leadId: normalizeText(insertedLead?.id)
  };
}
