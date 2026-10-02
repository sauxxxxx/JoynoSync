const RESULT_PREVIEW_LIMIT = 8;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function normalizeLeadImportResultRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    rowNumber: Number(row?.rowNumber || 0),
    operation: String(row?.operation || "skipped").trim().toLowerCase(),
    leadId: String(row?.leadId || "").trim(),
    leadName: String(row?.leadName || "Unnamed lead").trim() || "Unnamed lead",
    ownerMemberId: String(row?.ownerMemberId || "").trim(),
    ownerName: String(row?.ownerName || "").trim(),
    assigned: Boolean(row?.assigned),
    reasonCode: String(row?.reasonCode || "").trim(),
    reason: String(row?.reason || "").trim()
  }));
}

function renderRows(rows, emptyCopy, mode) {
  if (!rows.length) {
    return `<p class="lead-import-result-empty">${escapeHtml(emptyCopy)}</p>`;
  }
  const visibleRows = rows.slice(0, RESULT_PREVIEW_LIMIT);
  return `
    <ul class="lead-import-result-list">
      ${visibleRows
        .map(
          (row) => `
            <li>
              <span class="lead-import-result-row-number">${escapeHtml(row.rowNumber || "-")}</span>
              <span class="lead-import-result-identity">
                <strong>${escapeHtml(row.leadName)}</strong>
                <small>${escapeHtml(mode === "assigned" ? row.ownerName || "Reserve" : row.reason || "Skipped during validation")}</small>
              </span>
            </li>
          `
        )
        .join("")}
    </ul>
    ${rows.length > RESULT_PREVIEW_LIMIT ? `<p class="lead-import-result-more">${escapeHtml(rows.length - RESULT_PREVIEW_LIMIT)} more in the downloadable report</p>` : ""}
  `;
}

export function renderLeadImportResultSummary(rows) {
  const normalized = normalizeLeadImportResultRows(rows);
  const assigned = normalized.filter((row) => row.assigned && row.ownerName);
  const skipped = normalized.filter((row) => row.operation === "skipped");
  return `
    <section class="lead-import-result-groups ${!assigned.length ? "has-no-assigned" : ""} ${!skipped.length ? "has-no-skipped" : ""}" aria-label="Import row results">
      <article class="lead-import-result-group">
        <div class="lead-import-result-group-head">
          <span><i class="bi bi-people" aria-hidden="true"></i>Assigned leads</span>
          <strong>${escapeHtml(assigned.length)}</strong>
        </div>
        ${renderRows(assigned, "No leads were assigned by this import.", "assigned")}
      </article>
      <article class="lead-import-result-group is-skipped">
        <div class="lead-import-result-group-head">
          <span><i class="bi bi-dash-circle" aria-hidden="true"></i>Skipped rows</span>
          <strong>${escapeHtml(skipped.length)}</strong>
        </div>
        ${renderRows(skipped, "No rows were skipped.", "skipped")}
      </article>
    </section>
  `;
}

export function buildLeadImportResultCsv(rows, csvEscape) {
  const normalized = normalizeLeadImportResultRows(rows);
  return [
    ["Row", "Result", "Lead", "Assigned to", "Lead ID", "Reason code", "Reason"].map(csvEscape).join(","),
    ...normalized.map((row) =>
      [row.rowNumber, row.operation, row.leadName, row.ownerName, row.leadId, row.reasonCode, row.reason]
        .map(csvEscape)
        .join(",")
    )
  ];
}
