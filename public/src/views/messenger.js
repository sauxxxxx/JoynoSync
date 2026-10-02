import { conversationKey } from "../utils/conversations.js";
import { escapeHtml, matchesSearch } from "../utils/text.js";
import {
  collectConversations,
  buildMessengerPresenceSummary,
  buildMessengerConversationDisplayNameMap,
  getMessengerConversationDisplayName,
  getCommsLockedMeta,
  isWorkspaceDirectThread,
  messageBelongsToConversation,
  parseConversationKey,
  renderConversationRows,
  renderMessengerInlineState,
  renderMessengerThreadState,
  uniqueByKey
} from "./extended.js";
import {
  renderMessengerComposerSkeleton,
  renderMessengerInfoSkeleton,
  renderMessengerRailSkeleton,
  renderMessengerThreadHeaderSkeleton,
  renderMessengerThreadSkeleton
} from "../modules/messenger-skeleton-view.js";
import {
  renderMessengerFailedMessages,
  renderMessengerHistoryControl
} from "../modules/messenger-workflow-view.js";
import {
  buildMessengerMessageRows,
  buildTypingIndicatorMarkup
} from "./messenger-message-renderer.js";
import {
  buildMessengerInfoCollections,
  buildMessengerInfoPaneMarkup
} from "./messenger-details-renderer.js";
import { buildComposerMarkup } from "./messenger-composer-renderer.js";
import { normalizeMessengerThemeKey } from "../modules/messenger-customization.js";
import { renderMessengerLoadError } from "../modules/messenger-load-state-view.js";

export function renderMessengerView(data, context) {
  const query = String(context.searchTerm || "");
  const rawFilter = String(context.commsFilter || "all");
  const activeFilter = ["all", "direct", "gc"].includes(rawFilter) ? rawFilter : "all";
  const currentUserRole = String(context.currentUserRole || data.currentUser?.role || "Member").trim() || "Member";
  const isCommsParent = context.routeId === "communications";
  if (context.commsLocked) {
    const lockedMeta = getCommsLockedMeta("internal", currentUserRole);
    return {
      title: lockedMeta.title,
      subtitle: "Available to admins only for now",
      showWaitingPanel: false,
      html: `
        <section class="view-block comms-locked-view">
          <div class="settings-access-card comms-access-card">
            <div class="settings-access-card-icon comms-access-card-icon">
              <i class="${lockedMeta.icon}" aria-hidden="true"></i>
            </div>
            <div class="settings-access-card-copy">
              <p class="settings-card-eyebrow">${escapeHtml(lockedMeta.eyebrow)}</p>
              <h4>${escapeHtml(lockedMeta.headline)}</h4>
              <p>${escapeHtml(lockedMeta.description)}</p>
              <p class="task-meta">Your role: ${escapeHtml(currentUserRole)}</p>
            </div>
            <div class="settings-form-actions">
              <button type="button" class="table-ops-columns-btn" data-route="dashboard">
                <i class="bi bi-speedometer2" aria-hidden="true"></i>
                <span>${escapeHtml(lockedMeta.ctaLabel)}</span>
              </button>
            </div>
          </div>
        </section>
      `
    };
  }

  const messengerSnapshotReady = Boolean(context.messengerSnapshotReady);
  const messengerSnapshotError = String(context.messengerSnapshotError || "").trim();
  const currentUserName = String(data.currentUser?.name || "").trim().toLowerCase();
  const editMessageId = String(context.messengerEditMessageId || "").trim();
  const editDraft = String(context.messengerEditDraft || "");
  const isEditingMessage = Boolean(editMessageId);
  const isSendingMessage = Boolean(context.messengerSending);
  const messengerInfoOpen = context.messengerInfoOpen === true;

  const allConversations = collectConversations(data);
  const messengerNicknamesByConversationKey =
    context.messengerNicknamesByConversationKey && typeof context.messengerNicknamesByConversationKey === "object"
      ? context.messengerNicknamesByConversationKey
      : {};
  const messengerThemeByConversationKey =
    context.messengerThemeByConversationKey && typeof context.messengerThemeByConversationKey === "object"
      ? context.messengerThemeByConversationKey
      : {};
  const scopedConversations = allConversations.filter(
    (conversation) =>
      conversation.targetType === "channel" ||
      (conversation.targetType === "direct" && isWorkspaceDirectThread(data, conversation))
  );
  const scopedMessages = (data.messages || []).filter((message) => {
    const commMode = String(message.commMode || "").trim().toLowerCase();
    return !commMode || commMode === "internal";
  });

  const messagesByConversationKey = new Map();
  scopedMessages.forEach((message) => {
    const targetType = message.targetType || (message.channelId ? "channel" : "direct");
    const targetId = message.targetId || message.channelId || "";
    if (!targetId) {
      return;
    }
    const key = conversationKey(targetType, targetId);
    if (!messagesByConversationKey.has(key)) {
      messagesByConversationKey.set(key, []);
    }
    messagesByConversationKey.get(key).push(message);
  });

  const latestMessageByKey = new Map();
  messagesByConversationKey.forEach((threadMessages, key) => {
    const sorted = [...threadMessages].sort((a, b) => new Date(a.createdAt).valueOf() - new Date(b.createdAt).valueOf());
    const latest = sorted[sorted.length - 1];
    if (latest) {
      latestMessageByKey.set(key, latest);
    }
  });
  const conversationDisplayNameByKey = buildMessengerConversationDisplayNameMap(scopedConversations, {
    messengerNicknamesByConversationKey
  });

  let filteredConversations = scopedConversations;
  if (activeFilter === "direct") {
    filteredConversations = scopedConversations.filter((conversation) => conversation.targetType === "direct");
  } else if (activeFilter === "gc") {
    filteredConversations = scopedConversations.filter((conversation) => conversation.targetType === "channel");
  }
  if (query.trim()) {
    filteredConversations = filteredConversations.filter((conversation) => {
      const key = conversationKey(conversation.targetType, conversation.targetId);
      const latest = latestMessageByKey.get(key);
      return matchesSearch([
        conversationDisplayNameByKey.get(key) || conversation.name,
        conversation.topic,
        latest?.sender,
        latest?.text
      ], query);
    });
  }

  const selectedFromContext = parseConversationKey(context.selectedConversationKey);
  const selectedFromState = scopedConversations.find(
    (conversation) =>
      conversation.targetType === selectedFromContext.targetType &&
      conversation.targetId === selectedFromContext.targetId
  );
  const selectedVisible =
    selectedFromState &&
    filteredConversations.some(
      (conversation) =>
        conversation.targetType === selectedFromState.targetType &&
        conversation.targetId === selectedFromState.targetId
    )
      ? selectedFromState
      : null;
  const selectedConversation = selectedVisible || filteredConversations[0] || scopedConversations[0] || null;
  const selectedConversationKey = selectedConversation
    ? conversationKey(selectedConversation.targetType, selectedConversation.targetId)
    : "";
  const selectedThemeKey = normalizeMessengerThemeKey(
    messengerThemeByConversationKey[selectedConversationKey]
  );
  const selectedConversationDisplayName = selectedConversation
    ? getMessengerConversationDisplayName(selectedConversation, {
        messengerNicknamesByConversationKey
      })
    : "";
  const selectedPresenceSummary = selectedConversation
    ? buildMessengerPresenceSummary(selectedConversation, {
        currentUserId: data.currentUser?.id
      })
    : null;
  const selectedPresenceMarkup = selectedConversation?.targetType === "channel"
    ? `<p class="messenger-thread-presence messenger-thread-presence-line"><span>${escapeHtml(selectedConversation.detail || "Group conversation")}</span></p>`
    : selectedPresenceSummary
      ? `<p class="messenger-thread-presence messenger-thread-presence-line ${escapeHtml(selectedPresenceSummary.tone)}"><span>${escapeHtml(selectedPresenceSummary.label)}</span></p>`
      : "";

  const typingIndicatorMarkup = buildTypingIndicatorMarkup(data, context, selectedConversation);
  const threadStatusMarkup = [selectedPresenceMarkup, typingIndicatorMarkup].filter(Boolean).join("");
  const selectedDisplayAvatarLabel = escapeHtml(
    String(selectedConversationDisplayName || selectedConversation?.name || "")
      .replace("#", "")
      .trim()
      .slice(0, 1)
      .toUpperCase() || "C"
  );
  const selectedPresenceAvatarMarkup = selectedPresenceSummary
    ? `<span class="messenger-thread-avatar-status ${escapeHtml(selectedPresenceSummary.tone)}" aria-hidden="true"></span>`
    : "";
  const conversationMessages = scopedMessages.filter((message) =>
    messageBelongsToConversation(message, selectedConversation)
  );
  const messagesForConversation = conversationMessages
    .sort((a, b) => new Date(a.createdAt).valueOf() - new Date(b.createdAt).valueOf());
  const messengerInfoCollections = buildMessengerInfoCollections(conversationMessages, data, selectedConversation, {
    conversationKey: selectedConversationKey,
    messengerNicknamesByConversationKey
  });
  const historyState = context.messengerHistoryByConversation?.[selectedConversationKey] || {};
  const failedMessagesMarkup = renderMessengerFailedMessages(
    context.messengerFailedMessages,
    selectedConversationKey
  );

  const showMessengerBootstrapSkeleton = !messengerSnapshotReady && !messengerSnapshotError;
  const showMessengerLoadError = !messengerSnapshotReady && Boolean(messengerSnapshotError);
  const messageRows = buildMessengerMessageRows(messagesForConversation, data, selectedConversation, {
    conversationKey: selectedConversationKey,
    messengerNicknamesByConversationKey
  });
  const inboxConversations = uniqueByKey(filteredConversations);
  const unreadConversationCount = inboxConversations.filter((conversation) => Number(conversation.unread || 0) > 0).length;
  const filterLabels = {
    all: "All",
    direct: "Direct",
    gc: "Groups"
  };
  const messengerListMarkup = `
    <section>
      <div class="conversation-list messenger-list ${showMessengerBootstrapSkeleton ? "is-skeleton" : ""}">
        ${
          showMessengerBootstrapSkeleton
            ? renderMessengerRailSkeleton()
            : showMessengerLoadError
              ? renderMessengerInlineState("Could not load conversations.", messengerSnapshotError)
              : renderConversationRows(inboxConversations, selectedConversationKey, "", "No conversations found.", {
                  variant: "messenger",
                latestMessageByKey,
                displayNameByKey: conversationDisplayNameByKey,
                currentUserId: String(data.currentUser?.id || ""),
                currentUserName
              })
        }
      </div>
    </section>
  `;
  const composerMarkup = showMessengerBootstrapSkeleton
    ? renderMessengerComposerSkeleton()
    : showMessengerLoadError
      ? ""
      : buildComposerMarkup(selectedConversation, isEditingMessage, editDraft, isSendingMessage);

  return {
    title: isCommsParent ? "Communications" : "Messenger",
    subtitle: "Internal workspace chat for direct messages and group chats",
    primaryAction: "Compose",
    showWaitingPanel: false,
    html: `
      <section class="view-block comms-layout comms-mode-internal messenger-view messenger-theme-${selectedThemeKey} ${messengerInfoOpen ? "is-info-open" : "is-info-collapsed"}">
        <aside class="comms-rail" aria-label="Message inbox">
          <div class="comms-rail-head">
            <div class="messenger-filter-bar">
              <div class="messenger-inbox-heading">
                <div>
                  <h2>Messages</h2>
                  <p>${unreadConversationCount ? `${unreadConversationCount} unread` : "All caught up"}</p>
                </div>
                <details class="messenger-create-menu">
                  <summary class="messenger-create-toggle" role="button" aria-label="Start new chat" title="Start new chat">
                    <i class="bi bi-plus-lg" aria-hidden="true"></i>
                  </summary>
                  <div class="messenger-create-dropdown">
                    <button type="button" class="messenger-create-item" data-action="comm-new-direct" data-id="direct">
                      <i class="bi bi-person-plus" aria-hidden="true"></i>
                      <span>Direct message</span>
                    </button>
                    <button type="button" class="messenger-create-item" data-action="comm-new-gc" data-id="gc">
                      <i class="bi bi-people" aria-hidden="true"></i>
                      <span>Group chat</span>
                    </button>
                  </div>
                </details>
              </div>
              <div class="messenger-search-wrap">
                <i class="bi bi-search" aria-hidden="true"></i>
                <input class="search comms-search messenger-search" id="commsSearch" value="${escapeHtml(query)}" placeholder="Search messages" aria-label="Search messages" />
              </div>
              <div class="comms-filter-row" aria-label="Conversation type">
                <div class="messenger-scope-row">
                  <button class="mini-btn ${activeFilter === "all" ? "is-active" : ""}" data-action="comm-set-filter" data-id="all">${filterLabels.all}</button>
                  <button class="mini-btn ${activeFilter === "gc" ? "is-active" : ""}" data-action="comm-set-filter" data-id="gc">${filterLabels.gc}</button>
                  <button class="mini-btn ${activeFilter === "direct" ? "is-active" : ""}" data-action="comm-set-filter" data-id="direct">${filterLabels.direct}</button>
                </div>
              </div>
            </div>
          </div>
          ${messengerListMarkup}
        </aside>
        <section class="comms-thread">
          <header class="comms-thread-head">
            ${
              showMessengerBootstrapSkeleton
                ? renderMessengerThreadHeaderSkeleton()
                : showMessengerLoadError
                  ? renderMessengerThreadState("Could not load conversations.", messengerSnapshotError)
                  : `
                    <div class="messenger-thread-head-shell">
                      <div class="messenger-thread-head-avatar">${selectedDisplayAvatarLabel}${selectedPresenceAvatarMarkup}</div>
                      <div class="messenger-thread-head-copy">
                        <h3 class="block-title messenger-thread-title">${selectedConversation ? escapeHtml(selectedConversationDisplayName || selectedConversation.name) : "No Conversation Selected"}</h3>
                        <div class="messenger-thread-meta">
                          ${threadStatusMarkup}
                        </div>
                      </div>
                    </div>
                  `
            }
            <div class="thread-head-actions">
              ${showMessengerBootstrapSkeleton
                ? '<span class="messenger-skeleton-shape messenger-skeleton-control" aria-hidden="true"></span>'
                : `<button
                    type="button"
                    class="message-icon-btn messenger-info-toggle ${messengerInfoOpen ? "is-active" : ""}"
                    data-action="messenger-toggle-info"
                    data-id="toggle"
                    aria-label="${messengerInfoOpen ? "Close details" : "Open details"}"
                    aria-pressed="${messengerInfoOpen ? "true" : "false"}"
                    title="${messengerInfoOpen ? "Close details" : "Open details"}"
                  >
                    <i class="bi bi-layout-sidebar-inset-reverse" aria-hidden="true"></i>
                    <span>Details</span>
                  </button>`}
            </div>
          </header>
          <div class="message-list ${showMessengerBootstrapSkeleton ? "is-skeleton" : ""}" id="commMessageList" ${showMessengerBootstrapSkeleton ? 'aria-busy="true"' : ""}>
            ${
              showMessengerBootstrapSkeleton
                ? renderMessengerThreadSkeleton()
                : showMessengerLoadError
                  ? renderMessengerLoadError(messengerSnapshotError)
                  : `<div class="messenger-message-feed">
                      ${renderMessengerHistoryControl({
                        conversationKey: selectedConversationKey,
                        messageCount: conversationMessages.length,
                        historyState
                      })}
                      ${messageRows || `<div class="messenger-empty-thread"><i class="bi bi-chat-left-text" aria-hidden="true"></i><strong>Start the conversation</strong><span>Send a message to begin this thread.</span></div>`}
                      ${failedMessagesMarkup}
                    </div>`
            }
          </div>
          ${composerMarkup}
        </section>
        ${
          messengerInfoOpen && showMessengerBootstrapSkeleton
            ? renderMessengerInfoSkeleton()
            : messengerInfoOpen && selectedConversation
              ? buildMessengerInfoPaneMarkup(
                data,
                selectedConversation,
                selectedPresenceSummary,
                selectedDisplayAvatarLabel,
                selectedPresenceAvatarMarkup,
                {
                  conversationKey: selectedConversationKey,
                  displayName: selectedConversationDisplayName,
                  messengerThemeByConversationKey,
                  messengerNicknamesByConversationKey,
                  messengerInfoCollections
                }
                )
              : ""
        }
      </section>
    `
  };
}

export function renderCommsMessenger(data, context) {
  return renderMessengerView(data, context);
}
