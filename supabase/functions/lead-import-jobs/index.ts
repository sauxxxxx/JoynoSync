import {
  createServiceClient,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
  handleCors,
  jsonResponse,
  methodNotAllowed,
  requireCaller
} from "../_shared/runtime.ts";
import {
  MANAGE_ROLES,
  normalizeText,
  resolveCallerMember,
  sanitizeImportRows
} from "../_shared/lead_import.ts";

const HEARTBEAT_STALE_MS = 90_000;

type LeadImportJobRow = {
  id: string;
  workspace_id: string;
  created_by_member_id: string;
  file_name: string;
  status: string;
  duplicate_mode: string;
  distribution_mode: string;
  distribution_method: string;
  assignee_ids: string[];
  row_count: number;
  processed_count: number;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  assigned_count: number;
  left_unassigned_count: number;
  last_error: string;
  started_at: string | null;
  completed_at: string | null;
  heartbeat_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function normalizeDuplicateMode(value: unknown) {
  const mode = normalizeText(value).toLowerCase();
  return ["skip", "update", "create"].includes(mode) ? mode : "skip";
}

function normalizeDistributionMode(value: unknown) {
  return normalizeText(value).toLowerCase() === "unassigned" ? "unassigned" : "auto-assign";
}

function isHeartbeatStale(value: string | null) {
  const time = Date.parse(String(value || ""));
  if (!Number.isFinite(time)) {
    return true;
  }
  return Date.now() - time >= HEARTBEAT_STALE_MS;
}

function serializeJob(row: LeadImportJobRow | null) {
  if (!row) {
    return null;
  }
  return {
    id: normalizeText(row.id),
    workspaceId: normalizeText(row.workspace_id),
    createdByMemberId: normalizeText(row.created_by_member_id),
    fileName: normalizeText(row.file_name),
    status: normalizeText(row.status) || "queued",
    duplicateMode: normalizeText(row.duplicate_mode) || "skip",
    distributionMode: normalizeText(row.distribution_mode) || "auto-assign",
    distributionMethod: normalizeText(row.distribution_method) || "round-robin",
    assigneeIds: Array.isArray(row.assignee_ids) ? row.assignee_ids.map((value) => normalizeText(value)).filter(Boolean) : [],
    rowCount: Number(row.row_count || 0),
    processedCount: Number(row.processed_count || 0),
    createdCount: Number(row.created_count || 0),
    updatedCount: Number(row.updated_count || 0),
    skippedCount: Number(row.skipped_count || 0),
    assignedCount: Number(row.assigned_count || 0),
    leftUnassignedCount: Number(row.left_unassigned_count || 0),
    lastError: normalizeText(row.last_error),
    startedAt: normalizeText(row.started_at),
    completedAt: normalizeText(row.completed_at),
    heartbeatAt: normalizeText(row.heartbeat_at),
    createdAt: normalizeText(row.created_at),
    updatedAt: normalizeText(row.updated_at)
  };
}

async function triggerLeadImportWorker(jobId: string) {
  const response = await fetch(`${getSupabaseUrl()}/functions/v1/lead-import-worker`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getSupabaseServiceRoleKey()}`,
      apikey: getSupabaseServiceRoleKey()
    },
    body: JSON.stringify({ jobId })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.warn("lead-import-worker trigger failed", response.status, detail);
  }
}

function scheduleWorker(jobId: string) {
  const task = triggerLeadImportWorker(jobId).catch((error) => {
    console.error("lead-import-worker schedule failed", error);
  });
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime && typeof runtime.waitUntil === "function") {
    runtime.waitUntil(task);
    return;
  }
  void task;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) {
    return corsResponse;
  }
  if (!["GET", "POST"].includes(req.method)) {
    return methodNotAllowed(req, ["GET", "POST"]);
  }

  const auth = await requireCaller(req);
  if (auth.response) {
    return auth.response;
  }

  try {
    const serviceClient = createServiceClient();

    if (req.method === "POST") {
      const payload = await req.json().catch(() => ({}));
      const workspaceId = normalizeText(payload.workspaceId);
      if (!workspaceId) {
        return jsonResponse(req, 400, { ok: false, error: "workspaceId is required" });
      }

      const callerMember = await resolveCallerMember(serviceClient, {
        uid: String(auth.caller?.uid || ""),
        email: String(auth.caller?.email || "")
      }, workspaceId);

      if (!callerMember || normalizeText(callerMember.status) !== "Active") {
        return jsonResponse(req, 403, { ok: false, error: "Caller does not have active workspace access" });
      }
      if (!MANAGE_ROLES.has(normalizeText(callerMember.role))) {
        return jsonResponse(req, 403, { ok: false, error: "Only owners or admins can import leads" });
      }

      const rows = sanitizeImportRows(payload.rows);
      if (!rows.length) {
        return jsonResponse(req, 400, { ok: false, error: "Import rows are required" });
      }

      const distributionMode = normalizeDistributionMode(payload.distributionMode);
      const assigneeIds = Array.isArray(payload.assigneeIds)
        ? payload.assigneeIds.map((value: unknown) => normalizeText(value)).filter(Boolean)
        : [];

      const { data: workspaceMembers, error: workspaceMembersError } = await serviceClient
        .from("team_members")
        .select("id,role,status")
        .eq("workspace_id", workspaceId);
      if (workspaceMembersError) {
        throw workspaceMembersError;
      }

      const activeAssignableMemberIds = (workspaceMembers || [])
        .filter((member) => normalizeText(member.status) === "Active" && normalizeText(member.role) !== "Guest")
        .map((member) => normalizeText(member.id))
        .filter(Boolean);
      const selectedAssigneeIds = assigneeIds.filter((id) => activeAssignableMemberIds.includes(id));
      if (distributionMode === "auto-assign" && !selectedAssigneeIds.length) {
        return jsonResponse(req, 400, { ok: false, error: "Select at least one active assignee for auto-assignment" });
      }

      const insertPayload = {
        workspace_id: workspaceId,
        created_by_member_id: normalizeText(callerMember.id),
        file_name: normalizeText(payload.fileName),
        status: "queued",
        duplicate_mode: normalizeDuplicateMode(payload.duplicateMode),
        distribution_mode: distributionMode,
        distribution_method: "round-robin",
        assignee_ids: selectedAssigneeIds,
        rows,
        row_count: rows.length,
        processed_count: 0,
        created_count: 0,
        updated_count: 0,
        skipped_count: 0,
        assigned_count: 0,
        left_unassigned_count: 0,
        last_error: "",
        heartbeat_at: new Date().toISOString()
      };

      const { data: insertedJob, error: insertError } = await serviceClient
        .from("lead_import_jobs")
        .insert(insertPayload)
        .select("id,workspace_id,created_by_member_id,file_name,status,duplicate_mode,distribution_mode,distribution_method,assignee_ids,row_count,processed_count,created_count,updated_count,skipped_count,assigned_count,left_unassigned_count,last_error,started_at,completed_at,heartbeat_at,created_at,updated_at")
        .single();
      if (insertError) {
        throw insertError;
      }

      const job = serializeJob(insertedJob as LeadImportJobRow);
      if (job?.id) {
        scheduleWorker(job.id);
      }

      return jsonResponse(req, 200, {
        ok: true,
        job
      });
    }

    const url = new URL(req.url);
    const workspaceId = normalizeText(url.searchParams.get("workspaceId"));
    const jobId = normalizeText(url.searchParams.get("jobId"));
    if (!workspaceId || !jobId) {
      return jsonResponse(req, 400, { ok: false, error: "workspaceId and jobId are required" });
    }

    const callerMember = await resolveCallerMember(serviceClient, {
      uid: String(auth.caller?.uid || ""),
      email: String(auth.caller?.email || "")
    }, workspaceId);

    if (!callerMember || normalizeText(callerMember.status) !== "Active") {
      return jsonResponse(req, 403, { ok: false, error: "Caller does not have active workspace access" });
    }
    if (!MANAGE_ROLES.has(normalizeText(callerMember.role))) {
      return jsonResponse(req, 403, { ok: false, error: "Only owners or admins can view lead import jobs" });
    }

    const { data: jobRow, error: jobError } = await serviceClient
      .from("lead_import_jobs")
      .select("id,workspace_id,created_by_member_id,file_name,status,duplicate_mode,distribution_mode,distribution_method,assignee_ids,row_count,processed_count,created_count,updated_count,skipped_count,assigned_count,left_unassigned_count,last_error,started_at,completed_at,heartbeat_at,created_at,updated_at")
      .eq("workspace_id", workspaceId)
      .eq("id", jobId)
      .single();
    if (jobError) {
      throw jobError;
    }

    const job = serializeJob(jobRow as LeadImportJobRow);
    if (!job) {
      return jsonResponse(req, 404, { ok: false, error: "Lead import job not found" });
    }

    if (job.status === "queued" || (job.status === "processing" && isHeartbeatStale(job.heartbeatAt || null))) {
      scheduleWorker(job.id);
    }

    return jsonResponse(req, 200, { ok: true, job });
  } catch (error) {
    console.error("lead-import-jobs failed", error);
    return jsonResponse(req, 500, { ok: false, error: String(error instanceof Error ? error.message : error) });
  }
});
