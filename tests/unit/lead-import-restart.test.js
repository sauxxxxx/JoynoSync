import test from "node:test";
import assert from "node:assert/strict";
import { buildLeadImportRestartMeta } from "../../supabase/functions/_shared/lead_import_restart.js";

test("import workflow restart resets the active cycle and preserves its history", () => {
  const attemptHistory = [{ id: "attempt-1", reason: "Call no answer" }];
  const result = buildLeadImportRestartMeta(
    {
      attemptCount: 3,
      attemptHistory,
      lastAttemptAt: "2026-08-10T01:00:00.000Z",
      lastAttemptReason: "Call no answer",
      attemptLimitRemovalState: "pending",
      unqualifiedRemovalState: "pending",
      importRowNumber: 4
    },
    {
      restartedAt: "2026-08-12T02:00:00.000Z",
      restartedByMemberId: "member-1",
      restartedByName: "Remar",
      importJobId: "job-1",
      previousOwnerMemberId: "owner-old",
      nextOwnerMemberId: "owner-new",
      previousStatus: "Contacted",
      previousNextFollowUp: "2026-08-14"
    }
  );

  assert.equal(result.attemptCount, 0);
  assert.deepEqual(result.attemptHistory, []);
  assert.equal(result.lastAttemptAt, "");
  assert.equal(result.lastAttemptReason, "");
  assert.equal(result.attemptLimitRemovalState, "");
  assert.equal(result.unqualifiedRemovalState, "");
  assert.equal(result.lastStatusChangedTo, "New");
  assert.equal(result.importRowNumber, 4);
  assert.deepEqual(result.restartHistory[0].previousAttemptHistory, attemptHistory);
  assert.equal(result.restartHistory[0].previousAttemptCount, 3);
  assert.equal(result.restartHistory[0].previousNextFollowUp, "2026-08-14");
});

test("restart history is append-only across later sales cycles", () => {
  const firstRestart = { restartedAt: "2026-08-01T00:00:00.000Z", previousAttemptCount: 2 };
  const result = buildLeadImportRestartMeta(
    { restartHistory: [firstRestart], attemptCount: 1, attemptHistory: [] },
    { restartedAt: "2026-08-12T00:00:00.000Z", previousStatus: "Contacted" }
  );

  assert.equal(result.restartHistory.length, 2);
  assert.deepEqual(result.restartHistory[0], firstRestart);
  assert.equal(result.restartHistory[1].previousAttemptCount, 1);
});
