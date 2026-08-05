export const MESSENGER_ROUTE_ID = "comms-messenger";

const MESSENGER_TEMPLATE_TEXT = "Quick update: on track. Next checkpoint tomorrow.";
const MESSENGER_ACTIONS = new Set([
  "comm-select-conversation",
  "comm-new-direct",
  "comm-start-direct",
  "comm-new-gc",
  "comm-attach-trigger",
  "comm-clear-attachments",
  "comm-toggle-emoji-picker",
  "comm-insert-emoji",
  "comm-quick-template",
  "messenger-edit-cancel",
  "comm-mark-read",
  "comm-mark-unread",
  "comm-pin-toggle",
  "comm-mute-toggle",
  "comm-delete-conversation",
  "messenger-toggle-info",
  "messenger-open-theme",
  "messenger-open-nickname",
  "messenger-theme-select",
  "messenger-nickname-select",
  "message-edit",
  "message-reaction-toggle",
  "messenger-attachment-open",
  "message-delete"
]);

function sanitizeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function createMessengerController(options = {}) {
  const {
    state = null,
    messengerTypingState = null,
    createId,
    conversationKey,
    parseConversationOption,
    getConversationEntity,
    getSupabaseMessengerConversation,
    getSelectedConversationRef,
    getVisibleMessengerConversationRef,
    renderRoute,
    persistDataAndRefresh,
    blockConnectedModeLocalFallback,
    markSupabaseConversationRead,
    markSupabaseEntityNotificationsRead,
    markEntityNotificationsReadLocally,
    refreshSupabaseMessengerData,
    refreshSupabaseMessengerMessages,
    updateSupabaseConversationPrefs,
    openNewDirectChatModal,
    openMessengerThemeModal,
    openMessengerNicknameModal,
    startDirectChatWithMemberId,
    startNewGroupChat,
    insertTextAtCursor,
    addSupabaseMessageReaction,
    removeSupabaseMessageReaction,
    createSupabaseMessengerAttachmentSignedUrl,
    deleteSupabaseMessengerConversation,
    deleteSupabaseMessengerMessage,
    editSupabaseMessengerMessage,
    sendSupabaseMessengerMessage,
    appendInternalMessage,
    setSupabaseTyping,
    isSupabaseMessengerEnabled,
    openConfirmModal,
    showFormFeedback,
    deleteById,
    saveUiPrefs
  } = options;

  function isInternalMode() {
    return String(state?.commsMode || "").trim() === "internal";
  }

  function clearEditState() {
    state.messengerEditMessageId = "";
    state.messengerEditDraft = "";
  }

  function clearComposerField(form) {
    if (!(form instanceof HTMLFormElement)) {
      return;
    }
    const composer = form.querySelector("#commComposerText");
    if (composer instanceof HTMLTextAreaElement) {
      composer.value = "";
    }
    const counter = form.querySelector("#commCharCount");
    if (counter) {
      const max = Number(counter.dataset.max || 160);
      const segmentSize = Number(counter.dataset.segment || 160);
      const segments = Math.max(1, Math.ceil(0 / segmentSize));
      counter.textContent = `0/${max} (${segments} segment${segments === 1 ? "" : "s"})`;
      counter.classList.remove("is-over");
    }
  }

  function clearComposerDraft(conversationKey = "") {
    const normalizedConversationKey = String(conversationKey || "").trim();
    if (!normalizedConversationKey || !state.messengerUiState) {
      return;
    }
    const drafts = {
      ...((state.messengerUiState.draftsByConversationKey && typeof state.messengerUiState.draftsByConversationKey === "object")
        ? state.messengerUiState.draftsByConversationKey
        : {})
    };
    delete drafts[normalizedConversationKey];
    state.messengerUiState = {
      ...state.messengerUiState,
      draftsByConversationKey: drafts
    };
  }

  function restoreComposerDraft(form, conversationKey = "", draftText = "") {
    const normalizedConversationKey = String(conversationKey || "").trim();
    const value = String(draftText || "");
    if (normalizedConversationKey) {
      state.messengerUiState = {
        ...(state.messengerUiState || {}),
        draftsByConversationKey: {
          ...((state.messengerUiState && state.messengerUiState.draftsByConversationKey) || {}),
          [normalizedConversationKey]: {
            value,
            selectionStart: value.length,
            selectionEnd: value.length
          }
        }
      };
    }
    if (form instanceof HTMLFormElement) {
      const composer = form.querySelector("#commComposerText");
      if (composer instanceof HTMLTextAreaElement) {
        composer.value = value;
        const nextSelection = value.length;
        try {
          composer.setSelectionRange(nextSelection, nextSelection);
        } catch (error) {
          void error;
        }
      }
    }
  }

  function setComposerSendingState(form, isSending, options = {}) {
    if (!(form instanceof HTMLFormElement)) {
      return;
    }
    const sending = Boolean(isSending);
    const sendButton = form.querySelector(".messenger-send-btn");
    if (!(sendButton instanceof HTMLButtonElement)) {
      return;
    }
    const isEditingMessage = Boolean(options.isEditingMessage);
    sendButton.disabled = sending;
    sendButton.classList.toggle("is-loading", sending);
    sendButton.toggleAttribute("aria-busy", sending);
    sendButton.setAttribute(
      "aria-label",
      sending
        ? `Sending ${isEditingMessage ? "message" : "conversation reply"}`
        : `${isEditingMessage ? "Save" : "Send"} message`
    );
    sendButton.innerHTML = sending
      ? '<i class="bi bi-arrow-repeat messenger-send-spinner" aria-hidden="true"></i>'
      : `<i class="bi bi-send" aria-hidden="true"></i><span>${isEditingMessage ? "Save" : "Send"}</span>`;
  }

  function focusComposer() {
    window.setTimeout(() => {
      const composer = document.getElementById("commComposerText");
      if (composer instanceof HTMLElement && typeof composer.focus === "function") {
        composer.focus({ preventScroll: true });
      }
    }, 0);
  }

  function closeEmojiPicker(form = document.getElementById("commComposerForm")) {
    if (!form) {
      return;
    }
    const picker = form.querySelector("[data-comm-emoji-picker]");
    if (picker) {
      picker.setAttribute("hidden", "");
    }
  }

  function stopTyping(conversationId = "") {
    if (!isSupabaseMessengerEnabled?.()) {
      return;
    }
    const targetId = String(conversationId || messengerTypingState?.conversationId || "").trim();
    if (!targetId || !messengerTypingState?.isTyping) {
      return;
    }
    messengerTypingState.isTyping = false;
    setSupabaseTyping?.(targetId, false).catch(() => null);
  }

  function noteTyping(conversationId) {
    if (!isSupabaseMessengerEnabled?.()) {
      return;
    }
    const targetId = String(conversationId || "").trim();
    if (!targetId || !messengerTypingState) {
      return;
    }
    if (messengerTypingState.conversationId !== targetId) {
      messengerTypingState.conversationId = targetId;
      messengerTypingState.isTyping = false;
    }
    const now = Date.now();
    if (!messengerTypingState.isTyping || now - messengerTypingState.lastSentAt > 4000) {
      messengerTypingState.isTyping = true;
      messengerTypingState.lastSentAt = now;
      setSupabaseTyping?.(targetId, true).catch(() => null);
    }
    if (messengerTypingState.clearTimer) {
      window.clearTimeout(messengerTypingState.clearTimer);
    }
    messengerTypingState.clearTimer = window.setTimeout(() => {
      stopTyping(targetId);
    }, 5000);
  }

  function collectAttachments(form) {
    if (!form) {
      return [];
    }
    const attachInput = form.querySelector("#commAttachInput");
    const files = attachInput?.files ? [...attachInput.files] : [];
    return files.slice(0, 8).map((file) => ({
      id: createId("att"),
      name: String(file?.name || "").trim(),
      size: Number(file?.size || 0),
      type: String(file?.type || "").trim()
    }));
  }

  function collectAttachmentFiles(form) {
    if (!form) {
      return [];
    }
    const attachInput = form.querySelector("#commAttachInput");
    return attachInput?.files ? [...attachInput.files].slice(0, 8) : [];
  }

  function syncAttachmentUi(form) {
    if (!form) {
      return;
    }
    const attachInput = form.querySelector("#commAttachInput");
    const list = form.querySelector("[data-comm-attach-list]");
    const hint = form.querySelector("[data-comm-attach-hint]");
    const countLabel = form.querySelector("[data-comm-attach-count]");
    if (!attachInput || !list || !hint || !countLabel) {
      return;
    }
    const files = attachInput.files ? [...attachInput.files] : [];
    if (!files.length) {
      list.innerHTML = "";
      list.setAttribute("hidden", "");
      hint.setAttribute("hidden", "");
      countLabel.textContent = "";
      return;
    }
    list.innerHTML = files
      .map((file) => {
        const sizeKb = Math.max(1, Math.round((Number(file?.size || 0) || 0) / 1024));
        return `
          <span class="composer-attachment-pill">
            <i class="bi bi-paperclip" aria-hidden="true"></i>
            <span>${sanitizeHtml(file.name || "Attachment")}</span>
            <small>${sizeKb} KB</small>
          </span>
        `;
      })
      .join("");
    const count = files.length;
    countLabel.textContent = `${count} attachment${count === 1 ? "" : "s"} ready`;
    list.removeAttribute("hidden");
    hint.removeAttribute("hidden");
  }

  function handleComposerInput(target) {
    if (!target || target.id !== "commComposerText") {
      return false;
    }
    if (String(state.messengerEditMessageId || "").trim()) {
      state.messengerEditDraft = String(target.value || "");
    }
    if (isInternalMode()) {
      const selected = getSelectedConversationRef();
      if (getSupabaseMessengerConversation(selected.targetType, selected.targetId)) {
        noteTyping(selected.targetId);
      }
    }
    return true;
  }

  function handleAttachmentChange(target) {
    if (!target || target.id !== "commAttachInput") {
      return false;
    }
    const form = target.closest("#commComposerForm");
    if (form) {
      syncAttachmentUi(form);
    }
    return true;
  }

  function canHandleAction(action) {
    if (!MESSENGER_ACTIONS.has(String(action || ""))) {
      return false;
    }
    if (
      [
        "comm-new-direct",
        "comm-start-direct",
        "comm-new-gc",
        "messenger-toggle-info",
        "messenger-open-theme",
        "messenger-open-nickname",
        "messenger-theme-select",
        "messenger-nickname-select"
      ].includes(action)
    ) {
      return true;
    }
    if (["message-edit", "message-reaction-toggle", "messenger-attachment-open", "message-delete"].includes(action)) {
      return true;
    }
    return isInternalMode();
  }

  function removeConversationMessages(targetType, targetId) {
    const normalizedTargetType = targetType === "channel" ? "channel" : "direct";
    const normalizedTargetId = String(targetId || "").trim();
    state.data.messages = (state.data.messages || []).filter((message) => {
      if (!message?.isMessenger) {
        return true;
      }
      const messageTargetType = String(message?.targetType || (message?.channelId ? "channel" : "direct")).trim();
      const messageTargetId = String(message?.targetId || message?.channelId || "").trim();
      return !(messageTargetType === normalizedTargetType && messageTargetId === normalizedTargetId);
    });
  }

  function clearEditStateForConversation(targetType, targetId) {
    const normalizedTargetType = targetType === "channel" ? "channel" : "direct";
    const normalizedTargetId = String(targetId || "").trim();
    const editingMessageId = String(state.messengerEditMessageId || "").trim();
    if (!editingMessageId) {
      return;
    }
    const editingMessage = (state.data.messages || []).find((message) => String(message?.id || "").trim() === editingMessageId);
    const editingTargetType = String(editingMessage?.targetType || (editingMessage?.channelId ? "channel" : "direct")).trim();
    const editingTargetId = String(editingMessage?.targetId || editingMessage?.channelId || "").trim();
    if (editingTargetType === normalizedTargetType && editingTargetId === normalizedTargetId) {
      clearEditState();
    }
  }

  function syncSelectedConversationKey() {
    const nextVisibleConversation = getVisibleMessengerConversationRef?.();
    state.selectedConversationKey = nextVisibleConversation?.targetId
      ? conversationKey(nextVisibleConversation.targetType, nextVisibleConversation.targetId)
      : "";
  }

  function removeConversationLocally(targetType, targetId) {
    const normalizedTargetType = targetType === "channel" ? "channel" : "direct";
    const normalizedTargetId = String(targetId || "").trim();
    if (normalizedTargetType === "channel") {
      state.data.channels = (state.data.channels || []).filter(
        (channel) => String(channel?.id || "").trim() !== normalizedTargetId
      );
    } else {
      state.data.directThreads = (state.data.directThreads || []).filter(
        (thread) => !(thread?.isMessenger && String(thread?.id || "").trim() === normalizedTargetId)
      );
    }
    removeConversationMessages(normalizedTargetType, normalizedTargetId);
    clearEditStateForConversation(normalizedTargetType, normalizedTargetId);
    state.messengerTyping = (state.messengerTyping || []).filter(
      (item) => String(item?.conversationId || "").trim() !== normalizedTargetId
    );
    syncSelectedConversationKey();
  }

  async function handleAction(action, id, sourceEl = null) {
    const normalizedAction = String(action || "").trim();
    if (!canHandleAction(normalizedAction)) {
      return false;
    }

    if (normalizedAction === "comm-select-conversation") {
      const parsed = parseConversationOption(id);
      const conversation = getConversationEntity(parsed.targetType, parsed.targetId);
      if (!conversation) {
        return true;
      }
      stopTyping();
      clearEditState();
      state.selectedConversationKey = conversationKey(parsed.targetType, parsed.targetId);
      if (getSupabaseMessengerConversation(parsed.targetType, parsed.targetId)) {
        renderRoute();
        try {
          await markSupabaseConversationRead(parsed.targetId, { markUnread: false });
          await markSupabaseEntityNotificationsRead(
            String(state.data.workspace?.id || "").trim(),
            "conversation",
            parsed.targetId
          );
          markEntityNotificationsReadLocally("conversation", parsed.targetId);
          await refreshSupabaseMessengerData({
            render: false,
            alertOnError: false,
            conversationId: parsed.targetId
          });
        } catch (error) {
          console.error("Messenger conversation select failed:", error);
        }
        renderRoute();
        return true;
      }
      if (state.supabaseConfigured) {
        renderRoute();
        return true;
      }
      conversation.unread = 0;
      persistDataAndRefresh();
      return true;
    }

    if (normalizedAction === "comm-new-direct") {
      openNewDirectChatModal();
      return true;
    }

    if (normalizedAction === "comm-start-direct") {
      startDirectChatWithMemberId(id);
      return true;
    }

    if (normalizedAction === "comm-new-gc") {
      startNewGroupChat();
      return true;
    }

    if (normalizedAction === "comm-attach-trigger") {
      const form = document.getElementById("commComposerForm");
      const attachInput = form?.querySelector("#commAttachInput");
      if (attachInput) {
        attachInput.click();
      }
      return true;
    }

    if (normalizedAction === "comm-clear-attachments") {
      const form = document.getElementById("commComposerForm");
      const attachInput = form?.querySelector("#commAttachInput");
      if (attachInput) {
        attachInput.value = "";
        syncAttachmentUi(form);
      }
      return true;
    }

    if (normalizedAction === "comm-toggle-emoji-picker") {
      const form = document.getElementById("commComposerForm");
      const picker = form?.querySelector("[data-comm-emoji-picker]");
      if (picker) {
        const open = picker.hasAttribute("hidden");
        if (open) {
          picker.removeAttribute("hidden");
        } else {
          picker.setAttribute("hidden", "");
        }
      }
      return true;
    }

    if (normalizedAction === "comm-insert-emoji") {
      const form = document.getElementById("commComposerForm");
      const composer = form?.querySelector("#commComposerText");
      if (composer) {
        insertTextAtCursor(composer, id || "\u{1F600}");
        composer.focus();
        closeEmojiPicker(form);
      }
      return true;
    }

    if (normalizedAction === "comm-quick-template") {
      const form = document.getElementById("commComposerForm");
      const composer = form?.querySelector("#commComposerText");
      if (composer) {
        insertTextAtCursor(composer, MESSENGER_TEMPLATE_TEXT);
        composer.focus();
      }
      return true;
    }

    if (normalizedAction === "messenger-edit-cancel") {
      clearEditState();
      renderRoute();
      focusComposer();
      return true;
    }

    if (
      normalizedAction === "comm-mark-read" ||
      normalizedAction === "comm-mark-unread" ||
      normalizedAction === "comm-pin-toggle" ||
      normalizedAction === "comm-mute-toggle"
    ) {
      const parsed = parseConversationOption(id);
      const conversation = getConversationEntity(parsed.targetType, parsed.targetId);
      if (!conversation) {
        return true;
      }

      if (getSupabaseMessengerConversation(parsed.targetType, parsed.targetId)) {
        try {
          if (normalizedAction === "comm-mark-read" || normalizedAction === "comm-mark-unread") {
            await markSupabaseConversationRead(parsed.targetId, {
              markUnread: normalizedAction === "comm-mark-unread"
            });
            if (normalizedAction === "comm-mark-read") {
              await markSupabaseEntityNotificationsRead(
                String(state.data.workspace?.id || "").trim(),
                "conversation",
                parsed.targetId
              );
              markEntityNotificationsReadLocally("conversation", parsed.targetId);
            }
          } else {
            await updateSupabaseConversationPrefs(parsed.targetId, {
              pinned: normalizedAction === "comm-pin-toggle" ? !Boolean(conversation.pinned) : undefined,
              muted: normalizedAction === "comm-mute-toggle" ? !Boolean(conversation.muted) : undefined
            });
          }
          await refreshSupabaseMessengerData({
            render: false,
            alertOnError: false,
            conversationId:
              String(getSelectedConversationRef().targetId || "") === String(parsed.targetId || "") ? parsed.targetId : ""
          });
          renderRoute();
        } catch (error) {
          window.alert(`Messenger update failed: ${String(error?.message || error || "Unknown error")}`);
        }
        return true;
      }

      if (blockConnectedModeLocalFallback("Updating Messenger conversation state")) {
        return true;
      }

      if (normalizedAction === "comm-mark-read") {
        conversation.unread = 0;
      } else if (normalizedAction === "comm-mark-unread") {
        conversation.unread = Math.max(1, Number(conversation.unread || 0));
      } else if (normalizedAction === "comm-pin-toggle") {
        conversation.pinned = !Boolean(conversation.pinned);
      } else if (normalizedAction === "comm-mute-toggle") {
        conversation.muted = !Boolean(conversation.muted);
      }

      persistDataAndRefresh();
      return true;
    }

    if (normalizedAction === "message-edit") {
      const message = (state.data.messages || []).find((item) => item.id === id);
      if (!message) {
        return true;
      }
      state.messengerEditMessageId = String(message.id || "");
      state.messengerEditDraft = String(message.text || "");
      renderRoute();
      focusComposer();
      return true;
    }

    if (normalizedAction === "comm-delete-conversation") {
      const parsed = parseConversationOption(id);
      const normalizedTargetType = parsed.targetType === "channel" ? "channel" : "direct";
      const normalizedTargetId = String(parsed.targetId || "").trim();
      const conversation = getConversationEntity(normalizedTargetType, normalizedTargetId);
      if (!conversation || !openConfirmModal) {
        return true;
      }
      const conversationName = String(conversation.name || "this conversation").trim() || "this conversation";
      const isGroupConversation = normalizedTargetType === "channel";
      openConfirmModal({
        title: isGroupConversation ? "Delete conversation?" : "Delete direct chat?",
        message: isGroupConversation
          ? `Remove "${conversationName}" from your Messenger list? Other members will keep the conversation.`
          : `Delete "${conversationName}" for both members? This removes the direct chat from Messenger.`,
        confirmLabel: "Delete",
        danger: true,
        onConfirm: async () => {
          const selected = getSelectedConversationRef();
          const deletingSelectedConversation =
            String(selected?.targetType || "").trim() === normalizedTargetType &&
            String(selected?.targetId || "").trim() === normalizedTargetId;
          try {
            if (conversation.isMessenger && deleteSupabaseMessengerConversation && isSupabaseMessengerEnabled?.()) {
              if (deletingSelectedConversation) {
                stopTyping(normalizedTargetId);
              }
              await deleteSupabaseMessengerConversation(normalizedTargetId);
              await refreshSupabaseMessengerData({
                render: false,
                alertOnError: false
              });
              clearEditStateForConversation(normalizedTargetType, normalizedTargetId);
              removeConversationMessages(normalizedTargetType, normalizedTargetId);
              state.messengerTyping = (state.messengerTyping || []).filter(
                (item) => String(item?.conversationId || "").trim() !== normalizedTargetId
              );
              renderRoute();
              return;
            }
            if (blockConnectedModeLocalFallback("Deleting Messenger conversations")) {
              return;
            }
            if (deletingSelectedConversation) {
              stopTyping(normalizedTargetId);
            }
            removeConversationLocally(normalizedTargetType, normalizedTargetId);
            persistDataAndRefresh();
          } catch (error) {
            window.alert(`Delete conversation failed: ${String(error?.message || error || "Unknown error")}`);
          }
        }
      });
      return true;
    }

    if (normalizedAction === "messenger-toggle-info") {
      state.messengerInfoOpen = !Boolean(state.messengerInfoOpen);
      saveUiPrefs?.();
      renderRoute();
      return true;
    }

    if (normalizedAction === "messenger-open-theme") {
      const selected = getSelectedConversationRef();
      if (!selected || !openMessengerThemeModal) {
        return true;
      }
      openMessengerThemeModal(selected, {
        themeKey: state.messengerThemeByConversationKey?.[conversationKey(selected.targetType, selected.targetId)] || ""
      });
      return true;
    }

    if (normalizedAction === "messenger-open-nickname") {
      const selected = getSelectedConversationRef();
      if (!selected || !openMessengerNicknameModal) {
        return true;
      }
      openMessengerNicknameModal(selected, {
        participantName: ""
      });
      return true;
    }

    if (normalizedAction === "messenger-theme-select") {
      const selected = getSelectedConversationRef();
      if (!selected || !openMessengerThemeModal) {
        return true;
      }
      openMessengerThemeModal(selected, {
        themeKey: String(id || "").trim()
      });
      return true;
    }

    if (normalizedAction === "messenger-nickname-select") {
      const selected = getSelectedConversationRef();
      if (!selected || !openMessengerNicknameModal) {
        return true;
      }
      openMessengerNicknameModal(selected, {
        participantName: String(id || "").trim()
      });
      return true;
    }

    if (normalizedAction === "message-reaction-toggle") {
      const emoji = String(sourceEl?.dataset.emoji || "").trim();
      const message = (state.data.messages || []).find((item) => item.id === id);
      const selected = getSelectedConversationRef();
      if (!emoji || !message || !message.isMessenger || !getSupabaseMessengerConversation(selected.targetType, selected.targetId)) {
        return true;
      }
      const reaction = Array.isArray(message.reactions)
        ? message.reactions.find((item) => String(item?.emoji || "") === emoji)
        : null;
      try {
        if (reaction?.reacted) {
          await removeSupabaseMessageReaction(id, emoji);
        } else {
          await addSupabaseMessageReaction(id, emoji);
        }
        await refreshSupabaseMessengerMessages(selected.targetId, {
          render: false,
          targetType: selected.targetType
        });
        renderRoute();
      } catch (error) {
        window.alert(`Reaction update failed: ${String(error?.message || error || "Unknown error")}`);
      }
      return true;
    }

    if (normalizedAction === "messenger-attachment-open") {
      const storagePath = String(sourceEl?.dataset.storagePath || "").trim();
      if (!storagePath) {
        return true;
      }
      try {
        const signedUrl = await createSupabaseMessengerAttachmentSignedUrl(storagePath, 120);
        if (signedUrl) {
          window.open(signedUrl, "_blank", "noopener,noreferrer");
        }
      } catch (error) {
        window.alert(`Attachment open failed: ${String(error?.message || error || "Unknown error")}`);
      }
      return true;
    }

    if (normalizedAction === "message-delete") {
      const message = (state.data.messages || []).find((item) => item.id === id);
      const selected = getSelectedConversationRef();
      if (message?.isMessenger && getSupabaseMessengerConversation(selected.targetType, selected.targetId)) {
        try {
          await deleteSupabaseMessengerMessage(id);
          if (String(state.messengerEditMessageId || "") === String(id || "")) {
            clearEditState();
          }
          await refreshSupabaseMessengerData({
            render: false,
            alertOnError: false,
            conversationId: selected.targetId
          });
          renderRoute();
        } catch (error) {
          window.alert(`Delete message failed: ${String(error?.message || error || "Unknown error")}`);
        }
        return true;
      }
      if (blockConnectedModeLocalFallback("Deleting Messenger messages")) {
        return true;
      }
      deleteById("messages", id);
      persistDataAndRefresh();
      return true;
    }

    return false;
  }

  async function submitComposer(form) {
    if (!(form instanceof HTMLFormElement)) {
      return false;
    }
    if (state.messengerSending) {
      showFormFeedback(form, "Message is still sending. Please wait a moment.");
      return true;
    }
    const formData = new FormData(form);
    const mode = String(formData.get("mode") || state.commsMode || "internal").trim();
    if (mode !== "internal") {
      return false;
    }

    const selectedRef = getSelectedConversationRef();
    if (!selectedRef.targetId) {
      showFormFeedback(form, "No conversation selected.");
      return true;
    }

    const text = String(formData.get("text") || "").trim();
    const attachmentFiles = collectAttachmentFiles(form);
    const attachments = collectAttachments(form);
    const messageType = String(formData.get("messageType") || "Update");
    const important = String(formData.get("important") || "false").toLowerCase() === "true";
    const linkedType = String(formData.get("linkedType") || "").trim();
    const linkedLabel = String(formData.get("linkedLabel") || "").trim();
    const draftConversationKey = conversationKey(selectedRef.targetType, selectedRef.targetId);

    if (!text && !attachments.length) {
      showFormFeedback(form, "Message or attachment is required.", { fieldSelector: "textarea[name='text']" });
      return true;
    }

    const messengerConversation = getSupabaseMessengerConversation(selectedRef.targetType, selectedRef.targetId);
    const editingMessageId = String(state.messengerEditMessageId || "").trim();
    if (messengerConversation) {
      const workspaceId = String(state.data.workspace?.id || "").trim();
      const pendingDraftText = text;
      const pendingSelectionStart = Number.isFinite(form.querySelector("#commComposerText")?.selectionStart)
        ? Number(form.querySelector("#commComposerText")?.selectionStart)
        : pendingDraftText.length;
      const pendingSelectionEnd = Number.isFinite(form.querySelector("#commComposerText")?.selectionEnd)
        ? Number(form.querySelector("#commComposerText")?.selectionEnd)
        : pendingDraftText.length;
      state.messengerSending = true;
      setComposerSendingState(form, true, { isEditingMessage: Boolean(editingMessageId) });
      clearComposerDraft(draftConversationKey);
      clearComposerField(form);
      closeEmojiPicker(form);
      // Preserve the draft in state in case the send fails and we need to restore it.
      state.messengerUiState = {
        ...(state.messengerUiState || {}),
        draftsByConversationKey: {
          ...((state.messengerUiState && state.messengerUiState.draftsByConversationKey) || {}),
          [draftConversationKey]: {
            value: pendingDraftText,
            selectionStart: pendingSelectionStart,
            selectionEnd: pendingSelectionEnd
          }
        }
      };
      try {
        if (editingMessageId) {
          await editSupabaseMessengerMessage(editingMessageId, text);
        } else {
          await sendSupabaseMessengerMessage(selectedRef.targetId, workspaceId, {
            body: text,
            attachments: attachmentFiles
          });
        }
      } catch (error) {
        state.messengerSending = false;
        setComposerSendingState(form, false, { isEditingMessage: Boolean(editingMessageId) });
        restoreComposerDraft(form, draftConversationKey, pendingDraftText);
        showFormFeedback(form, `Messenger send failed: ${String(error?.message || error || "Unknown error")}`);
        return true;
      }
      stopTyping(selectedRef.targetId);
      state.messengerSending = false;
      clearEditState();
      clearComposerDraft(draftConversationKey);
      state.commsAdvancedOpen = false;
      setComposerSendingState(form, false, { isEditingMessage: false });
      const attachInput = form.querySelector("#commAttachInput");
      if (attachInput) {
        attachInput.value = "";
      }
      syncAttachmentUi(form);
      try {
        await refreshSupabaseMessengerData({
          render: false,
          alertOnError: false,
          conversationId: selectedRef.targetId
        });
      } catch (refreshError) {
        showFormFeedback(form, `Messenger sent, but the thread refresh failed: ${String(refreshError?.message || refreshError || "Unknown error")}`);
      }
      renderRoute();
      return true;
    }

    if (editingMessageId) {
      if (blockConnectedModeLocalFallback("Editing Messenger messages", { form })) {
        return true;
      }
      const message = (state.data.messages || []).find((item) => item.id === editingMessageId);
      if (message) {
        message.text = text;
        message.editedAt = new Date().toISOString();
      }
      clearEditState();
      clearComposerDraft(conversationKey(selectedRef.targetType, selectedRef.targetId));
      state.commsAdvancedOpen = false;
      clearComposerField(form);
      closeEmojiPicker(form);
      persistDataAndRefresh();
      return true;
    }

    if (blockConnectedModeLocalFallback("Sending Messenger messages", { form })) {
      return true;
    }

    appendInternalMessage({
      targetType: selectedRef.targetType,
      targetId: selectedRef.targetId,
      sender: state.data.currentUser.name,
      text,
      messageType,
      important,
      linkedType,
      linkedLabel,
      attachments
    });
    clearComposerDraft(conversationKey(selectedRef.targetType, selectedRef.targetId));
    state.commsAdvancedOpen = false;
    clearComposerField(form);
    closeEmojiPicker(form);
    persistDataAndRefresh();
    return true;
  }

  return {
    routeId: MESSENGER_ROUTE_ID,
    getState() {
      return state;
    },
    canHandleAction,
    handleAction,
    handleComposerInput,
    handleAttachmentChange,
    submitComposer,
    clearEditState,
    focusComposer,
    closeEmojiPicker,
    stopTyping,
    noteTyping,
    syncAttachmentUi
  };
}
