import { createServiceClient } from "./runtime.ts";

function text(value: unknown, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function phone(value: unknown) {
  const raw = text(value);
  if (!raw) {
    return "";
  }
  const normalized = raw.replace(/[^\d+]/g, "");
  return normalized.startsWith("+")
    ? `+${normalized.slice(1).replace(/\+/g, "")}`
    : normalized;
}

export type ProviderCallUpdate = {
  workspaceId: string;
  memberId: string;
  providerCallId?: string;
  providerSessionId?: string;
  providerPartyId?: string;
  providerQueueId?: string;
  queueName?: string;
  direction?: string;
  fromNumber?: string;
  toNumber?: string;
  counterpartyName?: string;
  status?: string;
  muted?: boolean;
  onHold?: boolean;
  startedAt?: string;
  answeredAt?: string;
  endedAt?: string;
  durationSeconds?: number;
  rawPayload?: unknown;
};

async function findExactCall(input: ProviderCallUpdate) {
  const service = createServiceClient();
  if (input.providerSessionId && input.providerPartyId) {
    const { data, error } = await service
      .from("call_logs")
      .select("*")
      .eq("workspace_id", input.workspaceId)
      .eq("provider", "ringcentral")
      .eq("provider_session_id", input.providerSessionId)
      .eq("provider_party_id", input.providerPartyId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }
  if (input.providerCallId) {
    const { data, error } = await service
      .from("call_logs")
      .select("*")
      .eq("workspace_id", input.workspaceId)
      .eq("provider", "ringcentral")
      .eq("provider_call_id", input.providerCallId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }
  return null;
}

async function findPendingJoynoCall(input: ProviderCallUpdate) {
  const service = createServiceClient();
  const direction = text(input.direction, "outbound").toLowerCase() === "inbound" ? "inbound" : "outbound";
  const counterpartyField = direction === "inbound" ? "from_number" : "to_number";
  const counterpartyNumber = phone(direction === "inbound" ? input.fromNumber : input.toNumber);
  if (!input.memberId || !counterpartyNumber) {
    return null;
  }
  const earliest = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data, error } = await service
    .from("call_logs")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .eq("member_id", input.memberId)
    .eq("provider", "ringcentral")
    .eq("direction", direction)
    .eq(counterpartyField, counterpartyNumber)
    .eq("provider_session_id", "")
    .gte("started_at", earliest)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function buildPatch(input: ProviderCallUpdate) {
  return {
    member_id: text(input.memberId) || null,
    provider_call_id: text(input.providerCallId),
    provider_session_id: text(input.providerSessionId),
    provider_party_id: text(input.providerPartyId),
    provider_queue_id: text(input.providerQueueId),
    queue_name_snapshot: text(input.queueName),
    direction: text(input.direction, "outbound").toLowerCase() === "inbound" ? "inbound" : "outbound",
    from_number: phone(input.fromNumber),
    to_number: phone(input.toNumber),
    counterparty_name: text(input.counterpartyName),
    status: text(input.status, "queued"),
    muted: Boolean(input.muted),
    on_hold: Boolean(input.onHold),
    started_at: text(input.startedAt) || null,
    answered_at: text(input.answeredAt) || null,
    ended_at: text(input.endedAt) || null,
    duration_seconds: Number.isFinite(Number(input.durationSeconds)) ? Math.max(0, Number(input.durationSeconds)) : 0,
    raw_payload: input.rawPayload && typeof input.rawPayload === "object" ? input.rawPayload : {}
  };
}

export async function reconcileProviderCall(input: ProviderCallUpdate) {
  const service = createServiceClient();
  const existing = await findExactCall(input) || await findPendingJoynoCall(input);
  const patch = buildPatch(input);
  if (existing?.id) {
    const preserved = {
      ...patch,
      provider_call_id: patch.provider_call_id || existing.provider_call_id,
      provider_session_id: patch.provider_session_id || existing.provider_session_id,
      provider_party_id: patch.provider_party_id || existing.provider_party_id,
      provider_queue_id: patch.provider_queue_id || existing.provider_queue_id,
      queue_name_snapshot: patch.queue_name_snapshot || existing.queue_name_snapshot,
      from_number: patch.from_number || existing.from_number,
      to_number: patch.to_number || existing.to_number,
      counterparty_name: patch.counterparty_name || existing.counterparty_name,
      started_at: patch.started_at || existing.started_at,
      answered_at: patch.answered_at || existing.answered_at,
      ended_at: patch.ended_at || existing.ended_at,
      duration_seconds: patch.duration_seconds || existing.duration_seconds,
      linked_entity_type: existing.linked_entity_type,
      linked_entity_id: existing.linked_entity_id,
      linked_label_snapshot: existing.linked_label_snapshot,
      disposition: existing.disposition,
      wrapup_notes: existing.wrapup_notes,
      follow_up_action: existing.follow_up_action,
      recording_enabled: existing.recording_enabled,
      recording_status: existing.recording_status,
      raw_payload: {
        ...(existing.raw_payload && typeof existing.raw_payload === "object" ? existing.raw_payload : {}),
        providerEvent: patch.raw_payload
      }
    };
    const { data, error } = await service.from("call_logs").update(preserved).eq("id", existing.id).select("*").maybeSingle();
    if (error) throw error;
    return data;
  }
  const { data, error } = await service.from("call_logs").insert({
    workspace_id: input.workspaceId,
    provider: "ringcentral",
    ...patch
  }).select("*").maybeSingle();
  if (error) throw error;
  return data;
}

export async function recordProviderEvent(
  workspaceId: string,
  callLogId: string,
  eventType: string,
  payload: unknown,
  providerEventId = ""
) {
  const service = createServiceClient();
  const eventId = text(providerEventId);
  if (eventId) {
    const { data, error } = await service
      .from("call_events")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("provider", "ringcentral")
      .eq("provider_event_id", eventId)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data?.id) return;
  }
  const { error } = await service.from("call_events").insert({
    workspace_id: workspaceId,
    call_log_id: callLogId || null,
    provider: "ringcentral",
    provider_event_id: eventId,
    event_type: text(eventType, "event"),
    payload: payload && typeof payload === "object" ? payload : {}
  });
  if (error) throw error;
}
