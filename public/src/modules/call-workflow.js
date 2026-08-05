export const CALL_OUTCOMES = Object.freeze([
  "Connected",
  "No Answer",
  "Voicemail",
  "Busy",
  "Callback Requested",
  "Wrong Number",
  "Not Interested",
  "Qualified",
  "Call Failed"
]);

export const CALL_FOLLOW_UP_ACTIONS = Object.freeze(["none", "task", "callback"]);

const CALL_OUTCOME_LABELS = Object.freeze({
  Connected: "Reached — follow-up needed",
  Voicemail: "Voicemail left"
});

const TERMINAL_OUTCOMES = new Set(["Wrong Number", "Not Interested"]);
const NOTES_REQUIRED_OUTCOMES = new Set([
  "Connected",
  "Callback Requested",
  "Wrong Number",
  "Not Interested",
  "Qualified",
  "Call Failed"
]);

export function normalizeCallOutcome(value, fallback = "Connected") {
  const normalized = String(value || "").trim();
  return CALL_OUTCOMES.includes(normalized) ? normalized : fallback;
}

export function callOutcomeLabel(value) {
  const outcome = normalizeCallOutcome(value, "");
  return CALL_OUTCOME_LABELS[outcome] || outcome;
}

export function ringCentralCallErrorMessage(error) {
  const message = String(error?.message || error || "").trim();
  const normalized = message.toLowerCase();
  if (normalized.includes("extension is not connected") || normalized.includes("telephony identity")) {
    return "Agent extension not mapped. Ask an administrator to map your JoynoSync account to a RingCentral extension.";
  }
  if (normalized.includes("did not answer") || normalized.includes("no answer")) {
    return "RingCentral device did not answer. Open the RingCentral app or check the assigned forwarding device.";
  }
  if (normalized.includes("failed to fetch") || normalized.includes("network")) {
    return "JoynoSync could not reach RingCentral. Check your connection and try the call again.";
  }
  return message || "RingCentral could not start the call. Test the workspace connection and agent mapping.";
}

export function normalizeCallFollowUpAction(value, fallback = "none") {
  const normalized = String(value || "").trim().toLowerCase();
  return CALL_FOLLOW_UP_ACTIONS.includes(normalized) ? normalized : fallback;
}

export function isTerminalCallOutcome(value) {
  return TERMINAL_OUTCOMES.has(normalizeCallOutcome(value));
}

export function callOutcomeRequiresNotes(value) {
  return NOTES_REQUIRED_OUTCOMES.has(normalizeCallOutcome(value));
}

export function defaultCallFollowUpAction(value) {
  const outcome = normalizeCallOutcome(value);
  if (TERMINAL_OUTCOMES.has(outcome)) {
    return "none";
  }
  if (["No Answer", "Voicemail", "Busy", "Callback Requested", "Call Failed"].includes(outcome)) {
    return "callback";
  }
  return "task";
}

export function defaultCallFollowUpAt(value, now = new Date()) {
  const outcome = normalizeCallOutcome(value);
  const base = now instanceof Date && !Number.isNaN(now.getTime()) ? new Date(now) : new Date();
  const next = new Date(base);
  if (["Busy", "Call Failed"].includes(outcome)) {
    next.setMinutes(next.getMinutes() + 30);
  } else if (outcome === "Callback Requested") {
    next.setHours(next.getHours() + 2);
  } else {
    next.setDate(next.getDate() + 1);
    next.setHours(9, 0, 0, 0);
  }
  return next;
}

export function toLocalDateTimeInputValue(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function validateCallWrapup(payload = {}, now = new Date()) {
  const outcome = normalizeCallOutcome(payload.outcome, "");
  const notes = String(payload.notes || "").trim();
  const followUpAction = normalizeCallFollowUpAction(payload.followUpAction);
  const followUpAt = String(payload.followUpAt || "").trim();
  const errors = {};

  if (!outcome) {
    errors.outcome = "Select a call outcome.";
  }
  if (outcome && callOutcomeRequiresNotes(outcome) && notes.length < 3) {
    errors.notes = "Add a short note explaining the call result.";
  }
  if (outcome && !isTerminalCallOutcome(outcome) && followUpAction === "none") {
    errors.followUpAction = "Choose the next task for this lead.";
  }
  if (followUpAction !== "none") {
    const parsed = new Date(followUpAt);
    if (!followUpAt || Number.isNaN(parsed.getTime())) {
      errors.followUpAt = "Choose when the next task is due.";
    } else {
      const reference = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
      if (parsed.getTime() <= reference.getTime()) {
        errors.followUpAt = "The next task must be scheduled in the future.";
      }
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: {
      outcome,
      notes,
      followUpAction,
      followUpAt: followUpAction === "none" ? "" : new Date(followUpAt).toISOString(),
      followUpLocal: followUpAction === "none" ? "" : followUpAt
    }
  };
}
