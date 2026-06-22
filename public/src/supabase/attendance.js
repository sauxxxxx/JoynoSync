import { defaultAttendancePolicy } from "../modules/attendance-core.js";
import { initSupabase } from "./init.js";

function getClient() {
  const services = initSupabase();
  if (!services.configured || !services.client) {
    throw new Error("Supabase is not configured.");
  }
  return services.client;
}

function normalizeText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeTimeText(value, fallback = "09:00") {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return fallback;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return fallback;
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizeIso(value) {
  return normalizeText(value);
}

function normalizeDateOnly(value) {
  const text = normalizeText(value);
  return text ? text.slice(0, 10) : "";
}

function normalizeBoolean(value) {
  return Boolean(value);
}

function normalizeInteger(value, fallback = 0, minimum = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Math.max(minimum, fallback);
  }
  return Math.max(minimum, Math.round(numeric));
}

function normalizeWorkDays(value, fallback = [1, 2, 3, 4, 5]) {
  const source = Array.isArray(value) ? value : fallback;
  return [...new Set(source.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 0 && item <= 6))];
}

function mapBreakType(entry, index = 0) {
  return {
    id: normalizeText(entry?.id || `break_${index + 1}`).toLowerCase(),
    label: normalizeText(entry?.label || `Break ${index + 1}`),
    durationMinutes: normalizeInteger(entry?.durationMinutes, 1, 1),
    paid: normalizeBoolean(entry?.paid),
    required: normalizeBoolean(entry?.required),
    maxPerDay: normalizeInteger(entry?.maxPerDay, 1, 1),
    minPerDay: normalizeInteger(entry?.minPerDay, 0, 0),
    windowStart: normalizeTimeText(entry?.windowStart, "00:00"),
    windowEnd: normalizeTimeText(entry?.windowEnd, "23:59")
  };
}

function mapPolicy(policy) {
  const fallback = defaultAttendancePolicy();
  const source = policy && typeof policy === "object" ? policy : {};
  return {
    ...fallback,
    ...source,
    shiftStart: normalizeTimeText(source.shiftStart, fallback.shiftStart),
    shiftEnd: normalizeTimeText(source.shiftEnd, fallback.shiftEnd),
    graceMinutes: normalizeInteger(source.graceMinutes ?? source.lateAfterMinutes, fallback.graceMinutes, 0),
    lateAfterMinutes: normalizeInteger(source.lateAfterMinutes ?? source.graceMinutes, fallback.lateAfterMinutes, 0),
    halfDayAfterMinutes: normalizeInteger(source.halfDayAfterMinutes, fallback.halfDayAfterMinutes, 0),
    autoAbsentAfterMinutes: normalizeInteger(source.autoAbsentAfterMinutes, fallback.autoAbsentAfterMinutes, 0),
    breakMinutes: normalizeInteger(source.breakMinutes, fallback.breakMinutes, 0),
    timezone: normalizeText(source.timezone, fallback.timezone),
    workDays: normalizeWorkDays(source.workDays, fallback.workDays),
    breakTypes: (Array.isArray(source.breakTypes) ? source.breakTypes : fallback.breakTypes).map(mapBreakType).filter((entry) => entry.id)
  };
}

function mapBreakRuleRow(entry, index = 0) {
  return mapBreakType(
    {
      id: normalizeText(entry?.code || entry?.id || `break_${index + 1}`),
      label: normalizeText(entry?.label || `Break ${index + 1}`),
      durationMinutes: normalizeInteger(entry?.duration_minutes ?? entry?.durationMinutes, 1, 1),
      paid: normalizeBoolean(entry?.paid),
      required: normalizeBoolean(entry?.required),
      maxPerDay: normalizeInteger(entry?.max_per_day ?? entry?.maxPerDay, 1, 1),
      minPerDay: normalizeInteger(entry?.min_per_day ?? entry?.minPerDay, 0, 0),
      windowStart: normalizeTimeText(entry?.window_start ?? entry?.windowStart, "00:00"),
      windowEnd: normalizeTimeText(entry?.window_end ?? entry?.windowEnd, "23:59")
    },
    index
  );
}

function mapPolicyRow(policyRow, breakRows = []) {
  return mapPolicy({
    shiftStart: normalizeTimeText(policyRow?.shift_start ?? policyRow?.shiftStart),
    shiftEnd: normalizeTimeText(policyRow?.shift_end ?? policyRow?.shiftEnd),
    graceMinutes: normalizeInteger(policyRow?.late_after_minutes ?? policyRow?.lateAfterMinutes, 10, 0),
    lateAfterMinutes: normalizeInteger(policyRow?.late_after_minutes ?? policyRow?.lateAfterMinutes, 10, 0),
    halfDayAfterMinutes: normalizeInteger(policyRow?.half_day_after_minutes ?? policyRow?.halfDayAfterMinutes, 120, 0),
    autoAbsentAfterMinutes: normalizeInteger(policyRow?.auto_absent_after_minutes ?? policyRow?.autoAbsentAfterMinutes, 0, 0),
    breakMinutes: normalizeInteger(policyRow?.break_minutes ?? policyRow?.breakMinutes, 60, 0),
    timezone: normalizeText(policyRow?.timezone),
    workDays: normalizeWorkDays(policyRow?.work_days ?? policyRow?.workDays),
    breakTypes: (Array.isArray(breakRows) ? breakRows : []).map(mapBreakRuleRow)
  });
}

function mapBreak(entry) {
  return {
    id: normalizeText(entry?.id),
    breakTypeId: normalizeText(entry?.breakTypeId).toLowerCase(),
    breakTypeLabel: normalizeText(entry?.breakTypeLabel, "Break"),
    paid: normalizeBoolean(entry?.paid),
    startAt: normalizeIso(entry?.startAt),
    endAt: normalizeIso(entry?.endAt)
  };
}

function mapLog(entry) {
  return {
    id: normalizeText(entry?.id),
    userId: normalizeText(entry?.userId),
    userName: normalizeText(entry?.userName, "Team Member"),
    date: normalizeDateOnly(entry?.date),
    clockInAt: normalizeIso(entry?.clockInAt),
    clockOutAt: normalizeIso(entry?.clockOutAt),
    breaks: (Array.isArray(entry?.breaks) ? entry.breaks : []).map(mapBreak),
    source: normalizeText(entry?.source, "manual"),
    createdAt: normalizeIso(entry?.createdAt),
    updatedAt: normalizeIso(entry?.updatedAt)
  };
}

function mapRequest(entry) {
  return {
    id: normalizeText(entry?.id),
    userId: normalizeText(entry?.userId),
    userName: normalizeText(entry?.userName, "Team Member"),
    date: normalizeDateOnly(entry?.date),
    type: normalizeText(entry?.type, "Time Adjustment"),
    reason: normalizeText(entry?.reason),
    status: normalizeText(entry?.status, "Pending"),
    requestedClockInAt: normalizeIso(entry?.requestedClockInAt),
    requestedClockOutAt: normalizeIso(entry?.requestedClockOutAt),
    resolutionNote: normalizeText(entry?.resolutionNote),
    shiftId: normalizeText(entry?.shiftId),
    createdAt: normalizeIso(entry?.createdAt),
    reviewedBy: normalizeText(entry?.reviewedBy),
    reviewedAt: normalizeIso(entry?.reviewedAt)
  };
}

function calculateServerOffset(serverNowIso, startedAt, receivedAt) {
  const serverMs = Date.parse(String(serverNowIso || ""));
  if (!Number.isFinite(serverMs)) {
    return null;
  }
  const midpoint = startedAt + Math.round((receivedAt - startedAt) / 2);
  return Math.max(-120000, Math.min(120000, serverMs - midpoint));
}

function mapSnapshot(data, startedAt, receivedAt) {
  const snapshot = data && typeof data === "object" ? data : {};
  return {
    serverNow: normalizeIso(snapshot.serverNow),
    serverOffsetMs: calculateServerOffset(snapshot.serverNow, startedAt, receivedAt),
    policy: mapPolicy(snapshot.policy),
    logs: (Array.isArray(snapshot.logs) ? snapshot.logs : []).map(mapLog),
    requests: (Array.isArray(snapshot.requests) ? snapshot.requests : []).map(mapRequest)
  };
}

async function callAttendanceRpc(functionName, args = {}) {
  const client = getClient();
  const startedAt = Date.now();
  const { data, error } = await client.rpc(functionName, args);
  const receivedAt = Date.now();
  if (error) {
    throw error;
  }
  return mapSnapshot(data, startedAt, receivedAt);
}

export function fetchSupabaseAttendanceSnapshot(referenceAt = "") {
  const params = normalizeText(referenceAt) ? { p_reference_at: referenceAt } : {};
  return callAttendanceRpc("get_attendance_snapshot", params);
}

export async function fetchSupabaseAttendancePolicyForWorkspace(workspaceId = "") {
  const normalizedWorkspaceId = normalizeText(workspaceId);
  if (!normalizedWorkspaceId) {
    return mapPolicy({});
  }
  const client = getClient();
  const [{ data: policyRow, error: policyError }, { data: breakRows, error: breakError }] = await Promise.all([
    client
      .from("attendance_policies")
      .select("*")
      .eq("workspace_id", normalizedWorkspaceId)
      .maybeSingle(),
    client
      .from("attendance_break_rules")
      .select("*")
      .eq("workspace_id", normalizedWorkspaceId)
      .order("sort_order", { ascending: true })
      .order("code", { ascending: true })
  ]);
  if (policyError) {
    throw policyError;
  }
  if (breakError) {
    throw breakError;
  }
  return mapPolicyRow(policyRow || {}, Array.isArray(breakRows) ? breakRows : []);
}

export function clockInSupabaseAttendance() {
  return callAttendanceRpc("attendance_clock_in");
}

export function startSupabaseAttendanceBreak(breakCode) {
  return callAttendanceRpc("attendance_start_break", {
    p_break_code: normalizeText(breakCode).toLowerCase()
  });
}

export function endSupabaseAttendanceBreak() {
  return callAttendanceRpc("attendance_end_break");
}

export function clockOutSupabaseAttendance() {
  return callAttendanceRpc("attendance_clock_out");
}

export function createSupabaseAttendanceAdjustmentRequest(payload = {}) {
  return callAttendanceRpc("create_attendance_adjustment_request", {
    p_work_date: normalizeDateOnly(payload.workDate),
    p_request_type: normalizeText(payload.requestType, "Time Adjustment"),
    p_reason: normalizeText(payload.reason),
    p_requested_clock_in_at: normalizeText(payload.requestedClockInAt) || null,
    p_requested_clock_out_at: normalizeText(payload.requestedClockOutAt) || null
  });
}

export function reviewSupabaseAttendanceAdjustmentRequest(requestId, decision, resolutionNote = "") {
  return callAttendanceRpc("review_attendance_adjustment_request", {
    p_request_id: normalizeText(requestId),
    p_decision: normalizeText(decision),
    p_resolution_note: normalizeText(resolutionNote)
  });
}

export function upsertSupabaseAttendanceManualEntry(payload = {}) {
  const hasBreakPaid = typeof payload.breakPaid === "boolean";
  return callAttendanceRpc("upsert_attendance_manual_entry", {
    p_member_id: normalizeText(payload.memberId) || null,
    p_work_date: normalizeDateOnly(payload.workDate) || null,
    p_clock_in_at: normalizeText(payload.clockInAt) || null,
    p_clock_out_at: normalizeText(payload.clockOutAt) || null,
    p_break_start_at: normalizeText(payload.breakStartAt) || null,
    p_break_end_at: normalizeText(payload.breakEndAt) || null,
    p_break_code: normalizeText(payload.breakCode).toLowerCase() || null,
    p_break_label: normalizeText(payload.breakLabel) || null,
    p_break_paid: hasBreakPaid ? Boolean(payload.breakPaid) : null
  });
}

export function deleteSupabaseAttendanceManualEntry(shiftId = "") {
  return callAttendanceRpc("delete_attendance_manual_entry", {
    p_shift_id: normalizeText(shiftId) || null
  });
}

export function upsertSupabaseAttendancePolicy(policy = {}) {
  const mappedPolicy = mapPolicy(policy);
  return callAttendanceRpc("upsert_attendance_policy", {
    p_shift_start: mappedPolicy.shiftStart,
    p_shift_end: mappedPolicy.shiftEnd,
    p_late_after_minutes: normalizeInteger(mappedPolicy.lateAfterMinutes, 10, 0),
    p_half_day_after_minutes: normalizeInteger(mappedPolicy.halfDayAfterMinutes, 120, 0),
    p_auto_absent_after_minutes: normalizeInteger(mappedPolicy.autoAbsentAfterMinutes, 0, 0),
    p_break_minutes: normalizeInteger(mappedPolicy.breakMinutes, 0, 0),
    p_timezone: normalizeText(mappedPolicy.timezone, "UTC"),
    p_work_days: normalizeWorkDays(mappedPolicy.workDays),
    p_break_types: mappedPolicy.breakTypes.map((entry) => ({
      id: entry.id,
      label: entry.label,
      durationMinutes: normalizeInteger(entry.durationMinutes, 1, 1),
      paid: normalizeBoolean(entry.paid),
      required: normalizeBoolean(entry.required),
      maxPerDay: normalizeInteger(entry.maxPerDay, 1, 1),
      minPerDay: normalizeInteger(entry.minPerDay, 0, 0),
      windowStart: normalizeText(entry.windowStart, "00:00"),
      windowEnd: normalizeText(entry.windowEnd, "23:59")
    }))
  });
}

export async function saveSupabaseAttendancePolicyForWorkspace(workspaceId = "", policy = {}, actorMemberId = "") {
  const normalizedWorkspaceId = normalizeText(workspaceId);
  if (!normalizedWorkspaceId) {
    throw new Error("Workspace context is required.");
  }
  const client = getClient();
  const mappedPolicy = mapPolicy(policy);
  const normalizedActorMemberId = normalizeText(actorMemberId) || null;
  const { error: policyError } = await client
    .from("attendance_policies")
    .upsert(
      {
        workspace_id: normalizedWorkspaceId,
        shift_start: normalizeText(mappedPolicy.shiftStart, "09:00"),
        shift_end: normalizeText(mappedPolicy.shiftEnd, "18:00"),
        late_after_minutes: normalizeInteger(mappedPolicy.lateAfterMinutes, 10, 0),
        half_day_after_minutes: normalizeInteger(mappedPolicy.halfDayAfterMinutes, 120, 0),
        auto_absent_after_minutes: normalizeInteger(mappedPolicy.autoAbsentAfterMinutes, 0, 0),
        break_minutes: normalizeInteger(mappedPolicy.breakMinutes, 60, 0),
        timezone: normalizeText(mappedPolicy.timezone, "UTC"),
        work_days: normalizeWorkDays(mappedPolicy.workDays),
        created_by_member_id: normalizedActorMemberId,
        updated_by_member_id: normalizedActorMemberId
      },
      {
        onConflict: "workspace_id"
      }
    );
  if (policyError) {
    throw policyError;
  }

  const { error: deleteError } = await client
    .from("attendance_break_rules")
    .delete()
    .eq("workspace_id", normalizedWorkspaceId);
  if (deleteError) {
    throw deleteError;
  }

  const nextBreakRows = mappedPolicy.breakTypes.map((entry, index) => ({
    workspace_id: normalizedWorkspaceId,
    code: normalizeText(entry.id || `break_${index + 1}`).toLowerCase(),
    label: normalizeText(entry.label || `Break ${index + 1}`),
    sort_order: index,
    duration_minutes: normalizeInteger(entry.durationMinutes, 1, 1),
    paid: normalizeBoolean(entry.paid),
    required: normalizeBoolean(entry.required),
    max_per_day: normalizeInteger(entry.maxPerDay, 1, 1),
    min_per_day: normalizeInteger(entry.minPerDay, 0, 0),
    window_start: normalizeText(entry.windowStart, "00:00"),
    window_end: normalizeText(entry.windowEnd, "23:59")
  }));

  if (nextBreakRows.length) {
    const { error: insertError } = await client
      .from("attendance_break_rules")
      .insert(nextBreakRows);
    if (insertError) {
      throw insertError;
    }
  }

  return fetchSupabaseAttendancePolicyForWorkspace(normalizedWorkspaceId);
}
