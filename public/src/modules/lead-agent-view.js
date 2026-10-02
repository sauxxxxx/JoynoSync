export const LEAD_AGENT_VIEWS = Object.freeze([
  { id: "queue", label: "Queue", status: "all", date: "all", countKey: "queue" },
  { id: "due-today", label: "Follow-up today", status: "all", date: "today", countKey: "today" },
  { id: "follow-up", label: "Follow-up", status: "all", date: "follow-up", countKey: "followUp" },
  { id: "overdue", label: "Overdue", status: "all", date: "overdue", countKey: "overdue" },
  { id: "contacted", label: "Contacted", status: "Contacted", date: "all", countKey: "contacted" },
  { id: "qualified", label: "Qualified", status: "Qualified", date: "all", countKey: "qualified" }
]);

function safeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function formatCount(value) {
  return new Intl.NumberFormat("en-US").format(safeNumber(value));
}

function localDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "";
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function waitingDateKey(item) {
  const raw = String(item?.linkedType || item?.nextFollowUp || "").trim();
  const match = raw.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : localDateKey(raw);
}

function countFollowUps(items = [], valueSelector = (item) => item?.nextFollowUp) {
  const today = localDateKey();
  return items.reduce(
    (counts, item) => {
      const date = localDateKey(valueSelector(item));
      if (!date) {
        return counts;
      }
      counts.followUp += 1;
      if (date === today) {
        counts.today += 1;
      } else if (date < today) {
        counts.overdue += 1;
      }
      return counts;
    },
    { today: 0, followUp: 0, overdue: 0 }
  );
}

export function resolveLeadAgentViewId({ status = "all", date = "all" } = {}) {
  const normalizedStatus = String(status || "all").trim();
  const normalizedDate = String(date || "all").trim().toLowerCase();
  return (
    LEAD_AGENT_VIEWS.find(
      (view) => view.status === normalizedStatus && view.date === normalizedDate
    )?.id || "queue"
  );
}

export function applyLeadAgentViewState(state, viewId) {
  const view = LEAD_AGENT_VIEWS.find((item) => item.id === String(viewId || "").trim());
  if (!view || !state || typeof state !== "object") {
    return false;
  }
  state.leadsScope = "mine";
  state.leadsStatusFilter = view.status;
  state.leadsDateFilter = view.date;
  state.leadsOwnerFilter = "all";
  state.leadsSourceFilter = "all";
  state.leadsTimezoneFilter = "all";
  state.leadFiltersOpen = false;
  return true;
}

export function buildLeadAgentViewCounts(pageData = {}, fallbackTotal = 0, leads = [], options = {}) {
  const scopeCounts = pageData?.scopeCounts && typeof pageData.scopeCounts === "object" ? pageData.scopeCounts : {};
  const sourceLeads = Array.isArray(leads) ? leads : [];
  const waitingItems = Array.isArray(pageData?.waitingItems) ? pageData.waitingItems : [];
  const followUpCounts = sourceLeads.length
    ? countFollowUps(sourceLeads)
    : countFollowUps(waitingItems, waitingDateKey);
  const statusCountsAreExact = Boolean(options.statusCountsAreExact);
  const countStatus = (status) => sourceLeads.filter((lead) => String(lead?.status || "").trim() === status).length;
  return {
    queue: safeNumber(scopeCounts.mine) || safeNumber(sourceLeads.length) || safeNumber(fallbackTotal),
    ...followUpCounts,
    contacted: statusCountsAreExact ? countStatus("Contacted") : null,
    qualified: statusCountsAreExact ? countStatus("Qualified") : null
  };
}

export function renderLeadAgentViewTabs({ activeViewId = "queue", counts = {}, loading = false } = {}) {
  return `
    <nav class="lead-agent-view-tabs ${loading ? "is-loading" : ""}" aria-label="My lead queue views" ${loading ? 'aria-busy="true"' : ""}>
      ${LEAD_AGENT_VIEWS.map((view) => {
        const rawCount = counts[view.countKey];
        const showCount = rawCount !== null && rawCount !== undefined;
        return `
          <button
            type="button"
            class="lead-agent-view-tab ${activeViewId === view.id ? "is-active" : ""}"
            data-action="lead-agent-view"
            data-id="${view.id}"
            aria-pressed="${activeViewId === view.id ? "true" : "false"}"
            ${loading ? 'disabled aria-disabled="true"' : ""}
          >
            <span>${view.label}</span>
            ${loading ? '<small class="lead-agent-tab-count-skeleton" aria-hidden="true"></small>' : showCount ? `<small>${formatCount(rawCount)}</small>` : ""}
          </button>
        `;
      }).join("")}
    </nav>
  `;
}
