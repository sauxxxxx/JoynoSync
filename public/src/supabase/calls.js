import { initSupabase } from "./init.js";
import { invokeSupabaseFunction } from "./functions.js";

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

function normalizeIso(value) {
  return normalizeText(value);
}

function normalizeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeBoolean(value) {
  return Boolean(value);
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function mapCallRecording(entry) {
  return {
    id: normalizeText(entry?.id),
    providerRecordingId: normalizeText(entry?.providerRecordingId),
    status: normalizeText(entry?.status, "pending"),
    durationSeconds: normalizeNumber(entry?.durationSeconds, 0),
    accessUrl: normalizeText(entry?.accessUrl),
    createdAt: normalizeIso(entry?.createdAt),
    updatedAt: normalizeIso(entry?.updatedAt)
  };
}

function mapCallLog(entry) {
  return {
    id: normalizeText(entry?.id),
    workspaceId: normalizeText(entry?.workspaceId),
    memberId: normalizeText(entry?.memberId),
    provider: normalizeText(entry?.provider, "ringcentral"),
    providerCallId: normalizeText(entry?.providerCallId),
    providerSessionId: normalizeText(entry?.providerSessionId),
    providerPartyId: normalizeText(entry?.providerPartyId),
    providerQueueId: normalizeText(entry?.providerQueueId),
    queueName: normalizeText(entry?.queueName),
    direction: normalizeText(entry?.direction, "outbound"),
    fromNumber: normalizeText(entry?.fromNumber),
    toNumber: normalizeText(entry?.toNumber),
    counterpartyName: normalizeText(entry?.counterpartyName),
    status: normalizeText(entry?.status, "queued"),
    muted: normalizeBoolean(entry?.muted),
    onHold: normalizeBoolean(entry?.onHold),
    recordingEnabled: normalizeBoolean(entry?.recordingEnabled),
    recordingStatus: normalizeText(entry?.recordingStatus, "off"),
    transferTarget: normalizeText(entry?.transferTarget),
    disposition: normalizeText(entry?.disposition),
    wrapupNotes: normalizeText(entry?.wrapupNotes),
    followUpAction: normalizeText(entry?.followUpAction, "none"),
    linkedEntityType: normalizeText(entry?.linkedEntityType),
    linkedEntityId: normalizeText(entry?.linkedEntityId),
    linkedLabel: normalizeText(entry?.linkedLabel),
    popupSeenAt: normalizeIso(entry?.popupSeenAt),
    popupDismissedAt: normalizeIso(entry?.popupDismissedAt),
    startedAt: normalizeIso(entry?.startedAt),
    answeredAt: normalizeIso(entry?.answeredAt),
    endedAt: normalizeIso(entry?.endedAt),
    durationSeconds: normalizeNumber(entry?.durationSeconds, 0),
    createdAt: normalizeIso(entry?.createdAt),
    updatedAt: normalizeIso(entry?.updatedAt),
    recordings: normalizeArray(entry?.recordings).map(mapCallRecording)
  };
}

function mapVoicemail(entry) {
  return {
    id: normalizeText(entry?.id),
    workspaceId: normalizeText(entry?.workspaceId),
    memberId: normalizeText(entry?.memberId),
    callLogId: normalizeText(entry?.callLogId),
    providerVoicemailId: normalizeText(entry?.providerVoicemailId),
    fromNumber: normalizeText(entry?.fromNumber),
    toNumber: normalizeText(entry?.toNumber),
    callerName: normalizeText(entry?.callerName),
    durationSeconds: normalizeNumber(entry?.durationSeconds, 0),
    transcription: normalizeText(entry?.transcription),
    accessUrl: normalizeText(entry?.accessUrl),
    isRead: normalizeBoolean(entry?.isRead),
    receivedAt: normalizeIso(entry?.receivedAt),
    createdAt: normalizeIso(entry?.createdAt),
    updatedAt: normalizeIso(entry?.updatedAt)
  };
}

function mapQueue(entry) {
  return {
    id: normalizeText(entry?.id),
    providerQueueId: normalizeText(entry?.providerQueueId),
    name: normalizeText(entry?.name, "Queue"),
    extensionNumber: normalizeText(entry?.extensionNumber),
    active: normalizeBoolean(entry?.active),
    acceptingCalls: normalizeBoolean(entry?.acceptingCalls),
    role: normalizeText(entry?.role, "agent"),
    updatedAt: normalizeIso(entry?.updatedAt)
  };
}

function mapAgentPresence(entry) {
  return {
    id: normalizeText(entry?.id),
    memberId: normalizeText(entry?.memberId),
    presenceStatus: normalizeText(entry?.presenceStatus, "Available"),
    acceptingQueueCalls: normalizeBoolean(entry?.acceptingQueueCalls),
    telephonyStatus: normalizeText(entry?.telephonyStatus),
    activeCallCount: normalizeNumber(entry?.activeCallCount, 0),
    lastProviderSyncAt: normalizeIso(entry?.lastProviderSyncAt),
    updatedAt: normalizeIso(entry?.updatedAt)
  };
}

function mapTelephonyIdentity(entry) {
  return {
    id: normalizeText(entry?.id),
    provider: normalizeText(entry?.provider, "ringcentral"),
    callerId: normalizeText(entry?.callerId),
    directNumber: normalizeText(entry?.directNumber),
    providerUserRef: normalizeText(entry?.providerUserRef),
    providerExtensionRef: normalizeText(entry?.providerExtensionRef),
    active: normalizeBoolean(entry?.active),
    updatedAt: normalizeIso(entry?.updatedAt)
  };
}

function mapSnapshot(data) {
  const snapshot = data && typeof data === "object" ? data : {};
  return {
    callLogs: normalizeArray(snapshot.callLogs).map(mapCallLog),
    voicemails: normalizeArray(snapshot.voicemails).map(mapVoicemail),
    queues: normalizeArray(snapshot.queues).map(mapQueue),
    activeCall: snapshot.activeCall ? mapCallLog(snapshot.activeCall) : null,
    wrapupCall: snapshot.wrapupCall ? mapCallLog(snapshot.wrapupCall) : null,
    inboundPopup: snapshot.inboundPopup ? mapCallLog(snapshot.inboundPopup) : null,
    agentPresence: snapshot.agentPresence ? mapAgentPresence(snapshot.agentPresence) : mapAgentPresence({}),
    telephonyIdentity: snapshot.telephonyIdentity ? mapTelephonyIdentity(snapshot.telephonyIdentity) : mapTelephonyIdentity({}),
    serverNow: normalizeIso(snapshot.serverNow)
  };
}

async function parseFunctionResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(normalizeText(payload?.error || response.statusText || "Unknown function error"));
  }
  return payload;
}

export async function fetchSupabaseCallsSnapshot() {
  const client = getClient();
  const { data, error } = await client.rpc("get_calls_snapshot");
  if (error) {
    throw error;
  }
  return mapSnapshot(data);
}

async function invokeCallsFunction(name, body = {}, refresh = true) {
  const response = await invokeSupabaseFunction(name, {
    method: "POST",
    body
  });
  const payload = await parseFunctionResponse(response);
  if (!refresh) {
    return payload;
  }
  return fetchSupabaseCallsSnapshot();
}

export function startSupabaseCall(payload = {}) {
  return invokeCallsFunction("ringcentral-start-call", {
    to: normalizeText(payload.to),
    displayName: normalizeText(payload.displayName),
    record: normalizeBoolean(payload.record),
    note: normalizeText(payload.note),
    linkedEntityType: normalizeText(payload.linkedEntityType),
    linkedEntityId: normalizeText(payload.linkedEntityId),
    linkedLabel: normalizeText(payload.linkedLabel)
  });
}

export function controlSupabaseCall(callLogId, action, payload = {}) {
  return invokeCallsFunction("ringcentral-call-control", {
    callLogId: normalizeText(callLogId),
    action: normalizeText(action),
    transferTarget: normalizeText(payload.transferTarget),
    digits: normalizeText(payload.digits)
  });
}

export async function deleteSupabaseCallLog(callLogId) {
  const response = await invokeSupabaseFunction("delete-call-log", {
    method: "POST",
    body: {
      callLogId: normalizeText(callLogId)
    }
  });
  return parseFunctionResponse(response);
}

export function answerSupabaseCall(callLogId) {
  return invokeCallsFunction("ringcentral-answer-call", {
    callLogId: normalizeText(callLogId)
  });
}

export function declineSupabaseCall(callLogId) {
  return invokeCallsFunction("ringcentral-decline-call", {
    callLogId: normalizeText(callLogId)
  });
}

export async function saveSupabaseCallWrapup(callLogId, payload = {}) {
  const client = getClient();
  const { data, error } = await client.rpc("save_call_wrapup", {
    p_call_log_id: normalizeText(callLogId),
    p_disposition: normalizeText(payload.disposition),
    p_wrapup_notes: normalizeText(payload.wrapupNotes),
    p_follow_up: normalizeText(payload.followUpAction, "none")
  });
  if (error) {
    throw error;
  }
  return mapSnapshot(data);
}

export async function dismissSupabaseCallWrapup(callLogId) {
  const client = getClient();
  const { data, error } = await client.rpc("dismiss_call_wrapup", {
    p_call_log_id: normalizeText(callLogId)
  });
  if (error) {
    throw error;
  }
  return mapSnapshot(data);
}

export async function setSupabaseAgentPresence(status) {
  const client = getClient();
  const { data, error } = await client.rpc("set_agent_presence", {
    p_presence_status: normalizeText(status, "Available")
  });
  if (error) {
    throw error;
  }
  return mapSnapshot(data);
}

export async function setSupabaseQueueAvailability(acceptingQueueCalls, queueId = "") {
  const client = getClient();
  const { data, error } = await client.rpc("set_queue_availability", {
    p_accepting_queue_calls: Boolean(acceptingQueueCalls),
    p_queue_id: normalizeText(queueId) || null
  });
  if (error) {
    throw error;
  }
  return mapSnapshot(data);
}

export async function acknowledgeSupabaseInboundPopup(callLogId, dismiss = false) {
  const client = getClient();
  const { data, error } = await client.rpc("acknowledge_inbound_popup", {
    p_call_log_id: normalizeText(callLogId),
    p_dismiss: Boolean(dismiss)
  });
  if (error) {
    throw error;
  }
  return mapSnapshot(data);
}

export function syncSupabaseCallPresence() {
  return invokeCallsFunction("ringcentral-sync-presence");
}

export function syncSupabaseCallQueues() {
  return invokeCallsFunction("ringcentral-sync-queues");
}

export function syncSupabaseVoicemails() {
  return invokeCallsFunction("ringcentral-sync-voicemails");
}
