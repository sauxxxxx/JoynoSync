import test from "node:test";
import assert from "node:assert/strict";

import {
  callOutcomeLabel,
  defaultCallFollowUpAction,
  ringCentralCallErrorMessage,
  validateCallWrapup
} from "../../public/src/modules/call-workflow.js";

const NOW = new Date("2026-08-04T04:00:00.000Z");

test("active call outcomes require a next task", () => {
  const result = validateCallWrapup({
    outcome: "No Answer",
    followUpAction: "none"
  }, NOW);
  assert.equal(result.valid, false);
  assert.equal(result.errors.followUpAction, "Choose the next task for this lead.");
});

test("callback outcomes require a future schedule", () => {
  const result = validateCallWrapup({
    outcome: "Callback Requested",
    notes: "Call again after lunch",
    followUpAction: "callback",
    followUpAt: "2026-08-04T03:00:00.000Z"
  }, NOW);
  assert.equal(result.valid, false);
  assert.equal(result.errors.followUpAt, "The next task must be scheduled in the future.");
});

test("terminal outcomes can close without another task", () => {
  const result = validateCallWrapup({
    outcome: "Wrong Number",
    notes: "Number belongs to another person",
    followUpAction: "none"
  }, NOW);
  assert.equal(result.valid, true);
  assert.equal(result.value.followUpAt, "");
});

test("default follow-up keeps active leads in the queue", () => {
  assert.equal(defaultCallFollowUpAction("Connected"), "task");
  assert.equal(defaultCallFollowUpAction("No Answer"), "callback");
  assert.equal(defaultCallFollowUpAction("Not Interested"), "none");
});

test("call outcomes use agent-friendly labels without changing stored values", () => {
  assert.equal(callOutcomeLabel("Connected"), "Reached — follow-up needed");
  assert.equal(callOutcomeLabel("Voicemail"), "Voicemail left");
  assert.equal(callOutcomeLabel("Busy"), "Busy");
});

test("unmapped RingCentral errors tell the agent what to do", () => {
  assert.equal(
    ringCentralCallErrorMessage(new Error("Your RingCentral extension is not connected.")),
    "Agent extension not mapped. Ask an administrator to map your JoynoSync account to a RingCentral extension."
  );
});
