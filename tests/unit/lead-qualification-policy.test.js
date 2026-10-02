import test from "node:test";
import assert from "node:assert/strict";
import { formatQualificationDuplicateWarning } from "../../public/src/modules/lead-qualification-policy.js";

test("duplicate warning calls out archived, reserve, and qualified matches", () => {
  const warning = formatQualificationDuplicateWarning([
    { leadId: "lead-1", duplicateLeadId: "duplicate-1", duplicateLeadName: "Archived Match", archived: true, activePool: false, status: "Archived" },
    { leadId: "lead-1", duplicateLeadId: "duplicate-2", duplicateLeadName: "Reserve Match", archived: false, activePool: false, status: "New" },
    { leadId: "lead-2", duplicateLeadId: "duplicate-3", duplicateLeadName: "Qualified Match", archived: false, activePool: true, status: "Qualified" }
  ], 2);

  assert.match(warning, /3 possible duplicates/);
  assert.match(warning, /1 archived/);
  assert.match(warning, /1 reserve/);
  assert.match(warning, /1 already qualified/);
  assert.match(warning, /Archived Match \(Archived\)/);
});
