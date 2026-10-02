import { canManageLeadArchive, createEmptyLeadArchiveData } from "../modules/lead-archive-page.js";
import { escapeHtml } from "../utils/text.js";

const STATUS_OPTIONS = ["all", "New", "Contacted", "Qualified", "Unqualified", "Converted"];

function formatDateTime(value) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) {
    return "Date unavailable";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function formatCount(value) {
  return new Intl.NumberFormat("en-US").format(Math.max(0, Number(value) || 0));
}

function initials(value) {
  const parts = String(value || "Lead").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0]?.[0] || ""}${parts.at(-1)?.[0] || ""}`.toUpperCase();
}

function renderStatusOptions(activeStatus) {
  return STATUS_OPTIONS.map((status) => {
    const label = status === "all" ? "All statuses" : status;
    return `<option value="${status}" ${status === activeStatus ? "selected" : ""}>${label}</option>`;
  }).join("");
}

function renderLoadingRows() {
  return Array.from({ length: 5 }, (_, index) => `
    <tr class="lead-archive-skeleton-row" aria-hidden="true">
      <td><span class="lead-archive-skeleton is-name"></span></td>
      <td><span class="lead-archive-skeleton"></span></td>
      <td><span class="lead-archive-skeleton is-chip"></span></td>
      <td><span class="lead-archive-skeleton"></span></td>
      <td><span class="lead-archive-skeleton is-date"></span></td>
      <td><span class="lead-archive-skeleton is-action"></span></td>
    </tr>
  `).join("");
}

function renderRows(rows, busyIds) {
  return rows.map((lead) => {
    const busy = busyIds.has(String(lead.id || ""));
    const name = escapeHtml(lead.name || "Unnamed lead");
    const email = escapeHtml(lead.email || "No email");
    return `
      <tr class="lead-archive-row ${busy ? "is-busy" : ""}" ${busy ? 'aria-busy="true"' : ""}>
        <td data-label="Lead">
          <span class="lead-archive-person">
            <span class="lead-archive-avatar" aria-hidden="true">${escapeHtml(initials(lead.name))}</span>
            <span class="lead-archive-person-copy">
              <strong>${name}</strong>
              <small>${email}</small>
            </span>
          </span>
        </td>
        <td data-label="Company">${escapeHtml(lead.company || "—")}</td>
        <td data-label="Status"><span class="lead-archive-status">${escapeHtml(lead.status || "New")}</span></td>
        <td data-label="Owner">${escapeHtml(lead.owner || "Unassigned")}</td>
        <td data-label="Archived"><time datetime="${escapeHtml(lead.archivedAt || "")}">${escapeHtml(formatDateTime(lead.archivedAt))}</time></td>
        <td data-label="Actions">
          <span class="lead-archive-actions">
            <button type="button" class="lead-archive-restore" data-action="lead-archive-restore" data-id="${escapeHtml(lead.id)}" ${busy ? "disabled" : ""}>
              <i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i>
              <span>Restore</span>
            </button>
            <button type="button" class="lead-archive-delete" data-action="lead-archive-delete-permanently" data-id="${escapeHtml(lead.id)}" ${busy ? "disabled" : ""} aria-label="Permanently delete ${name}" title="Permanently delete">
              <i class="bi bi-trash3" aria-hidden="true"></i>
            </button>
          </span>
        </td>
      </tr>
    `;
  }).join("");
}

function renderEmptyState(hasFilters) {
  return `
    <div class="lead-archive-empty">
      <i class="bi bi-archive" aria-hidden="true"></i>
      <h2>${hasFilters ? "No archived leads match" : "No archived leads"}</h2>
      <p>${hasFilters ? "Try another status or search term." : "Leads you archive will appear here and can be restored later."}</p>
      ${hasFilters ? '<button type="button" class="mini-btn" data-action="lead-archive-clear-filters">Clear filters</button>' : ""}
    </div>
  `;
}

export function renderLeadArchive(data, context = {}) {
  if (!canManageLeadArchive(context.currentUserRole || data?.currentUser?.role)) {
    return {
      title: "Archived Leads",
      subtitle: "Admin access required",
      showWaitingPanel: false,
      html: `
        <section class="view-block lead-archive-view">
          <div class="lead-archive-empty">
            <i class="bi bi-shield-lock" aria-hidden="true"></i>
            <h2>Admin access required</h2>
            <p>Only workspace owners and admins can manage archived leads.</p>
            <button type="button" class="mini-btn" data-route="leads">Back to Leads</button>
          </div>
        </section>
      `
    };
  }

  const archive = createEmptyLeadArchiveData(context.leadArchiveData || {});
  const rows = Array.isArray(archive.rows) ? archive.rows : [];
  const busyIds = new Set(archive.busyIds || []);
  const statusFilter = STATUS_OPTIONS.includes(archive.statusFilter) ? archive.statusFilter : "all";
  const page = Math.max(1, Number(archive.page) || 1);
  const fromRecord = archive.totalCount ? (page - 1) * archive.pageSize + 1 : 0;
  const toRecord = Math.min(archive.totalCount, (page - 1) * archive.pageSize + rows.length);
  const hasFilters = statusFilter !== "all" || Boolean(String(context.searchTerm || "").trim());

  let content = "";
  if (archive.loading && !archive.loaded) {
    content = `
      <div class="lead-archive-table-shell" aria-label="Loading archived leads" aria-busy="true">
        <table class="lead-archive-table">
          <thead><tr><th>Lead</th><th>Company</th><th>Status</th><th>Owner</th><th>Archived</th><th><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>${renderLoadingRows()}</tbody>
        </table>
      </div>
    `;
  } else if (archive.error) {
    content = `
      <div class="lead-archive-empty is-error" role="alert">
        <i class="bi bi-exclamation-circle" aria-hidden="true"></i>
        <h2>Archived leads could not be loaded</h2>
        <p>${escapeHtml(archive.error)}</p>
        <button type="button" class="mini-btn" data-action="lead-archive-refresh">Try again</button>
      </div>
    `;
  } else if (!rows.length) {
    content = renderEmptyState(hasFilters);
  } else {
    content = `
      <div class="lead-archive-table-shell">
        <table class="lead-archive-table">
          <thead>
            <tr>
              <th>Lead</th>
              <th>Company</th>
              <th>Status</th>
              <th>Owner</th>
              <th>Archived</th>
              <th><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>${renderRows(rows, busyIds)}</tbody>
        </table>
      </div>
    `;
  }

  return {
    title: "Archived Leads",
    subtitle: "Restore records or remove them permanently",
    showWaitingPanel: false,
    html: `
      <section class="view-block lead-archive-view">
        <header class="lead-archive-header">
          <div>
            <h1>Archived leads</h1>
            <p>Review records removed from the active list. Restoring a lead returns it to Leads.</p>
          </div>
          <div class="lead-archive-header-actions">
            <span class="lead-archive-count">${formatCount(archive.totalCount)} archived</span>
            <button type="button" class="mini-btn" data-action="lead-archive-refresh" ${archive.loading ? "disabled" : ""}>
              <i class="bi bi-arrow-clockwise" aria-hidden="true"></i>
              <span>${archive.loading ? "Refreshing" : "Refresh"}</span>
            </button>
          </div>
        </header>

        <div class="lead-archive-toolbar">
          <label>
            <span>Status</span>
            <select data-lead-archive-status ${archive.loading ? "disabled" : ""}>
              ${renderStatusOptions(statusFilter)}
            </select>
          </label>
          <p>Permanent deletion cannot be undone.</p>
        </div>

        ${content}

        ${rows.length ? `
          <footer class="lead-archive-footer">
            <p>Showing ${formatCount(fromRecord)}–${formatCount(toRecord)} of ${formatCount(archive.totalCount)}</p>
            <div>
              <button type="button" class="mini-btn" data-action="lead-archive-page" data-id="prev" ${page <= 1 || archive.loading ? "disabled" : ""}>
                <i class="bi bi-chevron-left" aria-hidden="true"></i>
                <span>Previous</span>
              </button>
              <span>Page ${formatCount(page)}</span>
              <button type="button" class="mini-btn" data-action="lead-archive-page" data-id="next" ${!archive.hasMore || archive.loading ? "disabled" : ""}>
                <span>Next</span>
                <i class="bi bi-chevron-right" aria-hidden="true"></i>
              </button>
            </div>
          </footer>
        ` : ""}
      </section>
    `
  };
}
