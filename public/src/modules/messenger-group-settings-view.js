import { isMessengerGroupMemberProtected } from "./messenger-group-settings.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderMessengerGroupMemberRows(teamMembers = [], selectedIds = [], currentUserId = "") {
  const selected = new Set((selectedIds || []).map(String));
  return (teamMembers || [])
    .filter((member) => String(member?.status || "").trim().toLowerCase() === "active")
    .sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")))
    .map((member) => {
      const memberId = String(member?.id || "");
      const locked = isMessengerGroupMemberProtected(member, selectedIds, currentUserId);
      const isCurrentUser = memberId === currentUserId;
      const role = String(member?.role || "Member").trim() || "Member";
      const searchText = [member?.name, member?.email, role, member?.team].filter(Boolean).join(" ").toLowerCase();
      const meta = isCurrentUser ? `${role} · You` : locked ? `${role} · Protected` : role;
      return `
        <label class="messenger-member-option ${locked ? "is-protected" : ""}" data-group-member-row data-search-text="${escapeHtml(searchText)}">
          <input type="checkbox" name="messengerGroupMember" value="${escapeHtml(memberId)}" ${selected.has(memberId) || locked ? "checked" : ""} ${locked ? "disabled data-group-protected" : ""}>
          ${locked ? `<input type="hidden" name="messengerGroupMember" value="${escapeHtml(memberId)}">` : ""}
          <span class="messenger-member-avatar">${escapeHtml(String(member?.name || "?").slice(0, 1).toUpperCase())}</span>
          <span class="messenger-member-copy"><strong>${escapeHtml(member?.name || "Unnamed member")}</strong><small>${escapeHtml(meta)}</small></span>
          ${locked ? `<span class="messenger-member-lock" title="This member cannot be removed" aria-label="Protected member"><i class="bi bi-lock" aria-hidden="true"></i></span>` : ""}
        </label>
      `;
    })
    .join("");
}

export function renderMessengerGroupEditor({ conversationName = "", conversationKey = "", memberRows = "" } = {}) {
  return `
    <section class="messenger-group-editor" data-group-manager>
      <p class="messenger-group-intro">Rename this conversation and choose who can take part.</p>
      <div class="messenger-group-editor-view" data-group-editor-view>
        <label class="messenger-field">
          <span>Group name</span>
          <input name="messengerGroupName" value="${escapeHtml(conversationName)}" maxlength="80" autocomplete="off">
        </label>
        <div class="messenger-member-picker">
          <div class="messenger-member-picker-head">
            <span>Members</span>
            <small data-group-member-count aria-live="polite"></small>
          </div>
          <label class="messenger-member-search">
            <i class="bi bi-search" aria-hidden="true"></i>
            <input type="search" placeholder="Search active members" aria-label="Search active members" data-group-member-search autocomplete="off">
          </label>
          <div class="messenger-member-options" role="group" aria-label="Active workspace members">
            ${memberRows}
            <p class="messenger-member-empty" data-group-member-empty hidden>No active members match this search.</p>
          </div>
          <p class="messenger-group-permission-note"><i class="bi bi-shield-check" aria-hidden="true"></i><span>Group owners and workspace managers can save changes. Protected members cannot be removed here.</span></p>
        </div>
        <div class="messenger-dialog-actions">
          <button type="button" class="messenger-text-action is-danger" data-action="messenger-leave-group" data-id="${escapeHtml(conversationKey)}">Leave group</button>
          <span></span>
          <button type="button" class="messenger-text-action" data-action="messenger-group-cancel" data-id="${escapeHtml(conversationKey)}">Cancel</button>
          <button type="button" class="messenger-primary-action" data-action="messenger-group-confirm" data-id="${escapeHtml(conversationKey)}" disabled>Save changes</button>
        </div>
      </div>
      <div class="messenger-group-review" data-group-review hidden></div>
      <p class="form-feedback" data-form-feedback role="status" aria-live="polite" hidden></p>
    </section>
  `;
}

export function renderMessengerGroupReview({ mode = "remove", removedMembers = [], conversationKey = "" } = {}) {
  const isDiscard = mode === "discard";
  const memberList = removedMembers.length
    ? `<ul class="messenger-group-removal-list">${removedMembers.map((member) => `
        <li>
          <span class="messenger-member-avatar">${escapeHtml(String(member?.name || "?").slice(0, 1).toUpperCase())}</span>
          <span>${escapeHtml(member?.name || "Unnamed member")}</span>
        </li>
      `).join("")}</ul>`
    : "";
  return `
    <div class="messenger-group-review-icon" aria-hidden="true"><i class="bi ${isDiscard ? "bi-arrow-counterclockwise" : "bi-person-dash"}"></i></div>
    <h4>${isDiscard ? "Discard your changes?" : `Remove ${removedMembers.length} ${removedMembers.length === 1 ? "member" : "members"}?`}</h4>
    <p>${isDiscard ? "The group name and member selection will return to their saved values." : "Removed members will lose access to this conversation and its future messages."}</p>
    ${memberList}
    <div class="messenger-group-review-actions">
      <button type="button" class="messenger-text-action" data-action="messenger-group-review-back" data-id="${escapeHtml(conversationKey)}">Back</button>
      <button type="button" class="${isDiscard ? "messenger-primary-action" : "messenger-danger-action"}" data-action="${isDiscard ? "messenger-group-discard-confirm" : "messenger-group-review-confirm"}" data-id="${escapeHtml(conversationKey)}">${isDiscard ? "Discard changes" : "Confirm changes"}</button>
    </div>
  `;
}
