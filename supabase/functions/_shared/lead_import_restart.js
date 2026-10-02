function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function textValue(value) {
  return String(value || "").trim();
}

function attemptCountValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(3, Math.round(numeric))) : 0;
}

export function buildLeadImportRestartMeta(currentMeta, context = {}) {
  const meta = objectValue(currentMeta);
  const restartHistory = arrayValue(meta.restartHistory);
  const previousAttemptHistory = arrayValue(meta.attemptHistory);
  const restartedAt = textValue(context.restartedAt) || new Date().toISOString();

  return {
    ...meta,
    restartHistory: [
      ...restartHistory,
      {
        restartedAt,
        restartedByMemberId: textValue(context.restartedByMemberId),
        restartedByName: textValue(context.restartedByName),
        source: "lead-import",
        importJobId: textValue(context.importJobId),
        previousOwnerMemberId: textValue(context.previousOwnerMemberId),
        nextOwnerMemberId: textValue(context.nextOwnerMemberId),
        previousStatus: textValue(context.previousStatus),
        previousAttemptCount: attemptCountValue(meta.attemptCount),
        previousAttemptHistory,
        previousLastAttemptAt: textValue(meta.lastAttemptAt),
        previousLastAttemptReason: textValue(meta.lastAttemptReason),
        previousNextFollowUp: textValue(context.previousNextFollowUp)
      }
    ],
    attemptCount: 0,
    attemptHistory: [],
    lastAttemptAt: "",
    lastAttemptReason: "",
    attemptLimitAt: "",
    attemptLimitRemovalDueAt: "",
    attemptLimitRemovalState: "",
    attemptLimitRemovedFromActiveAt: "",
    attemptLimitRemovedFromActiveReason: "",
    unqualifiedAt: "",
    unqualifiedRemovalDueAt: "",
    unqualifiedRemovalState: "",
    removedFromActiveAt: "",
    removedFromActiveReason: "",
    lastStatusChangedAt: restartedAt,
    lastStatusChangedByMemberId: textValue(context.restartedByMemberId),
    lastStatusChangedByName: textValue(context.restartedByName),
    lastStatusChangedFrom: textValue(context.previousStatus),
    lastStatusChangedTo: "New"
  };
}
