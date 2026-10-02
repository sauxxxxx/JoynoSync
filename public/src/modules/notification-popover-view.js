import { escapeHtml } from "../utils/text.js";

function formatNotificationTime(value, now = Date.now()) {
  const createdAt = new Date(String(value || ""));
  if (Number.isNaN(createdAt.getTime())) {
    return "";
  }
  const elapsedMinutes = Math.max(0, Math.floor((Number(now) - createdAt.getTime()) / 60000));
  if (elapsedMinutes < 1) return "Now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
  if (elapsedMinutes < 1440) return `${Math.floor(elapsedMinutes / 60)}h`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(createdAt);
}

export function groupUnreadNotifications(items = []) {
  const groups = new Map();
  (Array.isArray(items) ? items : [])
    .filter((item) => !String(item?.readAt || "").trim())
    .forEach((item) => {
      const entityType = String(item?.entityType || "").trim();
      const entityId = String(item?.entityId || "").trim();
      const canGroup = item?.type === "message" && entityType === "conversation" && entityId;
      const key = canGroup ? `conversation:${entityId}` : `notification:${String(item?.id || "")}`;
      const existing = groups.get(key);
      if (existing) {
        existing.count += 1;
        return;
      }
      groups.set(key, { ...item, count: 1 });
    });
  return [...groups.values()];
}

function renderLoading() {
  return `
    <div class="notification-popover-loading" aria-hidden="true">
      <span></span><span></span><span></span>
    </div>
    <p class="sr-only" role="status">Loading notifications</p>
  `;
}

function renderState(message, action = "") {
  return `
    <div class="notification-popover-state" ${action ? 'role="alert"' : ""}>
      <i class="bi bi-bell" aria-hidden="true"></i>
      <strong>${escapeHtml(message)}</strong>
      ${action ? '<button type="button" data-action="notifications-retry">Try again</button>' : ""}
    </div>
  `;
}

function renderItem(item, now) {
  const title = String(item?.title || "Notification").trim();
  const description = String(item?.body || item?.meta || "").trim();
  const time = formatNotificationTime(item?.createdAt, now);
  return `
    <article class="notification-popover-item">
      <button type="button" class="notification-popover-open" data-action="notification-open" data-id="${escapeHtml(item?.id || "")}">
        <span class="notification-popover-dot"><span class="sr-only">Unread</span></span>
        <span class="notification-popover-copy">
          <span class="notification-popover-title-row">
            <strong>${escapeHtml(title)}</strong>
            ${time ? `<time datetime="${escapeHtml(item?.createdAt || "")}">${escapeHtml(time)}</time>` : ""}
          </span>
          ${description ? `<span class="notification-popover-description">${escapeHtml(description)}</span>` : ""}
        </span>
        ${item.count > 1 ? `<span class="notification-popover-count" aria-label="${item.count} notifications">${item.count}</span>` : ""}
      </button>
    </article>
  `;
}

export function renderNotificationPopover(source = {}, options = {}) {
  const model = source && typeof source === "object" ? source : {};
  const unreadCount = Math.max(0, Number(model.unreadCount || 0));
  const unreadItems = groupUnreadNotifications(model.items);
  let content = "";
  if (!model.loaded && model.loading) {
    content = renderLoading();
  } else if (!model.loaded && model.error) {
    content = renderState("Notifications couldn't load.", "retry");
  } else if (model.enabled === false) {
    content = renderState("In-app notifications are off.");
  } else if (!unreadItems.length) {
    content = renderState("You're all caught up.");
  } else {
    content = `<div class="notification-popover-items">${unreadItems.map((item) => renderItem(item, options.now)).join("")}</div>`;
  }

  return `
    <section class="notification-popover" aria-label="Notifications" aria-busy="${Boolean(model.loading)}">
      <header class="notification-popover-header">
        <span>
          <strong>Notifications</strong>
          <small>${unreadCount ? `${unreadCount} unread` : "All caught up"}</small>
        </span>
        ${unreadCount ? '<button type="button" data-action="notifications-mark-all-read">Mark all read</button>' : ""}
      </header>
      <div class="notification-popover-content">${content}</div>
      <footer class="notification-popover-footer">
        <button type="button" data-route="notifications">
          <span>View all notifications</span><i class="bi bi-arrow-right" aria-hidden="true"></i>
        </button>
      </footer>
    </section>
  `;
}
