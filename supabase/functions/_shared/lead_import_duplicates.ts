import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  type ImportRow,
  normalizeEmail,
  normalizeMatch,
  normalizePhoneDigits,
  normalizeText
} from "./lead_import_policy.ts";

export const LEAD_IMPORT_DUPLICATE_SELECT =
  "id,workspace_id,name,company_name,email,phone,secondary_phone,role,interest,source,status,owner_member_id,next_follow_up_date,notes,tags,meta,account_id,active_pool,archived_at,updated_at";

export async function fetchLeadById(
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

export async function findExistingLeadDuplicate(
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

  const phoneKeys = [...new Set([
    normalizePhoneDigits(row.values.phone),
    normalizePhoneDigits(row.values.secondaryPhone)
  ].filter(Boolean))];
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
