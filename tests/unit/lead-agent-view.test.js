import test from "node:test";
import assert from "node:assert/strict";
import { renderLeadAgentViewTabs } from "../../public/src/modules/lead-agent-view.js";
import { renderLeadListHeader } from "../../public/src/modules/lead-list-header.js";

test("agent lead tabs show placeholders instead of zero counts while loading", () => {
  const markup = renderLeadAgentViewTabs({
    activeViewId: "queue",
    counts: { queue: 0, today: 0, followUp: 0, overdue: 0, contacted: 0, qualified: 0 },
    loading: true
  });

  assert.match(markup, /lead-agent-tab-count-skeleton/);
  assert.match(markup, /disabled aria-disabled="true"/);
  assert.doesNotMatch(markup, />0<\/small>/);
});

test("agent lead header communicates loading without exposing premature actions", () => {
  const markup = renderLeadListHeader({
    canManageLeads: false,
    visibleCount: 0,
    isLoading: true,
    agentViewId: "queue",
    agentViewCounts: {},
    activeFilterCount: 0,
    filterButtonLabel: "Open filters",
    filtersOpen: false,
    filterPopover: "",
    nextCallableLeadId: ""
  });

  assert.match(markup, /Loading your leads…/);
  assert.match(markup, /Loading lead count/);
  assert.doesNotMatch(markup, /Start next call/);
});
