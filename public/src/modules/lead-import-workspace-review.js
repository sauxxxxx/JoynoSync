function normalizeText(value) {
  return String(value ?? "").trim();
}

export function formatLeadImportWorkspaceError(error) {
  const message = normalizeText(error?.message || error?.details || error?.hint || error);
  if (!message || message === "[object Object]") {
    return "The complete workspace could not be checked. Try again.";
  }
  if (/statement timeout|canceling statement/i.test(message)) {
    return "The workspace check timed out. Try again to resume verification.";
  }
  if (/active workspace membership|workspace context/i.test(message)) {
    return "Your workspace session could not be verified. Refresh the page and sign in again.";
  }
  return message;
}

function withoutWorkspaceMessages(values = []) {
  return (Array.isArray(values) ? values : []).filter((message) => {
    const text = normalizeText(message);
    return !(
      text.startsWith("Matches existing lead:") ||
      text === "Lead will be verified by ID when the import runs." ||
      text === "Lead ID was not found in this workspace." ||
      text === "Lead changed after it was exported. Export it again before updating."
    );
  });
}

function summarize(rows) {
  return rows.reduce(
    (summary, row) => {
      summary.total += 1;
      summary[row.result] += 1;
      return summary;
    },
    { total: 0, ready: 0, update: 0, duplicate: 0, review: 0 }
  );
}

function duplicateLabel(match) {
  const name = normalizeText(match?.leadName) || "Existing lead";
  return `${name}${match?.archived ? " [archived]" : ""}`;
}

function applyUpdateMatch(row, match) {
  const issues = withoutWorkspaceMessages(row.issues);
  const warnings = withoutWorkspaceMessages(row.warnings);
  if (!normalizeText(match?.leadId)) {
    issues.push("Lead ID was not found in this workspace.");
  } else if (match?.versionMatches === false) {
    issues.push("Lead changed after it was exported. Export it again before updating.");
  }
  const blocked = issues.length > 0;
  return {
    ...row,
    result: blocked ? "review" : "update",
    resultLabel: blocked ? "Needs review" : "Update by Lead ID",
    duplicateLeadId: normalizeText(match?.leadId) || normalizeText(row.values?.leadId),
    isDuplicateMatch: Boolean(match?.leadId),
    issues,
    warnings,
    workspaceMatch: match || null
  };
}

function applyNewLeadMatch(row, match, duplicateMode, approvedRows) {
  const issues = withoutWorkspaceMessages(row.issues);
  const warnings = withoutWorkspaceMessages(row.warnings);
  const matchedLeadId = normalizeText(match?.leadId);
  const hasWorkspaceMatch = Boolean(matchedLeadId);
  const duplicateInFile = Boolean(row.duplicateInFile);
  if (!hasWorkspaceMatch) {
    return { ...row, issues, warnings, workspaceMatch: null };
  }

  warnings.push(`Matches existing lead: ${duplicateLabel(match)}.`);
  if (issues.length) {
    return {
      ...row,
      result: "review",
      resultLabel: "Needs review",
      duplicateLeadId: matchedLeadId,
      isDuplicateMatch: true,
      issues,
      warnings,
      workspaceMatch: match
    };
  }
  if (duplicateMode === "update" && !duplicateInFile) {
    return {
      ...row,
      result: "update",
      resultLabel: "Update existing",
      duplicateLeadId: matchedLeadId,
      isDuplicateMatch: true,
      issues,
      warnings,
      workspaceMatch: match
    };
  }
  if (duplicateMode === "create") {
    const approved = approvedRows.has(Number(row.rowNumber));
    return {
      ...row,
      result: approved ? "ready" : "duplicate",
      resultLabel: approved ? "Approved duplicate" : "Approval required",
      duplicateLeadId: matchedLeadId,
      isDuplicateMatch: true,
      issues,
      warnings,
      workspaceMatch: match
    };
  }
  return {
    ...row,
    result: "duplicate",
    resultLabel: "Duplicate",
    duplicateLeadId: matchedLeadId,
    isDuplicateMatch: true,
    issues,
    warnings,
    workspaceMatch: match
  };
}

export function mergeLeadImportWorkspaceReview(review, matches = [], options = {}) {
  const matchByRow = new Map(
    (Array.isArray(matches) ? matches : []).map((match) => [Number(match?.rowNumber || 0), match])
  );
  const updateMode = String(review?.importMode || "") === "update-exported";
  const duplicateMode = String(options.duplicateMode || review?.duplicateMode || "skip");
  const approvedRows = new Set((options.approvedDuplicateRows || []).map(Number));
  const rows = (review?.rows || []).map((row) => {
    const match = matchByRow.get(Number(row.rowNumber || 0)) || null;
    return updateMode
      ? applyUpdateMatch(row, match)
      : applyNewLeadMatch(row, match, duplicateMode, approvedRows);
  });
  return { ...review, rows, summary: summarize(rows) };
}
