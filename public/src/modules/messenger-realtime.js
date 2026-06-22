import {
  fetchSupabaseMessengerMessages,
  fetchSupabaseMessengerSnapshot,
  setSupabaseMessengerPresence
} from "../supabase/messenger.js";

const DEFAULT_MESSENGER_REALTIME_FALLBACK_MS = 5000;
const DEFAULT_MESSENGER_REFRESH_DELAY_MS = 1200;
const DEFAULT_MESSENGER_ACTIVE_REFRESH_DELAY_MS = 1200;
const DEFAULT_MESSENGER_SILENT_REFRESH_MS = 1000;

export function createMessengerRealtime(options = {}) {
  const {
    state = null,
    fallbackMs = DEFAULT_MESSENGER_REALTIME_FALLBACK_MS,
    canAccessComms,
    isSupabaseMessengerEnabled,
    initSupabase,
    withRetryableSystemSync,
    getConversationEntity,
    getDefaultConversationKey,
    parseConversationOption,
    getActiveMessengerConversationRef,
    renderRoute,
    setRealtimeHealth,
    resetSystemHealthEntry,
    recordSystemEvent,
    getSystemErrorMessage
  } = options;

  let realtimeChannel = null;
  const realtimeState = {
    refreshTimer: 0,
    pendingConversationIds: new Set(),
    activeRefreshTimer: 0,
    activeConversationId: "",
    activeTargetType: "direct",
    silentRefreshTimer: 0,
    fallbackTimer: 0,
    deferredRenderTimer: 0,
    deferredRenderPending: false
  };
  const prefetchState = {
    loadedConversationKeys: new Set()
  };
  const presenceState = {
    heartbeatTimer: 0,
    lastStatus: "",
    lastActiveSentAt: 0,
    inFlight: false,
    queuedStatus: "",
    queuedConversationId: "",
    listenersBound: false,
    visibilityHandler: null,
    focusHandler: null,
    blurHandler: null
  };

  function getMessengerConversationCacheKey(conversationId, targetType) {
    const normalizedConversationId = String(conversationId || "").trim();
    const normalizedTargetType = targetType === "channel" ? "channel" : "direct";
    return normalizedConversationId ? `${normalizedTargetType}:${normalizedConversationId}` : "";
  }

  function isMessengerConversationPrefetched(conversationId, targetType) {
    const cacheKey = getMessengerConversationCacheKey(conversationId, targetType);
    return cacheKey ? prefetchState.loadedConversationKeys.has(cacheKey) : false;
  }

  function markMessengerConversationPrefetched(conversationId, targetType) {
    const cacheKey = getMessengerConversationCacheKey(conversationId, targetType);
    if (cacheKey) {
      prefetchState.loadedConversationKeys.add(cacheKey);
    }
  }

  function clearCachedState() {
    prefetchState.loadedConversationKeys.clear();
  }

  function syncMessengerPrefetchState(conversationRefs) {
    const activeKeys = new Set(
      (Array.isArray(conversationRefs) ? conversationRefs : [])
        .map((item) => getMessengerConversationCacheKey(item?.conversationId, item?.targetType))
        .filter(Boolean)
    );
    prefetchState.loadedConversationKeys.forEach((cacheKey) => {
      if (!activeKeys.has(cacheKey)) {
        prefetchState.loadedConversationKeys.delete(cacheKey);
      }
    });
  }

  function dedupeMessengerConversationRefs(conversationRefs) {
    const refsByKey = new Map();
    (Array.isArray(conversationRefs) ? conversationRefs : []).forEach((item) => {
      const conversationId = String(item?.conversationId || item?.id || "").trim();
      if (!conversationId) {
        return;
      }
      const targetType = item?.targetType === "channel" ? "channel" : "direct";
      refsByKey.set(getMessengerConversationCacheKey(conversationId, targetType), {
        conversationId,
        targetType
      });
    });
    return [...refsByKey.values()];
  }

  function getSupabaseMessengerConversationRefs() {
    return dedupeMessengerConversationRefs([
      ...(state.data.channels || [])
        .filter((channel) => channel?.isMessenger)
        .map((channel) => ({
          conversationId: String(channel.id || "").trim(),
          targetType: "channel"
        })),
      ...(state.data.directThreads || [])
        .filter((thread) => thread?.isMessenger)
        .map((thread) => ({
          conversationId: String(thread.id || "").trim(),
          targetType: "direct"
        }))
    ]).filter((item) => item.conversationId);
  }

  function getSupabaseMessengerTargetType(conversationId) {
    const targetId = String(conversationId || "").trim();
    if (!targetId) {
      return "direct";
    }
    if ((state.data.channels || []).some((channel) => channel?.isMessenger && String(channel.id || "").trim() === targetId)) {
      return "channel";
    }
    return "direct";
  }

  function createMessengerRefreshOutcome(kind, background, details = {}) {
    if (!background) {
      return true;
    }
    return {
      ok: true,
      kind,
      background: true,
      ...details
    };
  }

  function clearMessengerDeferredRender() {
    realtimeState.deferredRenderPending = false;
    if (realtimeState.deferredRenderTimer) {
      window.clearInterval(realtimeState.deferredRenderTimer);
      realtimeState.deferredRenderTimer = 0;
    }
  }

  function isMessengerUiBusy() {
    if (state.routeId !== "comms-messenger") {
      return false;
    }
    const root = document.getElementById("viewContent");
    if (!(root instanceof HTMLElement)) {
      return false;
    }
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && root.contains(activeElement)) {
      if (
        activeElement.matches("#commComposerText, .messenger-view input, .messenger-view textarea, .messenger-view select")
      ) {
        return true;
      }
    }
    if (String(state.messengerEditMessageId || "").trim()) {
      return true;
    }
    if (Boolean(state.messengerSending)) {
      return true;
    }
    return Boolean(root.querySelector(".messenger-view details[open]"));
  }

  function requestMessengerRouteRender() {
    if (state.routeId !== "comms-messenger") {
      renderRoute();
      return;
    }
    if (!isMessengerUiBusy()) {
      clearMessengerDeferredRender();
      renderRoute();
      return;
    }
    realtimeState.deferredRenderPending = true;
    if (realtimeState.deferredRenderTimer) {
      return;
    }
    realtimeState.deferredRenderTimer = window.setInterval(() => {
      if (state.routeId !== "comms-messenger") {
        clearMessengerDeferredRender();
        return;
      }
      if (isMessengerUiBusy()) {
        return;
      }
      if (!realtimeState.deferredRenderPending) {
        clearMessengerDeferredRender();
        return;
      }
      clearMessengerDeferredRender();
      renderRoute();
    }, 250);
  }

  function getActiveMessengerPresenceConversationId() {
    const selected = getActiveMessengerConversationRef?.();
    return String(selected?.targetId || "").trim();
  }

  function getMessengerPresenceDesiredStatus() {
    const hasFocus = typeof document.hasFocus === "function" ? document.hasFocus() : true;
    return document.hidden || !hasFocus ? "Idle" : "Active";
  }

  function buildTeamMemberNameMap() {
    return new Map(
      (state.data.teamMembers || []).map((member) => [String(member.id || ""), String(member.name || "").trim()])
    );
  }

  function mapMessengerLatestMessage(latest) {
    if (!latest || typeof latest !== "object") {
      return null;
    }
    return {
      id: String(latest.id || "").trim(),
      senderId: String(latest.senderId || "").trim(),
      sender: String(latest.sender || "").trim() || "Unknown",
      text: String(latest.text || latest.body || "").trim(),
      createdAt: String(latest.createdAt || ""),
      deletedAt: String(latest.deletedAt || ""),
      attachmentCount: Math.max(0, Number(latest.attachmentCount || 0))
    };
  }

  function mapMessengerConversationToChannel(conversation, nameMap, currentMemberId) {
    const memberNames = (conversation.memberIds || []).map((id) => nameMap.get(String(id || "")) || "Unknown");
    const topicNames = memberNames.filter(
      (name) => String(name || "").trim() && String(name || "").trim() !== String(state.data.currentUser?.name || "").trim()
    );
    const topic = topicNames.slice(0, 3).join(", ");
    return {
      id: String(conversation.id || "").trim(),
      name: String(conversation.title || "").trim() || "Group Chat",
      type: "GC",
      topic,
      memberIds: Array.isArray(conversation.memberIds) ? [...conversation.memberIds] : [],
      unread: Math.max(0, Number(conversation.unreadCount || 0)),
      pinned: Boolean(conversation.pinned),
      muted: Boolean(conversation.muted),
      createdAt: String(conversation.createdAt || ""),
      updatedAt: String(conversation.updatedAt || ""),
      presence: conversation.presence && typeof conversation.presence === "object" ? conversation.presence : null,
      latestMessage: mapMessengerLatestMessage(conversation.latestMessage),
      isMessenger: true
    };
  }

  function mapMessengerConversationToDirectThread(conversation, nameMap, currentMemberId) {
    const memberNames = (conversation.memberIds || []).map((id) => nameMap.get(String(id || "")) || "Unknown");
    const otherNames = (conversation.memberIds || [])
      .filter((id) => String(id || "") !== String(currentMemberId || ""))
      .map((id) => nameMap.get(String(id || "")) || "Unknown")
      .filter(Boolean);
    const displayName = otherNames.join(", ") || memberNames.filter(Boolean).join(", ") || "Direct Message";
    return {
      id: String(conversation.id || "").trim(),
      name: displayName,
      members: memberNames.filter(Boolean),
      memberIds: Array.isArray(conversation.memberIds) ? [...conversation.memberIds] : [],
      unread: Math.max(0, Number(conversation.unreadCount || 0)),
      pinned: Boolean(conversation.pinned),
      muted: Boolean(conversation.muted),
      createdAt: String(conversation.createdAt || ""),
      updatedAt: String(conversation.updatedAt || ""),
      presence: conversation.presence && typeof conversation.presence === "object" ? conversation.presence : null,
      latestMessage: mapMessengerLatestMessage(conversation.latestMessage),
      isMessenger: true
    };
  }

  function applySupabaseMessengerSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") {
      return;
    }
    const conversations = Array.isArray(snapshot.conversations) ? snapshot.conversations : [];
    const nameMap = buildTeamMemberNameMap();
    const currentMemberId = String(state.data.currentUser?.id || "");
    const channels = [];
    const directThreads = [];
    conversations.forEach((conversation) => {
      const conversationType = String(conversation.type || "direct").trim().toLowerCase();
      if (conversationType === "gc") {
        channels.push(mapMessengerConversationToChannel(conversation, nameMap, currentMemberId));
      } else {
        directThreads.push(mapMessengerConversationToDirectThread(conversation, nameMap, currentMemberId));
      }
    });
    const externalThreads = (state.data.directThreads || []).filter((thread) => !thread?.isMessenger);
    state.data.channels = channels;
    state.data.directThreads = [...externalThreads, ...directThreads];
    const parsed = parseConversationOption(state.selectedConversationKey || "");
    if (!getConversationEntity(parsed.targetType, parsed.targetId)) {
      state.selectedConversationKey = getDefaultConversationKey(state.data);
    }
  }

  function clearSupabaseMessengerState() {
    stopMessengerPresenceHeartbeat();
    clearMessengerDeferredRender();
    state.data.channels = [];
    state.data.directThreads = (state.data.directThreads || []).filter((thread) => !thread?.isMessenger);
    if (Array.isArray(state.data.messages)) {
      state.data.messages = state.data.messages.filter((message) => !message?.isMessenger);
    }
    state.messengerLoading = false;
    state.messengerSending = false;
    state.messengerSnapshotReady = !state.supabaseConfigured;
    state.messengerSnapshotError = "";
    clearCachedState();
    state.messengerTyping = [];
    state.messengerEditMessageId = "";
    state.messengerEditDraft = "";
    state.messengerUiState = {
      draftsByConversationKey: {},
      messageListScrollTop: 0,
      conversationListScrollTop: 0,
      composerSelectionStart: null,
      composerSelectionEnd: null,
      lastSelectedConversationKey: "",
      lastCapturedAt: 0
    };
    resetSystemHealthEntry("messengerSync");
    resetSystemHealthEntry("messengerRealtime");
  }

  function setMessengerMessages(conversationId, targetType, messages) {
    const normalizedConversationId = String(conversationId || "").trim();
    const normalizedTargetType = targetType === "channel" ? "channel" : "direct";
    const baseMessages = Array.isArray(state.data.messages)
      ? state.data.messages.filter((message) => {
          const messageTargetType = message.targetType || (message.channelId ? "channel" : "direct");
          const messageTargetId = message.targetId || message.channelId || "";
          if (message?.isMessenger) {
            return !(messageTargetType === normalizedTargetType && String(messageTargetId || "") === normalizedConversationId);
          }
          return String(message?.commMode || "").trim().toLowerCase() !== "internal";
        })
      : [];
    const nextMessages = (Array.isArray(messages) ? messages : []).map((message) => ({
      ...message,
      targetType: normalizedTargetType,
      targetId: normalizedConversationId,
      commMode: "internal",
      messageType: "Update",
      important: false,
      linkedType: "",
      linkedLabel: "",
      isMessenger: true,
      canEdit: String(message.senderId || "") === String(state.data.currentUser?.id || "")
    }));
    state.data.messages = [...baseMessages, ...nextMessages];
    markMessengerConversationPrefetched(normalizedConversationId, normalizedTargetType);
  }

  async function publishMessengerPresence(nextStatus = "Active", conversationId = "") {
    if (!isSupabaseMessengerEnabled()) {
      return false;
    }
    const normalizedStatus = ["Active", "Idle", "Offline"].includes(String(nextStatus || "").trim())
      ? String(nextStatus || "").trim()
      : "Active";
    const normalizedConversationId = String(conversationId || getActiveMessengerPresenceConversationId() || "").trim() || null;

    if (presenceState.inFlight) {
      presenceState.queuedStatus = normalizedStatus;
      presenceState.queuedConversationId = normalizedConversationId || "";
      return false;
    }

    presenceState.inFlight = true;
    try {
      await setSupabaseMessengerPresence(normalizedStatus, normalizedConversationId);
      presenceState.lastStatus = normalizedStatus;
      if (normalizedStatus === "Active") {
        presenceState.lastActiveSentAt = Date.now();
      }
      return true;
    } catch (error) {
      console.warn("Messenger presence update failed:", error);
      return false;
    } finally {
      presenceState.inFlight = false;
      if (presenceState.queuedStatus) {
        const queuedStatus = presenceState.queuedStatus;
        const queuedConversationId = presenceState.queuedConversationId;
        presenceState.queuedStatus = "";
        presenceState.queuedConversationId = "";
        void publishMessengerPresence(queuedStatus, queuedConversationId);
      }
    }
  }

  async function syncMessengerPresenceState(force = false) {
    if (!isSupabaseMessengerEnabled()) {
      return;
    }
    const desiredStatus = getMessengerPresenceDesiredStatus();
    if (desiredStatus === "Active") {
      const shouldPing = force || presenceState.lastStatus !== "Active" || Date.now() - presenceState.lastActiveSentAt >= 30000;
      if (shouldPing) {
        await publishMessengerPresence("Active");
      }
      return;
    }
    if (force || presenceState.lastStatus !== "Idle") {
      await publishMessengerPresence("Idle");
    }
  }

  function bindMessengerPresenceListeners() {
    if (presenceState.listenersBound) {
      return;
    }
    presenceState.listenersBound = true;
    presenceState.visibilityHandler = () => {
      void syncMessengerPresenceState(true);
    };
    presenceState.focusHandler = () => {
      void syncMessengerPresenceState(true);
    };
    presenceState.blurHandler = () => {
      void syncMessengerPresenceState(true);
    };
    document.addEventListener("visibilitychange", presenceState.visibilityHandler);
    window.addEventListener("focus", presenceState.focusHandler);
    window.addEventListener("blur", presenceState.blurHandler);
  }

  function startMessengerPresenceHeartbeat() {
    if (!isSupabaseMessengerEnabled() || presenceState.heartbeatTimer) {
      return;
    }
    bindMessengerPresenceListeners();
    presenceState.heartbeatTimer = window.setInterval(() => {
      void syncMessengerPresenceState(false);
    }, 30000);
    void syncMessengerPresenceState(true);
  }

  function stopMessengerPresenceHeartbeat() {
    if (presenceState.visibilityHandler) {
      document.removeEventListener("visibilitychange", presenceState.visibilityHandler);
      presenceState.visibilityHandler = null;
    }
    if (presenceState.focusHandler) {
      window.removeEventListener("focus", presenceState.focusHandler);
      presenceState.focusHandler = null;
    }
    if (presenceState.blurHandler) {
      window.removeEventListener("blur", presenceState.blurHandler);
      presenceState.blurHandler = null;
    }
    presenceState.listenersBound = false;
    if (presenceState.heartbeatTimer) {
      window.clearInterval(presenceState.heartbeatTimer);
      presenceState.heartbeatTimer = 0;
    }
    presenceState.lastStatus = "";
    presenceState.lastActiveSentAt = 0;
    presenceState.queuedStatus = "";
    presenceState.queuedConversationId = "";
  }

  function applyMessengerMessagePayload(payload) {
    if (!payload || typeof payload !== "object") {
      return false;
    }
    const record = payload.new || payload.old;
    if (!record || typeof record !== "object") {
      return false;
    }
    const messageId = String(record.id || "").trim();
    const conversationId = String(record.conversation_id || "").trim();
    if (!messageId || !conversationId) {
      return false;
    }

    const targetType = getSupabaseMessengerTargetType(conversationId);
    const senderId = String(record.sender_id || "").trim();
    const senderName = buildTeamMemberNameMap().get(senderId) || "Unknown";
    const baseMessages = Array.isArray(state.data.messages) ? [...state.data.messages] : [];
    const existingIndex = baseMessages.findIndex((message) => String(message?.id || "") === messageId);

    if (payload.eventType === "DELETE") {
      if (existingIndex === -1) {
        return false;
      }
      baseMessages.splice(existingIndex, 1);
      state.data.messages = baseMessages;
      return true;
    }

    const existingMessage = existingIndex >= 0 ? baseMessages[existingIndex] : null;
    const nextMessage = {
      ...(existingMessage || {}),
      id: messageId,
      conversationId,
      workspaceId: String(record.workspace_id || existingMessage?.workspaceId || "").trim(),
      senderId,
      sender: senderName,
      text: String(record.body ?? existingMessage?.text ?? "").trim(),
      createdAt: String(record.created_at || existingMessage?.createdAt || "").trim(),
      editedAt: String(record.edited_at || existingMessage?.editedAt || "").trim(),
      deletedAt: String(record.deleted_at || existingMessage?.deletedAt || "").trim(),
      attachments: Array.isArray(existingMessage?.attachments) ? existingMessage.attachments : [],
      reactions: Array.isArray(existingMessage?.reactions) ? existingMessage.reactions : [],
      targetType,
      targetId: conversationId,
      commMode: "internal",
      messageType: "Update",
      important: false,
      linkedType: "",
      linkedLabel: "",
      isMessenger: true,
      canEdit: senderId === String(state.data.currentUser?.id || "")
    };

    if (existingIndex >= 0) {
      baseMessages[existingIndex] = nextMessage;
    } else {
      baseMessages.push(nextMessage);
    }
    state.data.messages = baseMessages;
    markMessengerConversationPrefetched(conversationId, targetType);
    return true;
  }

  async function refreshSupabaseMessengerMessages(conversationId, options = {}) {
    if (!isSupabaseMessengerEnabled()) {
      return false;
    }
    const targetId = String(conversationId || "").trim();
    if (!targetId) {
      return false;
    }
    const background = options.background === true;
    const shouldRender = options.render !== false && !background;
    const targetType =
      options.targetType ||
      ((state.data.channels || []).some((channel) => String(channel.id || "") === targetId) ? "channel" : "direct");
    const messages = await fetchSupabaseMessengerMessages(targetId, {
      limit: options.limit,
      before: options.before,
      search: options.search
    });
    setMessengerMessages(targetId, targetType, messages);
    if (shouldRender) {
      requestMessengerRouteRender();
    }
    return createMessengerRefreshOutcome("messages", background, {
      conversationId: targetId,
      targetType,
      messageCount: Array.isArray(messages) ? messages.length : 0
    });
  }

  async function refreshSupabaseMessengerMessagesBatch(conversationRefs, options = {}) {
    if (!isSupabaseMessengerEnabled()) {
      return false;
    }
    const refs = dedupeMessengerConversationRefs(conversationRefs);
    if (!refs.length) {
      return false;
    }
    const background = options.background === true;
    const shouldRender = options.render !== false && !background;
    const results = await Promise.all(
      refs.map(async (item) => ({
        ...item,
        messages: await fetchSupabaseMessengerMessages(item.conversationId, {
          limit: options.limit,
          before: options.before,
          search: options.search
        })
      }))
    );
    results.forEach((item) => {
      setMessengerMessages(item.conversationId, item.targetType, item.messages);
    });
    if (shouldRender) {
      requestMessengerRouteRender();
    }
    return createMessengerRefreshOutcome("messages-batch", background, {
      conversationIds: refs.map((item) => item.conversationId),
      messageCount: results.reduce((count, item) => count + (Array.isArray(item.messages) ? item.messages.length : 0), 0)
    });
  }

  async function refreshSupabaseMessengerData(options = {}) {
    const { render = true, alertOnError = false, conversationId = "", fetchAllMessages = false } = options;
    const background = options.background === true;
    const shouldRender = render !== false && !background;
    if (!state.supabaseConfigured || !state.signedInUser) {
      clearSupabaseMessengerState();
      return false;
    }
    if (!canAccessComms()) {
      unsubscribeMessengerRealtime();
      clearSupabaseMessengerState();
      return false;
    }
    if (!String(state.data.workspace?.id || "").trim()) {
      clearSupabaseMessengerState();
      return false;
    }
    if (!background) {
      state.messengerLoading = true;
    }
    state.messengerSnapshotError = "";
    if (shouldRender) {
      requestMessengerRouteRender();
    }
    try {
      let conversationRefs = [];
      let refreshedConversationRefs = [];
      await withRetryableSystemSync(
        "messengerSync",
        async () => {
          const snapshot = await fetchSupabaseMessengerSnapshot();
          applySupabaseMessengerSnapshot(snapshot);
          conversationRefs = getSupabaseMessengerConversationRefs();
          syncMessengerPrefetchState(conversationRefs);
          const normalizedConversationId = String(conversationId || "").trim();
          const selected = parseConversationOption(state.selectedConversationKey || "");
          const explicitRef = normalizedConversationId
            ? {
                conversationId: normalizedConversationId,
                targetType:
                  selected.targetId === normalizedConversationId &&
                  (selected.targetType === "channel" || selected.targetType === "direct")
                    ? selected.targetType
                    : getSupabaseMessengerTargetType(normalizedConversationId)
              }
            : null;
          const missingRefs = conversationRefs.filter(
            (item) => !isMessengerConversationPrefetched(item.conversationId, item.targetType)
          );
          if (fetchAllMessages) {
            refreshedConversationRefs = conversationRefs;
            await refreshSupabaseMessengerMessagesBatch(conversationRefs, { render: false, background });
          } else {
            const refsToFetch = dedupeMessengerConversationRefs([
              ...missingRefs,
              ...(explicitRef ? [explicitRef] : [])
            ]);
            refreshedConversationRefs = refsToFetch;
            if (refsToFetch.length) {
              await refreshSupabaseMessengerMessagesBatch(refsToFetch, { render: false, background });
            }
          }
        },
        {
          label: "Messenger sync",
          source: "rpc:get_conversations_snapshot",
          attempts: 3,
          failureDetail: "Conversation snapshot and message preload failed."
        }
      );
      if (!background) {
        state.messengerLoading = false;
      }
      state.messengerSnapshotReady = true;
      state.messengerSnapshotError = "";
      if (shouldRender) {
        requestMessengerRouteRender();
      }
      return createMessengerRefreshOutcome("snapshot", background, {
        conversationCount: Array.isArray(conversationRefs) ? conversationRefs.length : 0,
        refreshedConversationIds: Array.isArray(refreshedConversationRefs)
          ? refreshedConversationRefs.map((item) => item.conversationId)
          : [],
        fetchAllMessages: Boolean(fetchAllMessages),
        conversationId: String(conversationId || "").trim()
      });
    } catch (error) {
      console.error("Supabase messenger sync failed:", error);
      const errorMessage = String(error?.message || error || "Unknown error");
      if (!background) {
        state.messengerLoading = false;
      }
      if (!state.messengerSnapshotReady) {
        state.messengerSnapshotError = errorMessage;
      }
      if (alertOnError) {
        window.alert(`Messenger sync failed: ${errorMessage}`);
      }
      if (shouldRender) {
        requestMessengerRouteRender();
      }
      return false;
    }
  }

  function scheduleMessengerRefresh(conversationId = "") {
    if (!isSupabaseMessengerEnabled()) {
      return;
    }
    if (conversationId) {
      realtimeState.pendingConversationIds.add(conversationId);
    }
    if (realtimeState.refreshTimer) {
      return;
    }
    realtimeState.refreshTimer = window.setTimeout(async () => {
      const pendingIds = new Set(realtimeState.pendingConversationIds);
      realtimeState.pendingConversationIds.clear();
      realtimeState.refreshTimer = 0;
      await refreshSupabaseMessengerData({ render: false, alertOnError: false, background: true });
      if (pendingIds.size) {
        await refreshSupabaseMessengerMessagesBatch(
          [...pendingIds].map((pendingConversationId) => ({
            conversationId: pendingConversationId,
            targetType: getSupabaseMessengerTargetType(pendingConversationId)
          })),
          { render: false, background: true }
        );
      }
      requestMessengerRouteRender();
    }, DEFAULT_MESSENGER_REFRESH_DELAY_MS);
  }

  function scheduleMessengerActiveConversationRefresh(conversationId = "", targetType = "direct") {
    if (!isSupabaseMessengerEnabled()) {
      return;
    }
    const targetId = String(conversationId || "").trim();
    if (!targetId) {
      return;
    }
    realtimeState.activeConversationId = targetId;
    realtimeState.activeTargetType = targetType === "channel" ? "channel" : "direct";
    if (realtimeState.activeRefreshTimer) {
      return;
    }
    realtimeState.activeRefreshTimer = window.setTimeout(async () => {
      const activeConversationId = String(realtimeState.activeConversationId || "").trim();
      const activeTargetType = realtimeState.activeTargetType === "channel" ? "channel" : "direct";
      realtimeState.activeRefreshTimer = 0;
      realtimeState.activeConversationId = "";
      realtimeState.activeTargetType = "direct";
      if (!activeConversationId) {
        return;
      }
      try {
        await refreshSupabaseMessengerMessages(activeConversationId, {
          render: false,
          background: true,
          targetType: activeTargetType
        });
        requestMessengerRouteRender();
      } catch (error) {
        console.error("Messenger active thread refresh failed:", error);
      }
    }, DEFAULT_MESSENGER_ACTIVE_REFRESH_DELAY_MS);
  }

  function startMessengerSilentRefreshLoop() {
    if (!isSupabaseMessengerEnabled() || realtimeState.silentRefreshTimer) {
      return;
    }
    realtimeState.silentRefreshTimer = window.setInterval(async () => {
      if (document.hidden || state.routeId !== "comms-messenger") {
        return;
      }
      const selected = getActiveMessengerConversationRef();
      if (!selected?.targetId) {
        return;
      }
      try {
        await refreshSupabaseMessengerData({
          render: false,
          alertOnError: false,
          background: true,
          conversationId: selected.targetId,
          fetchAllMessages: false
        });
        await refreshSupabaseMessengerMessages(selected.targetId, {
          render: false,
          background: true,
          targetType: selected.targetType
        });
        requestMessengerRouteRender();
      } catch (error) {
        console.warn("Messenger silent refresh failed:", error);
      }
    }, DEFAULT_MESSENGER_SILENT_REFRESH_MS);
  }

  function stopMessengerSilentRefreshLoop() {
    if (!realtimeState.silentRefreshTimer) {
      return;
    }
    window.clearInterval(realtimeState.silentRefreshTimer);
    realtimeState.silentRefreshTimer = 0;
  }

  function applyMessengerTypingPayload(payload) {
    if (!payload) {
      return;
    }
    const record = payload.new || payload.old;
    if (!record) {
      return;
    }
    const entry = {
      conversationId: String(record.conversation_id || ""),
      memberId: String(record.member_id || ""),
      updatedAt: String(record.updated_at || "")
    };
    if (!entry.conversationId || !entry.memberId) {
      return;
    }
    if (entry.memberId === String(state.data.currentUser?.id || "")) {
      return;
    }
    if (payload.eventType === "DELETE") {
      state.messengerTyping = (state.messengerTyping || []).filter(
        (item) => !(item.conversationId === entry.conversationId && item.memberId === entry.memberId)
      );
    } else {
      const next = Array.isArray(state.messengerTyping) ? [...state.messengerTyping] : [];
      const index = next.findIndex(
        (item) => item.conversationId === entry.conversationId && item.memberId === entry.memberId
      );
      if (index >= 0) {
        next[index] = entry;
      } else {
        next.push(entry);
      }
      state.messengerTyping = next;
    }
    requestMessengerRouteRender();
  }

  function unsubscribeMessengerRealtime() {
    if (realtimeChannel) {
      realtimeChannel.unsubscribe();
      realtimeChannel = null;
    }
    if (realtimeState.refreshTimer) {
      window.clearTimeout(realtimeState.refreshTimer);
      realtimeState.refreshTimer = 0;
    }
    if (realtimeState.activeRefreshTimer) {
      window.clearTimeout(realtimeState.activeRefreshTimer);
      realtimeState.activeRefreshTimer = 0;
    }
    stopMessengerSilentRefreshLoop();
    clearMessengerDeferredRender();
    if (realtimeState.fallbackTimer) {
      window.clearInterval(realtimeState.fallbackTimer);
      realtimeState.fallbackTimer = 0;
    }
    realtimeState.pendingConversationIds.clear();
    realtimeState.activeConversationId = "";
    realtimeState.activeTargetType = "direct";
    stopMessengerPresenceHeartbeat();
    resetSystemHealthEntry("messengerRealtime");
  }

  function startMessengerRealtimeFallback(options = {}) {
    if (!isSupabaseMessengerEnabled() || realtimeState.fallbackTimer) {
      return;
    }
    if (options.recordHealth !== false) {
      const statusReason = String(options.reason || "fallback").trim();
      setRealtimeHealth("messengerRealtime", "degraded", {
        source: "polling",
        detail: "Fallback polling active for Messenger.",
        errorMessage: statusReason,
        bumpFailure: true,
        eventMessage: `Messenger realtime switched to fallback polling (${statusReason}).`,
        eventLevel: "warning"
      });
    }
    stopMessengerSilentRefreshLoop();
    realtimeState.fallbackTimer = window.setInterval(async () => {
      if (document.hidden) {
        return;
      }
      try {
        await refreshSupabaseMessengerData({ render: false, alertOnError: false, background: true });
        const selected = getActiveMessengerConversationRef();
        if (selected?.targetId && (selected.targetType === "direct" || selected.targetType === "channel")) {
          await refreshSupabaseMessengerMessages(selected.targetId, {
            render: false,
            background: true,
            targetType: selected.targetType
          });
        }
        requestMessengerRouteRender();
      } catch (error) {
        console.warn("Messenger fallback refresh failed:", error);
        recordSystemEvent("warning", "Messenger fallback refresh failed.", {
          subsystem: "messengerRealtime",
          source: "polling",
          error: getSystemErrorMessage(error)
        });
      }
    }, fallbackMs);
  }

  function stopMessengerRealtimeFallback() {
    if (!realtimeState.fallbackTimer) {
      return;
    }
    window.clearInterval(realtimeState.fallbackTimer);
    realtimeState.fallbackTimer = 0;
  }

  function subscribeMessengerRealtime() {
    if (!isSupabaseMessengerEnabled()) {
      return;
    }
    const services = initSupabase();
    if (!services.configured || !services.client) {
      return;
    }
    const workspaceId = String(state.data.workspace?.id || "").trim();
    if (!workspaceId) {
      return;
    }
    unsubscribeMessengerRealtime();
    setRealtimeHealth("messengerRealtime", "connecting", {
      source: "realtime",
      detail: "Connecting Messenger realtime channel."
    });
    startMessengerRealtimeFallback({ recordHealth: false });
    startMessengerPresenceHeartbeat();
    realtimeChannel = services.client
      .channel(`messenger:${workspaceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages" },
        (payload) => {
          const payloadWorkspaceId = String(payload.new?.workspace_id || payload.old?.workspace_id || "").trim();
          if (payloadWorkspaceId && payloadWorkspaceId !== workspaceId) {
            return;
          }
          const conversationId = String(payload.new?.conversation_id || payload.old?.conversation_id || "").trim();
          if (!conversationId) {
            return;
          }
          const selected = getActiveMessengerConversationRef();
          const appliedFromPayload =
            String(selected?.targetId || "") === conversationId ? applyMessengerMessagePayload(payload) : false;
          if (appliedFromPayload) {
            requestMessengerRouteRender();
          }
          if (String(selected?.targetId || "") === conversationId) {
            scheduleMessengerActiveConversationRefresh(conversationId, selected.targetType);
          }
          scheduleMessengerRefresh(conversationId);
        }
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, (payload) => {
        const conversationId = String(payload.new?.id || payload.old?.id || "").trim();
        if (!conversationId) {
          scheduleMessengerRefresh();
          return;
        }
        scheduleMessengerRefresh(conversationId);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_members" }, (payload) => {
        const conversationId = String(payload.new?.conversation_id || payload.old?.conversation_id || "").trim();
        if (!conversationId) {
          scheduleMessengerRefresh();
          return;
        }
        const selected = getActiveMessengerConversationRef();
        if (String(selected?.targetId || "") === conversationId) {
          scheduleMessengerActiveConversationRefresh(conversationId, selected.targetType);
        }
        scheduleMessengerRefresh(conversationId);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, () => {
        const selected = getActiveMessengerConversationRef();
        if (selected?.targetId) {
          scheduleMessengerActiveConversationRefresh(selected.targetId, selected.targetType);
          scheduleMessengerRefresh(selected.targetId);
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "typing_indicators" }, (payload) => {
        applyMessengerTypingPayload(payload);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "messenger_presence" }, () => {
        scheduleMessengerRefresh();
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          stopMessengerRealtimeFallback();
          startMessengerSilentRefreshLoop();
          setRealtimeHealth("messengerRealtime", "healthy", {
            source: "realtime",
            detail: "Messenger realtime channel subscribed."
          });
          scheduleMessengerRefresh();
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          console.warn("Messenger realtime channel status:", status, workspaceId);
          startMessengerRealtimeFallback({ reason: status });
        }
      });
  }

  return {
    clearSupabaseMessengerState,
    getSupabaseMessengerConversationRefs,
    refreshSupabaseMessengerMessages,
    refreshSupabaseMessengerMessagesBatch,
    refreshSupabaseMessengerData,
    subscribeMessengerRealtime,
    unsubscribeMessengerRealtime
  };
}
