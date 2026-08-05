import { conversationKey } from "../utils/conversations.js";
import { escapeHtml, matchesSearch } from "../utils/text.js";
import {
  collectConversations,
  formatBytesCompact,
  formatTimeLabel,
  buildMessengerPresenceSummary,
  buildMessengerConversationDisplayNameMap,
  getMessengerConversationDisplayName,
  getMessengerParticipantNickname,
  getParticipants,
  getCommsLockedMeta,
  highlightMentions,
  isWorkspaceDirectThread,
  messageBelongsToConversation,
  parseConversationKey,
  renderConversationRows,
  renderMessengerComposerSkeleton,
  renderMessengerInlineState,
  renderMessengerRailSkeleton,
  renderMessengerThreadHeaderSkeleton,
  renderMessengerThreadSkeleton,
  renderMessengerThreadState,
  uniqueByKey
} from "./extended.js";
import {
  getMessengerThemeLabel,
  normalizeMessengerThemeKey
} from "../modules/messenger-customization.js";

function buildTypingIndicatorMarkup(data, context, selectedConversation) {
  if (!selectedConversation) {
    return "";
  }
  const rawTyping = Array.isArray(context.messengerTyping) ? context.messengerTyping : [];
  const activeTyping = rawTyping.filter((entry) => {
    if (!entry || entry.conversationId !== selectedConversation.targetId) {
      return false;
    }
    if (String(entry.memberId || "") === String(data.currentUser?.id || "")) {
      return false;
    }
    const updatedAt = Date.parse(String(entry.updatedAt || ""));
    return Number.isFinite(updatedAt) && Date.now() - updatedAt < 12000;
  });
  if (!activeTyping.length) {
    return "";
  }
  const memberNameMap = new Map(
    (data.teamMembers || []).map((member) => [String(member.id || ""), String(member.name || "").trim()])
  );
  const uniqueNames = [
    ...new Set(
      activeTyping.map((entry) => memberNameMap.get(String(entry.memberId || "")) || "Someone").filter(Boolean)
    )
  ];
  if (!uniqueNames.length) {
    return "";
  }
  let label = "";
  if (uniqueNames.length === 1) {
    label = `${uniqueNames[0]} is typing...`;
  } else if (uniqueNames.length === 2) {
    label = `${uniqueNames[0]} and ${uniqueNames[1]} are typing...`;
  } else {
    label = `${uniqueNames[0]} and ${uniqueNames.length - 1} others are typing...`;
  }
  return `<p class="messenger-typing-indicator">${escapeHtml(label)}</p>`;
}

const MESSENGER_TIMELINE_GAP_MS = 10 * 60 * 1000;

function isMessengerMediaAttachment(attachment) {
  const mime = String(attachment?.type || "").trim().toLowerCase();
  return mime.startsWith("image/") || mime.startsWith("video/") || mime.startsWith("audio/");
}

function buildMessengerInfoCollections(messagesForConversation = [], data, selectedConversation) {
  const pinnedMessages = [];
  const mediaAttachments = [];
  const fileAttachments = [];
  const seenAttachmentKeys = new Set();
  const directChatName = String(selectedConversation?.name || "").trim();
  const currentUserName = String(data?.currentUser?.name || "").trim();

  (Array.isArray(messagesForConversation) ? messagesForConversation : []).forEach((message) => {
    if (!message || message.deletedAt) {
      return;
    }
    const messageId = String(message.id || "").trim();
    const messageText = String(message.text || "").trim();
    const senderName = String(message.sender || "").trim();
    const createdAt = String(message.createdAt || "").trim();
    const attachments = Array.isArray(message.attachments) ? message.attachments : [];
    const pinned =
      Boolean(message.pinned) ||
      Boolean(message.isPinned) ||
      Boolean(message.important) ||
      Boolean(message?.meta?.pinned) ||
      Boolean(message?.meta?.isPinned);
    if (pinned && (messageText || attachments.length)) {
      pinnedMessages.push({
        id: messageId || `${createdAt}:${senderName}`,
        senderName: senderName || directChatName || currentUserName || "Someone",
        text: messageText,
        createdAt,
        attachmentsCount: attachments.length
      });
    }
    attachments.forEach((attachment, index) => {
      const attachmentId = String(
        attachment?.id || attachment?.storagePath || attachment?.name || `${messageId}:${index}`
      ).trim();
      if (!attachmentId || seenAttachmentKeys.has(attachmentId)) {
        return;
      }
      seenAttachmentKeys.add(attachmentId);
      const item = {
        id: attachmentId,
        name: String(attachment?.name || "Attachment").trim() || "Attachment",
        type: String(attachment?.type || "File").trim() || "File",
        sizeLabel: formatBytesCompact(attachment?.size),
        senderName: senderName || directChatName || currentUserName || "Someone",
        createdAt,
        storagePath: String(attachment?.storagePath || "").trim(),
        messageId
      };
      if (isMessengerMediaAttachment(attachment)) {
        mediaAttachments.push(item);
      } else {
        fileAttachments.push(item);
      }
    });
  });

  return {
    pinnedMessages,
    mediaAttachments,
    fileAttachments
  };
}

function renderMessengerInfoPinnedMessage(item) {
  return `
    <article class="messenger-info-card messenger-info-card-message">
      <div class="messenger-info-card-head">
        <strong>${escapeHtml(item.senderName || "Someone")}</strong>
        ${item.createdAt ? `<span>${escapeHtml(formatTimeLabel(item.createdAt))}</span>` : ""}
      </div>
      ${item.text ? `<p class="messenger-info-card-copy">${escapeHtml(item.text)}</p>` : ""}
      ${
        item.attachmentsCount
          ? `<p class="messenger-info-card-meta">${item.attachmentsCount === 1 ? "1 attachment" : `${item.attachmentsCount} attachments`}</p>`
          : ""
      }
    </article>
  `;
}

function renderMessengerInfoAttachmentCard(item, variant = "media") {
  const icon = variant === "media" ? "bi-image" : "bi-file-earmark";
  return `
    <article class="messenger-info-card messenger-info-card-attachment">
      <div class="messenger-info-card-icon" aria-hidden="true">
        <i class="bi ${icon}"></i>
      </div>
      <div class="messenger-info-card-copy-wrap">
        <strong>${escapeHtml(item.name)}</strong>
        <p class="messenger-info-card-meta">
          ${escapeHtml(item.senderName)}
          ${item.createdAt ? ` · ${escapeHtml(formatTimeLabel(item.createdAt))}` : ""}
          ${item.sizeLabel ? ` · ${escapeHtml(item.sizeLabel)}` : ""}
        </p>
      </div>
    </article>
  `;
}

function formatMessengerTimelineLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return formatTimeLabel(value);
  }
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function getMessengerTimelineDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return "";
  }
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function shouldInsertMessengerTimelineSeparator(previousMessage, currentMessage) {
  if (!previousMessage || !currentMessage) {
    return false;
  }
  const previousCreatedAt = Date.parse(String(previousMessage.createdAt || ""));
  const currentCreatedAt = Date.parse(String(currentMessage.createdAt || ""));
  if (!Number.isFinite(previousCreatedAt) || !Number.isFinite(currentCreatedAt)) {
    return false;
  }
  if (getMessengerTimelineDateKey(previousMessage.createdAt) !== getMessengerTimelineDateKey(currentMessage.createdAt)) {
    return true;
  }
  return currentCreatedAt - previousCreatedAt >= MESSENGER_TIMELINE_GAP_MS;
}

function buildMessengerMessageRows(messagesForConversation, data, selectedConversation) {
  const showSenderName =
    selectedConversation?.targetType === "channel" || selectedConversation?.type === "GC";
  const rows = [];
  const getMessageSenderKey = (message) => {
    const senderId = String(message?.senderId || "").trim().toLowerCase();
    if (senderId) {
      return `id:${senderId}`;
    }
    return `name:${String(message?.sender || "").trim().toLowerCase()}`;
  };

  messagesForConversation.forEach((message, index) => {
    const previousMessage = index > 0 ? messagesForConversation[index - 1] : null;
    const nextMessage = index < messagesForConversation.length - 1 ? messagesForConversation[index + 1] : null;
    const isSelf = String(message.sender || "").toLowerCase() === String(data.currentUser?.name || "").toLowerCase();
    const isDeleted = Boolean(message.deletedAt);
    const canEdit = String(message.senderId || "") === String(data.currentUser?.id || "");
    const messageText = isDeleted ? "" : String(message.text || "").trim();
    const attachments = !isDeleted && Array.isArray(message.attachments) ? message.attachments : [];
    const currentSenderKey = getMessageSenderKey(message);
    const nextSenderKey = nextMessage ? getMessageSenderKey(nextMessage) : "";
    const showAvatar = !isSelf && (!nextMessage || nextSenderKey !== currentSenderKey || shouldInsertMessengerTimelineSeparator(message, nextMessage));
    const attachmentMarkup = attachments.length
      ? `
        <div class="message-attachments">
          ${attachments
            .map((file) => {
              const fileName = String(file?.name || "Attachment").trim() || "Attachment";
              const fileType = String(file?.type || "File").trim() || "File";
              const fileSize = formatBytesCompact(file?.size);
              const storagePath = String(file?.storagePath || "");
              return `
                <button
                  type="button"
                  class="message-attachment-pill"
                  data-action="messenger-attachment-open"
                  data-id="${message.id}"
                  data-storage-path="${escapeHtml(storagePath)}"
                  title="${escapeHtml(`${fileType} - ${fileSize}`)}"
                >
                  <i class="bi bi-paperclip" aria-hidden="true"></i>
                  <span>${escapeHtml(fileName)}</span>
                </button>
              `;
            })
            .join("")}
        </div>
      `
      : "";
    const reactions = Array.isArray(message.reactions) ? message.reactions : [];
    const reactionMarkup = reactions.length
      ? `
        <div class="message-reaction-bar">
          ${reactions
            .map((reaction) => {
              const emoji = reaction?.emoji || "";
              const count = Number(reaction?.count || 0);
              const reacted = Boolean(reaction?.reacted);
              return `
                <button
                  type="button"
                  class="message-reaction-pill ${reacted ? "is-active" : ""}"
                  data-action="message-reaction-toggle"
                  data-id="${message.id}"
                  data-emoji="${escapeHtml(emoji)}"
                >
                  <span>${escapeHtml(emoji)}</span>
                  <small>${count}</small>
                </button>
              `;
            })
            .join("")}
        </div>
      `
      : "";
    const reactionPicker = isDeleted
      ? ""
      : `
        <details class="message-reaction-picker">
          <summary class="message-icon-btn" aria-label="Add reaction" title="Add reaction">
            <i class="bi bi-emoji-smile" aria-hidden="true"></i>
          </summary>
          <div class="message-reaction-menu">
            ${["\u{1F44D}", "\u2764\uFE0F", "\u{1F602}", "\u{1F62E}", "\u{1F389}"]
              .map(
                (emoji) => `
                  <button type="button" class="emoji-chip-btn" data-action="message-reaction-toggle" data-id="${message.id}" data-emoji="${emoji}">
                    ${emoji}
                  </button>
                `
              )
              .join("")}
            </div>
        </details>
      `;
    const hoverActionsMarkup = isDeleted
      ? ""
      : `
        <div class="message-inline-actions">
          ${reactionPicker}
          ${
            canEdit
              ? `<button class="message-icon-btn" data-action="message-edit" data-id="${message.id}" title="Edit message" aria-label="Edit message">
                  <i class="bi bi-pencil" aria-hidden="true"></i>
                </button>`
              : ""
          }
          ${
            canEdit
              ? `<button class="message-icon-btn is-danger" data-action="message-delete" data-id="${message.id}" title="Delete message" aria-label="Delete message">
                  <i class="bi bi-trash3" aria-hidden="true"></i>
                </button>`
              : ""
          }
        </div>
      `;
    const messageAvatar = isSelf
      ? ""
      : `
        <div class="message-avatar ${showAvatar ? "" : "is-placeholder"}" aria-hidden="true" title="${escapeHtml(message.sender)}">
          ${escapeHtml(String(message.sender || "").trim().slice(0, 1).toUpperCase() || "?")}
        </div>
      `;
    const messageMetaMarkup = showSenderName
      ? `
        <div class="message-meta is-group-chat">
          <strong>${escapeHtml(message.sender)}</strong>
          <span>${formatTimeLabel(message.createdAt)}</span>
          ${message.editedAt && !isDeleted ? "<span class='message-pill is-edited'>Edited</span>" : ""}
        </div>
      `
      : "";

    if (shouldInsertMessengerTimelineSeparator(previousMessage, message)) {
      rows.push(`
        <div class="messenger-time-separator">
          <span>${escapeHtml(formatMessengerTimelineLabel(message.createdAt))}</span>
        </div>
      `);
    }

    rows.push(`
      <article class="message-row ${isSelf ? "is-self" : "is-peer"} ${isDeleted ? "is-deleted" : ""}">
        ${messageAvatar}
        <div class="message-body">
          <div class="message-bubble-shell">
            <div class="message-bubble ${isDeleted ? "is-deleted" : ""}">
              ${
                isDeleted
                  ? "<p class='message-text is-muted'>Message deleted</p>"
                  : messageText
                    ? `<p class="message-text">${highlightMentions(messageText)}</p>`
                    : attachments.length
                      ? "<p class='message-text is-muted'>Attachment</p>"
                      : ""
              }
              ${attachmentMarkup}
            </div>
            ${hoverActionsMarkup}
          </div>
          ${reactionMarkup}
          <div class="message-foot">${messageMetaMarkup}</div>
        </div>
      </article>
    `);
  });

  return rows.join("");
}

function buildMessengerInfoPaneMarkup(
  data,
  selectedConversation,
  selectedPresenceSummary,
  selectedAvatarLabel,
  selectedPresenceAvatarMarkup,
  options = {}
) {
  if (!selectedConversation) {
    return "";
  }

  const selectedConversationKey = String(options.conversationKey || "").trim();
  const selectedConversationDisplayName =
    String(options.displayName || selectedConversation.name || "Conversation").trim() || "Conversation";
  const nicknameStore = options.messengerNicknamesByConversationKey || {};
  const themeStore = options.messengerThemeByConversationKey || {};
  const messengerInfoCollections = options.messengerInfoCollections || {
    pinnedMessages: [],
    mediaAttachments: [],
    fileAttachments: []
  };
  const selectedThemeKey = normalizeMessengerThemeKey(themeStore[selectedConversationKey]);
  const selectedThemeLabel = getMessengerThemeLabel(selectedThemeKey);
  const participantNames = [...new Set(getParticipants(data, selectedConversation).map((name) => String(name || "").trim()).filter(Boolean))];
  const currentUserName = String(data.currentUser?.name || "").trim().toLowerCase();
  const visibleParticipantNames = participantNames.filter((name) => String(name || "").trim().toLowerCase() !== currentUserName);
  const participantNicknames = visibleParticipantNames
    .map((name) => getMessengerParticipantNickname(selectedConversationKey, name, nicknameStore))
    .filter(Boolean);
  const infoStatusMarkup = selectedPresenceSummary
    ? `<p class="messenger-info-status ${escapeHtml(selectedPresenceSummary.tone)}">${escapeHtml(selectedPresenceSummary.label)}</p>`
    : `<p class="messenger-info-status is-unavailable">Presence unavailable</p>`;
  const nicknameValue =
    selectedConversation.targetType === "direct"
      ? getMessengerParticipantNickname(selectedConversationKey, selectedConversationDisplayName, nicknameStore) ||
        getMessengerParticipantNickname(selectedConversationKey, selectedConversation.name, nicknameStore) ||
        "No nickname set"
      : participantNicknames.length
        ? `${participantNicknames.length} nickname${participantNicknames.length === 1 ? "" : "s"} set`
        : "No nicknames set";

  const membersSectionMarkup =
    selectedConversation.targetType === "channel"
      ? `
        <section class="messenger-info-section">
          <p class="messenger-info-label">Members</p>
          <div class="messenger-info-members">
            ${
              visibleParticipantNames.length
                ? visibleParticipantNames
                    .map((name) => {
                      const nickname = getMessengerParticipantNickname(
                        selectedConversationKey,
                        name,
                        nicknameStore
                      );
                      return `
                        <div class="messenger-info-member">
                          <span class="messenger-info-member-avatar">${escapeHtml(String(name || "").trim().slice(0, 1).toUpperCase() || "?")}</span>
                          <span class="messenger-info-member-copy">
                            <strong class="messenger-info-member-name">${escapeHtml(name)}</strong>
                            ${
                              nickname
                                ? `<span class="messenger-info-member-nickname">${escapeHtml(nickname)}</span>`
                                : "<span class='messenger-info-note'>No nickname</span>"
                            }
                          </span>
                        </div>
                      `;
                    })
                    .join("")
                : "<p class='messenger-info-note'>No participants found.</p>"
            }
          </div>
        </section>
      `
      : "";

  const pinnedMessagesMarkup = `
    <section class="messenger-info-section">
      <p class="messenger-info-label">Pinned messages</p>
      <div class="messenger-info-stack">
        ${
          messengerInfoCollections.pinnedMessages.length
            ? messengerInfoCollections.pinnedMessages
                .slice(0, 4)
                .map((item) => renderMessengerInfoPinnedMessage(item))
                .join("")
            : "<p class='messenger-info-note'>No pinned messages yet.</p>"
        }
      </div>
    </section>
  `;

  const mediaMarkup = `
    <section class="messenger-info-section">
      <p class="messenger-info-label">Media</p>
      <div class="messenger-info-assets">
        ${
          messengerInfoCollections.mediaAttachments.length
            ? messengerInfoCollections.mediaAttachments
                .slice(0, 6)
                .map((item) => renderMessengerInfoAttachmentCard(item, "media"))
                .join("")
            : "<p class='messenger-info-note'>No media shared yet.</p>"
        }
      </div>
    </section>
  `;

  const filesMarkup = `
    <section class="messenger-info-section">
      <p class="messenger-info-label">Files</p>
      <div class="messenger-info-assets">
        ${
          messengerInfoCollections.fileAttachments.length
            ? messengerInfoCollections.fileAttachments
                .slice(0, 6)
                .map((item) => renderMessengerInfoAttachmentCard(item, "file"))
                .join("")
            : "<p class='messenger-info-note'>No files shared yet.</p>"
        }
      </div>
    </section>
  `;

  return `
    <aside class="messenger-info-pane" aria-label="Conversation info">
      <div class="messenger-info-top">
        <div class="messenger-info-avatar" aria-hidden="true">
          ${selectedAvatarLabel}${selectedPresenceAvatarMarkup || ""}
        </div>
        <div class="messenger-info-copy">
          <h4 class="messenger-info-name">${escapeHtml(selectedConversationDisplayName)}</h4>
          ${infoStatusMarkup}
        </div>
      </div>

      <section class="messenger-info-section">
        <p class="messenger-info-label">Customize chat</p>
        <div class="messenger-customize-grid">
          <button class="messenger-customize-row" type="button" data-action="messenger-open-theme" data-id="${selectedConversationKey}">
            <span class="messenger-customize-row-copy">
              <strong>Theme</strong>
              <span>${escapeHtml(selectedThemeLabel)}</span>
            </span>
            <span class="messenger-customize-row-trigger" aria-hidden="true">
              <i class="bi bi-chevron-right"></i>
            </span>
          </button>
          <button class="messenger-customize-row" type="button" data-action="messenger-open-nickname" data-id="${selectedConversationKey}">
            <span class="messenger-customize-row-copy">
              <strong>Nickname</strong>
              <span>${escapeHtml(nicknameValue)}</span>
            </span>
            <span class="messenger-customize-row-trigger" aria-hidden="true">
              <i class="bi bi-chevron-right"></i>
            </span>
          </button>
        </div>
      </section>

      ${membersSectionMarkup}
      ${pinnedMessagesMarkup}
      ${mediaMarkup}
      ${filesMarkup}
    </aside>
  `;
}

function buildComposerMarkup(selectedConversation, isEditingMessage, editDraft, isSending) {
  if (!selectedConversation) {
    return "";
  }
  const sendLabel = isEditingMessage ? "Save" : "Send";
  const sendButtonLabel = isSending
    ? isEditingMessage
      ? "Saving message"
      : "Sending message"
    : `${sendLabel} message`;
  return `
    <form class="comms-composer" id="commComposerForm">
      <input type="hidden" name="mode" value="internal" />
      <section class="comms-mode-surface messenger-surface">
        <input type="file" id="commAttachInput" name="attachments" multiple hidden />
        ${
          isEditingMessage
            ? `<div class="messenger-edit-banner">
                <span>Editing message</span>
                <button type="button" class="mini-btn" data-action="messenger-edit-cancel">Cancel</button>
              </div>`
            : ""
        }
        <div class="messenger-compose-dock">
          <div class="messenger-compose-tools" aria-label="Message tools">
            <button type="button" class="message-icon-btn" data-action="comm-attach-trigger" data-id="attach" aria-label="Attach file" title="Attach file" ${isEditingMessage ? "disabled" : ""}>
              <i class="bi bi-paperclip" aria-hidden="true"></i>
            </button>
            <button type="button" class="message-icon-btn" data-action="comm-toggle-emoji-picker" data-id="toggle" aria-label="Insert emoji" title="Insert emoji">
              <i class="bi bi-emoji-smile" aria-hidden="true"></i>
            </button>
            <button type="button" class="message-icon-btn" data-action="comm-quick-template" data-id="template" aria-label="Quick template" title="Quick template">
              <i class="bi bi-lightning-charge" aria-hidden="true"></i>
            </button>
          </div>
          <textarea id="commComposerText" name="text" rows="1" placeholder="Type a message...">${escapeHtml(isEditingMessage ? editDraft : "")}</textarea>
          <button class="btn btn-accent messenger-send-btn${isSending ? " is-loading" : ""}" type="submit" ${isSending ? 'disabled aria-busy="true"' : ""} aria-label="${escapeHtml(sendButtonLabel)}" title="${escapeHtml(sendButtonLabel)}">
            ${
              isSending
                ? '<i class="bi bi-arrow-repeat messenger-send-spinner" aria-hidden="true"></i>'
                : '<i class="bi bi-send" aria-hidden="true"></i>'
            }
          </button>
        </div>
        <div class="messenger-emoji-picker" data-comm-emoji-picker hidden>
          ${[
            "\u{1F600}",
            "\u{1F44D}",
            "\u{1F525}",
            "\u2705",
            "\u{1F389}",
            "\u{1F64F}",
            "\u{1F91D}",
            "\u{1F4AC}",
            "\u{1F4CC}",
            "\u{1F680}"
          ]
            .map(
              (emoji) =>
                `<button type="button" class="emoji-chip-btn" data-action="comm-insert-emoji" data-id="${emoji}" aria-label="Insert ${emoji}" title="Insert ${emoji}">${emoji}</button>`
            )
            .join("")}
        </div>
        <div class="messenger-attachment-list" data-comm-attach-list hidden></div>
        <div class="messenger-attachment-actions" data-comm-attach-hint hidden>
          <span class="task-meta" data-comm-attach-count></span>
          <button type="button" class="mini-btn" data-action="comm-clear-attachments" data-id="clear">Clear</button>
        </div>
      </section>
    </form>
  `;
}

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
  const messengerInfoOpen = context.messengerInfoOpen !== false;

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
  const selectedPresenceMarkup = selectedPresenceSummary
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
    .filter((message) => {
      if (!query) {
        return true;
      }
      return matchesSearch(
        [
          message.sender,
          message.text,
          message.createdAt,
          message.messageType || "Update",
          message.linkedType || "",
          message.linkedLabel || ""
        ],
        query
      );
    })
    .sort((a, b) => new Date(a.createdAt).valueOf() - new Date(b.createdAt).valueOf());
  const messengerInfoCollections = buildMessengerInfoCollections(conversationMessages, data, selectedConversation);

  const showMessengerBootstrapSkeleton = !messengerSnapshotReady && !messengerSnapshotError;
  const showMessengerLoadError = !messengerSnapshotReady && Boolean(messengerSnapshotError);
  const messageRows = buildMessengerMessageRows(messagesForConversation, data, selectedConversation);
  const inboxConversations = uniqueByKey(filteredConversations);
  const filterLabels = {
    all: "All",
    direct: "Direct",
    gc: "GC"
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
      <section class="view-block comms-layout comms-mode-internal messenger-view ${messengerInfoOpen ? "is-info-open" : "is-info-collapsed"}">
        <aside class="comms-rail">
          <div class="comms-rail-head">
            <div class="comms-filter-row">
              <div class="messenger-filter-bar">
                <div class="messenger-scope-row">
                  <button class="mini-btn ${activeFilter === "all" ? "is-active" : ""}" data-action="comm-set-filter" data-id="all">${filterLabels.all}</button>
                  <button class="mini-btn ${activeFilter === "gc" ? "is-active" : ""}" data-action="comm-set-filter" data-id="gc">${filterLabels.gc}</button>
                  <button class="mini-btn ${activeFilter === "direct" ? "is-active" : ""}" data-action="comm-set-filter" data-id="direct">${filterLabels.direct}</button>
                </div>
                <details class="messenger-create-menu">
                  <summary class="message-icon-btn messenger-create-toggle" aria-label="Start new chat" title="Start new chat">
                    <i class="bi bi-pencil-square" aria-hidden="true"></i>
                  </summary>
                  <div class="messenger-create-dropdown">
                    <button type="button" class="messenger-create-item" data-action="comm-new-direct" data-id="direct">
                      <i class="bi bi-person-plus" aria-hidden="true"></i>
                      <span>New Direct</span>
                    </button>
                    <button type="button" class="messenger-create-item" data-action="comm-new-gc" data-id="gc">
                      <i class="bi bi-people" aria-hidden="true"></i>
                      <span>New GC</span>
                    </button>
                  </div>
                </details>
              </div>
              <input class="search comms-search messenger-search" id="commsSearch" value="${escapeHtml(query)}" placeholder="Search Messenger" />
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
              <button
                type="button"
                class="message-icon-btn messenger-info-toggle ${messengerInfoOpen ? "is-active" : ""}"
                data-action="messenger-toggle-info"
                data-id="toggle"
                aria-label="${messengerInfoOpen ? "Hide info panel" : "Show info panel"}"
                aria-pressed="${messengerInfoOpen ? "true" : "false"}"
                title="${messengerInfoOpen ? "Hide info panel" : "Show info panel"}"
              >
                <i class="bi ${messengerInfoOpen ? "bi-info-circle-fill" : "bi-info-circle"}" aria-hidden="true"></i>
              </button>
            </div>
          </header>
          <div class="message-list ${showMessengerBootstrapSkeleton ? "is-skeleton" : ""}" id="commMessageList" ${showMessengerBootstrapSkeleton ? 'aria-busy="true"' : ""}>
            ${
              showMessengerBootstrapSkeleton
                ? renderMessengerThreadSkeleton()
                : showMessengerLoadError
                  ? renderMessengerInlineState("Could not load messages.", messengerSnapshotError)
                  : `<div class="messenger-message-feed">${messageRows || "<p class='task-meta'>No messages in this conversation yet.</p>"}</div>`
            }
          </div>
          ${composerMarkup}
        </section>
        ${
          messengerInfoOpen && selectedConversation
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
