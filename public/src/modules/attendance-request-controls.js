function resolveRequestSection(source) {
  return source?.closest?.(".attendance-requests-notion") || document.querySelector(".attendance-requests-notion");
}

export function syncAttendanceRequestList(source, options = {}) {
  const section = resolveRequestSection(source);
  if (!section) return;

  const activeStatus = String(section.dataset.requestFilter || "pending").toLowerCase();
  const searchInput = section.querySelector("[data-attendance-request-search]");
  const query = String(searchInput?.value || "").trim().toLowerCase();
  const pageSize = Math.max(1, Number(section.dataset.requestPageSize || 8));
  const matchingRows = [];
  let visibleCount = 0;

  section.querySelectorAll("[data-attendance-request-row]").forEach((row) => {
    const matchesStatus = String(row.dataset.status || "pending") === activeStatus;
    const matchesSearch = !query || String(row.dataset.search || "").includes(query);
    if (matchesStatus && matchesSearch) matchingRows.push(row);
    row.hidden = true;
  });

  const pageCount = Math.max(1, Math.ceil(matchingRows.length / pageSize));
  const requestedPage = options.resetPage ? 1 : Math.max(1, Number(section.dataset.requestPage || 1));
  const page = Math.min(requestedPage, pageCount);
  const pageStart = (page - 1) * pageSize;
  matchingRows.slice(pageStart, pageStart + pageSize).forEach((row) => {
    row.hidden = false;
    visibleCount += 1;
  });
  section.dataset.requestPage = String(page);

  section.querySelectorAll("[data-action='attendance-request-filter']").forEach((button) => {
    const isActive = String(button.dataset.id || "") === activeStatus;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  const emptyState = section.querySelector("[data-attendance-request-empty]");
  if (emptyState) emptyState.hidden = visibleCount > 0;

  const countLabel = section.querySelector("[data-attendance-request-count]");
  if (countLabel) {
    const rangeStart = matchingRows.length ? pageStart + 1 : 0;
    const rangeEnd = matchingRows.length ? pageStart + visibleCount : 0;
    countLabel.textContent = `Showing ${rangeStart}-${rangeEnd} of ${matchingRows.length} requests`;
  }

  const pageLabel = section.querySelector("[data-attendance-request-page-label]");
  if (pageLabel) pageLabel.textContent = `${page} / ${pageCount}`;
  const previousButton = section.querySelector("[data-action='attendance-request-page'][data-id='previous']");
  const nextButton = section.querySelector("[data-action='attendance-request-page'][data-id='next']");
  if (previousButton) previousButton.disabled = page <= 1;
  if (nextButton) nextButton.disabled = page >= pageCount;
}

export function setAttendanceRequestFilter(source, status) {
  const section = resolveRequestSection(source);
  if (!section) return;
  section.dataset.requestFilter = ["pending", "approved", "rejected"].includes(String(status || "").toLowerCase())
    ? String(status).toLowerCase()
    : "pending";
  syncAttendanceRequestList(section, { resetPage: true });
}

export function changeAttendanceRequestPage(source, direction) {
  const section = resolveRequestSection(source);
  if (!section) return;
  const currentPage = Math.max(1, Number(section.dataset.requestPage || 1));
  section.dataset.requestPage = String(direction === "previous" ? currentPage - 1 : currentPage + 1);
  syncAttendanceRequestList(section);
}
