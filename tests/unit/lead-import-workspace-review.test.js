import test from "node:test";
import assert from "node:assert/strict";
import {
  formatLeadImportWorkspaceError,
  mergeLeadImportWorkspaceReview
} from "../../public/src/modules/lead-import-workspace-review.js";

function row(rowNumber, overrides = {}) {
  return {
    rowNumber,
    result: "ready",
    resultLabel: "Ready",
    duplicateLeadId: "",
    duplicateInFile: false,
    isDuplicateMatch: false,
    issues: [],
    warnings: [],
    values: { leadId: "", ...overrides.values },
    ...overrides
  };
}

test("workspace matches replace the incomplete browser duplicate preview", () => {
  const review = {
    importMode: "new",
    duplicateMode: "skip",
    rows: [row(2), row(3)]
  };
  const merged = mergeLeadImportWorkspaceReview(review, [
    { rowNumber: 2, leadId: "lead-1", leadName: "Existing Lead", archived: false }
  ]);
  assert.equal(merged.rows[0].result, "duplicate");
  assert.equal(merged.rows[0].duplicateLeadId, "lead-1");
  assert.match(merged.rows[0].warnings[0], /Matches existing lead/);
  assert.equal(merged.rows[1].result, "ready");
  assert.deepEqual(merged.summary, { total: 2, ready: 1, update: 0, duplicate: 1, review: 0 });
});

test("update duplicate policy converts a workspace match into an existing-lead update", () => {
  const review = { importMode: "new", duplicateMode: "update", rows: [row(2)] };
  const merged = mergeLeadImportWorkspaceReview(review, [
    { rowNumber: 2, leadId: "lead-1", leadName: "Existing Lead" }
  ], { duplicateMode: "update" });
  assert.equal(merged.rows[0].result, "update");
  assert.equal(merged.summary.update, 1);
});

test("exported updates are blocked when the ID is missing or the record changed", () => {
  const review = {
    importMode: "update-exported",
    duplicateMode: "update",
    rows: [
      row(2, { result: "update", values: { leadId: "missing" } }),
      row(3, { result: "update", values: { leadId: "changed" } }),
      row(4, { result: "update", values: { leadId: "current" } })
    ]
  };
  const merged = mergeLeadImportWorkspaceReview(review, [
    { rowNumber: 3, leadId: "changed", versionMatches: false },
    { rowNumber: 4, leadId: "current", versionMatches: true }
  ]);
  assert.equal(merged.rows[0].result, "review");
  assert.match(merged.rows[0].issues[0], /not found/i);
  assert.equal(merged.rows[1].result, "review");
  assert.match(merged.rows[1].issues[0], /changed after/i);
  assert.equal(merged.rows[2].result, "update");
});

test("workspace review errors preserve useful Supabase diagnostics", () => {
  assert.equal(
    formatLeadImportWorkspaceError({ code: "57014", message: "canceling statement due to statement timeout" }),
    "The workspace check timed out. Try again to resume verification."
  );
  assert.match(
    formatLeadImportWorkspaceError({ details: "Active workspace membership is required." }),
    /refresh the page/i
  );
});
