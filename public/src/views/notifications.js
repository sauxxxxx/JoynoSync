import { escapeHtml } from "../utils/text.js";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "read", label: "Read" }
];

const ICON_BY_TYPE = {
  message: "bi-chat-dots",
  "task-assigned": "bi-check2-square",
  "task-comment": "bi-chat-left-text",
  "task-due": "bi-calendar-event",
  "lead-assigned": "bi-person-plus",
  "lead-qualified": "bi-person-check",
  "lead-followup": "bi-telephone-outbound",
  "deal-update": "bi-graph-up-arrow",
  "missed-call": "bi-telephone-x"
};

function normalizeCenterData(context = {}) {
  const source = context.notificationCenterData && typeof context.notificationCenterData === "object"
    ? context.notificationCenterData
    : {};
  return {
    loaded: Boolean(source.loaded),
    loading: Boolean(source.loading),
    enabled: source.enabled !== false,
    error: String(source.error || "").trim(),
    filter: FILTERS.some((entry) => entry.id === source.filter) ? source.filter : "all",
    items: Array.isArray(source.items) ? source.items : [],
    totalCount: Math.max(0, Number(source.totalCount || 0)),
    unreadCount: Math.max(0, Number(source.unreadCount || 0)),
    offset: Math.max(0, Number(source.offset || 0)),
    limit: Math.max(1, Number(source.limit || 24)),
    hasMore: Boolean(source.hasMore)
  };
}

function formatNotificationTime(value) {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat(undefined, sameDay
    ? { hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
  ).format(date);
}

function renderSkeleton() {
  return `
    <div class="notification-center-skeleton" aria-hidden="true">
      ${Array.from({ length: 6 }, () => `
        <div class="notification-skeleton-row">
          <span class="notification-skeleton-icon"></span>
          <span><i></i><i></i></span>
        </div>
      `).join("")}
    </div>
    <p class="sr-only" role="status">Loading notifications</p>
  `;
}

function renderEmpty(filter) {
  const message = filter === "unread"
    ? "You're all caught up. New notifications will appear here."
    : filter === "read"
      ? "You haven't read any notifications yet."
      : "Notifications about your work will appear here.";
  return `
    <div class="notification-center-empty">
      <i class="bi bi-bell" aria-hidden="true"></i>
      <h2>No ${filter === "all" ? "notifications" : filter + " notifications"}</h2>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function renderItem(item) {
  const type = String(item?.type || "info").trim();
  const title = String(item?.title || "Notification").trim();
  const description = String(item?.body || item?.meta || "").trim();
  const meta = String(item?.meta || "").trim();
  const badge = String(item?.badge || "").trim();
  const unread = !String(item?.readAt || "").trim();
  const icon = ICON_BY_TYPE[type] || "bi-bell";
  return `
    <article class="notification-center-item ${unread ? "is-unread" : "is-read"}" data-notification-id="${escapeHtml(item?.id || "")}">
      <button class="notification-center-open" type="button" data-action="notification-open" data-id="${escapeHtml(item?.id || "")}">
        <span class="notification-center-icon" aria-hidden="true"><i class="bi ${icon}"></i></span>
        <span class="notification-center-copy">
          <span class="notification-center-title-row">
            <strong>${escapeHtml(title)}</strong>
            <time datetime="${escapeHtml(item?.createdAt || "")}">${escapeHtml(formatNotificationTime(item?.createdAt))}</time>
          </span>
          ${description ? `<span class="notification-center-description">${escapeHtml(description)}</span>` : ""}
          <span class="notification-center-meta">
            ${meta && meta !== description ? `<span>${escapeHtml(meta)}</span>` : ""}
            ${badge ? `<span class="notification-center-badge">${escapeHtml(badge)}</span>` : ""}
          </span>
        </span>
        ${unread ? '<span class="notification-center-unread"><span class="sr-only">Unread</span></span>' : ""}
      </button>
      <button class="notification-center-dismiss" type="button" data-action="notification-dismiss" data-id="${escapeHtml(item?.id || "")}" aria-label="Dismiss ${escapeHtml(title)}" title="Dismiss">
        <i class="bi bi-x-lg" aria-hidden="true"></i>
      </button>
    </article>
  `;
}

function renderContent(model) {
  if (!model.loaded && model.loading) {
    return renderSkeleton();
  }
  if (model.error && !model.loaded) {
    return `
      <div class="notification-center-state is-error" role="alert">
        <h2>Notifications couldn't load</h2>
        <p>Check your connection and try again.</p>
        <button type="button" data-action="notifications-retry">Try again</button>
      </div>
    `;
  }
  if (!model.enabled) {
    return `
      <div class="notification-center-state">
        <h2>In-app notifications are off</h2>
        <p>Turn them on in Settings when you want updates about your work.</p>
        <button type="button" data-route="settings">Open Settings</button>
      </div>
    `;
  }
  if (!model.items.length) {
    return renderEmpty(model.filter);
  }
  return `<div class="notification-center-list">${model.items.map(renderItem).join("")}</div>`;
}

function renderPagination(model) {
  if (!model.enabled || !model.loaded || model.totalCount <= model.limit) {
    return "";
  }
  const start = model.totalCount ? model.offset + 1 : 0;
  const end = Math.min(model.offset + model.items.length, model.totalCount);
  return `
    <footer class="notification-center-pagination">
      <span>Showing ${start}–${end} of ${model.totalCount}</span>
      <div>
        <button type="button" data-action="notifications-page" data-id="previous" ${model.offset === 0 ? "disabled" : ""} aria-label="Previous notification page"><i class="bi bi-chevron-left" aria-hidden="true"></i></button>
        <button type="button" data-action="notifications-page" data-id="next" ${!model.hasMore ? "disabled" : ""} aria-label="Next notification page"><i class="bi bi-chevron-right" aria-hidden="true"></i></button>
      </div>
    </footer>
  `;
}

export function renderNotifications(_data, context = {}) {
  const model = normalizeCenterData(context);
  return {
    title: "Notifications",
    subtitle: "Updates that need your attention",
    showWaitingPanel: false,
    html: `
      <section class="notification-center" aria-labelledby="notification-center-title" aria-busy="${model.loading}">
        <header class="notification-center-header">
          <div>
            <h1 id="notification-center-title">Notifications</h1>
            <p>Updates about messages, tasks, CRM activity, and calls.</p>
          </div>
          <button class="notification-center-mark-read" type="button" data-action="notifications-mark-all-read" ${model.unreadCount === 0 ? "disabled" : ""}>
            <i class="bi bi-check2-all" aria-hidden="true"></i><span>Mark all as read</span>
          </button>
        </header>
        <nav class="notification-center-filters" aria-label="Notification filters">
          ${FILTERS.map((filter) => `<button type="button" data-action="notifications-filter" data-id="${filter.id}" class="${model.filter === filter.id ? "is-current" : ""}" aria-pressed="${model.filter === filter.id}">${filter.label}${filter.id === "unread" && model.unreadCount ? `<span>${model.unreadCount > 99 ? "99+" : model.unreadCount}</span>` : ""}</button>`).join("")}
        </nav>
        <div class="notification-center-content">${renderContent(model)}</div>
        ${renderPagination(model)}
      </section>
    `
  };
}
