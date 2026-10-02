import { escapeHtml } from "../utils/text.js";

const numberFormatter = new Intl.NumberFormat("en-US");

function formatCount(value) {
  return numberFormatter.format(Math.max(0, Number(value || 0)));
}

function metricById(model, id) {
  return (model.kpis || []).find((metric) => metric.id === id) || {};
}

function funnelByKey(model, key) {
  return (model.salesFunnelRows || []).find((stage) => stage.key === key) || {};
}

function percent(part, total) {
  const safePart = Math.max(0, Number(part || 0));
  const safeTotal = Math.max(0, Number(total || 0));
  return safeTotal ? Math.min(100, Math.round((safePart / safeTotal) * 100)) : 0;
}

function renderSummaryMetrics(model) {
  const newLeads = metricById(model, "new-leads");
  const pipeline = metricById(model, "pipeline");
  const wonValue = metricById(model, "won-value");
  const leadsStage = funnelByKey(model, "leads");
  const contactedStage = funnelByKey(model, "contacted");
  const qualifiedStage = funnelByKey(model, "qualified");
  const contactRate = percent(contactedStage.count, leadsStage.count);
  const qualificationRate = percent(qualifiedStage.count, contactedStage.count);
  const metrics = [
    {
      id: "new-leads",
      label: "New leads",
      value: newLeads.value || "0",
      note: model.compareVisible ? newLeads.deltaLabel : model.toolbarRangeLabel,
      tone: newLeads.deltaTone,
      target: "new-leads"
    },
    {
      id: "contact-rate",
      label: "Contact rate",
      value: `${contactRate}%`,
      note: `${formatCount(contactedStage.count)} contacted`,
      tone: "neutral",
      target: "contacted"
    },
    {
      id: "qualification-rate",
      label: "Qualification rate",
      value: `${qualificationRate}%`,
      note: `${formatCount(qualifiedStage.count)} qualified`,
      tone: "neutral",
      target: "qualified"
    },
    {
      id: "pipeline",
      label: "Open pipeline",
      value: pipeline.value || "$0",
      note: pipeline.note || "Across open stages",
      tone: "neutral",
      target: "pipeline"
    },
    {
      id: "won-value",
      label: "Won value",
      value: wonValue.value || "$0",
      note: model.compareVisible ? wonValue.deltaLabel : model.toolbarRangeLabel,
      tone: wonValue.deltaTone,
      target: "won"
    }
  ];

  return metrics
    .map(
      (metric) => `
        <button
          type="button"
          class="dashboard-notion-metric"
          data-action="dashboard-metric-open"
          data-id="${escapeHtml(metric.target)}"
          data-live-key="metric-${escapeHtml(metric.id)}"
          aria-label="Open ${escapeHtml(metric.label)} details"
        >
          <span class="dashboard-notion-label">${escapeHtml(metric.label)}</span>
          <strong>${escapeHtml(metric.value)}</strong>
          <span class="dashboard-notion-delta is-${escapeHtml(metric.tone || "neutral")}">
            ${escapeHtml(metric.note || "")}
          </span>
        </button>
      `
    )
    .join("");
}

function renderActionRows(rows, action, emptyCopy) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return `<p class="dashboard-notion-empty" data-live-key="empty">${escapeHtml(emptyCopy)}</p>`;
  }
  return rows
    .map(
      (row) => `
        <button
          type="button"
          class="dashboard-notion-action-row is-${escapeHtml(row.tone || "neutral")}"
          data-action="${escapeHtml(action)}"
          data-id="${escapeHtml(row.key || "")}"
          data-live-key="${escapeHtml(row.key || row.label || "row")}"
        >
          <span class="dashboard-notion-row-icon" aria-hidden="true"><i class="bi ${escapeHtml(row.icon || "bi-circle")}"></i></span>
          <span class="dashboard-notion-row-copy">
            <strong>${escapeHtml(row.label || "Item")}</strong>
            <small>${escapeHtml(row.meta || "")}</small>
          </span>
          <span class="dashboard-notion-row-count">${formatCount(row.count)}</span>
          <i class="bi bi-chevron-right dashboard-notion-row-chevron" aria-hidden="true"></i>
        </button>
      `
    )
    .join("");
}

function renderSalesFlow(model) {
  const rows = Array.isArray(model.salesFunnelRows) ? model.salesFunnelRows : [];
  return rows
    .map((row, index) => {
      const previous = rows[index - 1];
      const conversion = previous ? percent(row.count, previous.count) : null;
      return `
        ${
          previous
            ? `<span class="dashboard-notion-flow-connector" aria-label="${conversion}% converted from ${escapeHtml(previous.label || "previous stage")}">
                <i class="bi bi-arrow-right" aria-hidden="true"></i><small>${conversion}%</small>
              </span>`
            : ""
        }
        <button
          type="button"
          class="dashboard-notion-flow-stage"
          data-action="dashboard-stage-open"
          data-id="${escapeHtml(row.key || "")}"
          data-live-key="flow-${escapeHtml(row.key || row.label || "stage")}"
          aria-label="Open ${escapeHtml(row.label || "stage")}: ${formatCount(row.count)}"
        >
          <span>${escapeHtml(row.label || "Stage")}</span>
          <strong>${formatCount(row.count)}</strong>
        </button>
      `;
    })
    .join("");
}

function renderSourceRows(model) {
  const rows = Array.isArray(model.sourceRows) ? model.sourceRows : [];
  return rows
    .map((row) => {
      if (row.placeholder) {
        return `<tr data-live-key="source-empty"><td colspan="5" class="dashboard-notion-table-empty">${escapeHtml(row.secondaryLabel || "No source data in this range.")}</td></tr>`;
      }
      return `
        <tr data-live-key="source-${escapeHtml(row.key || row.label || "source")}">
          <th scope="row"><button type="button" class="dashboard-notion-table-link" data-action="dashboard-source-open" data-id="${escapeHtml(row.label || "")}">${escapeHtml(row.label || "Not set")}</button></th>
          <td>${formatCount(row.count)}</td>
          <td>${formatCount(row.qualified)}</td>
          <td>${formatCount(row.converted)}</td>
          <td>${formatCount(row.conversionRate)}%</td>
        </tr>
      `;
    })
    .join("");
}

function renderTeamRows(model) {
  const rows = Array.isArray(model.ownerRows) ? model.ownerRows : [];
  return rows
    .map((row) => {
      if (row.placeholder) {
        return `<tr data-live-key="team-empty"><td colspan="5" class="dashboard-notion-table-empty">No owner activity in this range.</td></tr>`;
      }
      const name = escapeHtml(row.name || "Unassigned");
      const ownerName = row.profileAvailable
        ? `<button type="button" class="dashboard-notion-owner" data-action="team-open-profile" data-id="${escapeHtml(row.id || "")}"><span>${escapeHtml(row.initials || "--")}</span>${name}</button>`
        : `<span class="dashboard-notion-owner is-static"><span>${escapeHtml(row.initials || "--")}</span>${name}</span>`;
      return `
        <tr data-live-key="team-${escapeHtml(row.id || row.name || "owner")}">
          <th scope="row">${ownerName}</th>
          <td>${formatCount(row.qualifiedLeads)}</td>
          <td>${formatCount(row.convertedLeads)}</td>
          <td>${formatCount(row.openDeals)}</td>
          <td class="${Number(row.overdueFollowUps || 0) > 0 ? "is-risk" : ""}">${formatCount(row.overdueFollowUps)}</td>
        </tr>
      `;
    })
    .join("");
}

function skeletonRows(count) {
  return Array.from({ length: count }, (_, index) => `
    <span class="dashboard-notion-skeleton-row" style="--skeleton-index:${index}" aria-hidden="true"></span>
  `).join("");
}

export function renderDashboardNotionLoadingState() {
  return {
    title: "Dashboard",
    subtitle: "Sales performance and work requiring attention",
    primaryAction: "Add Task",
    showWaitingPanel: false,
    html: `
      <main class="dashboard-notion dashboard-notion-loading" aria-busy="true" aria-label="Loading dashboard">
        <header class="dashboard-notion-loading-header" aria-hidden="true">
          <span class="dashboard-notion-skeleton-line is-title"></span>
          <span class="dashboard-notion-skeleton-line is-subtitle"></span>
        </header>
        <section class="dashboard-notion-summary" aria-hidden="true">
          ${Array.from({ length: 5 }, () => `<span class="dashboard-notion-skeleton-metric"><i></i><strong></strong><small></small></span>`).join("")}
        </section>
        <section class="dashboard-notion-priority-grid" aria-hidden="true">
          <article><span class="dashboard-notion-skeleton-line is-heading"></span>${skeletonRows(4)}</article>
          <article><span class="dashboard-notion-skeleton-line is-heading"></span>${skeletonRows(3)}</article>
        </section>
        <section class="dashboard-notion-loading-flow" aria-hidden="true">${skeletonRows(1)}</section>
        <section class="dashboard-notion-table-grid" aria-hidden="true">
          <article><span class="dashboard-notion-skeleton-line is-heading"></span>${skeletonRows(4)}</article>
          <article><span class="dashboard-notion-skeleton-line is-heading"></span>${skeletonRows(4)}</article>
        </section>
      </main>
    `
  };
}

export function renderDashboardNotionMessageState({ title, message, detail, locked = false } = {}) {
  return {
    title: "Dashboard",
    subtitle: "Sales performance and work requiring attention",
    primaryAction: locked ? "Open Tasks" : "Add Task",
    showWaitingPanel: false,
    html: `
      <main class="dashboard-notion dashboard-notion-message">
        <section role="${locked ? "status" : "alert"}">
          <span class="dashboard-notion-message-icon" aria-hidden="true"><i class="bi ${locked ? "bi-lock" : "bi-exclamation-circle"}"></i></span>
          <h1>${escapeHtml(title || "Dashboard unavailable")}</h1>
          <p>${escapeHtml(message || "We couldn't load the latest dashboard data.")}</p>
          ${detail ? `<small>${escapeHtml(detail)}</small>` : ""}
          ${locked ? `<button type="button" data-route="kanban">Open Tasks</button>` : `<button type="button" data-action="dashboard-refresh" data-id="refresh"><i class="bi bi-arrow-clockwise" aria-hidden="true"></i> Try again</button>`}
        </section>
      </main>
    `
  };
}

export function renderDashboardNotionView(model) {
  return {
    title: "Dashboard",
    subtitle: "Sales performance and work requiring attention",
    primaryAction: "Add Task",
    showWaitingPanel: false,
    html: `
      <main class="dashboard-notion" data-dashboard-live-root>
        <header class="dashboard-notion-header" data-dashboard-region="toolbar">
          <div class="dashboard-notion-header-inner" data-live-key="dashboard-toolbar">
            <div>
              <h1>${escapeHtml(model.toolbarHeading || "Dashboard")}</h1>
              <p>Sales performance and work requiring attention</p>
            </div>
            <div class="dashboard-notion-controls">
              <div class="dashboard-notion-range" aria-label="Dashboard date range">
                ${(model.rangeOptions || [])
                  .map(
                    (option) => `<button type="button" class="${option.active ? "is-active" : ""}" data-action="dashboard-range" data-id="${escapeHtml(option.id || "")}" aria-pressed="${option.active ? "true" : "false"}">${escapeHtml(option.label || "")}</button>`
                  )
                  .join("")}
              </div>
              <button type="button" class="dashboard-notion-compare ${model.compareVisible ? "is-active" : ""}" data-action="dashboard-compare-toggle" data-id="compare" aria-pressed="${model.compareVisible ? "true" : "false"}">
                <i class="bi bi-columns-gap" aria-hidden="true"></i><span>Compare</span>
              </button>
            </div>
          </div>
        </header>

        <section class="dashboard-notion-summary" aria-label="Sales summary" data-dashboard-region="summary">
          ${renderSummaryMetrics(model)}
        </section>

        <section class="dashboard-notion-priority-grid">
          <article class="dashboard-notion-section">
            <header class="dashboard-notion-section-head"><div><h2>Needs attention</h2><p>Items most likely to block progress</p></div></header>
            <div class="dashboard-notion-action-list" data-dashboard-region="attention">
              ${renderActionRows(model.attentionGroups, "dashboard-attention-open", "Nothing needs attention right now.")}
            </div>
          </article>
          <article class="dashboard-notion-section">
            <header class="dashboard-notion-section-head"><div><h2>Today</h2><p>Your immediate work queue</p></div></header>
            <div class="dashboard-notion-action-list" data-dashboard-region="today">
              ${renderActionRows(model.todaySummary, "dashboard-today-open", "Your queue is clear today.")}
            </div>
          </article>
        </section>

        <section class="dashboard-notion-section dashboard-notion-flow-section">
          <header class="dashboard-notion-section-head"><div><h2>Sales flow</h2><p>${escapeHtml(model.toolbarRangeLabel || "Selected range")} · stage-to-stage conversion</p></div></header>
          <div class="dashboard-notion-flow" data-dashboard-region="sales-flow">
            ${renderSalesFlow(model)}
          </div>
        </section>

        <section class="dashboard-notion-table-grid">
          <article class="dashboard-notion-section">
            <header class="dashboard-notion-section-head"><div><h2>Source performance</h2><p>Which channels create qualified opportunities</p></div></header>
            <div class="dashboard-notion-table-wrap">
              <table class="dashboard-notion-table">
                <thead><tr><th>Source</th><th>Leads</th><th>Qualified</th><th>Converted</th><th>Rate</th></tr></thead>
                <tbody data-dashboard-region="sources">${renderSourceRows(model)}</tbody>
              </table>
            </div>
          </article>
          <article class="dashboard-notion-section">
            <header class="dashboard-notion-section-head"><div><h2>Team performance</h2><p>Outcomes and follow-up risk by owner</p></div></header>
            <div class="dashboard-notion-table-wrap">
              <table class="dashboard-notion-table">
                <thead><tr><th>Owner</th><th>Qualified</th><th>Converted</th><th>Open deals</th><th>Overdue</th></tr></thead>
                <tbody data-dashboard-region="team">${renderTeamRows(model)}</tbody>
              </table>
            </div>
          </article>
        </section>
      </main>
    `
  };
}
