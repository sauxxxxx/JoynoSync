const ADMIN_LEAD_ROLES = new Set(["Owner", "Admin", "Manager"]);

export const LEAD_ADMIN_VIEWS = Object.freeze([
  { id: "all", label: "All Leads", scope: "all", status: "all", date: "all", countKey: "all" },
  { id: "mine", label: "My Leads", scope: "mine", status: "all", date: "all", countKey: "mine" },
  { id: "last-import", label: "Last import", scope: "all", status: "all", date: "all", countKey: "lastImport" },
  { id: "new", label: "New", scope: "all", status: "New", date: "all" },
  { id: "today", label: "Today", scope: "all", status: "all", date: "today", countKey: "today" },
  { id: "follow-up", label: "Follow-up", scope: "all", status: "all", date: "follow-up", countKey: "followUp" },
  { id: "overdue", label: "Overdue", scope: "all", status: "all", date: "overdue", countKey: "overdue" }
]);

function safeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function formatCount(value) {
  return new Intl.NumberFormat("en-US").format(safeNumber(value));
}

function localIsoDate(daysFromNow = 0) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + daysFromNow);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function extractWaitingDate(item) {
  const raw = String(item?.linkedType || item?.nextFollowUp || "").trim();
  const match = raw.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

export function isLeadAdminRole(role) {
  return ADMIN_LEAD_ROLES.has(String(role || "").trim());
}

export function resolveLeadScopeForRole(role, requestedScope = "all") {
  if (!isLeadAdminRole(role)) {
    return "mine";
  }
  const normalized = String(requestedScope || "all").trim().toLowerCase();
  return ["all", "mine", "unassigned", "assigned"].includes(normalized) ? normalized : "all";
}

export function resolveLeadAdminViewId({ scope = "all", status = "all", date = "all" } = {}) {
  const normalizedScope = String(scope || "all").trim().toLowerCase();
  const normalizedStatus = String(status || "all").trim();
  const normalizedDate = String(date || "all").trim().toLowerCase();
  return (
    LEAD_ADMIN_VIEWS.find(
      (view) => view.scope === normalizedScope && view.status === normalizedStatus && view.date === normalizedDate
    )?.id || ""
  );
}

export function applyLeadAdminViewState(state, viewId) {
  const view = LEAD_ADMIN_VIEWS.find((item) => item.id === String(viewId || "").trim());
  if (!view || !state || typeof state !== "object") {
    return false;
  }
  if (view.id === "last-import" && !String(state.leadsImportJobId || "").trim()) {
    return false;
  }
  state.leadsImportViewActive = view.id === "last-import";
  if (state.crmSortByRoute?.leads) {
    if (view.id === "new") {
      state.crmSortByRoute.leads = { key: "createdAt", dir: "desc" };
    } else if (["updatedAt", "createdAt"].includes(state.crmSortByRoute.leads.key)) {
      state.crmSortByRoute.leads = { key: "createdAt", dir: "desc" };
    }
  }
  state.leadsScope = view.scope;
  state.leadsStatusFilter = view.status;
  state.leadsDateFilter = view.date;
  state.leadsOwnerFilter = "all";
  state.leadsSourceFilter = "all";
  state.leadsTimezoneFilter = "all";
  state.leadFiltersOpen = false;
  return true;
}

export function buildLeadAdminViewCounts(pageData = {}, fallbackTotal = 0) {
  const scopeCounts = pageData?.scopeCounts && typeof pageData.scopeCounts === "object" ? pageData.scopeCounts : {};
  const waitingItems = Array.isArray(pageData?.waitingItems) ? pageData.waitingItems : [];
  const today = localIsoDate(0);
  let todayCount = 0;
  let overdueCount = 0;
  waitingItems.forEach((item) => {
    const date = extractWaitingDate(item);
    if (!date) {
      return;
    }
    if (date === today) {
      todayCount += 1;
    } else if (date < today) {
      overdueCount += 1;
    }
  });
  return {
    all: safeNumber(scopeCounts.all) || safeNumber(fallbackTotal),
    mine: safeNumber(scopeCounts.mine),
    today: todayCount,
    followUp: waitingItems.length,
    overdue: overdueCount
  };
}

export function formatLeadAdminSyncLabel(lastAttemptAt, isLiveData = false) {
  if (!isLiveData) {
    return "Local workspace";
  }
  const timestamp = Number(lastAttemptAt || 0);
  if (!timestamp) {
    return "Syncing leads";
  }
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (elapsedMinutes < 1) {
    return "Synced just now";
  }
  if (elapsedMinutes === 1) {
    return "Synced 1 min ago";
  }
  if (elapsedMinutes < 60) {
    return `Synced ${elapsedMinutes} min ago`;
  }
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  return `Synced ${elapsedHours} hr${elapsedHours === 1 ? "" : "s"} ago`;
}

export function renderLeadAdminViewTabs({ activeViewId = "", counts = {}, showLastImport = false } = {}) {
  const visibleViews = LEAD_ADMIN_VIEWS.filter((view) => view.id !== "last-import" || showLastImport);
  return `
    <nav class="lead-admin-view-tabs" aria-label="Lead views">
      ${visibleViews.map((view) => {
        const count = view.countKey ? safeNumber(counts[view.countKey]) : 0;
        const showCount = Boolean(view.countKey) && (count > 0 || view.id === "overdue");
        return `
          <button
            type="button"
            class="lead-admin-view-tab ${activeViewId === view.id ? "is-active" : ""}"
            data-action="lead-admin-view"
            data-id="${view.id}"
            aria-pressed="${activeViewId === view.id ? "true" : "false"}"
          >
            <span>${view.label}</span>
            ${showCount ? `<small>${formatCount(count)}</small>` : ""}
          </button>
        `;
      }).join("")}
    </nav>
  `;
}

export function renderLeadAdminTableFooter(routeId, pagination, totalRecords, options = {}) {
  const showTotalRecords = options.showTotalRecords !== false;
  const navigationPending = Boolean(options.navigationPending);
  const hasPrevious = Number(pagination?.page || 1) > 1;
  const page = Math.max(1, Number(pagination?.page || 1));
  const totalPages = Math.max(page, Number(pagination?.totalPages || page));
  const fromRecord = safeNumber(pagination?.fromRecord);
  const toRecord = safeNumber(pagination?.toRecord);
  const pageSize = safeNumber(pagination?.pageSize) || 25;
  return `
    <footer class="table-ops-footer lead-admin-table-footer" ${navigationPending ? 'aria-busy="true"' : ""}>
      <div class="table-ops-page-size">
        <button type="button" class="crm-page-size-trigger" data-action="crm-table-page-size-menu" data-id="${routeId}">
          <span>${pageSize}</span>
          <span class="lead-admin-per-page">per page</span>
          <i class="bi bi-chevron-down" aria-hidden="true"></i>
        </button>
      </div>
      <p class="task-meta">Showing ${formatCount(fromRecord)}–${formatCount(toRecord)}${showTotalRecords ? ` of ${formatCount(totalRecords)}` : ""}</p>
      <div class="table-ops-pages">
        <button type="button" data-action="crm-table-page" data-id="prev" ${hasPrevious && !navigationPending ? "" : "disabled"} aria-label="Previous page">
          <i class="bi bi-chevron-left" aria-hidden="true"></i>
          <span>Previous</span>
        </button>
        <span class="lead-admin-page-summary">Page ${formatCount(page)}${showTotalRecords ? ` of ${formatCount(totalPages)}` : ""}</span>
        <button type="button" data-action="crm-table-page" data-id="next" ${pagination?.canGoNext && !navigationPending ? "" : "disabled"} aria-label="Next page">
          <span>Next</span>
          <i class="bi bi-chevron-right" aria-hidden="true"></i>
        </button>
      </div>
    </footer>
  `;
}
