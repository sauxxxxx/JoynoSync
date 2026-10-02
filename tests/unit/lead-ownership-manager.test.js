import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEvenLeadAllocations,
  renderLeadExportOwnerOptions,
  renderLeadOwnershipManagerMarkup
} from "../../public/src/modules/lead-ownership-manager.js";

test("even lead allocation preserves the total", () => {
  assert.deepEqual(buildEvenLeadAllocations(527, ["vanessa", "liz"]), [
    { ownerId: "vanessa", count: 264 },
    { ownerId: "liz", count: 263 }
  ]);
  assert.equal(buildEvenLeadAllocations(3, ["a", "b", "c"]).reduce((sum, item) => sum + item.count, 0), 3);
});

test("ownership markup defaults to newest imports and active scope", () => {
  const markup = renderLeadOwnershipManagerMarkup({
    ownerMembers: [{ id: "source", name: "John Lee" }],
    activeMembers: [{ id: "destination", name: "Liz Tyler" }],
    statuses: ["New", "Contacted"]
  });
  assert.match(markup, /Newest imported first/);
  assert.match(markup, /Active only/);
  assert.match(markup, /destinationOwnerMemberIds/);
  assert.match(markup, /Unassign instead/);
});

test("export owner options retain stable member ids", () => {
  const markup = renderLeadExportOwnerOptions([{ id: "member-1", name: "John Lee" }]);
  assert.match(markup, /value="member-1"/);
  assert.match(markup, />John Lee</);
});
