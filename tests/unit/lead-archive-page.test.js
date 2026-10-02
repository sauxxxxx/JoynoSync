import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLocalArchivedLeadPage,
  canManageLeadArchive,
  createEmptyLeadArchiveData,
  createLeadArchivePageController
} from "../../public/src/modules/lead-archive-page.js";
import { renderLeadArchive } from "../../public/src/views/lead-archive.js";

test("archived lead management is limited to owners and admins", () => {
  assert.equal(canManageLeadArchive("Owner"), true);
  assert.equal(canManageLeadArchive("Admin"), true);
  assert.equal(canManageLeadArchive("Manager"), false);
  assert.equal(canManageLeadArchive("Member"), false);
});

test("local archive paging filters by status and search", () => {
  const page = buildLocalArchivedLeadPage(
    [
      { id: "1", name: "Ada Lovelace", status: "New", archived: true, archivedAt: "2026-09-28T01:00:00Z" },
      { id: "2", name: "Grace Hopper", status: "Contacted", archived: true, archivedAt: "2026-09-27T01:00:00Z" },
      { id: "3", name: "Active Lead", status: "New", archived: false, archivedAt: "" }
    ],
    { page: 1, pageSize: 25, statusFilter: "New", searchTerm: "Ada" }
  );
  assert.equal(page.totalCount, 1);
  assert.equal(page.rows[0].id, "1");
  assert.equal(page.hasMore, false);
});

test("archive view exposes restore and permanent delete with an irreversible warning", () => {
  const archive = createEmptyLeadArchiveData({
    loaded: true,
    totalCount: 1,
    rows: [
      {
        id: "lead-1",
        name: "Ada Lovelace",
        email: "ada@example.com",
        company: "Analytical Engines",
        status: "Contacted",
        owner: "Joy N.",
        archivedAt: "2026-09-28T01:00:00Z"
      }
    ]
  });
  const view = renderLeadArchive(
    { currentUser: { role: "Owner" } },
    { currentUserRole: "Owner", leadArchiveData: archive, searchTerm: "" }
  );
  assert.match(view.html, /data-action="lead-archive-restore"/);
  assert.match(view.html, /data-action="lead-archive-delete-permanently"/);
  assert.match(view.html, /Permanent deletion cannot be undone/);
});

test("restoring a local archived lead clears its busy state", async () => {
  const lead = { id: "lead-1", name: "Ada Lovelace", archived: true, archivedAt: "2026-09-28T01:00:00Z" };
  const state = {
    data: { leads: [lead], teamMembers: [], workspace: { id: "workspace-1" } },
    searchTerm: "",
    leadArchiveData: createEmptyLeadArchiveData({ loaded: true, totalCount: 1, rows: [lead] })
  };
  let confirmation;
  const controller = createLeadArchivePageController({
    state,
    canManage: () => true,
    isLiveEnabled: () => false,
    fetchPage: async () => null,
    restoreRemote: async () => null,
    deleteRemote: async () => null,
    openConfirmModal: (options) => { confirmation = options; },
    renderRoute: () => {},
    renderRoutePreservingInput: () => {},
    onRestored: () => {
      lead.archived = false;
      lead.archivedAt = "";
    },
    onDeleted: () => {},
    showToast: () => {}
  });

  controller.restore(lead.id);
  await confirmation.onConfirm();

  assert.deepEqual(state.leadArchiveData.busyIds, []);
  assert.equal(state.leadArchiveData.totalCount, 0);
});
