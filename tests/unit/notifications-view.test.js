import test from "node:test";
import assert from "node:assert/strict";
import { renderNotifications } from "../../public/src/views/notifications.js";

function render(center) {
  return renderNotifications({}, { notificationCenterData: center }).html;
}

test("notification center renders loading, error, and disabled states", () => {
  assert.match(render({ loading: true }), /Loading notifications/);
  assert.match(render({ error: "offline" }), /Notifications couldn't load/);
  assert.match(render({ loaded: true, enabled: false }), /In-app notifications are off/);
});

test("notification center renders filtered records and pagination actions", () => {
  const html = render({
    loaded: true,
    filter: "unread",
    unreadCount: 3,
    totalCount: 30,
    offset: 24,
    limit: 24,
    hasMore: false,
    items: [{
      id: "notification-1",
      type: "task-assigned",
      title: "Task assigned: Follow up",
      body: "Review the lead notes.",
      meta: "Tasks",
      badge: "Assigned",
      entityType: "task",
      entityId: "task-1",
      createdAt: "2026-09-04T01:00:00.000Z",
      readAt: ""
    }]
  });

  assert.match(html, /data-action="notification-open" data-id="notification-1"/);
  assert.match(html, /data-action="notification-dismiss" data-id="notification-1"/);
  assert.match(html, /data-action="notifications-filter" data-id="unread" class="is-current"/);
  assert.match(html, /data-action="notifications-page" data-id="previous"/);
  assert.match(html, /Showing 25–25 of 30/);
  assert.match(html, /<span class="notification-center-unread">/);
});

test("notification center escapes record copy", () => {
  const html = render({
    loaded: true,
    totalCount: 1,
    items: [{ id: "n-1", title: "<script>alert(1)</script>", body: "<b>unsafe</b>" }]
  });

  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;b&gt;unsafe&lt;\/b&gt;/);
});
