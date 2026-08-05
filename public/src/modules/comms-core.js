import { createId, saveData } from "../data/store.js";
import { conversationKey } from "../utils/conversations.js";

export function getDefaultConversationKey(data) {
  if (data.channels?.length) {
    return conversationKey("channel", data.channels[0].id);
  }
  if (data.directThreads?.length) {
    return conversationKey("direct", data.directThreads[0].id);
  }
  return null;
}

export function getConversationOptions(data) {
  const channelOptions = (data.channels || []).map((channel) => ({
    value: conversationKey("channel", channel.id),
    label: `GC / ${channel.name}`
  }));
  const directOptions = (data.directThreads || []).map((thread) => ({
    value: conversationKey("direct", thread.id),
    label: `@ ${thread.name} (Direct)`
  }));
  return [...channelOptions, ...directOptions];
}

export function parseConversationOption(value) {
  if (!value || typeof value !== "string") {
    return { targetType: "channel", targetId: "" };
  }
  const [targetType, ...rest] = value.split(":");
  return { targetType, targetId: rest.join(":") };
}

export function getSelectedConversation(data, selectedKey) {
  const options = [
    ...(data.channels || []).map((channel) => ({
      targetType: "channel",
      targetId: channel.id,
      entity: channel
    })),
    ...(data.directThreads || []).map((thread) => ({
      targetType: "direct",
      targetId: thread.id,
      entity: thread
    }))
  ];

  const parsed = parseConversationOption(selectedKey || "");
  const found = options.find((item) => item.targetType === parsed.targetType && item.targetId === parsed.targetId);
  if (found) {
    return found;
  }

  const fallbackKey = getDefaultConversationKey(data);
  const fallback = parseConversationOption(fallbackKey || "");
  return options.find((item) => item.targetType === fallback.targetType && item.targetId === fallback.targetId) || null;
}

export function getConversationCollection(data, targetType) {
  if (targetType === "crm") {
    return data.crmConversations || [];
  }
  if (targetType === "direct") {
    return data.directThreads || [];
  }
  return data.channels || [];
}

export function getConversationEntity(data, targetType, targetId) {
  return (
    getConversationCollection(data, targetType).find((item) => String(item.id || "") === String(targetId || "")) || null
  );
}

export function findDirectThreadByName(data, name, normalizeForMatch) {
  const normalized = normalizeForMatch(name);
  if (!normalized) {
    return null;
  }
  return (data.directThreads || []).find((thread) => normalizeForMatch(thread.name) === normalized) || null;
}

export function ensureNamedDirectThread(data, name, currentUserName, normalizeForMatch, createIfMissing = false) {
  const direct = findDirectThreadByName(data, name, normalizeForMatch);
  if (direct) {
    return direct;
  }
  if (!createIfMissing) {
    return null;
  }
  const safeName = String(name || "").trim();
  if (!safeName) {
    return null;
  }
  if (!Array.isArray(data.directThreads)) {
    data.directThreads = [];
  }
  const thread = {
    id: createId("dm"),
    name: safeName,
    members: [String(currentUserName || "").trim() || "Owner", safeName],
    unread: 0,
    pinned: false,
    muted: false
  };
  data.directThreads.unshift(thread);
  saveData(data);
  return thread;
}
