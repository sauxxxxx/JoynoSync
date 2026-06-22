import { createServiceClient, getRequiredEnv } from "./runtime.ts";

const DEFAULT_RINGCENTRAL_SERVER_URL = "https://platform.ringcentral.com";

let cachedAccessToken = "";
let cachedAccessTokenExpiresAt = 0;

function normalizeText(value: unknown, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

export function normalizePhoneNumber(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const normalized = raw.replace(/[^\d+]/g, "");
  if (!normalized) {
    return "";
  }
  if (normalized.startsWith("+")) {
    return `+${normalized.slice(1).replace(/\+/g, "")}`;
  }
  return normalized;
}

function getRingCentralServerUrl() {
  return normalizeText(Deno.env.get("RINGCENTRAL_SERVER_URL"), DEFAULT_RINGCENTRAL_SERVER_URL).replace(/\/+$/, "");
}

function getRingCentralClientId() {
  return getRequiredEnv("RINGCENTRAL_CLIENT_ID");
}

function getRingCentralClientSecret() {
  return getRequiredEnv("RINGCENTRAL_CLIENT_SECRET");
}

function getRingCentralJwt() {
  return getRequiredEnv("RINGCENTRAL_JWT");
}

function getRingCentralAccountRef() {
  return normalizeText(Deno.env.get("RINGCENTRAL_ACCOUNT_ID"), "~");
}

function getDefaultExtensionRef() {
  return normalizeText(Deno.env.get("RINGCENTRAL_DEFAULT_EXTENSION_ID"), "~");
}

function getDefaultCallerId() {
  return normalizePhoneNumber(Deno.env.get("RINGCENTRAL_DEFAULT_CALLER_ID"));
}

function getDefaultDirectNumber() {
  return normalizePhoneNumber(Deno.env.get("RINGCENTRAL_DEFAULT_DIRECT_NUMBER"));
}

function getDefaultProviderUserRef() {
  return normalizeText(Deno.env.get("RINGCENTRAL_DEFAULT_USER_REF"));
}

function getDefaultProviderExtensionRef() {
  return normalizeText(Deno.env.get("RINGCENTRAL_DEFAULT_EXTENSION_REF"), getDefaultExtensionRef());
}

async function parseJsonSafe(response: Response) {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function getRingCentralAccessToken(forceRefresh = false) {
  if (!forceRefresh && cachedAccessToken && cachedAccessTokenExpiresAt > Date.now() + 10_000) {
    return cachedAccessToken;
  }

  const credentials = btoa(`${getRingCentralClientId()}:${getRingCentralClientSecret()}`);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: getRingCentralJwt()
  });
  const response = await fetch(`${getRingCentralServerUrl()}/restapi/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(`RingCentral auth failed (${response.status}): ${normalizeText((payload as Record<string, unknown>)?.message || (payload as Record<string, unknown>)?.error_description || response.statusText)}`);
  }

  const accessToken = normalizeText((payload as Record<string, unknown>)?.access_token);
  if (!accessToken) {
    throw new Error("RingCentral auth succeeded without an access token.");
  }

  const expiresIn = Number((payload as Record<string, unknown>)?.expires_in || 3600);
  cachedAccessToken = accessToken;
  cachedAccessTokenExpiresAt = Date.now() + Math.max(60, expiresIn - 30) * 1000;
  return cachedAccessToken;
}

export async function ringCentralRequest(path: string, options: {
  method?: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  headers?: HeadersInit;
  absoluteUrl?: boolean;
  forceTokenRefresh?: boolean;
} = {}) {
  const url = options.absoluteUrl ? new URL(path) : new URL(`${getRingCentralServerUrl()}${path}`);
  Object.entries(options.query || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    url.searchParams.set(key, String(value));
  });

  const accessToken = await getRingCentralAccessToken(options.forceTokenRefresh === true);
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("Accept", "application/json");

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.body);
  }

  const response = await fetch(url.toString(), {
    method: options.method || "GET",
    headers,
    body
  });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    const message = normalizeText(
      (payload as Record<string, unknown>)?.message ||
      (payload as Record<string, unknown>)?.error_description ||
      (payload as Record<string, unknown>)?.error ||
      response.statusText
    );
    throw new Error(`RingCentral request failed (${response.status}): ${message}`);
  }
  return payload as Record<string, unknown>;
}

export type WorkspaceMemberContext = {
  workspaceId: string;
  memberId: string;
  memberName: string;
  memberEmail: string;
};

export async function resolveWorkspaceMemberContext(caller: { uid?: string; email?: string }) {
  const service = createServiceClient();
  const email = normalizeText(caller.email).toLowerCase();
  const uid = normalizeText(caller.uid);
  let query = service
    .from("team_members")
    .select("id, workspace_id, name, email, status, auth_user_id, updated_at")
    .eq("status", "Active")
    .order("updated_at", { ascending: false })
    .limit(1);

  if (uid) {
    query = query.eq("auth_user_id", uid);
  } else if (email) {
    query = query.ilike("email", email);
  } else {
    throw new Error("Caller identity is missing.");
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error("No active workspace member matched the current caller.");
  }

  return {
    workspaceId: normalizeText(data.workspace_id),
    memberId: normalizeText(data.id),
    memberName: normalizeText(data.name, "Team Member"),
    memberEmail: normalizeText(data.email).toLowerCase()
  } satisfies WorkspaceMemberContext;
}

export type TelephonyIdentity = {
  id: string;
  workspaceId: string;
  memberId: string;
  callerId: string;
  directNumber: string;
  providerUserRef: string;
  providerExtensionRef: string;
  active: boolean;
};

export async function resolveTelephonyIdentity(workspaceId: string, memberId: string) {
  const service = createServiceClient();
  const { data, error } = await service
    .from("telephony_identities")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("member_id", memberId)
    .eq("provider", "ringcentral")
    .eq("active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return {
      id: "",
      workspaceId,
      memberId,
      callerId: getDefaultCallerId(),
      directNumber: getDefaultDirectNumber(),
      providerUserRef: getDefaultProviderUserRef(),
      providerExtensionRef: getDefaultProviderExtensionRef(),
      active: true
    } satisfies TelephonyIdentity;
  }

  return {
    id: normalizeText(data.id),
    workspaceId: normalizeText(data.workspace_id),
    memberId: normalizeText(data.member_id),
    callerId: normalizePhoneNumber(data.caller_id),
    directNumber: normalizePhoneNumber(data.direct_number),
    providerUserRef: normalizeText(data.provider_user_ref),
    providerExtensionRef: normalizeText(data.provider_extension_ref, getDefaultProviderExtensionRef()),
    active: data.active !== false
  } satisfies TelephonyIdentity;
}

export async function findTelephonyIdentityByExtensionRef(extensionRef: string) {
  const service = createServiceClient();
  const normalized = normalizeText(extensionRef);
  if (!normalized) {
    return null;
  }
  const { data, error } = await service
    .from("telephony_identities")
    .select("*")
    .eq("provider", "ringcentral")
    .eq("provider_extension_ref", normalized)
    .eq("active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }
  return {
    id: normalizeText(data.id),
    workspaceId: normalizeText(data.workspace_id),
    memberId: normalizeText(data.member_id),
    callerId: normalizePhoneNumber(data.caller_id),
    directNumber: normalizePhoneNumber(data.direct_number),
    providerUserRef: normalizeText(data.provider_user_ref),
    providerExtensionRef: normalizeText(data.provider_extension_ref),
    active: data.active !== false
  } satisfies TelephonyIdentity;
}

function normalizeStatusCode(value: unknown) {
  return normalizeText(value).toLowerCase();
}

export function mapProviderCallStatus(value: unknown, direction = "outbound") {
  const status = normalizeStatusCode(value);
  if (!status) {
    return direction === "inbound" ? "inbound" : "queued";
  }
  if (["setup", "queued"].includes(status)) {
    return direction === "inbound" ? "inbound" : "dialing";
  }
  if (["proceeding", "ringing"].includes(status)) {
    return "ringing";
  }
  if (["answered", "connected"].includes(status)) {
    return "connected";
  }
  if (status === "hold") {
    return "hold";
  }
  if (["parked", "transferring"].includes(status)) {
    return "transferring";
  }
  if (["gone", "finished", "disconnected"].includes(status)) {
    return "completed";
  }
  if (["voicemail", "voice-mail"].includes(status)) {
    return "voicemail";
  }
  if (["busy", "noanswer", "no-answer", "missed"].includes(status)) {
    return "missed";
  }
  if (["rejected", "declined"].includes(status)) {
    return "declined";
  }
  if (["cancelled", "canceled"].includes(status)) {
    return "canceled";
  }
  if (status === "failed") {
    return "failed";
  }
  return "queued";
}

export type CallLogUpsertInput = {
  workspaceId: string;
  memberId?: string;
  providerCallId?: string;
  providerSessionId?: string;
  providerPartyId?: string;
  providerQueueId?: string;
  queueNameSnapshot?: string;
  direction?: string;
  fromNumber?: string;
  toNumber?: string;
  counterpartyName?: string;
  status?: string;
  muted?: boolean;
  onHold?: boolean;
  recordingEnabled?: boolean;
  recordingStatus?: string;
  transferTarget?: string;
  disposition?: string;
  wrapupNotes?: string;
  followUpAction?: string;
  linkedEntityType?: string;
  linkedEntityId?: string;
  linkedLabelSnapshot?: string;
  popupSeenAt?: string | null;
  popupDismissedAt?: string | null;
  startedAt?: string | null;
  answeredAt?: string | null;
  endedAt?: string | null;
  durationSeconds?: number;
  rawPayload?: unknown;
};

async function findExistingCallLogId(workspaceId: string, providerSessionId: string, providerPartyId: string, providerCallId: string) {
  const service = createServiceClient();
  if (providerSessionId && providerPartyId) {
    const { data, error } = await service
      .from("call_logs")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("provider", "ringcentral")
      .eq("provider_session_id", providerSessionId)
      .eq("provider_party_id", providerPartyId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (data?.id) {
      return normalizeText(data.id);
    }
  }

  if (providerCallId) {
    const { data, error } = await service
      .from("call_logs")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("provider", "ringcentral")
      .eq("provider_call_id", providerCallId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (data?.id) {
      return normalizeText(data.id);
    }
  }

  return "";
}

export async function upsertCallLog(input: CallLogUpsertInput) {
  const service = createServiceClient();
  const workspaceId = normalizeText(input.workspaceId);
  if (!workspaceId) {
    throw new Error("Workspace is required to upsert a call log.");
  }

  const providerCallId = normalizeText(input.providerCallId);
  const providerSessionId = normalizeText(input.providerSessionId);
  const providerPartyId = normalizeText(input.providerPartyId);
  const existingId = await findExistingCallLogId(workspaceId, providerSessionId, providerPartyId, providerCallId);
  const row = {
    workspace_id: workspaceId,
    member_id: normalizeText(input.memberId) || null,
    provider: "ringcentral",
    provider_call_id: providerCallId,
    provider_session_id: providerSessionId,
    provider_party_id: providerPartyId,
    provider_queue_id: normalizeText(input.providerQueueId),
    queue_name_snapshot: normalizeText(input.queueNameSnapshot),
    direction: normalizeText(input.direction, "outbound").toLowerCase() === "inbound" ? "inbound" : "outbound",
    from_number: normalizePhoneNumber(input.fromNumber),
    to_number: normalizePhoneNumber(input.toNumber),
    counterparty_name: normalizeText(input.counterpartyName),
    status: normalizeText(input.status, "queued"),
    muted: Boolean(input.muted),
    on_hold: Boolean(input.onHold),
    recording_enabled: Boolean(input.recordingEnabled),
    recording_status: normalizeText(input.recordingStatus, "off"),
    transfer_target: normalizePhoneNumber(input.transferTarget),
    disposition: normalizeText(input.disposition),
    wrapup_notes: normalizeText(input.wrapupNotes),
    follow_up_action: normalizeText(input.followUpAction, "none"),
    linked_entity_type: normalizeText(input.linkedEntityType),
    linked_entity_id: normalizeText(input.linkedEntityId),
    linked_label_snapshot: normalizeText(input.linkedLabelSnapshot),
    popup_seen_at: input.popupSeenAt || null,
    popup_dismissed_at: input.popupDismissedAt || null,
    started_at: input.startedAt || null,
    answered_at: input.answeredAt || null,
    ended_at: input.endedAt || null,
    duration_seconds: Number.isFinite(Number(input.durationSeconds)) ? Math.max(0, Number(input.durationSeconds)) : 0,
    raw_payload: input.rawPayload && typeof input.rawPayload === "object" ? input.rawPayload : {}
  };

  if (existingId) {
    const { data, error } = await service.from("call_logs").update(row).eq("id", existingId).select("*").maybeSingle();
    if (error) {
      throw error;
    }
    return data;
  }

  const { data, error } = await service.from("call_logs").insert(row).select("*").maybeSingle();
  if (error) {
    throw error;
  }
  return data;
}

export async function getCallLogById(callLogId: string) {
  const service = createServiceClient();
  const { data, error } = await service.from("call_logs").select("*").eq("id", callLogId).maybeSingle();
  if (error) {
    throw error;
  }
  return data;
}

export async function patchCallLog(callLogId: string, patch: Record<string, unknown>) {
  const service = createServiceClient();
  const { data, error } = await service.from("call_logs").update(patch).eq("id", callLogId).select("*").maybeSingle();
  if (error) {
    throw error;
  }
  return data;
}

export async function insertCallEvent(workspaceId: string, callLogId: string | null, eventType: string, payload: unknown, providerEventId = "") {
  const service = createServiceClient();
  const { error } = await service.from("call_events").insert({
    workspace_id: workspaceId,
    call_log_id: normalizeText(callLogId) || null,
    provider: "ringcentral",
    provider_event_id: normalizeText(providerEventId),
    event_type: normalizeText(eventType, "event"),
    payload: payload && typeof payload === "object" ? payload : {}
  });
  if (error) {
    throw error;
  }
}

export async function upsertVoicemail(workspaceId: string, memberId: string, message: Record<string, unknown>) {
  const service = createServiceClient();
  const providerVoicemailId = normalizeText(message.id);
  const row = {
    workspace_id: workspaceId,
    member_id: memberId || null,
    provider: "ringcentral",
    provider_voicemail_id: providerVoicemailId,
    from_number: normalizePhoneNumber((message.from as Record<string, unknown> | undefined)?.phoneNumber),
    to_number: normalizePhoneNumber((message.to as Record<string, unknown> | undefined)?.phoneNumber),
    caller_name: normalizeText((message.from as Record<string, unknown> | undefined)?.name),
    duration_seconds: Number(message.vmDuration || message.duration || 0) || 0,
    transcription: normalizeText((message as Record<string, unknown>).subject),
    access_url: normalizeText((message as Record<string, unknown>).uri),
    is_read: String((message as Record<string, unknown>).readStatus || "").toLowerCase() === "read",
    raw_payload: message,
    received_at: normalizeText((message as Record<string, unknown>).creationTime) || null
  };
  const { error } = await service.from("voicemails").upsert(row, { onConflict: "workspace_id,provider,provider_voicemail_id" });
  if (error) {
    throw error;
  }
}

export async function upsertCallQueue(workspaceId: string, queue: Record<string, unknown>) {
  const service = createServiceClient();
  const providerQueueId = normalizeText(queue.id);
  if (!providerQueueId) {
    return;
  }
  const row = {
    workspace_id: workspaceId,
    provider: "ringcentral",
    provider_queue_id: providerQueueId,
    name: normalizeText(queue.name, "Queue"),
    extension_number: normalizeText(queue.extensionNumber),
    active: String(queue.status || "enabled").toLowerCase() !== "disabled",
    metadata: queue
  };
  const { error } = await service.from("call_queues").upsert(row, { onConflict: "workspace_id,provider,provider_queue_id" });
  if (error) {
    throw error;
  }
}

export async function upsertQueueMembership(workspaceId: string, memberId: string, providerQueueId: string, acceptingCalls: boolean) {
  const service = createServiceClient();
  const { data: queue, error: queueError } = await service
    .from("call_queues")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("provider", "ringcentral")
    .eq("provider_queue_id", providerQueueId)
    .maybeSingle();
  if (queueError) {
    throw queueError;
  }
  if (!queue?.id) {
    return;
  }
  const { error } = await service.from("queue_memberships").upsert({
    queue_id: queue.id,
    member_id: memberId,
    accepting_calls: acceptingCalls,
    role: "agent",
    last_provider_sync_at: new Date().toISOString()
  });
  if (error) {
    throw error;
  }
}

export async function upsertAgentPresence(workspaceId: string, memberId: string, payload: {
  presenceStatus?: string;
  acceptingQueueCalls?: boolean;
  telephonyStatus?: string;
  activeCallCount?: number;
  metadata?: unknown;
}) {
  const service = createServiceClient();
  const row = {
    workspace_id: workspaceId,
    member_id: memberId,
    provider: "ringcentral",
    presence_status: normalizeText(payload.presenceStatus, "Available"),
    accepting_queue_calls: payload.acceptingQueueCalls !== false,
    telephony_status: normalizeText(payload.telephonyStatus),
    active_call_count: Number(payload.activeCallCount || 0) || 0,
    last_provider_sync_at: new Date().toISOString(),
    metadata: payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {}
  };
  const { error } = await service.from("agent_presence").upsert(row, { onConflict: "workspace_id,member_id,provider" });
  if (error) {
    throw error;
  }
}

export function getTelephonyPartyPath(callLog: Record<string, unknown>) {
  const sessionId = normalizeText(callLog.provider_session_id || callLog.providerSessionId);
  const partyId = normalizeText(callLog.provider_party_id || callLog.providerPartyId);
  if (!sessionId || !partyId) {
    throw new Error("This call does not have a provider session/party yet.");
  }
  return `/restapi/v1.0/account/${getRingCentralAccountRef()}/telephony/sessions/${sessionId}/parties/${partyId}`;
}

export function getRingOutPath(extensionRef = "") {
  const safeExtension = normalizeText(extensionRef, getDefaultExtensionRef());
  return `/restapi/v1.0/account/${getRingCentralAccountRef()}/extension/${safeExtension}/ring-out`;
}

export function parseTelephonyNotification(input: Record<string, unknown>) {
  const body = (input.body && typeof input.body === "object" ? input.body : input) as Record<string, unknown>;
  const eventType = normalizeText(input.event || body.eventType || body.event, "telephony");
  const sessionId = normalizeText(body.sessionId || body.telephonySessionId);
  const parties = Array.isArray(body.parties) ? body.parties as Record<string, unknown>[] : [];
  return {
    eventType,
    sessionId,
    parties,
    raw: input
  };
}
