import test from "node:test";
import assert from "node:assert/strict";
import { shouldRefreshAccessControlledSidebar } from "../../public/src/modules/sidebar-access.js";

test("refreshes the sidebar when archive access becomes available after startup", () => {
  assert.equal(
    shouldRefreshAccessControlledSidebar({
      canManageArchivedLeads: true,
      hasArchivedLeadRoute: false
    }),
    true
  );
});

test("refreshes the sidebar when archive access is removed", () => {
  assert.equal(
    shouldRefreshAccessControlledSidebar({
      canManageArchivedLeads: false,
      hasArchivedLeadRoute: true
    }),
    true
  );
});

test("keeps the existing sidebar when archive access already matches", () => {
  assert.equal(
    shouldRefreshAccessControlledSidebar({
      canManageArchivedLeads: true,
      hasArchivedLeadRoute: true
    }),
    false
  );
  assert.equal(
    shouldRefreshAccessControlledSidebar({
      canManageArchivedLeads: false,
      hasArchivedLeadRoute: false
    }),
    false
  );
});
