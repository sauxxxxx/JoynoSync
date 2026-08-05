import { createId, saveData } from "../data/store.js";

const CRM_CONVERSATION_ENTITY_TYPES = ["lead", "account", "deal"];

export function normalizeCrmConversationEntityType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return CRM_CONVERSATION_ENTITY_TYPES.includes(normalized) ? normalized : "";
}

export function getCrmEntityCollectionName(entityType) {
  if (entityType === "lead") {
    return "leads";
  }
  if (entityType === "account") {
    return "accounts";
  }
  if (entityType === "deal") {
    return "deals";
  }
  return "";
}

export function getCrmEntityRecord(data, entityType, entityId) {
  const collection = getCrmEntityCollectionName(entityType);
  if (!collection || !Array.isArray(data?.[collection])) {
    return null;
  }
  return data[collection].find((item) => String(item.id || "") === String(entityId || "")) || null;
}

export function findAccountIdByName(data, accountName) {
  const normalized = String(accountName || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  return (
    (data.accounts || []).find((account) => String(account.name || "").trim().toLowerCase() === normalized)?.id || ""
  );
}

export function getCrmConversationStatus(entityType, record, fallback = "active") {
  const safeFallback = String(fallback || "active").trim().toLowerCase() || "active";
  if (!record || typeof record !== "object") {
    return safeFallback;
  }
  if (entityType === "lead") {
    const status = String(record.status || "").trim().toLowerCase();
    return ["converted", "archived"].includes(status) ? "closed" : "active";
  }
  if (entityType === "account") {
    return record.archived ? "closed" : "active";
  }
  if (entityType === "deal") {
    const stage = String(record.stage || "").trim().toLowerCase();
    return ["won", "lost"].includes(stage) ? "closed" : "active";
  }
  return safeFallback;
}

export function buildCrmConversationSnapshot(data, entityType, record, existing = {}) {
  const snapshot = {
    title: String(existing.title || existing.name || "").trim(),
    accountId: String(existing.accountId || "").trim(),
    accountName: String(existing.accountName || "").trim(),
    owner: String(existing.owner || "").trim()
  };

  if (entityType === "lead") {
    snapshot.title = String(record?.name || snapshot.title || "Lead").trim();
    snapshot.accountName = String(record?.company || snapshot.accountName).trim();
    snapshot.accountId = findAccountIdByName(data, snapshot.accountName) || snapshot.accountId;
    snapshot.owner = String(record?.owner || snapshot.owner).trim();
  } else if (entityType === "account") {
    snapshot.title = String(record?.name || snapshot.title || "Account").trim();
    snapshot.accountName = String(record?.name || snapshot.accountName || snapshot.title).trim();
    snapshot.accountId = String(record?.id || snapshot.accountId || findAccountIdByName(data, snapshot.accountName)).trim();
    snapshot.owner = String(record?.owner || snapshot.owner).trim();
  } else if (entityType === "deal") {
    snapshot.title = String(record?.name || snapshot.title || "Deal").trim();
    snapshot.accountName = String(record?.account || snapshot.accountName).trim();
    snapshot.accountId = findAccountIdByName(data, snapshot.accountName) || snapshot.accountId;
    snapshot.owner = String(record?.owner || snapshot.owner).trim();
  }

  return {
    title: snapshot.title,
    accountId: snapshot.accountId,
    accountName: snapshot.accountName,
    owner: snapshot.owner,
    status: getCrmConversationStatus(entityType, record, existing.status)
  };
}

export function ensureMessagingCollections(data) {
  if (!Array.isArray(data.channels)) {
    data.channels = [];
  }
  if (!Array.isArray(data.directThreads)) {
    data.directThreads = [];
  }
  if (!Array.isArray(data.crmConversations)) {
    data.crmConversations = [];
  }

  const existingConversationIdByEntityKey = new Map(
    (data.crmConversations || [])
      .map((conversation) => [
        `${normalizeCrmConversationEntityType(conversation?.entityType || conversation?.type)}:${String(conversation?.entityId || "").trim()}`,
        String(conversation?.id || "").trim()
      ])
      .filter(([key, id]) => key !== ":" && id)
  );

  const retainedChannels = [];
  (data.channels || []).forEach((channel) => {
    const entityType = normalizeCrmConversationEntityType(channel?.type);
    if (!entityType) {
      retainedChannels.push(channel);
      return;
    }
    const rawName = String(channel?.name || "").trim();
    const recordLabel = rawName.includes(":") ? rawName.split(":").slice(1).join(":").trim() : rawName;
    const normalizedLabel = recordLabel.toLowerCase();
    let record = null;
    if (entityType === "lead") {
      record = (data.leads || []).find((lead) => String(lead.name || "").trim().toLowerCase() === normalizedLabel) || null;
    } else if (entityType === "account") {
      record =
        (data.accounts || []).find((account) => String(account.name || "").trim().toLowerCase() === normalizedLabel) || null;
    } else if (entityType === "deal") {
      record = (data.deals || []).find((deal) => String(deal.name || "").trim().toLowerCase() === normalizedLabel) || null;
    }
    if (!record) {
      retainedChannels.push(channel);
      return;
    }
    const entityKey = `${entityType}:${String(record.id || "").trim()}`;
    let crmConversationId = existingConversationIdByEntityKey.get(entityKey) || "";
    if (!crmConversationId) {
      crmConversationId = createId("crmconv");
      const snapshot = buildCrmConversationSnapshot(data, entityType, record, {
        title: recordLabel,
        owner: channel.owner || ""
      });
      data.crmConversations.push({
        id: crmConversationId,
        entityType,
        entityId: String(record.id || "").trim(),
        title: snapshot.title,
        accountId: snapshot.accountId,
        accountName: snapshot.accountName,
        owner: snapshot.owner,
        status: snapshot.status,
        unread: Math.max(0, Number(channel.unread || 0) || 0),
        pinned: Boolean(channel.pinned),
        muted: Boolean(channel.muted),
        createdAt: "",
        updatedAt: ""
      });
      existingConversationIdByEntityKey.set(entityKey, crmConversationId);
    }
    record.crmConversationId = crmConversationId;
    (data.messages || []).forEach((message) => {
      const targetType = message.targetType || (message.channelId ? "channel" : "direct");
      const targetId = message.targetId || message.channelId || "";
      if (targetType === "channel" && String(targetId || "").trim() === String(channel.id || "").trim()) {
        message.targetType = "crm";
        message.targetId = crmConversationId;
        if ("channelId" in message) {
          delete message.channelId;
        }
      }
    });
  });
  data.channels = retainedChannels;

  data.crmConversations = data.crmConversations
    .map((conversation) => {
      if (!conversation || typeof conversation !== "object") {
        return null;
      }
      const entityType = normalizeCrmConversationEntityType(conversation.entityType || conversation.type);
      if (!entityType) {
        return null;
      }
      const entityId = String(conversation.entityId || "").trim();
      const record = getCrmEntityRecord(data, entityType, entityId);
      const snapshot = buildCrmConversationSnapshot(data, entityType, record, conversation);
      return {
        ...conversation,
        ...snapshot,
        id: String(conversation.id || createId("crmconv")),
        entityType,
        entityId,
        unread: Math.max(0, Number(conversation.unread || 0) || 0),
        pinned: Boolean(conversation.pinned),
        muted: Boolean(conversation.muted),
        createdAt: String(conversation.createdAt || ""),
        updatedAt: String(conversation.updatedAt || conversation.createdAt || "")
      };
    })
    .filter(Boolean);

  const conversationIdByEntityKey = new Map(
    data.crmConversations.map((conversation) => [`${conversation.entityType}:${conversation.entityId}`, conversation.id])
  );
  [
    ["leads", "lead"],
    ["accounts", "account"],
    ["deals", "deal"]
  ].forEach(([collectionName, entityType]) => {
    if (!Array.isArray(data[collectionName])) {
      return;
    }
    data[collectionName].forEach((record) => {
      if (!record || typeof record !== "object") {
        return;
      }
      const directLink = String(record.crmConversationId || "").trim();
      if (directLink && data.crmConversations.some((conversation) => conversation.id === directLink)) {
        return;
      }
      const entityKey = `${entityType}:${String(record.id || "").trim()}`;
      record.crmConversationId = conversationIdByEntityKey.get(entityKey) || "";
    });
  });
}

export function findCrmConversationByEntity(data, entityType, entityId) {
  const normalizedType = normalizeCrmConversationEntityType(entityType);
  const safeEntityId = String(entityId || "").trim();
  if (!normalizedType || !safeEntityId) {
    return null;
  }
  return (
    (data.crmConversations || []).find(
      (conversation) =>
        String(conversation.entityType || "").trim().toLowerCase() === normalizedType &&
        String(conversation.entityId || "").trim() === safeEntityId
    ) || null
  );
}

export function syncCrmConversationRecord(data, conversation, entityType, record) {
  if (!conversation || !record) {
    return false;
  }
  const snapshot = buildCrmConversationSnapshot(data, entityType, record, conversation);
  let changed = false;
  ["title", "accountId", "accountName", "owner", "status"].forEach((field) => {
    const nextValue = String(snapshot[field] || "").trim();
    if (String(conversation[field] || "").trim() !== nextValue) {
      conversation[field] = nextValue;
      changed = true;
    }
  });
  if (String(conversation.entityType || "").trim().toLowerCase() !== entityType) {
    conversation.entityType = entityType;
    changed = true;
  }
  if (String(conversation.entityId || "").trim() !== String(record.id || "").trim()) {
    conversation.entityId = String(record.id || "").trim();
    changed = true;
  }
  return changed;
}

export function ensureCrmConversationForRecord(data, entityType, record, createIfMissing = false, getConversationEntity) {
  const normalizedType = normalizeCrmConversationEntityType(entityType);
  if (!normalizedType || !record || typeof record !== "object") {
    return null;
  }
  ensureMessagingCollections(data);

  let dirty = false;
  let conversation = null;
  const linkedId = String(record.crmConversationId || "").trim();
  if (linkedId) {
    conversation = getConversationEntity ? getConversationEntity("crm", linkedId) : null;
    if (conversation && syncCrmConversationRecord(data, conversation, normalizedType, record)) {
      dirty = true;
    }
  }

  if (!conversation) {
    conversation = findCrmConversationByEntity(data, normalizedType, record.id);
    if (conversation) {
      if (String(record.crmConversationId || "").trim() !== conversation.id) {
        record.crmConversationId = conversation.id;
        dirty = true;
      }
      if (syncCrmConversationRecord(data, conversation, normalizedType, record)) {
        dirty = true;
      }
    }
  }

  if (!conversation && createIfMissing) {
    const nowIso = new Date().toISOString();
    const snapshot = buildCrmConversationSnapshot(data, normalizedType, record);
    conversation = {
      id: createId("crmconv"),
      entityType: normalizedType,
      entityId: String(record.id || "").trim(),
      title: snapshot.title,
      accountId: snapshot.accountId,
      accountName: snapshot.accountName,
      owner: snapshot.owner,
      status: snapshot.status,
      unread: 0,
      pinned: false,
      muted: false,
      createdAt: nowIso,
      updatedAt: nowIso
    };
    if (!Array.isArray(data.crmConversations)) {
      data.crmConversations = [];
    }
    data.crmConversations.unshift(conversation);
    record.crmConversationId = conversation.id;
    dirty = true;
  }

  if (dirty) {
    saveData(data);
  }
  return conversation;
}
