import test from "node:test";
import assert from "node:assert/strict";
import {
  renderMessengerComposerSkeleton,
  renderMessengerInfoSkeleton,
  renderMessengerRailSkeleton,
  renderMessengerThreadHeaderSkeleton,
  renderMessengerThreadSkeleton
} from "../../public/src/modules/messenger-skeleton-view.js";

test("Messenger skeleton uses quiet structural shapes instead of message bubbles", () => {
  const thread = renderMessengerThreadSkeleton();
  assert.match(thread, /messenger-skeleton-message-copy/);
  assert.match(thread, /messenger-skeleton-message is-self/);
  assert.doesNotMatch(thread, /message-bubble/);
  assert.doesNotMatch(thread, /comms-skeleton-bar/);
});

test("Messenger skeleton covers the rail, header, composer, and details pane", () => {
  assert.match(renderMessengerRailSkeleton(), /messenger-skeleton-rail/);
  assert.match(renderMessengerThreadHeaderSkeleton(), /is-header-avatar/);
  assert.match(renderMessengerComposerSkeleton(), /messenger-skeleton-compose-dock/);
  assert.match(renderMessengerInfoSkeleton(), /Loading conversation details/);
});
