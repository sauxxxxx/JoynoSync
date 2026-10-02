function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function mappingIndex(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function renderMappingRows(model) {
  const headers = Array.isArray(model.headers) ? model.headers : [];
  const mapping = model.mapping || {};
  return (model.fields || []).map((field) => {
    const selectedValue = String(mapping[field.key] ?? "").trim();
    const selectedIndex = mappingIndex(selectedValue);
    const selectedLabel = selectedIndex === null ? "Not mapped" : String(headers[selectedIndex] || "Not mapped");
    const isOpen = String(model.openMapField || "") === field.key;
    return `
      <div class="lead-import-notion-map-row">
        <div class="lead-import-notion-map-source">
          <span>${escapeHtml(field.label)}${field.required ? " *" : ""}</span>
          <small>${selectedIndex === null ? "Not included" : `Source column ${selectedIndex + 1}`}</small>
        </div>
        <i class="bi bi-arrow-right" aria-hidden="true"></i>
        <div class="contact-picker-control lead-import-map-control" data-lead-import-map-control="${escapeHtml(field.key)}">
          <button type="button" class="contact-picker-trigger ${isOpen ? "is-open" : ""} ${selectedIndex === null ? "is-unmapped" : ""}" data-action="lead-import-map-toggle" data-id="${escapeHtml(field.key)}" aria-label="Map ${escapeHtml(field.label)}. Currently ${escapeHtml(selectedLabel)}" aria-expanded="${isOpen ? "true" : "false"}">
            <span>${escapeHtml(selectedLabel)}</span>
            <i class="bi bi-chevron-down" aria-hidden="true"></i>
          </button>
          <div class="contact-picker-popover lead-import-map-popover" ${isOpen ? "" : "hidden"}>
            <div class="contact-picker-list" role="listbox" aria-label="Source column for ${escapeHtml(field.label)}">
              <button type="button" role="option" aria-selected="${selectedValue ? "false" : "true"}" class="contact-picker-option ${selectedValue ? "" : "is-selected"}" data-action="lead-import-map-select" data-id="${escapeHtml(`${field.key}:`)}">
                Not mapped
                <small>Do not import a value into this field.</small>
              </button>
              ${headers.map((header, index) => `
                <button type="button" role="option" aria-selected="${String(index) === selectedValue ? "true" : "false"}" class="contact-picker-option ${String(index) === selectedValue ? "is-selected" : ""}" data-action="lead-import-map-select" data-id="${escapeHtml(`${field.key}:${index}`)}">
                  ${escapeHtml(header)}
                  <small>Column ${index + 1}</small>
                </button>
              `).join("")}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function renderDuplicateSettings(model) {
  if (model.updateImportMode) {
    return "";
  }
  const duplicate = model.duplicate || {};
  return `
    <section class="lead-import-notion-settings" aria-label="Duplicate matching">
      <div class="lead-import-notion-setting-row">
        <div><strong>Duplicate behavior</strong><small>Choose what happens when an existing lead matches.</small></div>
        <div class="contact-picker-control lead-import-map-control" data-lead-import-duplicate-control>
          <button type="button" class="contact-picker-trigger ${duplicate.openMode ? "is-open" : ""}" data-action="lead-import-duplicate-toggle" aria-expanded="${duplicate.openMode ? "true" : "false"}">
            <span>${escapeHtml(duplicate.modeLabel || "Skip duplicates")}</span><i class="bi bi-chevron-down" aria-hidden="true"></i>
          </button>
          <div class="contact-picker-popover lead-import-map-popover" ${duplicate.openMode ? "" : "hidden"}>
            <div class="contact-picker-list">
              ${(duplicate.options || []).map((option) => `
                <button type="button" class="contact-picker-option ${option.value === duplicate.mode ? "is-selected" : ""}" data-action="lead-import-duplicate-select" data-id="${escapeHtml(option.value)}">
                  ${escapeHtml(option.label)}<small>${escapeHtml(option.detail || "")}</small>
                </button>
              `).join("")}
            </div>
          </div>
        </div>
      </div>
      <div class="lead-import-notion-setting-row">
        <div><strong>Duplicate columns</strong><small>Columns used to identify an existing lead.</small></div>
        <div class="contact-picker-control lead-import-map-control" data-lead-import-duplicate-columns-control>
          <button type="button" class="contact-picker-trigger ${duplicate.openColumns ? "is-open" : ""}" data-action="lead-import-duplicate-columns-toggle" aria-expanded="${duplicate.openColumns ? "true" : "false"}">
            <span>${escapeHtml(duplicate.columnsSummary || "All columns")}</span><i class="bi bi-chevron-down" aria-hidden="true"></i>
          </button>
          <div class="contact-picker-popover lead-import-map-popover" ${duplicate.openColumns ? "" : "hidden"}>
            <div class="contact-picker-list">
              ${(duplicate.headers || []).map((header, index) => `
                <button type="button" class="contact-picker-option ${(duplicate.selectedColumns || []).includes(String(index)) ? "is-selected" : ""}" data-action="lead-import-duplicate-column-toggle" data-id="${index}">
                  ${escapeHtml(header)}<small>Column ${index + 1}</small>
                </button>
              `).join("")}
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function issueMessage(row) {
  return [...(row.issues || []), ...(row.warnings || [])].join(" · ") || "Needs attention before import.";
}

function renderIssueRows(model, limit, detailed = false) {
  const rows = (model.issues || []).slice(0, limit);
  if (!rows.length) {
    return `<p class="lead-import-notion-empty"><i class="bi bi-check2-circle" aria-hidden="true"></i>No warnings were found in this file.</p>`;
  }
  return rows.map((row) => `
    <article class="lead-import-notion-warning-row ${row.result === "review" ? "is-blocking" : ""}">
      <span class="lead-import-notion-warning-icon" aria-hidden="true"><i class="bi bi-exclamation-triangle"></i></span>
      <div>
        <strong>Row ${escapeHtml(row.rowNumber)} · ${escapeHtml(row.values?.name || row.values?.email || "Unnamed lead")}</strong>
        <small>${escapeHtml(issueMessage(row))}</small>
      </div>
      ${detailed && row.isDuplicateMatch && model.duplicateMode === "create" ? `
        <button type="button" class="lead-import-notion-text-action" data-action="lead-import-approve-duplicate" data-id="${escapeHtml(row.rowNumber)}">
          ${(model.approvedDuplicateRows || []).includes(row.rowNumber) ? "Revoke approval" : "Approve duplicate"}
        </button>
      ` : `<span class="lead-import-notion-warning-result">${escapeHtml(row.resultLabel || "Review")}</span>`}
    </article>
  `).join("");
}

function renderUpdateBehavior(model) {
  if (!model.updateImportMode) {
    return "";
  }
  const update = model.update || {};
  const selectedClearFields = update.clearBlankFields || [];
  return `
    <section class="lead-import-notion-behavior" aria-label="Update behavior">
      <h4>Update behavior</h4>
      <details class="lead-import-notion-behavior-row" ${selectedClearFields.length ? "open" : ""}>
        <summary>
          <span><strong>Blank fields</strong><small>Choose what an empty file cell should do.</small></span>
          <span class="lead-import-notion-row-value">${selectedClearFields.length ? `${selectedClearFields.length} fields will be cleared` : "Preserve existing values"}</span>
          <i class="bi bi-chevron-right" aria-hidden="true"></i>
        </summary>
        <div class="lead-import-notion-behavior-content">
          <p>Blank cells preserve current values unless you explicitly select a field below.</p>
          <div class="lead-import-choice-grid">
            ${(update.clearableFields || []).map((field) => `<label class="lead-import-check"><input type="checkbox" data-action="lead-import-clear-blank-field" data-id="${escapeHtml(field.key)}" ${selectedClearFields.includes(field.key) ? "checked" : ""} /><span>Clear blank ${escapeHtml(field.label)}</span></label>`).join("")}
          </div>
        </div>
      </details>
      <details class="lead-import-notion-behavior-row">
        <summary>
          <span><strong>Status handling</strong><small>Choose whether this batch restarts the lead workflow.</small></span>
          <span class="lead-import-notion-row-value">${update.resetBlankStatus ? "Set every lead to New · 0/3" : "Use file Status or preserve current"}</span>
          <i class="bi bi-chevron-right" aria-hidden="true"></i>
        </summary>
        <div class="lead-import-notion-behavior-content lead-import-notion-radio-list" role="radiogroup" aria-label="Blank status behavior">
          <label><input type="radio" name="leadImportStatusBehavior" value="preserve" data-action="lead-import-status-behavior" ${update.resetBlankStatus ? "" : "checked"} /><span><strong>Use file Status</strong><small>Mapped Status values are applied; blank cells preserve the current Status.</small></span></label>
          <label><input type="radio" name="leadImportStatusBehavior" value="reset" data-action="lead-import-status-behavior" ${update.resetBlankStatus ? "checked" : ""} /><span><strong>Set every lead to New</strong><small>Reset active progress to 0/3 and clear Next Follow-up. Previous attempts and Last Activity remain in history.</small></span></label>
        </div>
      </details>
      <label class="lead-import-notion-restore-row">
        <input type="checkbox" data-action="lead-import-restore-archived" ${update.restoreArchived ? "checked" : ""} />
        <span><strong>Restore archived leads</strong><small>Return archived records matched by Lead ID to the active list.</small></span>
      </label>
    </section>
  `;
}

function renderReviewOverview(model) {
  const attentionCount = model.attentionCount;
  const warningStatus = attentionCount ? `${attentionCount} need attention` : "No issues";
  return `
    <section class="lead-import-notion-overview">
      <h4>Review before import</h4>
      <button type="button" class="lead-import-notion-disclosure" data-action="lead-import-review-subview" data-id="mapping">
        <span><strong>Column mapping</strong><small>${model.mappedFieldCount} fields matched</small></span>
        <span class="lead-import-notion-state is-ready">Ready</span>
        <i class="bi bi-chevron-right" aria-hidden="true"></i>
      </button>
      <button type="button" class="lead-import-notion-disclosure" data-action="lead-import-review-subview" data-id="warnings" ${attentionCount ? "" : "disabled"}>
        <span><strong>Warnings</strong><small>${attentionCount ? `${attentionCount} rows need review · ${model.blockedCount} blocking` : "No rows need review"}</small></span>
        <span class="lead-import-notion-state ${attentionCount ? "is-warning" : "is-ready"}">${warningStatus}</span>
        <i class="bi bi-chevron-right" aria-hidden="true"></i>
      </button>
      ${attentionCount ? `<div class="lead-import-notion-warning-preview">${renderIssueRows(model, 3)}<button type="button" class="lead-import-notion-text-action" data-action="lead-import-review-subview" data-id="warnings">Review all ${attentionCount} warnings</button></div>` : ""}
      ${renderUpdateBehavior(model)}
    </section>
  `;
}

function renderMappingSubview(model) {
  return `
    <section class="lead-import-notion-subview" aria-labelledby="lead-import-mapping-title">
      <button type="button" class="lead-import-notion-back" data-action="lead-import-review-overview"><i class="bi bi-arrow-left" aria-hidden="true"></i>Back to review</button>
      <header><div><h4 id="lead-import-mapping-title">Column mapping</h4><p>Match each JoynoSync field to the correct column from your file.</p></div><span class="lead-import-notion-state is-ready">${model.mappedFieldCount} matched</span></header>
      <div class="lead-import-notion-map-head"><span>JoynoSync field</span><span>Source column</span></div>
      <div class="lead-import-notion-map-list">${renderMappingRows(model.mappingModel)}</div>
      ${renderDuplicateSettings(model)}
    </section>
  `;
}

function renderWarningsSubview(model) {
  const attentionCount = model.attentionCount;
  const shownCount = Math.min(attentionCount, 12);
  return `
    <section class="lead-import-notion-subview" aria-labelledby="lead-import-warnings-title">
      <button type="button" class="lead-import-notion-back" data-action="lead-import-review-overview"><i class="bi bi-arrow-left" aria-hidden="true"></i>Back to review</button>
      <header><div><h4 id="lead-import-warnings-title">Warnings</h4><p>Review rows that may be skipped or need a decision before import.</p></div><span class="lead-import-notion-state is-warning">${attentionCount} need attention</span></header>
      <div class="lead-import-notion-warning-tools">
        <span>Showing ${shownCount} of ${attentionCount}</span>
        <div>${model.duplicateCount ? `<button type="button" class="lead-import-notion-text-action" data-action="lead-import-download-duplicates" ${model.duplicateExportBusy ? "disabled" : ""}>${model.duplicateExportBusy ? "Exporting…" : "Export duplicates"}</button>` : ""}${model.blockedCount ? `<button type="button" class="lead-import-notion-text-action" data-action="lead-import-download-issues">Export issues</button>` : ""}</div>
      </div>
      ${model.duplicateExportError ? `<p class="lead-import-soft-note lead-import-soft-note-error">${escapeHtml(model.duplicateExportError)}</p>` : ""}
      <div class="lead-import-notion-warning-list">${renderIssueRows(model, 12, true)}</div>
      ${attentionCount > 12 ? `<p class="lead-import-notion-list-note">Export the issue report to review all ${attentionCount} affected rows.</p>` : ""}
    </section>
  `;
}

export function renderLeadImportReviewView(model) {
  const subview = ["mapping", "warnings"].includes(model.reviewSubview) ? model.reviewSubview : "";
  const attentionCount = Number.isFinite(model.attentionCount) ? model.attentionCount : (model.issues || []).length;
  const viewModel = { ...model, attentionCount };
  const workspaceStatus = String(model.workspaceReviewStatus || "idle");
  const workspaceStatusMarkup = workspaceStatus === "checking"
    ? `<div class="lead-import-workspace-check is-checking" role="status"><i class="bi bi-arrow-repeat" aria-hidden="true"></i><span><strong>Checking the complete workspace</strong><small>Verifying every row against all existing leads.</small></span></div>`
    : workspaceStatus === "failed"
      ? `<div class="lead-import-workspace-check is-failed" role="alert"><i class="bi bi-exclamation-circle" aria-hidden="true"></i><span><strong>Workspace verification failed</strong><small>${escapeHtml(model.workspaceReviewError || "Try the file again before importing.")}</small></span><button type="button" class="lead-import-notion-text-action" data-action="lead-import-review-retry">Try again</button></div>`
      : workspaceStatus === "complete"
        ? `<div class="lead-import-workspace-check is-complete"><i class="bi bi-check2-circle" aria-hidden="true"></i><span><strong>Complete workspace checked</strong><small>${model.detectedJoynoSyncExport ? "JoynoSync export detected and verified by Lead ID." : "Existing leads and file duplicates are included below."}</small></span></div>`
        : "";
  return `
    <section class="lead-import-panel lead-import-review-panel lead-import-notion-review" data-review-subview="${subview || "overview"}">
      <div class="lead-import-notion-file-row">
        <span class="lead-import-notion-file-icon" aria-hidden="true"><i class="bi bi-file-earmark-spreadsheet"></i></span>
        <div><span>${model.updateImportMode ? "UPDATE BY LEAD ID" : "CREATE NEW LEADS"}</span><strong>${escapeHtml(model.fileName || "Selected file")}</strong><small>${model.rowCount} row${model.rowCount === 1 ? "" : "s"} detected</small></div>
        <button type="button" class="lead-import-notion-text-action" data-action="lead-import-reset">Replace file</button>
      </div>
      ${workspaceStatusMarkup}
      <div class="lead-import-notion-stats" aria-label="Import review summary">
        <span><strong>${model.rowCount}</strong> Rows</span>
        <span><strong>${model.readyCount}</strong> Ready</span>
        <span class="${attentionCount ? "is-warning" : ""}"><strong>${attentionCount}</strong> Need attention</span>
        <span><strong>${model.updateImportMode ? "Update" : "Create"}</strong> · ${model.updateImportMode ? "By Lead ID" : "New leads"}</span>
      </div>
      ${subview === "mapping" ? renderMappingSubview(viewModel) : subview === "warnings" ? renderWarningsSubview(viewModel) : renderReviewOverview(viewModel)}
    </section>
  `;
}
