import { invokeSupabaseFunction } from "./functions.js";

function normalizeText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeIso(value) {
  return normalizeText(value);
}

function normalizeBoolean(value) {
  return Boolean(value);
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeEmailFolder(value, fallback = "inbox") {
  const normalized = String(value || "").trim().toLowerCase();
  if (["inbox", "unread", "sent", "drafts", "spam", "trash"].includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function mapMailboxAttachment(entry) {
  return {
    id: normalizeText(entry?.id),
    name: normalizeText(entry?.name),
    mimeType: normalizeText(entry?.mimeType, "application/octet-stream"),
    size: Number(entry?.size || 0) || 0
  };
}

function mapMailboxMessage(entry) {
  return {
    id: normalizeText(entry?.id),
    threadId: normalizeText(entry?.threadId),
    targetType: normalizeText(entry?.targetType),
    targetId: normalizeText(entry?.targetId),
    sender: normalizeText(entry?.sender, "Unknown sender"),
    senderAddress: normalizeText(entry?.senderAddress),
    text: String(entry?.text || ""),
    html: String(entry?.html || ""),
    messageType: normalizeText(entry?.messageType, "Announcement"),
    important: normalizeBoolean(entry?.important),
    linkedType: normalizeText(entry?.linkedType),
    linkedLabel: normalizeText(entry?.linkedLabel),
    commMode: "email",
    emailFolder: normalizeEmailFolder(entry?.emailFolder),
    emailSubject: normalizeText(entry?.emailSubject, "No subject"),
    emailTo: normalizeText(entry?.emailTo),
    emailCc: normalizeText(entry?.emailCc),
    emailBcc: normalizeText(entry?.emailBcc),
    createdAt: normalizeIso(entry?.createdAt),
    attachments: normalizeArray(entry?.attachments).map(mapMailboxAttachment),
    emailSnippet: normalizeText(entry?.emailSnippet),
    isGmailMailbox: true
  };
}

function normalizeMailboxCounts(value) {
  const counts = value && typeof value === "object" ? value : {};
  return {
    inbox: Number(counts.inbox || 0) || 0,
    unread: Number(counts.unread || 0) || 0,
    sent: Number(counts.sent || 0) || 0,
    drafts: Number(counts.drafts || 0) || 0,
    spam: Number(counts.spam || 0) || 0,
    trash: Number(counts.trash || 0) || 0
  };
}

async function parseFunctionResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(normalizeText(payload?.error || response.statusText || "Unknown function error"));
  }
  return payload;
}

export async function fetchSupabaseEmailMailbox(payload = {}) {
  const response = await invokeSupabaseFunction("gmail-mailbox", {
    method: "GET",
    accessToken: normalizeText(payload.accessToken),
    query: {
      workspaceId: normalizeText(payload.workspaceId),
      userId: normalizeText(payload.userId),
      integrationId: normalizeText(payload.integrationId),
      folder: normalizeEmailFolder(payload.folder),
      limit: Number(payload.limit || 25) || 25
    }
  });
  const result = await parseFunctionResponse(response);
  return {
    provider: normalizeText(result.provider, "gmail"),
    source: normalizeText(result.source, "supabase"),
    folder: normalizeEmailFolder(result.folder),
    counts: normalizeMailboxCounts(result.counts),
    items: normalizeArray(result.items).map(mapMailboxMessage)
  };
}
