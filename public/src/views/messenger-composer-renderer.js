import { escapeHtml } from "../utils/text.js";

export function buildComposerMarkup(selectedConversation, isEditingMessage, editDraft, isSending) {
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
        <div class="messenger-attachment-list" data-comm-attach-list hidden></div>
        <div class="messenger-attachment-actions" data-comm-attach-hint hidden>
          <span class="task-meta" data-comm-attach-count></span>
          <button type="button" class="mini-btn" data-action="comm-clear-attachments" data-id="clear">Clear</button>
        </div>
        <div class="messenger-compose-dock">
          <div class="messenger-compose-tools" aria-label="Message tools">
            <details class="messenger-compose-menu">
              <summary class="message-icon-btn" role="button" aria-label="More message tools" title="More message tools">
                <i class="bi bi-plus-lg" aria-hidden="true"></i>
              </summary>
              <div class="messenger-compose-dropdown">
                <button type="button" data-action="comm-attach-trigger" data-id="attach" ${isEditingMessage ? "disabled" : ""}>
                  <i class="bi bi-paperclip" aria-hidden="true"></i><span>Attach file</span>
                </button>
                <button type="button" data-action="comm-toggle-emoji-picker" data-id="toggle">
                  <i class="bi bi-emoji-smile" aria-hidden="true"></i><span>Add emoji</span>
                </button>
                <button type="button" data-action="comm-quick-template" data-id="template">
                  <i class="bi bi-lightning-charge" aria-hidden="true"></i><span>Quick reply</span>
                </button>
              </div>
            </details>
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
      </section>
    </form>
  `;
}
