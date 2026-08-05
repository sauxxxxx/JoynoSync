import test from "node:test";
import assert from "node:assert/strict";
import { hydrateLeadExportRows } from "../../public/src/modules/lead-export-roundtrip.js";

test("round-trip export hydration preserves owner metadata and adds editable fields", async () => {
  const client = {
    from(table) {
      assert.equal(table, "leads");
      return {
        select() {
          return {
            async in(_column, ids) {
              return {
                data: ids.map((id) => ({ id, notes: `Notes for ${id}`, tags: ["priority"], next_follow_up_date: "2026-08-10" })),
                error: null
              };
            }
          };
        }
      };
    }
  };

  const rows = await hydrateLeadExportRows(client, [{ id: "lead-1", owner: "Joy N." }]);
  assert.deepEqual(rows, [{
    id: "lead-1",
    owner: "Joy N.",
    notes: "Notes for lead-1",
    tags: ["priority"],
    next_follow_up_date: "2026-08-10"
  }]);
});
