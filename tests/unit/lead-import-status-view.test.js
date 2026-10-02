import test from "node:test";
import assert from "node:assert/strict";
import {
  renderLeadImportDoneView,
  renderLeadImportProcessingView
} from "../../public/src/modules/lead-import-status-view.js";

test("processing view exposes background progress without card counters", () => {
  const markup = renderLeadImportProcessingView({
    status: "processing",
    title: "Importing in background",
    subtitle: "The worker is saving rows.",
    label: "Processing",
    fileName: "leads.xlsx",
    rowCount: 4,
    processedCount: 2,
    progressPercent: 50,
    createdCount: 0,
    updatedCount: 2,
    skippedCount: 0,
    assignedCount: 2,
    leftUnassignedCount: 0
  });

  assert.match(markup, /<strong>2<\/strong> of 4 rows processed/);
  assert.match(markup, /aria-valuenow="50"/);
  assert.match(markup, /continue safely in the background/);
  assert.doesNotMatch(markup, /lead-import-progress-card/);
});

test("completed view prioritizes changed leads and row-level results", () => {
  const markup = renderLeadImportDoneView({
    fileName: "exported-leads.xlsx",
    summary: { total: 4, created: 0, updated: 4, assigned: 4, skipped: 0, leftUnassigned: 0 },
    resultSummaryHtml: '<section aria-label="Import row results">Assigned leads</section>'
  });

  assert.match(markup, /4 leads were changed across 4 reviewed rows/);
  assert.match(markup, /Assigned leads/);
  assert.match(markup, /lead-import-complete-icon/);
});
