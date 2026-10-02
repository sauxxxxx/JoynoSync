function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderMetricRows(items, className = "") {
  return `
    <dl class="lead-import-notion-metrics ${className}">
      ${items
        .map(
          ({ label, value, tone = "" }) => `
            <div class="${tone ? `is-${escapeHtml(tone)}` : ""}">
              <dt>${escapeHtml(label)}</dt>
              <dd>${escapeHtml(value)}</dd>
            </div>
          `
        )
        .join("")}
    </dl>
  `;
}

function statusIcon(status) {
  if (status === "failed") {
    return "bi-exclamation-circle";
  }
  if (status === "completed") {
    return "bi-check2";
  }
  return "bi-arrow-repeat";
}

export function renderLeadImportProcessingView(model) {
  const status = String(model.status || "queued");
  const processed = Number(model.processedCount || 0);
  const total = Number(model.rowCount || 0);
  const percent = Number(model.progressPercent || 0);
  const isRunning = status === "processing" || status === "queued";
  return `
    <section class="lead-import-panel lead-import-execution-view" aria-live="polite">
      <header class="lead-import-execution-heading">
        <span class="lead-import-execution-icon is-${escapeHtml(status)}" aria-hidden="true">
          <i class="bi ${statusIcon(status)}"></i>
        </span>
        <div>
          <p class="lead-import-section-title">${escapeHtml(model.title)}</p>
          <p class="lead-import-section-subtitle">${escapeHtml(model.subtitle)}</p>
        </div>
        <span class="lead-import-notion-status is-${escapeHtml(status)}">
          <i aria-hidden="true"></i>${escapeHtml(model.label)}
        </span>
      </header>

      <div class="lead-import-execution-file">
        <i class="bi bi-file-earmark-spreadsheet" aria-hidden="true"></i>
        <span><strong>${escapeHtml(model.fileName || "Lead import")}</strong><small>${escapeHtml(total)} row${total === 1 ? "" : "s"}</small></span>
      </div>

      <section class="lead-import-notion-progress" aria-label="Import progress">
        <div class="lead-import-progress-head">
          <span><strong>${escapeHtml(processed)}</strong> of ${escapeHtml(total)} rows processed</span>
          <span>${escapeHtml(percent)}%</span>
        </div>
        <div class="lead-import-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${escapeHtml(percent)}">
          <span class="lead-import-progress-fill" style="width:${escapeHtml(percent)}%"></span>
        </div>
      </section>

      ${renderMetricRows([
        { label: "Created", value: model.createdCount },
        { label: "Updated", value: model.updatedCount },
        { label: "Assigned", value: model.assignedCount },
        { label: "Skipped", value: model.skippedCount },
        { label: "Reserve", value: model.leftUnassignedCount }
      ])}

      ${model.error
        ? `<p class="lead-import-notion-callout is-error"><i class="bi bi-exclamation-circle" aria-hidden="true"></i><span>${escapeHtml(model.error)}</span></p>`
        : isRunning
          ? `<p class="lead-import-notion-callout"><i class="bi bi-cloud-check" aria-hidden="true"></i><span>You can close this window. The import will continue safely in the background.</span></p>`
          : ""}
    </section>
  `;
}

export function renderLeadImportDoneView(model) {
  const summary = model.summary || {};
  const total = Number(summary.total || 0);
  const changed = Number(summary.created || 0) + Number(summary.updated || 0);
  return `
    <section class="lead-import-panel lead-import-complete-view">
      <header class="lead-import-complete-heading">
        <span class="lead-import-complete-icon" aria-hidden="true"><i class="bi bi-check-lg"></i></span>
        <div>
          <p class="lead-import-section-title">Import complete</p>
          <p class="lead-import-section-subtitle"><strong>${escapeHtml(model.fileName || "Lead import")}</strong> finished successfully.</p>
        </div>
      </header>

      <p class="lead-import-complete-summary">
        ${escapeHtml(changed)} lead${changed === 1 ? " was" : "s were"} changed across ${escapeHtml(total)} reviewed row${total === 1 ? "" : "s"}.
      </p>

      ${renderMetricRows([
        { label: "Created", value: summary.created || 0 },
        { label: "Updated", value: summary.updated || 0 },
        { label: "Assigned", value: summary.assigned || 0, tone: "success" },
        { label: "Skipped", value: summary.skipped || 0, tone: Number(summary.skipped || 0) ? "warning" : "" },
        { label: "Reserve", value: summary.leftUnassigned || 0 }
      ], "is-complete")}

      ${model.resultSummaryHtml || ""}
      ${model.error ? `<p class="lead-import-notion-callout is-error"><i class="bi bi-exclamation-circle" aria-hidden="true"></i><span>${escapeHtml(model.error)}</span></p>` : ""}
    </section>
  `;
}
