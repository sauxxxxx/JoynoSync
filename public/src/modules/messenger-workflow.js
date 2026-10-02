import { fetchSupabaseMessengerMessagePage } from "../supabase/messenger.js";
import {
  getMessengerGroupRemovedMembers,
  hasMessengerGroupChanges,
  normalizeMessengerGroupMemberIds,
  resolveMessengerGroupInitialMemberIds
} from "./messenger-group-settings.js";
import {
  renderMessengerGroupEditor,
  renderMessengerGroupMemberRows,
  renderMessengerGroupReview
} from "./messenger-group-settings-view.js";

const WORKFLOW_ACTIONS = new Set([
  "messenger-load-older",
  "message-pin-toggle",
  "messenger-manage-group",
  "messenger-group-confirm",
  "messenger-group-review-confirm",
  "messenger-group-review-back",
  "messenger-group-sync",
  "messenger-group-cancel",
  "messenger-group-discard-confirm",
  "messenger-retry-load",
  "messenger-leave-group",
  "messenger-retry-send",
  "messenger-dismiss-failed"
]);

export function createMessengerWorkflow(options = {}) {
  const {
    state,
    conversationKey,
    parseConversationOption,
    getConversationEntity,
    getSelectedConversationRef,
    refreshSupabaseMessengerData,
    setSupabaseMessengerMessagePinned,
    updateSupabaseGroupConversation,
    leaveSupabaseGroupConversation,
    sendSupabaseMessengerMessage,
    openConfirmModal,
    closeModal,
    showToast,
    renderRoute
  } = options;

  function canHandleAction(action) {
    return WORKFLOW_ACTIONS.has(String(action || "").trim());
  }

  function getHistoryStore() {
    if (!state.messengerHistoryByConversation || typeof state.messengerHistoryByConversation !== "object") {
      state.messengerHistoryByConversation = {};
    }
    return state.messengerHistoryByConversation;
  }

  function getFailedMessages() {
    if (!Array.isArray(state.messengerFailedMessages)) {
      state.messengerFailedMessages = [];
    }
    return state.messengerFailedMessages;
  }

  function recordFailedSend(entry = {}) {
    const failed = getFailedMessages();
    const next = {
      id: String(entry.id || `failed-${Date.now()}`),
      conversationKey: String(entry.conversationKey || ""),
      conversationId: String(entry.conversationId || ""),
      targetType: entry.targetType === "channel" ? "channel" : "direct",
      workspaceId: String(entry.workspaceId || ""),
      body: String(entry.body || ""),
      files: Array.isArray(entry.files) ? entry.files : [],
      error: String(entry.error || "Message could not be sent."),
      createdAt: new Date().toISOString(),
      retrying: false
    };
    const index = failed.findIndex((item) => item.id === next.id);
    if (index >= 0) {
      failed[index] = next;
    } else {
      failed.push(next);
    }
    return next;
  }

  function dismissFailedMessage(id) {
    state.messengerFailedMessages = getFailedMessages().filter((item) => String(item?.id || "") !== String(id || ""));
  }

  function mapLoadedMessage(message, targetType, targetId) {
    return {
      ...message,
      targetType,
      targetId,
      commMode: "internal",
      messageType: "Update",
      important: false,
      linkedType: "",
      linkedLabel: "",
      isMessenger: true,
      canEdit: String(message?.senderId || "") === String(state.data.currentUser?.id || "")
    };
  }

  async function loadOlderMessages(id) {
    const parsed = parseConversationOption(id);
    const targetId = String(parsed.targetId || "").trim();
    if (!targetId) {
      return;
    }
    const key = conversationKey(parsed.targetType, targetId);
    const historyStore = getHistoryStore();
    const existing = (state.data.messages || [])
      .filter((message) => String(message?.targetId || message?.channelId || "") === targetId)
      .sort((a, b) => new Date(a.createdAt).valueOf() - new Date(b.createdAt).valueOf());
    const before = existing[0]?.createdAt || null;
    historyStore[key] = { ...(historyStore[key] || {}), loading: true, error: "" };
    renderRoute();
    try {
      const page = await fetchSupabaseMessengerMessagePage(targetId, { limit: 40, before });
      const incoming = page.messages.map((message) => mapLoadedMessage(message, parsed.targetType, targetId));
      const byId = new Map((state.data.messages || []).map((message) => [String(message?.id || ""), message]));
      incoming.forEach((message) => byId.set(String(message.id || ""), message));
      state.data.messages = [...byId.values()];
      historyStore[key] = { loading: false, error: "", hasMore: page.hasMore, expanded: true };
    } catch (error) {
      historyStore[key] = {
        ...(historyStore[key] || {}),
        loading: false,
        error: String(error?.message || error || "Could not load earlier messages.")
      };
    }
    renderRoute();
  }

  function getGroupFormMemberIds(form) {
    return normalizeMessengerGroupMemberIds(
      [...(form?.querySelectorAll("[name='messengerGroupMember']:checked, input[type='hidden'][name='messengerGroupMember']") || [])]
        .map((input) => String(input.value || "").trim())
    );
  }

  function getInitialGroupMemberIds(form) {
    return normalizeMessengerGroupMemberIds(String(form?.dataset.initialMemberIds || "").split(","));
  }

  function openGroupManager(id) {
    const parsed = parseConversationOption(id);
    const conversation = getConversationEntity(parsed.targetType, parsed.targetId);
    const overlay = document.getElementById("modalOverlay");
    const title = document.getElementById("modalTitle");
    const form = document.getElementById("modalForm");
    const card = document.querySelector(".modal-card");
    const closeButton = document.getElementById("modalCloseButton");
    if (!conversation || parsed.targetType !== "channel" || !overlay || !title || !form || !card) {
      return;
    }
    const initialMemberIds = resolveMessengerGroupInitialMemberIds(
      conversation,
      state.data.teamMembers || [],
      state.data.currentUser?.id
    );
    card.className = "modal-card is-messenger-workflow";
    title.textContent = "Group settings";
    form.dataset.mode = "messenger-group-manage";
    form.dataset.conversationId = parsed.targetId;
    form.dataset.conversationKey = id;
    form.dataset.initialGroupName = String(conversation.name || "").trim();
    form.dataset.initialMemberIds = initialMemberIds.join(",");
    form.dataset.groupBusy = "0";
    if (closeButton instanceof HTMLButtonElement) {
      closeButton.dataset.action = "messenger-group-cancel";
      closeButton.dataset.id = id;
    }
    form.innerHTML = renderMessengerGroupEditor({
      conversationName: conversation.name || "",
      conversationKey: id,
      memberRows: renderMessengerGroupMemberRows(
        state.data.teamMembers || [],
        initialMemberIds,
        String(state.data.currentUser?.id || "")
      )
    });
    overlay.hidden = false;
    syncGroupManager(form);
    window.setTimeout(() => form.querySelector("input[name='messengerGroupName']")?.focus(), 0);
  }

  function syncGroupManager(form) {
    if (!(form instanceof HTMLFormElement) || form.dataset.mode !== "messenger-group-manage") {
      return false;
    }
    const search = String(form.querySelector("[data-group-member-search]")?.value || "").trim().toLowerCase();
    const memberRows = [...form.querySelectorAll("[data-group-member-row]")];
    let visibleCount = 0;
    memberRows.forEach((row) => {
      const visible = !search || String(row.dataset.searchText || "").includes(search);
      row.hidden = !visible;
      visibleCount += visible ? 1 : 0;
    });
    const empty = form.querySelector("[data-group-member-empty]");
    if (empty instanceof HTMLElement) {
      empty.hidden = visibleCount > 0;
    }
    const memberIds = getGroupFormMemberIds(form);
    const count = form.querySelector("[data-group-member-count]");
    if (count) {
      count.textContent = `${memberIds.length} selected`;
    }
    const saveButton = form.querySelector("[data-action='messenger-group-confirm']");
    if (saveButton instanceof HTMLButtonElement) {
      const nextName = String(form.querySelector("[name='messengerGroupName']")?.value || "").trim();
      saveButton.disabled = form.dataset.groupBusy === "1" || !hasMessengerGroupChanges(
        form.dataset.initialGroupName,
        nextName,
        getInitialGroupMemberIds(form),
        memberIds
      );
    }
    return true;
  }

  function setGroupBusy(form, busy) {
    if (!(form instanceof HTMLFormElement)) {
      return;
    }
    form.dataset.groupBusy = busy ? "1" : "0";
    form.setAttribute("aria-busy", busy ? "true" : "false");
    form.querySelectorAll("button, input").forEach((control) => {
      if (control instanceof HTMLButtonElement || control instanceof HTMLInputElement) {
        control.disabled = busy || control.hasAttribute("data-group-protected");
      }
    });
    const activeSave = form.querySelector("[data-action='messenger-group-review-confirm'], [data-action='messenger-group-confirm']");
    if (activeSave instanceof HTMLButtonElement) {
      activeSave.innerHTML = busy
        ? `<span class="messenger-action-spinner" aria-hidden="true"></span><span>Saving</span>`
        : activeSave.dataset.action === "messenger-group-review-confirm" ? "Confirm changes" : "Save changes";
    }
    if (!busy) {
      syncGroupManager(form);
    }
  }

  function openGroupReview(form, mode, removedMembers = []) {
    const editorView = form.querySelector("[data-group-editor-view]");
    const review = form.querySelector("[data-group-review]");
    if (!(editorView instanceof HTMLElement) || !(review instanceof HTMLElement)) {
      return;
    }
    form.dataset.groupReviewMode = mode;
    editorView.hidden = true;
    review.hidden = false;
    review.innerHTML = renderMessengerGroupReview({
      mode,
      removedMembers,
      conversationKey: form.dataset.conversationKey || ""
    });
    window.setTimeout(() => review.querySelector("button")?.focus(), 0);
  }

  function closeGroupReview(form) {
    const editorView = form?.querySelector("[data-group-editor-view]");
    const review = form?.querySelector("[data-group-review]");
    if (editorView instanceof HTMLElement && review instanceof HTMLElement) {
      review.hidden = true;
      review.innerHTML = "";
      editorView.hidden = false;
      form.dataset.groupReviewMode = "";
      window.setTimeout(() => form.querySelector("[data-action='messenger-group-confirm']")?.focus(), 0);
    }
  }

  function setModalFeedback(message = "") {
    const feedback = document.querySelector("#modalForm [data-form-feedback]");
    if (!feedback) {
      return;
    }
    feedback.textContent = message;
    feedback.hidden = !message;
  }

  async function saveGroup(id, sourceEl, confirmedRemoval = false) {
    const parsed = parseConversationOption(id);
    const form = sourceEl?.closest("form") || document.getElementById("modalForm");
    const name = String(form?.querySelector("[name='messengerGroupName']")?.value || "").trim();
    const memberIds = getGroupFormMemberIds(form);
    if (!name) {
      setModalFeedback("Enter a group name.");
      form?.querySelector("[name='messengerGroupName']")?.focus();
      return;
    }
    if (new Set(memberIds).size < 2) {
      setModalFeedback("Select at least one teammate.");
      return;
    }
    const removedMembers = getMessengerGroupRemovedMembers(
      getInitialGroupMemberIds(form),
      memberIds,
      state.data.teamMembers || []
    );
    if (removedMembers.length && !confirmedRemoval) {
      openGroupReview(form, "remove", removedMembers);
      return;
    }
    setGroupBusy(form, true);
    setModalFeedback("");
    try {
      await updateSupabaseGroupConversation(parsed.targetId, name, [...new Set(memberIds)]);
      closeModal?.({ reopenTaskSheet: false });
      await refreshSupabaseMessengerData({ render: false, alertOnError: false, conversationId: parsed.targetId });
      showToast?.("Group updated.", { tone: "success" });
      renderRoute();
    } catch (error) {
      setGroupBusy(form, false);
      setModalFeedback(String(error?.message || error || "Could not update the group."));
    }
  }

  function cancelGroupManager(id, sourceEl) {
    const form = sourceEl?.closest("form") || document.getElementById("modalForm");
    if (!(form instanceof HTMLFormElement) || form.dataset.groupBusy === "1") {
      return;
    }
    if (form.dataset.groupReviewMode) {
      closeGroupReview(form);
      return;
    }
    const dirty = hasMessengerGroupChanges(
      form.dataset.initialGroupName,
      form.querySelector("[name='messengerGroupName']")?.value,
      getInitialGroupMemberIds(form),
      getGroupFormMemberIds(form)
    );
    if (dirty) {
      openGroupReview(form, "discard");
      return;
    }
    closeModal?.({ reopenTaskSheet: false });
  }

  async function retrySend(id) {
    const entry = getFailedMessages().find((item) => String(item?.id || "") === String(id || ""));
    if (!entry || entry.retrying) {
      return;
    }
    entry.retrying = true;
    renderRoute();
    try {
      await sendSupabaseMessengerMessage(entry.conversationId, entry.workspaceId, {
        body: entry.body,
        attachments: entry.files
      });
      dismissFailedMessage(entry.id);
      await refreshSupabaseMessengerData({ render: false, alertOnError: false, conversationId: entry.conversationId });
      showToast?.("Message sent.", { tone: "success" });
    } catch (error) {
      entry.retrying = false;
      entry.error = String(error?.message || error || "Message could not be sent.");
      showToast?.("Message still could not be sent.", { tone: "danger" });
    }
    renderRoute();
  }

  async function handleAction(action, id, sourceEl) {
    const normalizedAction = String(action || "").trim();
    if (!canHandleAction(normalizedAction)) {
      return false;
    }
    if (normalizedAction === "messenger-load-older") {
      await loadOlderMessages(id);
    } else if (normalizedAction === "messenger-retry-load") {
      state.messengerSnapshotReady = false;
      state.messengerSnapshotError = "";
      renderRoute();
      await refreshSupabaseMessengerData({ render: true, alertOnError: false });
    } else if (normalizedAction === "message-pin-toggle") {
      const message = (state.data.messages || []).find((item) => String(item?.id || "") === String(id || ""));
      if (message) {
        try {
          await setSupabaseMessengerMessagePinned(id, !Boolean(message.pinned));
          const selected = getSelectedConversationRef();
          await refreshSupabaseMessengerData({ render: false, alertOnError: false, conversationId: selected.targetId });
          showToast?.(message.pinned ? "Message unpinned." : "Message pinned.", { tone: "success" });
        } catch (error) {
          showToast?.(String(error?.message || error || "Could not update the pinned message."), { tone: "danger" });
        }
        renderRoute();
      }
    } else if (normalizedAction === "messenger-manage-group") {
      openGroupManager(id);
    } else if (normalizedAction === "messenger-group-confirm") {
      await saveGroup(id, sourceEl);
    } else if (normalizedAction === "messenger-group-review-confirm") {
      await saveGroup(id, sourceEl, true);
    } else if (normalizedAction === "messenger-group-review-back") {
      closeGroupReview(sourceEl?.closest("form") || document.getElementById("modalForm"));
    } else if (normalizedAction === "messenger-group-sync") {
      syncGroupManager(sourceEl?.closest?.("#modalForm"));
    } else if (normalizedAction === "messenger-group-cancel") {
      cancelGroupManager(id, sourceEl);
    } else if (normalizedAction === "messenger-group-discard-confirm") {
      closeModal?.({ reopenTaskSheet: false });
    } else if (normalizedAction === "messenger-leave-group") {
      const parsed = parseConversationOption(id);
      openConfirmModal?.({
        title: "Leave this group?",
        message: "You will stop receiving messages from this group. The conversation stays available to the remaining members.",
        confirmLabel: "Leave group",
        danger: true,
        onConfirm: async () => {
          await leaveSupabaseGroupConversation(parsed.targetId);
          closeModal?.({ reopenTaskSheet: false });
          state.selectedConversationKey = "";
          await refreshSupabaseMessengerData({ render: false, alertOnError: false });
          showToast?.("You left the group.", { tone: "success" });
          renderRoute();
        }
      });
    } else if (normalizedAction === "messenger-retry-send") {
      await retrySend(id);
    } else if (normalizedAction === "messenger-dismiss-failed") {
      dismissFailedMessage(id);
      renderRoute();
    }
    return true;
  }

  return {
    canHandleAction,
    handleAction,
    recordFailedSend
  };
}
