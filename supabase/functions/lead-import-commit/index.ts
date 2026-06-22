import { createServiceClient, handleCors, jsonResponse, methodNotAllowed, requireCaller } from "../_shared/runtime.ts";
import {
  MANAGE_ROLES,
  fetchLeadImportContext,
  normalizeText,
  processLeadImportRow,
  resolveCallerMember,
  sanitizeImportRows
} from "../_shared/lead_import.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) {
    return corsResponse;
  }
  if (req.method !== "POST") {
    return methodNotAllowed(req, ["POST"]);
  }

  const auth = await requireCaller(req);
  if (auth.response) {
    return auth.response;
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const workspaceId = normalizeText(payload.workspaceId);
    if (!workspaceId) {
      return jsonResponse(req, 400, { ok: false, error: "workspaceId is required" });
    }

    const rows = sanitizeImportRows(payload.rows);
    if (!rows.length) {
      return jsonResponse(req, 400, { ok: false, error: "Import rows are required" });
    }

    const duplicateMode = ["skip", "update", "create"].includes(normalizeText(payload.duplicateMode).toLowerCase())
      ? normalizeText(payload.duplicateMode).toLowerCase()
      : "skip";
    const distributionMode = normalizeText(payload.distributionMode).toLowerCase() === "unassigned" ? "unassigned" : "auto-assign";
    const assigneeIds = Array.isArray(payload.assigneeIds)
      ? payload.assigneeIds.map((value: unknown) => normalizeText(value)).filter(Boolean)
      : [];

    const serviceClient = createServiceClient();
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

    const context = await fetchLeadImportContext(
      serviceClient,
      workspaceId,
      [...new Set(rows.filter((row) => row.result === "update" && row.duplicateLeadId).map((row) => row.duplicateLeadId))]
    );
    const selectedAssignees =
      distributionMode === "auto-assign"
        ? context.activeAssignableMembers.filter((member) => assigneeIds.includes(normalizeText(member.id)))
        : [];
    if (distributionMode === "auto-assign" && !selectedAssignees.length) {
      return jsonResponse(req, 400, { ok: false, error: "Select at least one active assignee for auto-assignment" });
    }

    let assignmentCursor = 0;
    const batchId = `leadimport_${Date.now()}`;
    const nowIso = new Date().toISOString();
    const nextAssignment = () => {
      if (distributionMode !== "auto-assign" || !selectedAssignees.length) {
        return null;
      }
      const member = selectedAssignees[assignmentCursor % selectedAssignees.length] || null;
      assignmentCursor += 1;
      return member;
    };

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let assigned = 0;
    let leftUnassigned = 0;

    for (const row of rows) {
      const assignedMember = row.result === "ready" ? nextAssignment() : null;
      const result = await processLeadImportRow(serviceClient, {
        workspaceId,
        callerMember,
        row,
        teamMembers: context.teamMembers,
        accountIdByName: context.accountIdByName,
        existingLeadById: context.existingLeadById,
        duplicateMode,
        distributionMode,
        assignedMember,
        batchId,
        nowIso
      });
      created += result.created;
      updated += result.updated;
      skipped += result.skipped;
      assigned += result.assigned;
      leftUnassigned += result.leftUnassigned;
    }

    return jsonResponse(req, 200, {
      ok: true,
      summary: {
        created,
        updated,
        skipped,
        total: rows.length,
        assigned,
        leftUnassigned
      }
    });
  } catch (error) {
    console.error("lead-import-commit failed", error);
    return jsonResponse(req, 500, { ok: false, error: String(error instanceof Error ? error.message : error) });
  }
});
