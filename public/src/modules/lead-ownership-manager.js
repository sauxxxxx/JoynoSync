function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function memberLabel(member = {}) {
  return String(member.name || member.email || "Team member").trim() || "Team member";
}

function memberInitials(member = {}) {
  return memberLabel(member)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function renderLeadCustomSelect({ name, label, value, options = [], upward = false }) {
  const normalizedValue = String(value ?? "");
  const selected = options.find((option) => String(option.value ?? "") === normalizedValue) || options[0] || {};
  const labelId = `leadOwnership${name}Label`;
  return `
    <div class="lead-export-field">
      <span id="${escapeHtml(labelId)}">${escapeHtml(label)}</span>
      <div class="lead-custom-select${upward ? " is-upward" : ""}" data-lead-custom-select>
        <input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(normalizedValue)}" />
        <button type="button" class="lead-custom-select-trigger" data-lead-custom-select-trigger aria-haspopup="listbox" aria-expanded="false" aria-labelledby="${escapeHtml(labelId)} ${escapeHtml(labelId)}Value">
          <span id="${escapeHtml(labelId)}Value" data-lead-custom-select-label>${escapeHtml(selected.label || "Choose option")}</span>
          <i class="bi bi-chevron-down" aria-hidden="true"></i>
        </button>
        <div class="lead-custom-select-menu" data-lead-custom-select-menu role="listbox" aria-labelledby="${escapeHtml(labelId)}" hidden>
          ${options.map((option) => {
            const optionValue = String(option.value ?? "");
            const isSelected = optionValue === normalizedValue;
            return `
              <button type="button" class="lead-custom-select-option${isSelected ? " is-selected" : ""}" data-lead-custom-select-option data-value="${escapeHtml(optionValue)}" role="option" aria-selected="${isSelected}">
                <span>${escapeHtml(option.label || "Option")}</span>
                <i class="bi bi-check2" aria-hidden="true"></i>
              </button>
            `;
          }).join("")}
        </div>
      </div>
    </div>
  `;
}

export function setupLeadCustomSelects(form) {
  if (!(form instanceof HTMLElement) || form.dataset.leadCustomSelectsBound === "true") return;
  form.dataset.leadCustomSelectsBound = "true";
  form.addEventListener("click", (event) => {
    if (handleLeadCustomSelectClick(event, form)) return;
    if (!event.target.closest?.("[data-lead-custom-select]")) closeLeadCustomSelectMenus(form);
  });
  form.addEventListener("keydown", (event) => {
    handleLeadCustomSelectKeydown(event, form);
  });
}

export function closeLeadCustomSelectMenus(form, except = null) {
  form?.querySelectorAll?.("[data-lead-custom-select]").forEach((select) => {
    if (select === except) return;
    const menu = select.querySelector("[data-lead-custom-select-menu]");
    const trigger = select.querySelector("[data-lead-custom-select-trigger]");
    if (menu instanceof HTMLElement) menu.hidden = true;
    trigger?.setAttribute("aria-expanded", "false");
  });
}

export function handleLeadCustomSelectClick(event, form) {
  const trigger = event.target.closest?.("[data-lead-custom-select-trigger]");
  if (trigger) {
    const select = trigger.closest("[data-lead-custom-select]");
    const menu = select?.querySelector("[data-lead-custom-select-menu]");
    const willOpen = Boolean(menu?.hidden);
    closeLeadCustomSelectMenus(form, select);
    if (menu instanceof HTMLElement) menu.hidden = !willOpen;
    trigger.setAttribute("aria-expanded", String(willOpen));
    if (willOpen) {
      const selectedOption = select?.querySelector("[data-lead-custom-select-option].is-selected")
        || select?.querySelector("[data-lead-custom-select-option]");
      requestAnimationFrame(() => selectedOption?.focus());
    }
    return true;
  }

  const option = event.target.closest?.("[data-lead-custom-select-option]");
  if (!option) return false;
  const select = option.closest("[data-lead-custom-select]");
  const input = select?.querySelector("input[type='hidden']");
  const label = select?.querySelector("[data-lead-custom-select-label]");
  const selectTrigger = select?.querySelector("[data-lead-custom-select-trigger]");
  const value = String(option.dataset.value ?? "");
  if (input instanceof HTMLInputElement) input.value = value;
  if (label) label.textContent = option.textContent.trim();
  select?.querySelectorAll("[data-lead-custom-select-option]").forEach((item) => {
    const isSelected = item === option;
    item.classList.toggle("is-selected", isSelected);
    item.setAttribute("aria-selected", String(isSelected));
  });
  closeLeadCustomSelectMenus(form);
  selectTrigger?.focus();
  input?.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

export function handleLeadCustomSelectKeydown(event, form) {
  const trigger = event.target.closest?.("[data-lead-custom-select-trigger]");
  if (trigger && ["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
    event.preventDefault();
    if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
    return true;
  }
  const option = event.target.closest?.("[data-lead-custom-select-option]");
  if (!option) return false;
  const select = option.closest("[data-lead-custom-select]");
  const options = [...(select?.querySelectorAll("[data-lead-custom-select-option]") || [])];
  const index = options.indexOf(option);
  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? options.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
    options[nextIndex]?.focus();
    return true;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    closeLeadCustomSelectMenus(form);
    select?.querySelector("[data-lead-custom-select-trigger]")?.focus();
    return true;
  }
  return false;
}

export function buildEvenLeadAllocations(total, ownerIds = []) {
  const ids = [...new Set((Array.isArray(ownerIds) ? ownerIds : []).map(String).filter(Boolean))];
  const normalizedTotal = Math.max(0, Math.floor(Number(total) || 0));
  if (!ids.length) return [];
  const base = Math.floor(normalizedTotal / ids.length);
  const remainder = normalizedTotal % ids.length;
  return ids.map((ownerId, index) => ({
    ownerId,
    count: base + (index < remainder ? 1 : 0)
  }));
}

export function getSelectedLeadOwnerIds(form) {
  if (!form?.querySelectorAll) return [];
  return [...form.querySelectorAll("input[name='destinationOwnerMemberIds']:checked")]
    .map((input) => String(input.value || "").trim())
    .filter(Boolean);
}

export function renderLeadOwnerOptions(members = [], selectedSourceId = "") {
  return (Array.isArray(members) ? members : [])
    .filter((member) => String(member?.id || "").trim())
    .map((member) => {
      const id = String(member.id).trim();
      const isSource = id === String(selectedSourceId || "").trim();
      return `
        <label class="lead-owner-option${isSource ? " is-disabled" : ""}">
          <input type="checkbox" name="destinationOwnerMemberIds" value="${escapeHtml(id)}" ${isSource ? "disabled" : ""} />
          <span class="lead-owner-avatar" aria-hidden="true">${escapeHtml(memberInitials(member))}</span>
          <span>${escapeHtml(memberLabel(member))}</span>
          <i class="bi bi-check2" aria-hidden="true"></i>
        </label>
      `;
    })
    .join("");
}

export function renderLeadOwnershipManagerMarkup({
  ownerMembers = [],
  activeMembers = [],
  selectedSourceId = "",
  statuses = []
} = {}) {
  const ownerOptions = [
    { value: "", label: "Choose owner" },
    ...ownerMembers.map((member) => ({ value: member.id, label: memberLabel(member) }))
  ];
  const statusOptions = [
    { value: "all", label: "All statuses" },
    ...[...new Set([...statuses, "Converted"])].map((status) => ({ value: status, label: status }))
  ];
  return `
    <button type="button" class="lead-ownership-unassign-toggle" data-lead-ownership-unassign-toggle>Unassign instead</button>
    <input type="hidden" name="ownershipAction" value="transfer" />
    <div class="modal-body lead-ownership-modal">
      <p class="lead-export-modal__intro">Move matching leads between owners.</p>

      <section class="lead-ownership-section" aria-labelledby="leadOwnershipSourceLabel">
        <h4 id="leadOwnershipSourceLabel">Source</h4>
        <div class="lead-ownership-source-grid">
          ${renderLeadCustomSelect({ name: "sourceOwnerMemberId", label: "Current owner", value: selectedSourceId, options: ownerOptions })}
          ${renderLeadCustomSelect({ name: "leadStatus", label: "Status", value: "New", options: statusOptions })}
          ${renderLeadCustomSelect({
            name: "archiveScope",
            label: "Archive",
            value: "active",
            options: [
              { value: "active", label: "Active only" },
              { value: "archived", label: "Archived only" },
              { value: "all", label: "Active + archived" }
            ]
          })}
        </div>
        <p class="lead-ownership-availability" data-lead-ownership-availability aria-live="polite">Choose a current owner</p>
      </section>

      <section class="lead-ownership-section" aria-labelledby="leadOwnershipSelectionLabel">
        <h4 id="leadOwnershipSelectionLabel">Selection</h4>
        <div class="lead-ownership-amount-grid">
          <label class="lead-ownership-choice">
            <input type="radio" name="amountMode" value="all" checked />
            <span data-lead-ownership-all-label>All matching leads</span>
          </label>
          <label class="lead-ownership-choice">
            <input type="radio" name="amountMode" value="limited" />
            <span>First</span>
            <input class="lead-ownership-limit-input" type="number" name="leadLimit" min="1" max="50000" step="1" value="500" inputmode="numeric" />
            <span>leads</span>
          </label>
        </div>
        <div class="lead-ownership-order-field">
          ${renderLeadCustomSelect({
            name: "leadOrder",
            label: "Order",
            value: "newest_created",
            options: [
              { value: "newest_created", label: "Newest imported first" },
              { value: "oldest_created", label: "Oldest imported first" },
              { value: "newest_updated", label: "Newest updated first" },
              { value: "oldest_updated", label: "Oldest updated first" },
              { value: "random", label: "Random" }
            ]
          })}
        </div>
      </section>

      <section class="lead-ownership-section" data-lead-ownership-destination-section aria-labelledby="leadOwnershipDestinationLabel">
        <h4 id="leadOwnershipDestinationLabel">Destination</h4>
        <span class="lead-ownership-field-label">Owners</span>
        <div class="lead-owner-picker" data-lead-owner-picker>
          <button type="button" class="lead-owner-picker-trigger" data-lead-owner-picker-toggle aria-expanded="false">
            <span data-lead-owner-picker-summary>Choose owners</span>
            <i class="bi bi-chevron-down" aria-hidden="true"></i>
          </button>
          <div class="lead-owner-picker-panel" data-lead-owner-picker-panel hidden>
            ${renderLeadOwnerOptions(activeMembers, selectedSourceId)}
          </div>
        </div>
        <div class="lead-ownership-distribution-field">
          ${renderLeadCustomSelect({
            name: "leadDistribution",
            label: "Distribution",
            value: "even",
            upward: true,
            options: [{ value: "even", label: "Evenly" }]
          })}
        </div>
        <div class="lead-ownership-allocation" data-lead-ownership-allocation></div>
      </section>
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn-secondary" data-action="close-modal">Cancel</button>
      <button type="submit" class="btn btn-accent" data-submit-busy-label="Previewing...">Preview transfer</button>
    </div>
  `;
}

export function syncLeadOwnerPicker(form, members = [], total = 0) {
  const selectedIds = getSelectedLeadOwnerIds(form);
  const memberById = new Map((Array.isArray(members) ? members : []).map((member) => [String(member.id), member]));
  const summary = form?.querySelector?.("[data-lead-owner-picker-summary]");
  if (summary) {
    const visibleIds = selectedIds.slice(0, 2);
    const hiddenCount = selectedIds.length - visibleIds.length;
    summary.innerHTML = visibleIds.length
      ? visibleIds.map((id) => {
        const member = memberById.get(id) || {};
        return `<span class="lead-owner-chip"><span class="lead-owner-avatar">${escapeHtml(memberInitials(member))}</span>${escapeHtml(memberLabel(member))}</span>`;
      }).join("") + (hiddenCount ? `<span class="lead-owner-chip-count">+${hiddenCount}</span>` : "")
      : "Choose owners";
    summary.title = selectedIds.map((id) => memberLabel(memberById.get(id) || {})).join(", ");
  }
  const allocation = form?.querySelector?.("[data-lead-ownership-allocation]");
  if (allocation) {
    const leadCount = Math.max(0, Math.floor(Number(total) || 0));
    allocation.textContent = selectedIds.length
      ? leadCount
        ? `${leadCount.toLocaleString()} leads split evenly across ${selectedIds.length} owners`
        : `${selectedIds.length} ${selectedIds.length === 1 ? "owner" : "owners"} selected`
      : "";
  }
  return selectedIds;
}

export function renderLeadExportOwnerOptions(members = []) {
  return (Array.isArray(members) ? members : [])
    .filter((member) => String(member?.id || "").trim())
    .map((member) => `<option value="${escapeHtml(member.id)}">${escapeHtml(memberLabel(member))}</option>`)
    .join("");
}

export function renderLeadExportFiltersMarkup(members = []) {
  const ownerOptions = [
    { value: "all", label: "All owners" },
    ...(Array.isArray(members) ? members : []).map((member) => ({
      value: member.id,
      label: memberLabel(member)
    }))
  ];
  return `
    ${renderLeadCustomSelect({ name: "leadExportOwner", label: "Owner", value: "all", options: ownerOptions })}
    ${renderLeadCustomSelect({
      name: "leadExportStatus",
      label: "Status",
      value: "all",
      options: ["all", "New", "Contacted", "Qualified", "Unqualified", "Converted"].map((value) => ({
        value,
        label: value === "all" ? "All statuses" : value
      }))
    })}
    ${renderLeadCustomSelect({
      name: "leadExportArchiveScope",
      label: "Archive scope",
      value: "active",
      options: [
        { value: "active", label: "Active leads only" },
        { value: "archived", label: "Archived leads only" },
        { value: "all", label: "Active + archived" }
      ]
    })}
  `;
}
