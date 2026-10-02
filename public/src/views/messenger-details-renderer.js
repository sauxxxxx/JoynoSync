import { escapeHtml } from "../utils/text.js";
import {
  formatBytesCompact,
  formatTimeLabel,
  getMessengerParticipantNickname,
  getParticipants
} from "./extended.js";
import {
  getMessengerNicknameForSender,
  getMessengerThemeLabel,
  normalizeMessengerThemeKey
} from "../modules/messenger-customization.js";
import { renderMessengerGroupManageAction } from "../modules/messenger-workflow-view.js";

function isMessengerMediaAttachment(attachment) {
  const mime = String(attachment?.type || "").trim().toLowerCase();
  return mime.startsWith("image/") || mime.startsWith("video/") || mime.startsWith("audio/");
}

export function buildMessengerInfoCollections(messagesForConversation = [], data, selectedConversation, options = {}) {
  const pinnedMessages = [];
  const mediaAttachments = [];
  const fileAttachments = [];
  const seenAttachmentKeys = new Set();
  const directChatName = String(selectedConversation?.name || "").trim();
  const currentUserName = String(data?.currentUser?.name || "").trim();
  const selectedConversationKey = String(options.conversationKey || "").trim();
  const nicknameStore = options.messengerNicknamesByConversationKey || {};

  (Array.isArray(messagesForConversation) ? messagesForConversation : []).forEach((message) => {
    if (!message || message.deletedAt) {
      return;
    }
    const messageId = String(message.id || "").trim();
    const messageText = String(message.text || "").trim();
    const senderName = String(message.sender || "").trim();
    const senderMember = (data?.teamMembers || []).find(
      (member) => String(member?.id || "") === String(message.senderId || "")
    );
    const canonicalSenderName = String(senderMember?.name || senderName).trim();
    const senderDisplayName = getMessengerNicknameForSender(
      selectedConversationKey,
      senderName,
      canonicalSenderName,
      nicknameStore
    ) || senderName;
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
        senderName: senderDisplayName || directChatName || currentUserName || "Someone",
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
        senderName: senderDisplayName || directChatName || currentUserName || "Someone",
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
          ${item.createdAt ? ` Â· ${escapeHtml(formatTimeLabel(item.createdAt))}` : ""}
          ${item.sizeLabel ? ` Â· ${escapeHtml(item.sizeLabel)}` : ""}
        </p>
      </div>
    </article>
  `;
}

export function buildMessengerInfoPaneMarkup(
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
  const fallbackConversationLabel =
    selectedConversation.targetType === "channel"
      ? `${visibleParticipantNames.length} member${visibleParticipantNames.length === 1 ? "" : "s"}`
      : "Direct conversation";
  const infoStatusMarkup = selectedConversation.targetType === "direct" && selectedPresenceSummary
    ? `<p class="messenger-info-status ${escapeHtml(selectedPresenceSummary.tone)}">${escapeHtml(selectedPresenceSummary.label)}</p>`
    : `<p class="messenger-info-status">${escapeHtml(fallbackConversationLabel)}</p>`;
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
      <button
        type="button"
        class="message-icon-btn messenger-info-close"
        data-action="messenger-toggle-info"
        data-id="toggle"
        aria-label="Close conversation details"
        title="Close conversation details"
      >
        <i class="bi bi-x-lg" aria-hidden="true"></i>
      </button>
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
          ${selectedConversation.targetType === "channel" ? renderMessengerGroupManageAction(selectedConversationKey) : ""}
        </div>
      </section>

      ${membersSectionMarkup}
      ${pinnedMessagesMarkup}
      ${mediaMarkup}
      ${filesMarkup}
    </aside>
  `;
}
