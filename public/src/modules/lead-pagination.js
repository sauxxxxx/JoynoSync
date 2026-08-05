export function normalizeLeadCursorPageRows(rows, pageSize, direction = "next") {
  const safeRows = Array.isArray(rows) ? rows : [];
  const safePageSize = Math.max(1, Number(pageSize) || 1);
  const pageRows = safeRows.slice(0, safePageSize);
  return String(direction || "next").toLowerCase() === "prev" ? pageRows.reverse() : pageRows;
}

export function hasLeadCursorExtraRow(rows, pageSize) {
  return Array.isArray(rows) && rows.length > Math.max(1, Number(pageSize) || 1);
}

export function isLeadPageTransitionPending({
  requestedPage = 1,
  committedPage = 1,
  rowLoading = false,
  routeLoading = false
} = {}) {
  return Boolean(
    rowLoading ||
    routeLoading ||
    Math.max(1, Number(requestedPage) || 1) !== Math.max(1, Number(committedPage) || 1)
  );
}
