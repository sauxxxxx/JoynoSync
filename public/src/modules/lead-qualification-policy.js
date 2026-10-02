function normalizeText(value) {
  return String(value || "").trim();
}

export function formatQualificationDuplicateWarning(duplicates = [], leadCount = 1) {
  const matches = Array.isArray(duplicates) ? duplicates : [];
  const affectedLeadIds = new Set(matches.map((match) => normalizeText(match?.leadId)).filter(Boolean));
  const archivedCount = matches.filter((match) => Boolean(match?.archived)).length;
  const reserveCount = matches.filter((match) => match?.activePool === false && !match?.archived).length;
  const qualifiedCount = matches.filter((match) => normalizeText(match?.status).toLowerCase() === "qualified").length;
  const scopeParts = [
    archivedCount ? `${archivedCount} archived` : "",
    reserveCount ? `${reserveCount} reserve` : "",
    qualifiedCount ? `${qualifiedCount} already qualified` : ""
  ].filter(Boolean);
  const matchExamples = [...new Map(
    matches
      .map((match) => {
        const id = normalizeText(match?.duplicateLeadId);
        const name = normalizeText(match?.duplicateLeadName) || "Unnamed lead";
        const status = match?.archived ? "Archived" : normalizeText(match?.status) || "Existing";
        return id ? [id, `${name} (${status})`] : null;
      })
      .filter(Boolean)
  ).values()].slice(0, 3);
  const reviewedLeadCount = Math.max(affectedLeadIds.size, Math.max(1, Number(leadCount) || 1));
  return `${matches.length} possible duplicate${matches.length === 1 ? "" : "s"} found while checking ${reviewedLeadCount} lead${reviewedLeadCount === 1 ? "" : "s"}${scopeParts.length ? ` (${scopeParts.join(", ")})` : ""}.${matchExamples.length ? ` Matches include ${matchExamples.join(", ")}.` : ""} Continue only if these are separate people or opportunities.`;
}
