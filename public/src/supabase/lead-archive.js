import { initSupabase } from "./init.js";

const ARCHIVE_ROW_SELECT = [
  "id",
  "workspace_id",
  "name",
  "company_name",
  "email",
  "phone",
  "source",
  "status",
  "owner_member_id",
  "created_at",
  "updated_at",
  "archived_at",
  "active_pool"
].join(",");

function getClient() {
  const services = initSupabase();
  if (!services.configured || !services.client) {
    throw new Error("Supabase is not configured.");
  }
  return services.client;
}

function normalizeText(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function isMissingArchiveRpc(error) {
  return Boolean(
    error &&
      (error.code === "PGRST202" ||
        String(error.message || "").includes("Could not find the function"))
  );
}

function sanitizeSearchTerm(value) {
  return normalizeText(value)
    .replaceAll(",", " ")
    .replaceAll("(", " ")
    .replaceAll(")", " ")
    .replaceAll("%", " ")
    .replaceAll("_", " ")
    .trim();
}

function buildMemberNameMap(teamMembers = []) {
  return new Map(
    (Array.isArray(teamMembers) ? teamMembers : [])
      .map((member) => [normalizeText(member?.id), normalizeText(member?.name)])
      .filter(([id, name]) => id && name)
  );
}

function mapArchivedLeadRow(row, memberNameMap) {
  const ownerId = normalizeText(row?.owner_member_id ?? row?.ownerMemberId);
  return {
    id: normalizeText(row?.id),
    workspaceId: normalizeText(row?.workspace_id ?? row?.workspaceId),
    name: normalizeText(row?.name, "Unnamed lead"),
    company: normalizeText(row?.company_name ?? row?.companyName),
    email: normalizeText(row?.email).toLowerCase(),
    phone: normalizeText(row?.phone),
    source: normalizeText(row?.source),
    status: normalizeText(row?.status, "New"),
    ownerId,
    owner: normalizeText(row?.owner_name ?? row?.ownerName ?? memberNameMap.get(ownerId)),
    createdAt: normalizeText(row?.created_at ?? row?.createdAt),
    updatedAt: normalizeText(row?.updated_at ?? row?.updatedAt),
    archivedAt: normalizeText(row?.archived_at ?? row?.archivedAt),
    activePool: (row?.active_pool ?? row?.activePool) !== false,
    archived: true
  };
}

function normalizeArchivePage(data, options, teamMembers) {
  const memberNameMap = buildMemberNameMap(teamMembers);
  const page = Math.max(1, Number(data?.page || options.page) || 1);
  const pageSize = Math.max(1, Number(data?.pageSize || options.pageSize) || 25);
  const rows = (Array.isArray(data?.rows) ? data.rows : []).map((row) =>
    mapArchivedLeadRow(row, memberNameMap)
  );
  const totalCount = Math.max(0, Number(data?.totalCount ?? data?.total_count ?? rows.length) || 0);
  return {
    rows,
    totalCount,
    page,
    pageSize,
    hasMore: Object.hasOwn(data || {}, "hasMore")
      ? Boolean(data.hasMore)
      : page * pageSize < totalCount
  };
}

async function fetchArchivedLeadsDirect(client, workspaceId, options) {
  const page = Math.max(1, Number(options.page) || 1);
  const pageSize = Math.max(1, Math.min(100, Number(options.pageSize) || 25));
  const statusFilter = normalizeText(options.statusFilter, "all");
  const searchTerm = sanitizeSearchTerm(options.searchTerm);
  let query = client
    .from("leads")
    .select(ARCHIVE_ROW_SELECT, { count: "exact" })
    .eq("workspace_id", workspaceId)
    .not("archived_at", "is", null);

  if (statusFilter !== "all") {
    query = query.eq("status", statusFilter);
  }
  if (searchTerm) {
    const pattern = `%${searchTerm.replaceAll(".", "\\.")}%`;
    query = query.or(
      ["name", "company_name", "email", "phone", "source", "status"]
        .map((column) => `${column}.ilike.${pattern}`)
        .join(",")
    );
  }

  const { data, count, error } = await query
    .order("archived_at", { ascending: false })
    .order("id", { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) {
    throw error;
  }
  return {
    rows: data || [],
    totalCount: Number(count || 0),
    page,
    pageSize,
    hasMore: page * pageSize < Number(count || 0)
  };
}

export async function fetchArchivedLeadsPage(workspaceId, options = {}) {
  const normalizedWorkspaceId = normalizeText(workspaceId);
  if (!normalizedWorkspaceId) {
    return { rows: [], totalCount: 0, page: 1, pageSize: 25, hasMore: false };
  }

  const client = getClient();
  const request = {
    page: Math.max(1, Number(options.page) || 1),
    pageSize: Math.max(1, Math.min(100, Number(options.pageSize) || 25)),
    statusFilter: normalizeText(options.statusFilter, "all"),
    searchTerm: sanitizeSearchTerm(options.searchTerm)
  };
  const { data, error } = await client.rpc("get_archived_leads_page", {
    p_page: request.page,
    p_page_size: request.pageSize,
    p_status_filter: request.statusFilter,
    p_search_term: request.searchTerm
  });

  if (!error) {
    return normalizeArchivePage(data, request, options.teamMembers);
  }
  if (!isMissingArchiveRpc(error)) {
    throw error;
  }

  const fallback = await fetchArchivedLeadsDirect(client, normalizedWorkspaceId, request);
  return normalizeArchivePage(fallback, request, options.teamMembers);
}

export async function restoreArchivedLead(leadId) {
  const normalizedLeadId = normalizeText(leadId);
  if (!normalizedLeadId) {
    throw new Error("Choose a lead to restore.");
  }
  const client = getClient();
  const { data, error } = await client.rpc("restore_archived_lead", {
    p_lead_id: normalizedLeadId
  });
  if (!error) {
    return data;
  }
  if (!isMissingArchiveRpc(error)) {
    throw error;
  }
  throw new Error("Archived lead restore is not configured yet. Apply the admin lead archive migration first.");
}

export async function permanentlyDeleteArchivedLead(leadId) {
  const normalizedLeadId = normalizeText(leadId);
  if (!normalizedLeadId) {
    throw new Error("Choose a lead to delete.");
  }
  const client = getClient();
  const { data, error } = await client.rpc("permanently_delete_archived_lead", {
    p_lead_id: normalizedLeadId
  });
  if (!error) {
    return data;
  }
  if (!isMissingArchiveRpc(error)) {
    throw error;
  }
  throw new Error("Permanent lead deletion is not configured yet. Apply the admin lead archive migration first.");
}
