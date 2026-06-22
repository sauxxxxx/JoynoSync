import { isSupabaseConfigured } from "../supabase/init.js";
import { seedData } from "./seed.js";

const STORAGE_KEY = "joyno_crm_demo_v1";

function cloneSeed() {
  return stripEphemeralCollections(structuredClone(seedData));
}

function isNonNullObject(value) {
  return value !== null && typeof value === "object";
}

function hasCoreCollections(data) {
  const requiredKeys = [
    "leads",
    "contacts",
    "accounts",
    "deals",
    "teamMembers",
    "channels",
    "messages",
    "workspace",
    "currentUser"
  ];
  return requiredKeys.every((key) => Object.hasOwn(data, key));
}

function normalizeChannels(channels) {
  if (!Array.isArray(channels)) {
    return [];
  }

  return channels.map((channel) => ({
    ...channel,
    topic: channel.topic || "",
    unread: Number(channel.unread || 0),
    pinned: Boolean(channel.pinned),
    muted: Boolean(channel.muted)
  }));
}

function normalizeDirectThreads(directThreads) {
  if (!Array.isArray(directThreads)) {
    return [];
  }

  return directThreads.map((thread) => ({
    ...thread,
    members: Array.isArray(thread.members) ? thread.members : [],
    unread: Number(thread.unread || 0),
    pinned: Boolean(thread.pinned),
    muted: Boolean(thread.muted)
  }));
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.map((message) => {
    const targetType = message.targetType || (message.channelId ? "channel" : "direct");
    const targetId = message.targetId || message.channelId || "";

    return {
      ...message,
      targetType,
      targetId,
      messageType: message.messageType || "Update",
      important: Boolean(message.important),
      linkedType: message.linkedType || "",
      linkedLabel: message.linkedLabel || ""
    };
  });
}

function stripWorkCollections(data) {
  if (!isNonNullObject(data)) {
    return data;
  }
  const next = data;
  next.tasks = [];
  next.projects = [];
  next.waitingList = [];
  return next;
}

function stripCrmCollections(data) {
  if (!isNonNullObject(data)) {
    return data;
  }
  const next = data;
  next.accounts = [];
  next.contacts = [];
  next.leads = [];
  next.deals = [];
  return next;
}

function stripAttendanceCollections(data) {
  if (!isNonNullObject(data)) {
    return data;
  }
  const next = data;
  next.attendanceLogs = [];
  next.attendanceRequests = [];
  next.attendancePolicy = {};
  return next;
}

function stripCallsCollections(data) {
  if (!isNonNullObject(data)) {
    return data;
  }
  const next = data;
  next.callLogs = [];
  next.voicemails = [];
  next.callQueues = [];
  next.agentPresence = {};
  next.telephonyIdentity = {};
  return next;
}

function stripMessengerCollections(data) {
  if (!isNonNullObject(data) || !data.__stripMessenger) {
    return data;
  }
  const next = data;
  if (Array.isArray(next.channels)) {
    next.channels = next.channels.filter((channel) => !channel?.isMessenger);
  }
  if (Array.isArray(next.directThreads)) {
    next.directThreads = next.directThreads.filter((thread) => !thread?.isMessenger);
  }
  if (Array.isArray(next.messages)) {
    next.messages = next.messages.filter((message) => {
      if (message?.isMessenger) {
        return false;
      }
      const commMode = String(message?.commMode || "").trim().toLowerCase();
      if (commMode === "internal") {
        return false;
      }
      return true;
    });
  }
  delete next.__stripMessenger;
  return next;
}

function stripConnectedBootstrapCollections(data) {
  if (!isNonNullObject(data)) {
    return data;
  }
  const next = data;
  next.workspace = {};
  next.currentUser = {};
  next.teamMembers = [];
  next.messages = [];
  next.metrics = {};
  return next;
}

function stripEphemeralCollections(data) {
  return stripMessengerCollections(stripCallsCollections(stripAttendanceCollections(stripWorkCollections(data))));
}

function buildPersistableData(data) {
  const prepared = structuredClone(data);
  if (!isSupabaseConfigured()) {
    return stripEphemeralCollections(prepared);
  }
  prepared.__stripMessenger = true;
  return stripConnectedBootstrapCollections(
    stripCrmCollections(
      stripEphemeralCollections(prepared)
    )
  );
}

function normalizeData(data) {
  const normalized = structuredClone(data);
  normalized.channels = normalizeChannels(normalized.channels);
  normalized.directThreads = normalizeDirectThreads(normalized.directThreads);
  if (normalized.directThreads.length === 0 && Array.isArray(normalized.teamMembers)) {
    const currentUserName = normalized.currentUser?.name || "";
    normalized.directThreads = normalized.teamMembers
      .filter((member) => member.name && member.name !== currentUserName)
      .slice(0, 3)
      .map((member, index) => ({
        id: `dm_seed_${index + 1}`,
        name: member.name,
        members: [currentUserName, member.name].filter(Boolean),
        unread: 0,
        pinned: false,
        muted: false
      }));
  }
  normalized.messages = normalizeMessages(normalized.messages);
  return stripEphemeralCollections(normalized);
}

export function loadData() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return cloneSeed();
    }

    const parsed = JSON.parse(raw);
    if (!isNonNullObject(parsed) || !hasCoreCollections(parsed)) {
      return cloneSeed();
    }

    return normalizeData(parsed);
  } catch {
    return cloneSeed();
  }
}

export function saveData(data) {
  const payload = JSON.stringify(buildPersistableData(data));
  try {
    window.localStorage.setItem(STORAGE_KEY, payload);
    return true;
  } catch (error) {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.setItem(STORAGE_KEY, payload);
      return true;
    } catch (fallbackError) {
      console.warn("Local data cache skipped.", fallbackError || error);
      return false;
    }
  }
}

export function resetData() {
  const fresh = cloneSeed();
  saveData(fresh);
  return fresh;
}

export function createId(prefix) {
  const randomPart = Math.random().toString(36).slice(2, 7);
  return `${prefix}_${Date.now()}_${randomPart}`;
}
