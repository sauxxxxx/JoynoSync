import assert from "node:assert/strict";
import test from "node:test";

import {
  endLocalQaSession,
  isLocalQaAvailable,
  isLocalQaSessionActive,
  startLocalQaSession
} from "../../public/src/modules/local-qa-session.js";

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

test("local QA is restricted to loopback hosts", () => {
  assert.equal(isLocalQaAvailable({ hostname: "localhost" }), true);
  assert.equal(isLocalQaAvailable({ hostname: "127.0.0.1" }), true);
  assert.equal(isLocalQaAvailable({ hostname: "::1" }), true);
  assert.equal(isLocalQaAvailable({ hostname: "joynosync.web.app" }), false);
});

test("local QA creates and removes only a browser-local session", () => {
  const locationLike = { hostname: "localhost" };
  const storage = createMemoryStorage();

  assert.equal(isLocalQaSessionActive(locationLike, storage), false);
  assert.equal(startLocalQaSession(locationLike, storage), true);
  assert.equal(isLocalQaSessionActive(locationLike, storage), true);

  endLocalQaSession(storage);
  assert.equal(isLocalQaSessionActive(locationLike, storage), false);
});

test("local QA cannot start on a deployed host", () => {
  const storage = createMemoryStorage();
  assert.equal(startLocalQaSession({ hostname: "joynosync.web.app" }, storage), false);
  assert.equal(isLocalQaSessionActive({ hostname: "joynosync.web.app" }, storage), false);
});

test("local QA fails closed when browser storage is unavailable", () => {
  assert.equal(startLocalQaSession({ hostname: "localhost" }, null), false);
  assert.equal(isLocalQaSessionActive({ hostname: "localhost" }, null), false);
});
