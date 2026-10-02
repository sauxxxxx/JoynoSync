import test from "node:test";
import assert from "node:assert/strict";
import {
  applyLeadAdminViewState,
  isLeadAdminRole,
  renderLeadAdminTableFooter,
  resolveLeadAdminViewId,
  resolveLeadScopeForRole
} from "../../public/src/modules/lead-admin-view.js";

test("admin lead access is role-gated and agents stay in My Leads", () => {
  assert.equal(isLeadAdminRole("Owner"), true);
  assert.equal(isLeadAdminRole("Admin"), true);
  assert.equal(isLeadAdminRole("Manager"), true);
  assert.equal(isLeadAdminRole("Agent"), false);
  assert.equal(resolveLeadScopeForRole("Agent", "all"), "mine");
  assert.equal(resolveLeadScopeForRole("Admin", "mine"), "mine");
});

test("admin lead views apply real filter state", () => {
  const state = {
    leadsScope: "all",
    leadsStatusFilter: "Qualified",
    leadsDateFilter: "all",
    leadsOwnerFilter: "owner-1",
    leadsSourceFilter: "Referral",
    leadsTimezoneFilter: "eastern",
    leadFiltersOpen: true
  };
  assert.equal(applyLeadAdminViewState(state, "follow-up"), true);
  assert.equal(state.leadsScope, "all");
  assert.equal(state.leadsStatusFilter, "all");
  assert.equal(state.leadsDateFilter, "follow-up");
  assert.equal(state.leadsOwnerFilter, "all");
  assert.equal(state.leadFiltersOpen, false);
  assert.equal(resolveLeadAdminViewId({ scope: "all", status: "all", date: "follow-up" }), "follow-up");
});

test("last import view is available only while a completed batch is active", () => {
  const state = {
    leadsImportJobId: "job-1",
    leadsImportResultCount: 4,
    leadsImportViewActive: false,
    leadsScope: "all",
    leadsStatusFilter: "all",
    leadsDateFilter: "all",
    crmSortByRoute: { leads: { key: "lastTouch", dir: "desc" } }
  };
  assert.equal(applyLeadAdminViewState(state, "last-import"), true);
  assert.equal(state.leadsImportJobId, "job-1");
  assert.equal(state.leadsImportViewActive, true);
  assert.equal(applyLeadAdminViewState(state, "all"), true);
  assert.equal(state.leadsImportJobId, "job-1");
  assert.equal(state.leadsImportViewActive, false);
  assert.equal(applyLeadAdminViewState(state, "new"), true);
  assert.deepEqual(state.crmSortByRoute.leads, { key: "createdAt", dir: "desc" });
});

test("admin pagination is explicit and never presents deletion", () => {
  const markup = renderLeadAdminTableFooter(
    "leads",
    { page: 1, pageSize: 25, totalPages: 2023, fromRecord: 1, toRecord: 25, canGoNext: true },
    50564
  );
  assert.match(markup, /Page 1 of 2,023/);
  assert.match(markup, /Showing 1–25 of 50,564/);
  assert.doesNotMatch(markup, /Delete/i);
});
