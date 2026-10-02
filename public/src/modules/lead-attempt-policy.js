const UNQUALIFIED_REASONS = new Set([
  "talk to author, not interested",
  "talked to author, not interested",
  "wrong number",
  "not interested"
]);

export function normalizeLeadAttemptReason(reason) {
  return String(reason || "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function resolveLeadAttemptStatus(currentStatus, reason) {
  const current = String(currentStatus || "").trim() || "New";
  const normalizedReason = normalizeLeadAttemptReason(reason);
  if (normalizedReason === "qualified") {
    return "Qualified";
  }
  if (current === "Unqualified" || UNQUALIFIED_REASONS.has(normalizedReason)) {
    return "Unqualified";
  }
  return current === "New" ? "Contacted" : current;
}
