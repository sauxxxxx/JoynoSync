import assert from "node:assert/strict";
import test from "node:test";

import {
  getMessengerNicknameForSender,
  normalizeMessengerThemeKey
} from "../../public/src/modules/messenger-customization.js";

test("messenger themes fall back to the default option", () => {
  assert.equal(normalizeMessengerThemeKey("soft"), "soft");
  assert.equal(normalizeMessengerThemeKey("unknown"), "default");
});

test("messenger nicknames resolve an exact participant name", () => {
  const nicknames = { "channel:chan_02": { "Ken Li": "Kenny" } };

  assert.equal(
    getMessengerNicknameForSender("channel:chan_02", "Ken", "Ken Li", nicknames),
    "Kenny"
  );
});

test("messenger nicknames resolve a unique short sender name", () => {
  const nicknames = { "channel:chan_02": { "Ken Li": "Kenny" } };

  assert.equal(
    getMessengerNicknameForSender("channel:chan_02", "Ken", "Ken", nicknames),
    "Kenny"
  );
});

test("messenger nicknames do not guess between matching short names", () => {
  const nicknames = {
    "channel:chan_02": {
      "Ken Li": "Kenny",
      "Ken Smith": "KS"
    }
  };

  assert.equal(
    getMessengerNicknameForSender("channel:chan_02", "Ken", "Ken", nicknames),
    ""
  );
});
