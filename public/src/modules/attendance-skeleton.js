function skeletonBlock(className = "") {
  return `<span class="attendance-skeleton-block ${className}" aria-hidden="true"></span>`;
}

function skeletonRows(count, className) {
  return Array.from({ length: count }, (_, index) => `
    <div class="${className}" style="--attendance-skeleton-index:${index}" aria-hidden="true">
      ${skeletonBlock("is-cell is-wide")}
      ${skeletonBlock("is-cell")}
      ${skeletonBlock("is-cell")}
      ${skeletonBlock("is-cell is-wide")}
      ${skeletonBlock("is-cell")}
      ${skeletonBlock("is-cell is-short")}
    </div>
  `).join("");
}

function renderTimelineSkeleton() {
  return `
    <section class="attendance-skeleton attendance-skeleton-timeline" aria-busy="true" aria-label="Loading attendance timeline">
      <div class="attendance-skeleton-hero">
        <div>${skeletonBlock("is-clock")}${skeletonBlock("is-date")}</div>
        <div>${skeletonBlock("is-heading")}${skeletonBlock("is-subtitle")}</div>
        <div>${skeletonBlock("is-action")}${skeletonBlock("is-link")}</div>
      </div>
      <div class="attendance-skeleton-metrics">
        <div>${skeletonBlock("is-label")}${skeletonBlock("is-value")}</div>
        <div>${skeletonBlock("is-label")}${skeletonBlock("is-value")}</div>
      </div>
      <div class="attendance-skeleton-section">
        ${skeletonBlock("is-section-title")}
        ${skeletonRows(3, "attendance-skeleton-break-row")}
      </div>
      <div class="attendance-skeleton-section is-table">
        ${skeletonBlock("is-section-title")}
        ${skeletonRows(4, "attendance-skeleton-table-row")}
      </div>
    </section>
  `;
}

function renderTeamSkeleton() {
  return `
    <section class="attendance-skeleton attendance-skeleton-team" aria-busy="true" aria-label="Loading team attendance">
      <div class="attendance-skeleton-toolbar">
        <div>${skeletonBlock("is-heading")}${skeletonBlock("is-subtitle")}</div>
        <div>${skeletonBlock("is-search")}${skeletonBlock("is-button")}${skeletonBlock("is-button")}</div>
      </div>
      <div class="attendance-skeleton-kpis">
        ${Array.from({ length: 4 }, () => `<div>${skeletonBlock("is-label")}${skeletonBlock("is-kpi")}${skeletonBlock("is-subtitle")}</div>`).join("")}
      </div>
      <div class="attendance-skeleton-table">
        <div class="attendance-skeleton-table-head">${Array.from({ length: 6 }, () => skeletonBlock("is-cell")).join("")}</div>
        ${skeletonRows(8, "attendance-skeleton-table-row")}
      </div>
      <div class="attendance-skeleton-footer">${skeletonBlock("is-subtitle")}${skeletonBlock("is-pagination")}</div>
    </section>
  `;
}

function renderRequestsSkeleton() {
  return `
    <section class="attendance-skeleton attendance-skeleton-requests" aria-busy="true" aria-label="Loading attendance requests">
      <div class="attendance-skeleton-toolbar">
        <div>${skeletonBlock("is-heading")}${skeletonBlock("is-subtitle")}</div>
        ${skeletonBlock("is-search")}
      </div>
      <div class="attendance-skeleton-tabs">${skeletonBlock("is-tab")}${skeletonBlock("is-tab")}${skeletonBlock("is-tab")}</div>
      <div class="attendance-skeleton-table">
        <div class="attendance-skeleton-table-head">${Array.from({ length: 6 }, () => skeletonBlock("is-cell")).join("")}</div>
        ${skeletonRows(6, "attendance-skeleton-table-row")}
      </div>
      <div class="attendance-skeleton-footer">${skeletonBlock("is-subtitle")}${skeletonBlock("is-pagination")}</div>
    </section>
  `;
}

function renderPolicySkeleton() {
  return `
    <section class="attendance-skeleton attendance-skeleton-policy" aria-busy="true" aria-label="Loading attendance policy">
      <div class="attendance-skeleton-toolbar">
        <div>${skeletonBlock("is-heading")}${skeletonBlock("is-subtitle")}</div>
        ${skeletonBlock("is-button")}
      </div>
      ${Array.from({ length: 3 }, (_, sectionIndex) => `
        <div class="attendance-skeleton-policy-section">
          ${skeletonBlock("is-section-title")}
          ${skeletonRows(sectionIndex === 2 ? 3 : 3, "attendance-skeleton-policy-row")}
        </div>
      `).join("")}
    </section>
  `;
}

export function renderAttendanceSkeleton(tab = "today") {
  if (tab === "team") return renderTeamSkeleton();
  if (tab === "requests") return renderRequestsSkeleton();
  if (tab === "policy") return renderPolicySkeleton();
  return renderTimelineSkeleton();
}
