import { canManageLeadArchive, createEmptyLeadArchiveData } from "../modules/lead-archive-page.js";
import { avatarHueFromValue } from "../modules/avatar-tone.js";
import { escapeHtml } from "../utils/text.js";
import { tableActionMenu } from "../utils/ui.js";

const STATUS_OPTIONS = [
  { id: "all", label: "All archived" },
  { id: "New", label: "New" },
  { id: "Contacted", label: "Contacted" },
  { id: "Qualified", label: "Qualified" },
  { id: "Unqualified", label: "Unqualified" },
  { id: "Converted", label: "Converted" }
];

function formatDateTime(value) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) return "Date unavailable";
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
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] || ""}${parts.at(-1)?.[0] || ""}`.toUpperCase();
}

function avatarCell(label, secondary = "") {
  const safeLabel = escapeHtml(label || "-");
  const safeSecondary = escapeHtml(secondary || "");
  return `
    <span class="crm-name-cell">
      <span class="crm-inline-avatar is-person-tone" style="--crm-avatar-hue:${avatarHueFromValue(label)}" aria-hidden="true">${escapeHtml(initials(label))}</span>
      <span class="crm-name-stack">
        <span class="crm-name-text">${safeLabel}</span>
        ${safeSecondary ? `<span class="crm-name-sub">${safeSecondary}</span>` : ""}
      </span>
    </span>
  `;
}

function statusClass(value) {
  return String(value || "New").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function formatSyncLabel(lastLoadedAt, loading) {
  if (loading) return "Refreshing archived leads";
  const timestamp = Number(lastLoadedAt || 0);
  if (!timestamp) return "Archive ready";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  return minutes < 1 ? "Updated just now" : `Updated ${formatCount(minutes)} min ago`;
}

function renderStatusTabs(activeStatus, totalCount, loading) {
  return `
    <nav class="lead-admin-view-tabs" aria-label="Archived lead status">
      ${STATUS_OPTIONS.map((option) => `
        <button
          type="button"
          class="lead-admin-view-tab ${activeStatus === option.id ? "is-active" : ""}"
          data-action="lead-archive-status"
          data-id="${escapeHtml(option.id)}"
          aria-pressed="${activeStatus === option.id ? "true" : "false"}"
          ${loading ? "disabled" : ""}
        >
          <span>${option.label}</span>
          ${option.id === activeStatus && totalCount ? `<small>${formatCount(totalCount)}</small>` : ""}
        </button>
      `).join("")}
    </nav>
  `;
}

function renderLoadingRows() {
  return Array.from({ length: 7 }, (_, index) => `
    <tr class="crm-table-skeleton-row lead-archive-skeleton-row" aria-hidden="true">
      <td class="table-col-check crm-lead-select-cell"><span class="crm-skeleton-icon"></span></td>
      <td class="lead-name-cell">
        <span class="crm-name-cell crm-skeleton-name-cell">
          <span class="crm-skeleton-avatar"></span>
          <span class="crm-name-stack">
            <span class="crm-skeleton-bar is-name" style="width:${112 + (index % 3) * 12}px"></span>
            <span class="crm-skeleton-bar is-sub" style="width:${78 + (index % 4) * 8}px"></span>
          </span>
        </span>
      </td>
      <td><span class="crm-skeleton-bar is-medium" style="width:88px"></span></td>
      <td><span class="crm-skeleton-bar is-pill" style="width:72px"></span></td>
      <td><span class="crm-skeleton-bar is-medium" style="width:96px"></span></td>
      <td><span class="crm-skeleton-bar is-medium" style="width:112px"></span></td>
      <td class="crm-admin-row-actions"><span class="crm-skeleton-icon"></span></td>
    </tr>
  `).join("");
}

function renderRows(rows, busyIds, selectedIds) {
  return rows.map((lead) => {
    const leadId = String(lead.id || "");
    const busy = busyIds.has(leadId);
    const selected = selectedIds.has(leadId);
    const name = lead.name || "Unnamed lead";
    const owner = lead.owner || "Unassigned";
    const menuItems = [
      { action: "lead-archive-restore", id: leadId, label: "Restore to Leads", icon: "bi-arrow-counterclockwise", primary: true, disabled: busy },
      { type: "divider" },
      { action: "lead-archive-delete-permanently", id: leadId, label: "Delete permanently", icon: "bi-trash3", danger: true, disabled: busy }
    ];
    return `
      <tr class="lead-archive-row ${selected ? "is-selected" : ""} ${busy ? "is-busy" : ""}" ${busy ? 'aria-busy="true"' : ""}>
        <td class="table-col-check crm-lead-select-cell">
          <input type="checkbox" name="archivedLeadSelect" value="${escapeHtml(leadId)}" ${selected ? "checked" : ""} ${busy ? "disabled" : ""} aria-label="Select ${escapeHtml(name)}" />
        </td>
        <td class="lead-name-cell">${avatarCell(name, lead.email || "No email")}</td>
        <td class="lead-archive-company-cell"><span class="crm-table-meta" title="${escapeHtml(lead.company || "No company")}">${escapeHtml(lead.company || "—")}</span></td>
        <td class="crm-status-cell"><span class="status-chip status-${escapeHtml(statusClass(lead.status))}">${escapeHtml(lead.status || "New")}</span></td>
        <td class="crm-owner-cell">${avatarCell(owner)}</td>
        <td class="lead-archive-date-cell"><time datetime="${escapeHtml(lead.archivedAt || "")}">${escapeHtml(formatDateTime(lead.archivedAt))}</time></td>
        <td class="crm-admin-row-actions"><span class="lead-row-inline-actions row-actions row-actions-table">${tableActionMenu(`Actions for ${name}`, menuItems)}</span></td>
      </tr>
    `;
  }).join("");
}

function renderEmptyRow({ hasFilters, error = false }) {
  const title = error ? "Archived leads could not be loaded" : hasFilters ? "No archived leads match" : "No archived leads yet";
  const description = error ? "Refresh the list to try again." : hasFilters ? "Try another status or search term." : "Leads removed from the active list will appear here.";
  const action = error ? "lead-archive-refresh" : hasFilters ? "lead-archive-clear-filters" : "lead-archive-refresh";
  return `
    <tr class="crm-table-empty-row">
      <td colspan="7">
        <div class="crm-table-empty-state ${error ? "is-error" : ""}" role="${error ? "alert" : "status"}">
          <span class="crm-table-empty-icon" aria-hidden="true"><i class="bi ${error ? "bi-exclamation-circle" : "bi-archive"}"></i></span>
          <h3>${title}</h3>
          <p>${description}</p>
          <button class="crm-table-empty-primary" type="button" data-action="${action}">
            <i class="bi ${hasFilters && !error ? "bi-x-lg" : "bi-arrow-clockwise"}" aria-hidden="true"></i>
            <span>${error ? "Try again" : hasFilters ? "Clear filters" : "Refresh"}</span>
          </button>
        </div>
      </td>
    </tr>
  `;
}

function renderFooter(archive, rowCount) {
  const page = Math.max(1, Number(archive.page) || 1);
  const pageSize = Math.max(1, Number(archive.pageSize) || 25);
  const fromRecord = archive.totalCount ? (page - 1) * pageSize + 1 : 0;
  const toRecord = Math.min(archive.totalCount, (page - 1) * pageSize + rowCount);
  const totalPages = Math.max(1, Math.ceil(Math.max(0, archive.totalCount) / pageSize));
  return `
    <footer class="table-ops-footer lead-admin-table-footer lead-archive-footer" ${archive.loading ? 'aria-busy="true"' : ""}>
      <div class="table-ops-page-size"><span class="lead-archive-page-size"><strong>${formatCount(pageSize)}</strong> per page</span></div>
      <p class="task-meta">Showing ${formatCount(fromRecord)}–${formatCount(toRecord)} of ${formatCount(archive.totalCount)}</p>
      <div class="table-ops-pages">
        <button type="button" data-action="lead-archive-page" data-id="prev" ${page <= 1 || archive.loading ? "disabled" : ""} aria-label="Previous page"><i class="bi bi-chevron-left" aria-hidden="true"></i><span>Previous</span></button>
        <span class="lead-admin-page-summary">Page ${formatCount(page)} of ${formatCount(totalPages)}</span>
        <button type="button" data-action="lead-archive-page" data-id="next" ${!archive.hasMore || archive.loading ? "disabled" : ""} aria-label="Next page"><span>Next</span><i class="bi bi-chevron-right" aria-hidden="true"></i></button>
      </div>
    </footer>
  `;
}

export function renderLeadArchive(data, context = {}) {
  if (!canManageLeadArchive(context.currentUserRole || data?.currentUser?.role)) {
    return {
      title: "Archived Leads",
      subtitle: "Admin access required",
      showWaitingPanel: false,
      html: `<section class="view-block crm-list-v2 crm-leads-list lead-archive-view is-admin-view"><div class="table-ops-wrap data-table-shell"><table class="data-table"><tbody>${renderEmptyRow({ error: true })}</tbody></table></div></section>`
    };
  }

  const archive = createEmptyLeadArchiveData(context.leadArchiveData || {});
  const rows = Array.isArray(archive.rows) ? archive.rows : [];
  const busyIds = new Set(archive.busyIds || []);
  const selectedIds = new Set(archive.selectedIds || []);
  const statusFilter = STATUS_OPTIONS.some((option) => option.id === archive.statusFilter) ? archive.statusFilter : "all";
  const selectedVisibleIds = rows.map((lead) => String(lead.id || "")).filter((id) => selectedIds.has(id));
  const allVisibleSelected = rows.length > 0 && selectedVisibleIds.length === rows.length;
  const partiallySelected = selectedVisibleIds.length > 0 && !allVisibleSelected;
  const hasFilters = statusFilter !== "all" || Boolean(String(context.searchTerm || "").trim());
  const tableRows = archive.loading && !archive.loaded
    ? renderLoadingRows()
    : archive.error
      ? renderEmptyRow({ error: true })
      : rows.length
        ? renderRows(rows, busyIds, selectedIds)
        : renderEmptyRow({ hasFilters });

  return {
    title: "Archived Leads",
    subtitle: "Restore records or remove them permanently",
    showWaitingPanel: false,
    html: `
      <section class="view-block crm-list-v2 crm-leads-list lead-archive-view is-admin-view ${archive.loading ? "is-loading" : ""}" ${archive.loading ? 'aria-busy="true"' : ""}>
        <div class="crm-lead-header-shell">
          <div class="crm-lead-header-main">
            <div class="crm-lead-title-group">
              <div class="crm-lead-title-row">
                <h1 class="block-title">Archived leads</h1>
                <span class="crm-lead-total-badge" aria-label="${formatCount(archive.totalCount)} archived leads">${formatCount(archive.totalCount)}</span>
              </div>
              <p class="crm-lead-title-meta"><span>Removed from the active list</span><span aria-hidden="true">&middot;</span><span>${escapeHtml(formatSyncLabel(archive.lastLoadedAt, archive.loading))}</span></p>
            </div>
            <div class="team-head-actions crm-lead-header-actions" role="group" aria-label="Archived lead actions">
              <button type="button" class="mini-btn crm-lead-admin-action" data-route="leads"><i class="bi bi-arrow-left" aria-hidden="true"></i><span>Active leads</span></button>
              <button type="button" class="mini-btn crm-lead-admin-action" data-action="lead-archive-refresh" ${archive.loading ? "disabled" : ""}><i class="bi ${archive.loading ? "bi-arrow-repeat lead-status-spinner" : "bi-arrow-clockwise"}" aria-hidden="true"></i><span>${archive.loading ? "Refreshing" : "Refresh"}</span></button>
            </div>
          </div>
        </div>

        <div class="lead-admin-viewbar">
          ${renderStatusTabs(statusFilter, archive.totalCount, archive.loading)}
          <div class="lead-admin-viewbar-actions"><p class="lead-archive-warning"><i class="bi bi-shield-check" aria-hidden="true"></i><span>Permanent deletion cannot be undone.</span></p></div>
        </div>

        <div class="table-ops-wrap data-table-shell lead-archive-table-shell">
          <table class="data-table lead-archive-table">
            <thead>
              <tr>
                <th class="table-col-check crm-lead-select-cell"><input id="archiveSelectAll" type="checkbox" aria-label="Select all visible archived leads" ${allVisibleSelected ? "checked" : ""} ${partiallySelected ? 'data-indeterminate="true"' : ""} ${!rows.length || archive.loading ? "disabled" : ""} /></th>
                <th class="lead-archive-col-lead">Lead</th>
                <th class="lead-archive-col-company">Company</th>
                <th class="lead-archive-col-status">Status</th>
                <th class="lead-archive-col-owner">Owner</th>
                <th class="lead-archive-col-date">Archived</th>
                <th class="crm-col-admin-actions"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>

        ${selectedVisibleIds.length ? `
          <div class="crm-lead-bulk-bar" role="region" aria-label="Archived lead bulk actions">
            <div class="crm-lead-bulk-copy"><p class="task-meta">${selectedVisibleIds.length} of ${rows.length} selected</p></div>
            <div class="crm-lead-bulk-actions">
              <button type="button" class="crm-lead-bulk-trigger" data-action="lead-archive-restore-selected"><i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i><span>Restore selected</span></button>
              <button type="button" class="crm-lead-bulk-trigger lead-archive-bulk-delete" data-action="lead-archive-delete-selected"><i class="bi bi-trash3" aria-hidden="true"></i><span>Delete selected</span></button>
              <button type="button" class="crm-lead-bulk-trigger" data-action="lead-archive-clear-selection"><i class="bi bi-x-lg" aria-hidden="true"></i><span class="sr-only">Clear selection</span></button>
            </div>
          </div>
        ` : ""}

        ${archive.loaded && !archive.error ? renderFooter(archive, rows.length) : ""}
      </section>
    `
  };
}
