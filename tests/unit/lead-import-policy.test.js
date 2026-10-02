import test from "node:test";
import assert from "node:assert/strict";
import {
  LEAD_IMPORT_MODE_NEW,
  LEAD_IMPORT_MODE_UPDATE,
  assertLeadImportFileLimits,
  inferLeadImportMode,
  isJoynoSyncLeadExport,
  resolveImportedStatus,
  validateManualLeadIdentity
} from "../../public/src/modules/lead-import-policy.js";

test("JoynoSync round-trip files require the export signature", () => {
  assert.equal(inferLeadImportMode(["Lead ID", "Updated At", "Lead Name", "Status"]), LEAD_IMPORT_MODE_UPDATE);
  assert.equal(isJoynoSyncLeadExport(["Lead ID", "Updated At", "Lead Name", "Email"]), true);
  assert.equal(inferLeadImportMode(["Lead ID", "Lead Name", "Status"]), LEAD_IMPORT_MODE_NEW);
  assert.equal(inferLeadImportMode(["ID", "Updated At", "Lead Name", "Status"]), LEAD_IMPORT_MODE_NEW);
  assert.equal(inferLeadImportMode(["Lead Name", "Status"]), LEAD_IMPORT_MODE_NEW);
});

test("blank statuses default to New only for new-lead imports", () => {
  assert.deepEqual(resolveImportedStatus("", { mode: LEAD_IMPORT_MODE_NEW }), {
    value: "New",
    provided: false,
    warning: "",
    error: ""
  });
  assert.deepEqual(resolveImportedStatus("", { mode: LEAD_IMPORT_MODE_UPDATE }), {
    value: "",
    provided: false,
    warning: "",
    error: ""
  });
});

test("unknown statuses are blocked instead of silently resetting a lead", () => {
  const result = resolveImportedStatus("Called - no answer", { mode: LEAD_IMPORT_MODE_NEW });
  assert.equal(result.value, "");
  assert.equal(result.provided, false);
  assert.match(result.error, /Unknown status/);
});

test("blank update statuses can be explicitly reset", () => {
  const result = resolveImportedStatus("", { mode: LEAD_IMPORT_MODE_UPDATE, resetBlankStatus: true });
  assert.equal(result.value, "New");
  assert.equal(result.provided, true);
});

test("restart workflow overrides an exported status for every matched lead", () => {
  const result = resolveImportedStatus("Contacted", {
    mode: LEAD_IMPORT_MODE_UPDATE,
    resetBlankStatus: true
  });
  assert.equal(result.value, "New");
  assert.equal(result.provided, true);
});

test("manual leads require a name and a contact identifier", () => {
  assert.deepEqual(validateManualLeadIdentity({ name: "", email: "", phone: "" }), [
    "Lead name is required.",
    "Add at least an email or phone."
  ]);
  assert.deepEqual(validateManualLeadIdentity({ name: "Joy", phone: "+1 555 123 4567" }), []);
});

test("import limits reject oversized files and row sets", () => {
  assert.throws(() => assertLeadImportFileLimits({ size: 10 * 1024 * 1024 + 1 }, 1), /larger than 10 MB/);
  assert.throws(() => assertLeadImportFileLimits({ size: 100 }, 10_001), /more than 10,000 rows/);
});
