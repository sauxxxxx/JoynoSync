import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLeadImportSheetRows, parseCsvMatrix } from "../../public/src/modules/lead-import-file.js";

test("purchased lead files can contain title rows before their real headers", () => {
  const parsed = normalizeLeadImportSheetRows([
    ["Purchased leads - August"],
    ["Prepared for JoynoSync"],
    ["Full Name", "Phone Number", "Email Address", "Book Title"],
    ["Ada Lovelace", "+1 555 0100", "ada@example.com", "Analytical Engine"]
  ]);
  assert.equal(parsed.headerRowNumber, 3);
  assert.equal(parsed.skippedPreambleRows, 2);
  assert.deepEqual(parsed.headers, ["Full Name", "Phone Number", "Email Address", "Book Title"]);
  assert.equal(parsed.rows.length, 1);
});

test("CSV parsing preserves commas and escaped quotes inside quoted values", () => {
  assert.deepEqual(parseCsvMatrix('Name,Notes\n"Hopper, Grace","Said ""hello"""'), [
    ["Name", "Notes"],
    ["Hopper, Grace", 'Said "hello"']
  ]);
});
