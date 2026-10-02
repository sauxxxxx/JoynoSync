const EMPTY_STATES = {
  leads: {
    icon: "bi-people",
    title: "No leads yet",
    description: "Add your first lead to start building your pipeline.",
    actionLabel: "Add Lead",
    secondaryLabel: "Import leads"
  },
  contacts: {
    icon: "bi-person-vcard",
    title: "No contacts yet",
    description: "Add your first contact to keep customer relationships organized.",
    actionLabel: "Add Contact"
  },
  accounts: {
    icon: "bi-buildings",
    title: "No accounts yet",
    description: "Add your first account to build relationships and track opportunities.",
    actionLabel: "Add Account"
  },
  deals: {
    icon: "bi-briefcase",
    title: "No deals yet",
    description: "Add your first deal to begin tracking pipeline progress.",
    actionLabel: "Add Deal"
  }
};

export function renderCrmTableEmptyState(type, colspan) {
  const state = EMPTY_STATES[type] || EMPTY_STATES.leads;
  return `
    <tr class="crm-table-empty-row">
      <td colspan="${Number(colspan) || 1}">
        <div class="crm-table-empty-state" role="status">
          <span class="crm-table-empty-icon" aria-hidden="true">
            <i class="bi ${state.icon}"></i>
          </span>
          <h3>${state.title}</h3>
          <p>${state.description}</p>
          <button class="crm-table-empty-primary" type="button" data-action="view-add-record" data-id="create">
            <i class="bi bi-plus-lg" aria-hidden="true"></i>
            <span>${state.actionLabel}</span>
          </button>
          ${
            state.secondaryLabel
              ? `<button class="crm-table-empty-secondary" type="button" data-action="lead-import-open" data-id="open">${state.secondaryLabel}</button>`
              : ""
          }
        </div>
      </td>
    </tr>
  `;
}
