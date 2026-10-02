import test from "node:test";
import assert from "node:assert/strict";
import {
  renderMessengerFailedMessages,
  renderMessengerGroupManageAction,
  renderMessengerHistoryControl,
  renderMessengerReceipt
} from "../../public/src/modules/messenger-workflow-view.js";

test("Messenger receipt summarizes readers without exposing markup", () => {
  const html = renderMessengerReceipt({
    readBy: [{ name: "Olivia <Admin>" }, { name: "John" }, { name: "Liz" }]
  }, true, true);
  assert.match(html, /Read by Olivia &lt;Admin&gt; and 2 others/);
  assert.equal(renderMessengerReceipt({ readBy: [] }, false, true), "");
});

test("Messenger history control only appears for paged threads", () => {
  assert.equal(renderMessengerHistoryControl({ conversationKey: "direct:1", messageCount: 12 }), "");
  assert.match(
    renderMessengerHistoryControl({ conversationKey: "direct:1", messageCount: 60 }),
    /data-action="messenger-load-older"/
  );
  assert.doesNotMatch(
    renderMessengerHistoryControl({ conversationKey: "direct:1", messageCount: 60, historyState: { hasMore: false } }),
    /messenger-load-older/
  );
});

test("failed messages keep a retry and removal path", () => {
  const html = renderMessengerFailedMessages([{
    id: "failed-1",
    conversationKey: "channel:group-1",
    body: "Try again <later>",
    files: [{ name: "brief.pdf" }]
  }], "channel:group-1");
  assert.match(html, /Not sent/);
  assert.match(html, /data-action="messenger-retry-send"/);
  assert.match(html, /data-action="messenger-dismiss-failed"/);
  assert.match(html, /Try again &lt;later&gt;/);
});

test("group management remains contextual", () => {
  assert.equal(renderMessengerGroupManageAction(""), "");
  assert.match(renderMessengerGroupManageAction("channel:group-1"), /Group settings/);
});
