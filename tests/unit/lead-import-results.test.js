import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLeadImportResultCsv,
  normalizeLeadImportResultRows,
  renderLeadImportResultSummary
} from "../../public/src/modules/lead-import-results.js";

const rows = [
  {
    rowNumber: 2,
    operation: "created",
    leadId: "lead-1",
    leadName: "Ada Lovelace",
    ownerName: "John Lee",
    assigned: true
  },
  {
    rowNumber: 4,
    operation: "updated",
    leadId: "lead-2",
    leadName: "Katherine Johnson",
    ownerName: "Liz Tyler",
    assigned: true
  },
  {
    rowNumber: 3,
    operation: "skipped",
    leadName: "Grace Hopper",
    reasonCode: "duplicate_match",
    reason: "Matches an existing lead."
  }
];

test("import results retain assignee and skip diagnostics", () => {
  const normalized = normalizeLeadImportResultRows(rows);
  assert.equal(normalized[0].ownerName, "John Lee");
  assert.equal(normalized[2].reasonCode, "duplicate_match");
});

test("import completion summary exposes assigned and skipped lead names", () => {
  const markup = renderLeadImportResultSummary(rows);
  assert.match(markup, /Assigned/);
  assert.match(markup, /Ada Lovelace/);
  assert.match(markup, /Katherine Johnson/);
  assert.match(markup, /Skipped/);
  assert.match(markup, /Grace Hopper/);
});

test("import report includes the assignee and reason fields", () => {
  const csvEscape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const lines = buildLeadImportResultCsv(rows, csvEscape);
  assert.match(lines[0], /Assigned to/);
  assert.match(lines[1], /John Lee/);
  assert.match(lines[3], /duplicate_match/);
});
