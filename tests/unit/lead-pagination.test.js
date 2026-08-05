import test from "node:test";
import assert from "node:assert/strict";

import {
  hasLeadCursorExtraRow,
  isLeadPageTransitionPending,
  normalizeLeadCursorPageRows
} from "../../public/src/modules/lead-pagination.js";
import { buildLeadsMetaCacheKey } from "../../public/src/modules/cache-keys.js";

test("previous cursor pages discard the extra boundary row before reversing", () => {
  const descendingRows = Array.from({ length: 26 }, (_, index) => 50 - index);
  assert.deepEqual(
    normalizeLeadCursorPageRows(descendingRows, 25, "prev"),
    Array.from({ length: 25 }, (_, index) => 26 + index)
  );
});

test("next cursor pages retain order and discard the lookahead row", () => {
  const ascendingRows = Array.from({ length: 26 }, (_, index) => 51 + index);
  assert.deepEqual(
    normalizeLeadCursorPageRows(ascendingRows, 25, "next"),
    Array.from({ length: 25 }, (_, index) => 51 + index)
  );
  assert.equal(hasLeadCursorExtraRow(ascendingRows, 25), true);
  assert.equal(hasLeadCursorExtraRow(ascendingRows.slice(0, 25), 25), false);
});

test("page transitions stay locked until requested and committed pages match", () => {
  assert.equal(isLeadPageTransitionPending({ requestedPage: 2, committedPage: 1 }), true);
  assert.equal(isLeadPageTransitionPending({ requestedPage: 2, committedPage: 2 }), false);
  assert.equal(isLeadPageTransitionPending({ requestedPage: 2, committedPage: 2, rowLoading: true }), true);
  assert.equal(isLeadPageTransitionPending({ requestedPage: 2, committedPage: 2, routeLoading: true }), true);
});

test("lead metadata cache identity is stable across pages and page sizes", () => {
  const base = { currentUserId: "member-1", scope: "all", statusFilter: "New", page: 1, pageSize: 25 };
  assert.equal(
    buildLeadsMetaCacheKey("workspace-1", base),
    buildLeadsMetaCacheKey("workspace-1", { ...base, page: 9, pageSize: 100 })
  );
  assert.notEqual(
    buildLeadsMetaCacheKey("workspace-1", base),
    buildLeadsMetaCacheKey("workspace-1", { ...base, statusFilter: "Qualified" })
  );
});
