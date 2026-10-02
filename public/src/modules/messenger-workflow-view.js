import { escapeHtml } from "../utils/text.js";

function formatReceiptLabel(readBy = []) {
  const names = [...new Set((Array.isArray(readBy) ? readBy : []).map((item) => String(item?.name || "").trim()).filter(Boolean))];
  if (!names.length) {
    return "Sent";
  }
  if (names.length === 1) {
    return `Read by ${names[0]}`;
  }
  if (names.length === 2) {
    return `Read by ${names[0]} and ${names[1]}`;
  }
  return `Read by ${names[0]} and ${names.length - 1} others`;
}

export function renderMessengerReceipt(message, isSelf, isLastSelfMessage) {
  if (!isSelf || !isLastSelfMessage || message?.deletedAt) {
    return "";
  }
  return `<span class="messenger-receipt">${escapeHtml(formatReceiptLabel(message?.readBy))}</span>`;
}

export function renderMessengerHistoryControl(options = {}) {
  const { conversationKey = "", messageCount = 0, historyState = {} } = options;
  if (!conversationKey || Number(messageCount) < 60 || historyState?.hasMore === false) {
    return "";
  }
  if (historyState?.loading) {
    return `
      <div class="messenger-history-control" aria-live="polite">
        <span class="messenger-history-loading"><i class="bi bi-arrow-repeat" aria-hidden="true"></i> Loading earlier messages</span>
      </div>
    `;
  }
  return `
    <div class="messenger-history-control">
      <button type="button" class="messenger-history-button" data-action="messenger-load-older" data-id="${escapeHtml(conversationKey)}">
        <i class="bi bi-clock-history" aria-hidden="true"></i>
        <span>${historyState?.error ? "Try loading earlier messages again" : "Load earlier messages"}</span>
      </button>
      ${historyState?.error ? `<p>${escapeHtml(historyState.error)}</p>` : ""}
    </div>
  `;
}

export function renderMessengerFailedMessages(entries = [], conversationKey = "") {
  const visibleEntries = (Array.isArray(entries) ? entries : []).filter(
    (entry) => String(entry?.conversationKey || "") === String(conversationKey || "")
  );
  if (!visibleEntries.length) {
    return "";
  }
  return visibleEntries
    .map((entry) => {
      const attachmentCount = Array.isArray(entry?.files) ? entry.files.length : 0;
      return `
        <article class="message-row is-self is-failed" data-failed-message-id="${escapeHtml(entry.id)}">
          <div class="message-body">
            <div class="message-bubble-shell">
              <div class="message-bubble">
                ${entry.body ? `<p class="message-text">${escapeHtml(entry.body)}</p>` : ""}
                ${attachmentCount ? `<p class="messenger-failed-attachments">${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}</p>` : ""}
              </div>
            </div>
            <div class="messenger-failed-state">
              <span><i class="bi bi-exclamation-circle" aria-hidden="true"></i> Not sent</span>
              <button type="button" data-action="messenger-retry-send" data-id="${escapeHtml(entry.id)}">Retry</button>
              <button type="button" data-action="messenger-dismiss-failed" data-id="${escapeHtml(entry.id)}">Remove</button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

export function renderMessengerGroupManageAction(conversationKey = "") {
  if (!conversationKey) {
    return "";
  }
  return `
    <button class="messenger-customize-row" type="button" data-action="messenger-manage-group" data-id="${escapeHtml(conversationKey)}">
      <span class="messenger-customize-row-copy">
        <strong>Group settings</strong>
        <span>Rename, add, or remove members</span>
      </span>
      <span class="messenger-customize-row-trigger" aria-hidden="true"><i class="bi bi-chevron-right"></i></span>
    </button>
  `;
}
