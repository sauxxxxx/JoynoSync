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

function normalizeIso(value) {
  return normalizeText(value);
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === undefined || value === null) {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function normalizeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function mapNotification(entry) {
  const payload = normalizeObject(entry?.payload);
  const routeParams = normalizeObject(entry?.routeParams);
  return {
    id: normalizeText(entry?.id),
    type: normalizeText(entry?.type, "info"),
    title: normalizeText(entry?.title, "Notification"),
    meta: normalizeText(entry?.meta),
    body: normalizeText(entry?.body),
    badge: normalizeText(entry?.badge),
    tone: normalizeText(entry?.tone, "info"),
    routeId: normalizeText(entry?.routeId, "dashboard"),
    routeParams,
    entityType: normalizeText(entry?.entityType),
    entityId: normalizeText(entry?.entityId),
    payload,
    createdAt: normalizeIso(entry?.createdAt),
    updatedAt: normalizeIso(entry?.updatedAt),
    readAt: normalizeIso(entry?.readAt),
    unread: !normalizeText(entry?.readAt)
  };
}

async function callNotificationsRpc(functionName, args = {}) {
  const client = getClient();
  const { data, error } = await client.rpc(functionName, args);
  if (error) {
    throw error;
  }
  return data;
}

export async function fetchSupabaseNotificationsSnapshot(workspaceId, options = {}) {
  const data = await callNotificationsRpc("get_notifications_snapshot", {
    p_workspace_id: normalizeText(workspaceId),
    p_limit: Math.max(1, Math.min(50, normalizeNumber(options.limit, 12)))
  });
  const snapshot = normalizeObject(data);
  return {
    enabled: normalizeBoolean(snapshot.enabled, true),
    unreadCount: Math.max(0, normalizeNumber(snapshot.unreadCount, 0)),
    notifications: normalizeArray(snapshot.notifications).map(mapNotification)
  };
}

export async function markSupabaseNotificationsRead(workspaceId, notificationIds = []) {
  const ids = normalizeArray(notificationIds).map((value) => normalizeText(value)).filter(Boolean);
  if (!ids.length) {
    return 0;
  }
  const data = await callNotificationsRpc("mark_notifications_read", {
    p_workspace_id: normalizeText(workspaceId),
    p_notification_ids: ids
  });
  return Math.max(0, normalizeNumber(data, 0));
}

export async function markSupabaseEntityNotificationsRead(workspaceId, entityType, entityId) {
  const data = await callNotificationsRpc("mark_entity_notifications_read", {
    p_workspace_id: normalizeText(workspaceId),
    p_entity_type: normalizeText(entityType),
    p_entity_id: normalizeText(entityId)
  });
  return Math.max(0, normalizeNumber(data, 0));
}

export async function dismissSupabaseNotification(workspaceId, notificationId) {
  const data = await callNotificationsRpc("dismiss_notification", {
    p_workspace_id: normalizeText(workspaceId),
    p_notification_id: normalizeText(notificationId)
  });
  return Boolean(data);
}
