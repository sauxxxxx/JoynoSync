import { escapeHtml } from "../utils/text.js";
import { renderLeadAdminViewTabs } from "./lead-admin-view.js";
import { renderLeadAgentViewTabs } from "./lead-agent-view.js";

function filterButtonMarkup({ activeFilterCount, filterButtonLabel, filtersOpen, filterPopover, agent = false, isLoading = false }) {
  const loading = Boolean(isLoading);
  const className = agent
    ? "mini-btn crm-lead-agent-action crm-lead-filter-btn"
    : "mini-btn crm-lead-admin-action crm-lead-filter-btn";
  return `
    <div class="kanban-filter-shell lead-filter-shell">
      <button
        class="${className} ${activeFilterCount ? "is-active" : ""}"
        type="button"
        data-action="lead-open-filters"
        data-id="open"
        aria-label="${escapeHtml(filterButtonLabel)}"
        aria-expanded="${filtersOpen ? "true" : "false"}"
        ${loading ? 'disabled aria-disabled="true"' : ""}
      >
        <i class="bi bi-funnel" aria-hidden="true"></i><span>Filters</span>
        ${activeFilterCount ? `<small>${escapeHtml(String(activeFilterCount))}</small>` : ""}
      </button>
      ${loading ? "" : filterPopover}
    </div>
  `;
}

function adminActionsMarkup(options) {
  return `
    ${filterButtonMarkup(options)}
    <button type="button" class="mini-btn crm-lead-admin-action" data-action="lead-import-open" data-id="open"><i class="bi bi-download" aria-hidden="true"></i><span>Import</span><i class="bi bi-chevron-down lead-admin-action-chevron" aria-hidden="true"></i></button>
    <div class="crm-lead-admin-split-action">
      <button type="button" class="mini-btn crm-lead-admin-action" data-action="lead-export-leads" data-id="leads"><i class="bi bi-upload" aria-hidden="true"></i><span>Export</span></button>
      <details class="lead-admin-menu-shell">
        <summary class="crm-lead-admin-split-more" aria-label="Export options" title="Export options"><i class="bi bi-chevron-down" aria-hidden="true"></i></summary>
        <div class="lead-admin-action-menu" role="menu">
          <button type="button" data-action="lead-export-leads" data-id="leads" role="menuitem"><i class="bi bi-download" aria-hidden="true"></i><span>Export current view</span></button>
          <button type="button" data-action="lead-export-duplicates" data-id="duplicates" role="menuitem"><i class="bi bi-files" aria-hidden="true"></i><span>Export duplicates</span></button>
        </div>
      </details>
    </div>
    <button type="button" class="mini-btn crm-lead-admin-action" data-action="lead-ownership-manager" data-id=""><i class="bi bi-person-gear" aria-hidden="true"></i><span>Assign owner</span></button>
    <div class="lead-admin-primary-split">
      <button class="table-ops-columns-btn" type="button" data-action="view-add-record" data-id="create"><i class="bi bi-plus-lg" aria-hidden="true"></i><span>New Lead</span></button>
      <details class="lead-admin-menu-shell">
        <summary class="lead-admin-primary-more" aria-label="New lead options" title="New lead options"><i class="bi bi-chevron-down" aria-hidden="true"></i></summary>
        <div class="lead-admin-action-menu is-right" role="menu">
          <button type="button" data-action="view-add-record" data-id="create" role="menuitem"><i class="bi bi-person-plus" aria-hidden="true"></i><span>Add one lead</span></button>
          <button type="button" data-action="lead-import-open" data-id="open" role="menuitem"><i class="bi bi-upload" aria-hidden="true"></i><span>Import leads</span></button>
        </div>
      </details>
    </div>
  `;
}

function agentActionsMarkup(options) {
  const nextLeadId = String(options.nextCallableLeadId || "").trim();
  const loading = Boolean(options.isLoading);
  return `
    ${filterButtonMarkup({ ...options, agent: true })}
    <button type="button" class="mini-btn crm-lead-agent-action" data-action="view-add-record" data-id="create" ${loading ? 'disabled aria-disabled="true"' : ""}><i class="bi bi-person-plus" aria-hidden="true"></i><span>Add Lead</span></button>
    ${loading ? "" : `<button type="button" class="mini-btn crm-lead-agent-primary" data-action="lead-log-call" data-id="${escapeHtml(nextLeadId)}" ${nextLeadId ? "" : "disabled"}>
      <i class="bi bi-telephone" aria-hidden="true"></i><span>Start next call</span>
    </button>`}
  `;
}

function adminViewbarMarkup(options) {
  return `
    <div class="lead-admin-viewbar">
      ${renderLeadAdminViewTabs({
        activeViewId: options.adminViewId,
        counts: options.adminViewCounts,
        showLastImport: Boolean(options.showLastImport)
      })}
      <div class="lead-admin-viewbar-actions">
        <details class="lead-admin-menu-shell">
          <summary class="lead-admin-saved-views-btn"><i class="bi bi-bookmark" aria-hidden="true"></i><span>Saved views</span><i class="bi bi-chevron-down" aria-hidden="true"></i></summary>
          <div class="lead-admin-action-menu is-right" role="menu">
            <button type="button" data-action="lead-admin-view" data-id="all" role="menuitem">All Leads</button>
            <button type="button" data-action="lead-admin-view" data-id="mine" role="menuitem">My Leads</button>
            ${options.showLastImport ? '<button type="button" data-action="lead-admin-view" data-id="last-import" role="menuitem">Last import</button>' : ""}
            <button type="button" data-action="lead-admin-view" data-id="follow-up" role="menuitem">Follow-up</button>
            <button type="button" data-action="lead-admin-view" data-id="overdue" role="menuitem">Overdue</button>
          </div>
        </details>
        <button type="button" class="lead-admin-view-settings" data-action="lead-open-filters" data-id="open" aria-label="Configure lead view" title="Configure lead view"><i class="bi bi-sliders" aria-hidden="true"></i></button>
      </div>
    </div>
  `;
}

function agentViewbarMarkup(options) {
  const loading = Boolean(options.isLoading);
  return `
    <div class="lead-agent-viewbar ${loading ? "is-loading" : ""}">
      ${renderLeadAgentViewTabs({ activeViewId: options.agentViewId, counts: options.agentViewCounts, loading })}
      <div class="lead-agent-viewbar-actions">
        <details class="lead-agent-menu-shell" ${loading ? 'aria-disabled="true"' : ""}>
          <summary class="lead-agent-saved-views-btn" ${loading ? 'aria-disabled="true" tabindex="-1"' : ""}><i class="bi bi-bookmark" aria-hidden="true"></i><span>Saved views</span><i class="bi bi-chevron-down" aria-hidden="true"></i></summary>
          ${loading ? "" : `<div class="lead-agent-action-menu is-right" role="menu">
            <button type="button" data-action="lead-agent-view" data-id="queue" role="menuitem">Queue</button>
            <button type="button" data-action="lead-agent-view" data-id="due-today" role="menuitem">Follow-up today</button>
            <button type="button" data-action="lead-agent-view" data-id="follow-up" role="menuitem">Follow-up</button>
            <button type="button" data-action="lead-agent-view" data-id="overdue" role="menuitem">Overdue</button>
          </div>`}
        </details>
        <button type="button" class="lead-agent-view-settings" data-action="lead-open-filters" data-id="open" aria-label="Configure my lead view" title="Configure my lead view" ${loading ? 'disabled aria-disabled="true"' : ""}><i class="bi bi-gear" aria-hidden="true"></i></button>
      </div>
    </div>
  `;
}

export function renderLeadListHeader(options = {}) {
  const canManageLeads = Boolean(options.canManageLeads);
  const isLoading = !canManageLeads && Boolean(options.isLoading);
  const visibleCount = Number(options.visibleCount || 0).toLocaleString();
  return `
    <div class="crm-lead-header-shell">
      <div class="crm-lead-header-main">
        <div class="crm-lead-title-group">
          <div class="crm-lead-title-row">
            <h1 class="block-title">${canManageLeads ? "Leads" : "My Leads"}</h1>
            ${isLoading ? '<span class="crm-lead-total-badge is-loading" aria-label="Loading lead count"><span class="lead-agent-count-skeleton" aria-hidden="true"></span></span>' : `<span class="crm-lead-total-badge" aria-label="${escapeHtml(visibleCount)} leads">${escapeHtml(visibleCount)}</span>`}
          </div>
          <p class="crm-lead-title-meta">
            ${canManageLeads ? "All leads across workspace" : isLoading ? '<span role="status" aria-live="polite">Loading your leads…</span>' : "Your assigned leads and next actions"}
            ${canManageLeads ? `<span aria-hidden="true">&middot;</span><span>${escapeHtml(options.adminSyncLabel)}</span><button type="button" class="lead-admin-sync-btn" data-action="lead-admin-refresh" aria-label="Refresh leads" title="Refresh leads"><i class="bi bi-arrow-clockwise" aria-hidden="true"></i></button>` : ""}
          </p>
        </div>
        <div class="team-head-actions crm-lead-header-actions" role="group" aria-label="Lead actions">
          ${canManageLeads ? adminActionsMarkup(options) : agentActionsMarkup(options)}
        </div>
      </div>
    </div>
    ${canManageLeads ? adminViewbarMarkup(options) : agentViewbarMarkup(options)}
  `;
}
