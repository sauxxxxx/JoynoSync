import assert from "node:assert/strict";
import test from "node:test";

import {
  groupUnreadNotifications,
  renderNotificationPopover
} from "../../public/src/modules/notification-popover-view.js";

test("notification popover excludes read history and groups unread conversation messages", () => {
  const items = [
    { id: "1", type: "message", entityType: "conversation", entityId: "thread-1", title: "New message", readAt: "" },
    { id: "2", type: "message", entityType: "conversation", entityId: "thread-1", title: "New message", readAt: "" },
    { id: "3", type: "message", entityType: "conversation", entityId: "thread-1", title: "Old message", readAt: "2026-09-07" }
  ];
  const grouped = groupUnreadNotifications(items);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].count, 2);
  assert.equal(grouped[0].id, "1");
});

test("notification popover renders contained unread workflow without dismiss noise", () => {
  const html = renderNotificationPopover({
    loaded: true,
    enabled: true,
    unreadCount: 2,
    items: [
      {
        id: "notification-1",
        type: "message",
        title: "New message from Shaun",
        body: "Hello <team>",
        entityType: "conversation",
        entityId: "thread-1",
        createdAt: "2026-09-07T04:59:00.000Z",
        readAt: ""
      }
    ]
  }, { now: new Date("2026-09-07T05:00:00.000Z").getTime() });

  assert.match(html, /Notifications/);
  assert.match(html, /2 unread/);
  assert.match(html, /data-action="notifications-mark-all-read"/);
  assert.match(html, /data-route="notifications"/);
  assert.match(html, /1m/);
  assert.match(html, /Hello &lt;team&gt;/);
  assert.doesNotMatch(html, /notification-dismiss/);
  assert.doesNotMatch(html, /topbar-notif-chip/);
});
