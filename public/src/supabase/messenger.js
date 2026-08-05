import { initSupabase } from "./init.js";

const MESSENGER_ATTACHMENT_BUCKET = "messenger-attachments";
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel"
]);
const ALLOWED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "pdf", "docx", "xlsx", "csv"]);

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

function normalizeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function sanitizeStorageSegment(value, fallback = "file") {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || fallback;
}

function getFileExtension(name) {
  const safeName = String(name || "").trim();
  const parts = safeName.split(".");
  if (parts.length < 2) {
    return "";
  }
  return String(parts[parts.length - 1] || "").trim().toLowerCase();
}

function mapMessengerAttachment(entry) {
  return {
    id: normalizeText(entry?.id),
    storagePath: normalizeText(entry?.storagePath),
    name: normalizeText(entry?.filename),
    type: normalizeText(entry?.mimeType),
    size: normalizeNumber(entry?.size, 0),
    createdAt: normalizeIso(entry?.createdAt)
  };
}

function mapMessengerReaction(entry) {
  return {
    emoji: normalizeText(entry?.emoji),
    count: normalizeNumber(entry?.count, 0),
    reacted: Boolean(entry?.reacted)
  };
}

function mapMessengerPresenceMember(entry) {
  return {
    id: normalizeText(entry?.id),
    memberId: normalizeText(entry?.memberId),
    presenceStatus: normalizeText(entry?.presenceStatus, "Offline"),
    activeConversationId: normalizeText(entry?.activeConversationId),
    lastSeenAt: normalizeIso(entry?.lastSeenAt),
    updatedAt: normalizeIso(entry?.updatedAt)
  };
}

function mapMessengerPresence(entry) {
  if (!entry || typeof entry !== "object") {
    return {
      members: [],
      activeCount: 0,
      recentCount: 0,
      lastSeenAt: ""
    };
  }
  return {
    members: normalizeArray(entry?.members).map(mapMessengerPresenceMember).filter((member) => Boolean(member.memberId)),
    activeCount: normalizeNumber(entry?.activeCount, 0),
    recentCount: normalizeNumber(entry?.recentCount, 0),
    lastSeenAt: normalizeIso(entry?.lastSeenAt)
  };
}

function mapMessengerMessage(entry) {
  return {
    id: normalizeText(entry?.id),
    conversationId: normalizeText(entry?.conversationId),
    workspaceId: normalizeText(entry?.workspaceId),
    senderId: normalizeText(entry?.senderId),
    sender: normalizeText(entry?.sender, "Unknown"),
    text: normalizeText(entry?.body),
    createdAt: normalizeIso(entry?.createdAt),
    editedAt: normalizeIso(entry?.editedAt),
    deletedAt: normalizeIso(entry?.deletedAt),
    attachments: normalizeArray(entry?.attachments).map(mapMessengerAttachment),
    reactions: normalizeArray(entry?.reactions).map(mapMessengerReaction)
  };
}

function mapMessengerConversation(entry) {
  const latest = entry?.latestMessage && typeof entry.latestMessage === "object" ? entry.latestMessage : null;
  return {
    id: normalizeText(entry?.id),
    workspaceId: normalizeText(entry?.workspaceId),
    type: normalizeText(entry?.type, "direct"),
    title: normalizeText(entry?.title),
    memberIds: normalizeArray(entry?.memberIds).map((value) => normalizeText(value)).filter(Boolean),
    unreadCount: normalizeNumber(entry?.unreadCount, 0),
    pinned: Boolean(entry?.pinned),
    muted: Boolean(entry?.muted),
    lastReadAt: normalizeIso(entry?.lastReadAt),
    createdAt: normalizeIso(entry?.createdAt),
    updatedAt: normalizeIso(entry?.updatedAt),
    memberIds: normalizeArray(entry?.memberIds).map((value) => normalizeText(value)).filter(Boolean),
    presence: mapMessengerPresence(entry?.presence),
    latestMessage: latest
      ? {
          id: normalizeText(latest?.id),
          senderId: normalizeText(latest?.senderId),
          sender: normalizeText(latest?.sender, "Unknown"),
          text: normalizeText(latest?.body),
          createdAt: normalizeIso(latest?.createdAt),
          deletedAt: normalizeIso(latest?.deletedAt),
          attachmentCount: normalizeNumber(latest?.attachmentCount, 0)
        }
      : null
  };
}

async function callMessengerRpc(functionName, args = {}) {
  const client = getClient();
  const { data, error } = await client.rpc(functionName, args);
  if (error) {
    throw error;
  }
  return data;
}

export async function fetchSupabaseMessengerSnapshot() {
  const data = await callMessengerRpc("get_conversations_snapshot");
  const conversations = normalizeArray(data?.conversations || data).map(mapMessengerConversation);
  return { conversations };
}

export async function fetchSupabaseMessengerMessages(conversationId, options = {}) {
  const payload = {
    p_conversation_id: normalizeText(conversationId),
    p_limit: normalizeNumber(options.limit, 60),
    p_before: options.before || null,
    p_search: normalizeText(options.search)
  };
  const data = await callMessengerRpc("get_messages", payload);
  return normalizeArray(data?.messages || data).map(mapMessengerMessage);
}

export async function createSupabaseDirectConversation(memberId) {
  const data = await callMessengerRpc("create_direct_conversation", {
    p_member_id: normalizeText(memberId)
  });
  return normalizeText(data);
}

export async function createSupabaseGroupConversation(title, memberIds = []) {
  const data = await callMessengerRpc("create_group_conversation", {
    p_title: normalizeText(title),
    p_member_ids: normalizeArray(memberIds).map((value) => normalizeText(value)).filter(Boolean)
  });
  return normalizeText(data);
}

export async function markSupabaseConversationRead(conversationId, options = {}) {
  const data = await callMessengerRpc("mark_read", {
    p_conversation_id: normalizeText(conversationId),
    p_mark_unread: Boolean(options.markUnread)
  });
  return mapMessengerConversation(data || {});
}

export async function updateSupabaseConversationPrefs(conversationId, prefs = {}) {
  const data = await callMessengerRpc("update_conversation_prefs", {
    p_conversation_id: normalizeText(conversationId),
    p_pinned: typeof prefs.pinned === "boolean" ? prefs.pinned : null,
    p_muted: typeof prefs.muted === "boolean" ? prefs.muted : null
  });
  return mapMessengerConversation(data || {});
}

export async function deleteSupabaseMessengerConversation(conversationId) {
  return callMessengerRpc("delete_conversation", {
    p_conversation_id: normalizeText(conversationId)
  });
}

export async function setSupabaseTyping(conversationId, isTyping) {
  await callMessengerRpc("set_typing", {
    p_conversation_id: normalizeText(conversationId),
    p_is_typing: Boolean(isTyping)
  });
}

export async function setSupabaseMessengerPresence(presenceStatus = "Active", activeConversationId = null) {
  return callMessengerRpc("set_messenger_presence", {
    p_presence_status: normalizeText(presenceStatus, "Active"),
    p_active_conversation_id: normalizeText(activeConversationId) || null
  });
}

function validateAttachmentFile(file) {
  if (!(file instanceof File)) {
    throw new Error("Attachment is not a valid file.");
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error("Attachment exceeds the 25 MB limit.");
  }
  const mime = normalizeText(file.type);
  const extension = getFileExtension(file.name);
  if (!mime || !ALLOWED_MIME_TYPES.has(mime)) {
    throw new Error("Attachment type is not allowed.");
  }
  if (!extension || !ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error("Attachment file extension is not allowed.");
  }
}

async function uploadMessengerAttachment(workspaceId, conversationId, file) {
  const client = getClient();
  validateAttachmentFile(file);

  const storagePath = [
    sanitizeStorageSegment(workspaceId, "workspace"),
    sanitizeStorageSegment(conversationId, "conversation"),
    `${Date.now()}-${sanitizeStorageSegment(file.name, "attachment")}`
  ].join("/");

  const { error: uploadError } = await client.storage
    .from(MESSENGER_ATTACHMENT_BUCKET)
    .upload(storagePath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: normalizeText(file.type, "application/octet-stream")
    });

  if (uploadError) {
    throw uploadError;
  }

  return {
    storagePath,
    filename: normalizeText(file.name, "attachment"),
    mimeType: normalizeText(file.type, "application/octet-stream"),
    sizeBytes: normalizeNumber(file.size, 0)
  };
}

export async function sendSupabaseMessengerMessage(conversationId, workspaceId, payload = {}) {
  const normalizedConversationId = normalizeText(conversationId);
  const normalizedWorkspaceId = normalizeText(workspaceId);
  if (!normalizedConversationId || !normalizedWorkspaceId) {
    throw new Error("Conversation and workspace are required.");
  }

  const body = normalizeText(payload.body);
  const files = Array.isArray(payload.attachments) ? payload.attachments : [];

  if (!body && !files.length) {
    throw new Error("Message text or attachment is required.");
  }

  const uploaded = [];
  try {
    for (const file of files) {
      uploaded.push(await uploadMessengerAttachment(normalizedWorkspaceId, normalizedConversationId, file));
    }

    const data = await callMessengerRpc("send_message", {
      p_conversation_id: normalizedConversationId,
      p_body: body,
      p_attachments: uploaded
    });

    return mapMessengerMessage(data || {});
  } catch (error) {
    if (uploaded.length) {
      const client = getClient();
      const paths = uploaded.map((item) => item.storagePath).filter(Boolean);
      if (paths.length) {
        await client.storage.from(MESSENGER_ATTACHMENT_BUCKET).remove(paths).catch(() => null);
      }
    }
    throw error;
  }
}

export async function editSupabaseMessengerMessage(messageId, body) {
  const data = await callMessengerRpc("edit_message", {
    p_message_id: normalizeText(messageId),
    p_body: normalizeText(body)
  });
  return mapMessengerMessage(data || {});
}

export async function deleteSupabaseMessengerMessage(messageId) {
  const data = await callMessengerRpc("delete_message", {
    p_message_id: normalizeText(messageId)
  });
  return mapMessengerMessage(data || {});
}

export async function addSupabaseMessageReaction(messageId, emoji) {
  const data = await callMessengerRpc("add_reaction", {
    p_message_id: normalizeText(messageId),
    p_emoji: normalizeText(emoji)
  });
  return {
    messageId: normalizeText(data?.messageId || messageId),
    reactions: normalizeArray(data?.reactions).map(mapMessengerReaction)
  };
}

export async function removeSupabaseMessageReaction(messageId, emoji) {
  const data = await callMessengerRpc("remove_reaction", {
    p_message_id: normalizeText(messageId),
    p_emoji: normalizeText(emoji)
  });
  return {
    messageId: normalizeText(data?.messageId || messageId),
    reactions: normalizeArray(data?.reactions).map(mapMessengerReaction)
  };
}

export async function createSupabaseMessengerAttachmentSignedUrl(storagePath, expiresInSeconds = 60) {
  const client = getClient();
  const normalizedStoragePath = normalizeText(storagePath);
  if (!normalizedStoragePath) {
    throw new Error("Attachment path is required.");
  }
  const ttl = Math.max(15, normalizeNumber(expiresInSeconds, 60));
  const { data, error } = await client.storage
    .from(MESSENGER_ATTACHMENT_BUCKET)
    .createSignedUrl(normalizedStoragePath, ttl);
  if (error) {
    throw error;
  }
  return normalizeText(data?.signedUrl);
}
