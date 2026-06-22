import {
  createServiceClient,
  getBearerToken,
  getSupabaseServiceRoleKey,
  handleCors,
  jsonResponse,
  methodNotAllowed
} from "../_shared/runtime.ts";
import {
  type CallerMember,
  type ImportRow,
  fetchLeadImportContext,
  normalizeText,
  processLeadImportRow,
  sanitizeImportRows
} from "../_shared/lead_import.ts";

const HEARTBEAT_STALE_MS = 90_000;

type LeadImportJobRecord = {
  id: string;
  workspace_id: string;
  created_by_member_id: string;
  status: string;
  duplicate_mode: string;
  distribution_mode: string;
  assignee_ids: string[];
  rows: unknown[];
  row_count: number;
  processed_count: number;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  assigned_count: number;
  left_unassigned_count: number;
  last_error: string;
  started_at: string | null;
  heartbeat_at: string | null;
};

function isHeartbeatFresh(value: string | null) {
  const time = Date.parse(String(value || ""));
  if (!Number.isFinite(time)) {
    return false;
  }
  return Date.now() - time < HEARTBEAT_STALE_MS;
}

function normalizeJobStatus(value: unknown) {
  const status = normalizeText(value).toLowerCase();
  return ["queued", "processing", "completed", "failed"].includes(status) ? status : "queued";
}

async function fetchJob(serviceClient: ReturnType<typeof createServiceClient>, jobId: string) {
  const { data, error } = await serviceClient
    .from("lead_import_jobs")
    .select("id,workspace_id,created_by_member_id,status,duplicate_mode,distribution_mode,assignee_ids,rows,row_count,processed_count,created_count,updated_count,skipped_count,assigned_count,left_unassigned_count,last_error,started_at,heartbeat_at")
    .eq("id", jobId)
    .single();
  if (error) {
    throw error;
  }
  return data as LeadImportJobRecord | null;
}

async function claimJobForProcessing(
  serviceClient: ReturnType<typeof createServiceClient>,
  job: LeadImportJobRecord
) {
  const nextHeartbeat = new Date().toISOString();
  let query = serviceClient
    .from("lead_import_jobs")
    .update({
      status: "processing",
      started_at: job.started_at || nextHeartbeat,
      heartbeat_at: nextHeartbeat,
      last_error: ""
    })
    .eq("id", normalizeText(job.id));

  const status = normalizeJobStatus(job.status);
  if (status === "queued") {
    query = query.eq("status", "queued");
  } else if (status === "processing" && job.heartbeat_at) {
    query = query.eq("status", "processing").eq("heartbeat_at", job.heartbeat_at);
  } else if (status === "processing") {
    query = query.eq("status", "processing");
  }

  const { data, error } = await query
    .select("id,workspace_id,created_by_member_id,status,duplicate_mode,distribution_mode,assignee_ids,rows,row_count,processed_count,created_count,updated_count,skipped_count,assigned_count,left_unassigned_count,last_error,started_at,heartbeat_at")
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data as LeadImportJobRecord | null;
}

async function updateJobProgress(
  serviceClient: ReturnType<typeof createServiceClient>,
  jobId: string,
  counts: {
    processed: number;
    created: number;
    updated: number;
    skipped: number;
    assigned: number;
    leftUnassigned: number;
  }
) {
  const { error } = await serviceClient
    .from("lead_import_jobs")
    .update({
      status: "processing",
      processed_count: counts.processed,
      created_count: counts.created,
      updated_count: counts.updated,
      skipped_count: counts.skipped,
      assigned_count: counts.assigned,
      left_unassigned_count: counts.leftUnassigned,
      last_error: "",
      heartbeat_at: new Date().toISOString()
    })
    .eq("id", jobId);
  if (error) {
    throw error;
  }
}

async function failJob(
  serviceClient: ReturnType<typeof createServiceClient>,
  jobId: string,
  message: string
) {
  const { error } = await serviceClient
    .from("lead_import_jobs")
    .update({
      status: "failed",
      last_error: normalizeText(message),
      heartbeat_at: new Date().toISOString()
    })
    .eq("id", jobId);
  if (error) {
    throw error;
  }
}

async function completeJob(
  serviceClient: ReturnType<typeof createServiceClient>,
  jobId: string,
  counts: {
    processed: number;
    created: number;
    updated: number;
    skipped: number;
    assigned: number;
    leftUnassigned: number;
  }
) {
  const nowIso = new Date().toISOString();
  const { error } = await serviceClient
    .from("lead_import_jobs")
    .update({
      status: "completed",
      processed_count: counts.processed,
      created_count: counts.created,
      updated_count: counts.updated,
      skipped_count: counts.skipped,
      assigned_count: counts.assigned,
      left_unassigned_count: counts.leftUnassigned,
      completed_at: nowIso,
      heartbeat_at: nowIso,
      last_error: "",
      rows: []
    })
    .eq("id", jobId);
  if (error) {
    throw error;
  }
}

async function loadJobCreator(
  serviceClient: ReturnType<typeof createServiceClient>,
  workspaceId: string,
  memberId: string
) {
  const { data, error } = await serviceClient
    .from("team_members")
    .select("id,workspace_id,name,email,role,status")
    .eq("workspace_id", workspaceId)
    .eq("id", memberId)
    .single();
  if (error) {
    throw error;
  }
  return data as CallerMember | null;
}

async function runLeadImportJob(
  serviceClient: ReturnType<typeof createServiceClient>,
  job: LeadImportJobRecord
) {
  const workspaceId = normalizeText(job.workspace_id);
  const callerMember = await loadJobCreator(serviceClient, workspaceId, normalizeText(job.created_by_member_id));
  if (!callerMember) {
    throw new Error("Import owner could not be resolved.");
  }

  const rows = sanitizeImportRows(job.rows);
  if (!rows.length) {
    throw new Error("Import job does not contain any rows.");
  }

  const distributionMode = normalizeText(job.distribution_mode).toLowerCase() === "unassigned" ? "unassigned" : "auto-assign";
  const context = await fetchLeadImportContext(
    serviceClient,
    workspaceId,
    [...new Set(rows.filter((row) => row.result === "update" && row.duplicateLeadId).map((row) => row.duplicateLeadId))]
  );

  const selectedAssignees =
    distributionMode === "auto-assign"
      ? context.activeAssignableMembers.filter((member) => {
          return (Array.isArray(job.assignee_ids) ? job.assignee_ids : [])
            .map((value) => normalizeText(value))
            .includes(normalizeText(member.id));
        })
      : [];
  if (distributionMode === "auto-assign" && !selectedAssignees.length) {
    throw new Error("The queued lead import no longer has any active assignees.");
  }

  let assignmentCursor = Number(job.assigned_count || 0);
  const nextAssignment = () => {
    if (distributionMode !== "auto-assign" || !selectedAssignees.length) {
      return null;
    }
    const member = selectedAssignees[assignmentCursor % selectedAssignees.length] || null;
    assignmentCursor += 1;
    return member;
  };

  const nowIso = new Date().toISOString();
  const batchId = `leadimport_job_${normalizeText(job.id)}`;
  const counts = {
    processed: Number(job.processed_count || 0),
    created: Number(job.created_count || 0),
    updated: Number(job.updated_count || 0),
    skipped: Number(job.skipped_count || 0),
    assigned: Number(job.assigned_count || 0),
    leftUnassigned: Number(job.left_unassigned_count || 0)
  };

  for (let index = counts.processed; index < rows.length; index += 1) {
    const row = rows[index] as ImportRow;
    const assignedMember = row.result === "ready" ? nextAssignment() : null;
    const result = await processLeadImportRow(serviceClient, {
      workspaceId,
      callerMember,
      row,
      teamMembers: context.teamMembers,
      accountIdByName: context.accountIdByName,
      existingLeadById: context.existingLeadById,
      duplicateMode: normalizeText(job.duplicate_mode) || "skip",
      distributionMode,
      assignedMember,
      batchId,
      nowIso
    });
    counts.processed += 1;
    counts.created += result.created;
    counts.updated += result.updated;
    counts.skipped += result.skipped;
    counts.assigned += result.assigned;
    counts.leftUnassigned += result.leftUnassigned;
    await updateJobProgress(serviceClient, normalizeText(job.id), counts);
  }

  await completeJob(serviceClient, normalizeText(job.id), counts);
  return counts;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) {
    return corsResponse;
  }
  if (req.method !== "POST") {
    return methodNotAllowed(req, ["POST"]);
  }

  const bearerToken = getBearerToken(req);
  if (!bearerToken || bearerToken !== getSupabaseServiceRoleKey()) {
    return jsonResponse(req, 401, { ok: false, error: "Unauthorized worker request" });
  }

  let jobId = "";
  try {
    const payload = await req.json().catch(() => ({}));
    jobId = normalizeText(payload.jobId);
    if (!jobId) {
      return jsonResponse(req, 400, { ok: false, error: "jobId is required" });
    }

    const serviceClient = createServiceClient();
    const job = await fetchJob(serviceClient, jobId);
    if (!job) {
      return jsonResponse(req, 404, { ok: false, error: "Lead import job not found" });
    }

    const status = normalizeJobStatus(job.status);
    if (status === "completed") {
      return jsonResponse(req, 200, { ok: true, status: "completed" });
    }
    if (status === "failed") {
      return jsonResponse(req, 409, { ok: false, error: "Lead import job has already failed." });
    }
    if (status === "processing" && isHeartbeatFresh(job.heartbeat_at)) {
      return jsonResponse(req, 200, { ok: true, status: "processing" });
    }

    const claimedJob = await claimJobForProcessing(serviceClient, job);
    if (!claimedJob) {
      const latestJob = await fetchJob(serviceClient, jobId);
      return jsonResponse(req, 200, {
        ok: true,
        status: normalizeJobStatus(latestJob?.status || "processing")
      });
    }

    const counts = await runLeadImportJob(serviceClient, claimedJob);
    return jsonResponse(req, 200, {
      ok: true,
      status: "completed",
      summary: counts
    });
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    try {
      if (jobId) {
        const serviceClient = createServiceClient();
        await failJob(serviceClient, jobId, message);
      }
    } catch (persistError) {
      console.error("lead-import-worker could not persist failure", persistError);
    }
    console.error("lead-import-worker failed", error);
    return jsonResponse(req, 500, { ok: false, error: message });
  }
});
