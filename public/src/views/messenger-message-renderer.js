import { escapeHtml } from "../utils/text.js";
import {
  formatBytesCompact,
  formatTimeLabel,
  highlightMentions
} from "./extended.js";
import { getMessengerNicknameForSender } from "../modules/messenger-customization.js";
import { renderMessengerReceipt } from "../modules/messenger-workflow-view.js";

export function buildTypingIndicatorMarkup(data, context, selectedConversation) {
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

export function buildMessengerMessageRows(messagesForConversation, data, selectedConversation, options = {}) {
  const showSenderName =
    selectedConversation?.targetType === "channel" || selectedConversation?.type === "GC";
  const rows = [];
  const currentUserId = String(data.currentUser?.id || "");
  const currentUserName = String(data.currentUser?.name || "").toLowerCase();
  const selectedConversationKey = String(options.conversationKey || "").trim();
  const nicknameStore = options.messengerNicknamesByConversationKey || {};
  const lastSelfMessageId = [...messagesForConversation]
    .reverse()
    .find((message) => !message?.deletedAt && (
      String(message?.senderId || "") === currentUserId ||
      String(message?.sender || "").toLowerCase() === currentUserName
    ))?.id;
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
    const isSelf = String(message.senderId || "") === currentUserId || String(message.sender || "").toLowerCase() === currentUserName;
    const isDeleted = Boolean(message.deletedAt);
    const canEdit = String(message.senderId || "") === String(data.currentUser?.id || "");
    const senderMember = (data.teamMembers || []).find(
      (member) => String(member?.id || "") === String(message.senderId || "")
    );
    const canonicalSenderName = String(senderMember?.name || message.sender || "").trim();
    const senderDisplayName = getMessengerNicknameForSender(
      selectedConversationKey,
      message.sender,
      canonicalSenderName,
      nicknameStore
    ) || message.sender;
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
          <button class="message-icon-btn ${message.pinned ? "is-active" : ""}" data-action="message-pin-toggle" data-id="${message.id}" title="${message.pinned ? "Unpin message" : "Pin message"}" aria-label="${message.pinned ? "Unpin message" : "Pin message"}">
            <i class="bi bi-pin-angle${message.pinned ? "-fill" : ""}" aria-hidden="true"></i>
          </button>
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
        <div class="message-avatar ${showAvatar ? "" : "is-placeholder"}" aria-hidden="true" title="${escapeHtml(senderDisplayName)}">
          ${escapeHtml(String(senderDisplayName || "").trim().slice(0, 1).toUpperCase() || "?")}
        </div>
      `;
    const messageMetaMarkup = showSenderName
      ? `
        <div class="message-meta is-group-chat">
          <strong>${escapeHtml(senderDisplayName)}</strong>
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
      <article class="message-row ${isSelf ? "is-self" : "is-peer"} ${isDeleted ? "is-deleted" : ""} ${message.pinned ? "is-pinned" : ""}">
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
          <div class="message-foot">${messageMetaMarkup}${renderMessengerReceipt(message, isSelf, String(message.id || "") === String(lastSelfMessageId || ""))}</div>
        </div>
      </article>
    `);
  });

  return rows.join("");
}
