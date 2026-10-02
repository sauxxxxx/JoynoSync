import test from "node:test";
import assert from "node:assert/strict";
import { resolveLeadAttemptStatus } from "../../public/src/modules/lead-attempt-policy.js";

test("a no-answer attempt moves a New lead to Contacted", () => {
  assert.equal(resolveLeadAttemptStatus("New", "Call no answer"), "Contacted");
});

test("later attempts never regress an existing status to New", () => {
  assert.equal(resolveLeadAttemptStatus("Contacted", "Voicemail left"), "Contacted");
  assert.equal(resolveLeadAttemptStatus("Qualified", "Call no answer"), "Qualified");
});

test("terminal attempt outcomes set the lead to Unqualified", () => {
  assert.equal(resolveLeadAttemptStatus("New", "Wrong number"), "Unqualified");
  assert.equal(resolveLeadAttemptStatus("Contacted", "Not Interested"), "Unqualified");
});

test("qualified call outcomes promote the lead", () => {
  assert.equal(resolveLeadAttemptStatus("Contacted", "Qualified"), "Qualified");
});
