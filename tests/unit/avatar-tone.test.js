import assert from "node:assert/strict";
import test from "node:test";

import { avatarHueFromValue } from "../../public/src/modules/avatar-tone.js";

test("avatar hues are deterministic and stay within the CSS hue range", () => {
  const hue = avatarHueFromValue("teammate-123");
  assert.equal(avatarHueFromValue("teammate-123"), hue);
  assert.ok(hue >= 0 && hue < 360);
});

test("different teammate identities produce varied fallback avatar hues", () => {
  const hues = new Set(["Aesop Elliot", "Brandon Cole", "Joan Reyes", "John Lee"].map(avatarHueFromValue));
  assert.ok(hues.size > 1);
});
