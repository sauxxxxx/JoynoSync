import { escapeHtml } from "./text.js";

export function tableActionMenu(label, items) {
  const rows = items
    .map((item) => {
      if (item.type === "divider") {
        return `<div class="table-menu-divider" role="separator"></div>`;
      }
      const dangerClass = item.danger ? " is-danger" : "";
      const primaryClass = item.primary ? " is-primary" : "";
      const mutedClass = item.muted ? " is-muted" : "";
      const disabledAttr = item.disabled ? "disabled" : "";
      const titleAttr = item.title ? `title="${escapeHtml(item.title)}"` : "";
      const dividerBefore = item.dividerBefore ? `<div class="table-menu-divider" role="separator"></div>` : "";
      const action = escapeHtml(item.action || "");
      const id = escapeHtml(item.id || "");
      const itemLabel = escapeHtml(item.label || "");
      const icon = item.icon ? `<i class="bi ${escapeHtml(item.icon)} table-menu-item-icon" aria-hidden="true"></i>` : "";
      return `${dividerBefore}<button class="table-menu-item${dangerClass}${primaryClass}${mutedClass}" type="button" data-action="${action}" data-id="${id}" ${disabledAttr} ${titleAttr}><span class="table-menu-item-content">${icon}<span>${itemLabel}</span></span></button>`;
    })
    .join("");
  return `
    <details class="table-actions-menu">
      <summary class="table-menu-toggle" aria-label="${escapeHtml(label)}">
        <i class="bi bi-three-dots-vertical" aria-hidden="true"></i>
      </summary>
      <div class="table-actions-dropdown">
        ${rows}
      </div>
    </details>
  `;
}

export function viewSectionHead(title, actionLabel) {
  return `
    <div class="view-section-head">
      <h3 class="block-title">${escapeHtml(title)}</h3>
      <button class="table-ops-columns-btn" type="button" data-action="view-add-record" data-id="create">
        <i class="bi bi-plus-lg" aria-hidden="true"></i>
        <span>${escapeHtml(actionLabel)}</span>
      </button>
    </div>
  `;
}
