const SOURCE_ICONS = {
  Inbound: "bi-box-arrow-in-right",
  Referral: "bi-people",
  Outbound: "bi-send",
  Event: "bi-calendar-event"
};

function renderSegmentButtons(options, selectedValue, action, dataAttribute, escapeText) {
  return options
    .map((option) => {
      const selected = option === selectedValue;
      const icon = SOURCE_ICONS[option] || "bi-circle";
      return `
        <button type="button" class="lead-source-btn ${selected ? "is-active" : ""}"
          data-action="${action}" data-id="${escapeText(option)}" ${dataAttribute}
          aria-pressed="${selected ? "true" : "false"}">
          ${dataAttribute === "data-lead-source" ? `<i class="bi ${icon}" aria-hidden="true"></i>` : ""}
          <span>${escapeText(option)}</span>
        </button>`;
    })
    .join("");
}

export function renderLeadComposerMarkup(model) {
  const {
    isEditing,
    values,
    owner,
    ownerOptionsMarkup,
    sourceOptions,
    statusOptions,
    followUpPreview,
    followUpRelative,
    detailsOpen,
    escapeText
  } = model;
  const submitLabel = isEditing ? "Save lead" : "Create lead";
  const busyLabel = isEditing ? "Saving..." : "Creating...";

  return `
    <section class="lead-compose-shell" aria-labelledby="leadComposeHeading">
      <header class="lead-compose-header">
        <div class="lead-compose-heading">
          <span class="lead-compose-mark" aria-hidden="true"><i class="bi bi-person-plus-fill"></i></span>
          <div>
            <h2 id="leadComposeHeading">${isEditing ? "Edit lead" : "Add lead"}</h2>
            <p>${isEditing ? "Update the lead, ownership, and next move." : "Capture the lead, route ownership, and set the next move."}</p>
          </div>
        </div>
        <div class="lead-compose-header-actions">
          <span class="lead-status-badge"><span>Status:</span><strong>${escapeText(values.status)}</strong></span>
          <button type="button" class="lead-compose-close" data-action="close-modal" aria-label="Close lead dialog">
            <i class="bi bi-x-lg" aria-hidden="true"></i>
          </button>
        </div>
      </header>

      <div class="lead-compose-workspace">
        <section class="lead-compose-details" aria-labelledby="leadDetailsHeading">
          <h3 id="leadDetailsHeading" class="lead-compose-eyebrow">Lead details</h3>
          <label class="form-field lead-name-field">
            <span>Lead name <b aria-hidden="true">*</b></span>
            <input type="text" name="name" required autocomplete="name" value="${escapeText(values.name)}" placeholder="Enter lead name" />
          </label>
          <div class="lead-compose-detail-grid">
            <label class="form-field"><span>Interest</span><input type="text" name="interest" value="${escapeText(values.interest)}" placeholder="Book title or product interest" /></label>
            <label class="form-field"><span>Phone</span><input type="tel" name="phone" autocomplete="tel" inputmode="tel" value="${escapeText(values.phone)}" placeholder="+1 555 000 0000" /></label>
            <label class="form-field lead-company-field"><span>Company <em>(optional)</em></span><input type="text" name="company" autocomplete="organization" value="${escapeText(values.company)}" placeholder="Company name" /></label>
          </div>
          <fieldset class="form-field lead-source-field">
            <legend>How did they find us?</legend>
            <input type="hidden" name="source" value="${escapeText(values.source)}" />
            <div class="lead-source-segment" role="group" aria-label="Lead source">
              ${renderSegmentButtons(sourceOptions, values.source, "lead-compose-source", "data-lead-source", escapeText)}
            </div>
          </fieldset>
        </section>

        <aside class="lead-compose-routing" aria-labelledby="leadRoutingHeading">
          <h3 id="leadRoutingHeading" class="lead-compose-eyebrow">Routing &amp; next move</h3>
          <div class="form-field lead-owner-field">
            <span>Owner</span>
            <div class="task-assignee-control" data-lead-owner-control>
              <input type="hidden" name="owner" value="${escapeText(owner.name)}" />
              <button type="button" class="task-assignee-trigger" data-action="lead-owner-toggle" data-id="toggle" data-lead-owner-trigger aria-haspopup="listbox">
                <span class="task-assignee-avatar" data-lead-owner-avatar>${escapeText(owner.initials)}</span>
                <span class="task-assignee-copy"><strong data-lead-owner-label>${escapeText(owner.name)}</strong><small data-lead-owner-subtitle>${escapeText(owner.meta)}</small></span>
                <i class="bi bi-chevron-down" aria-hidden="true"></i>
              </button>
              <div class="task-assignee-popover" data-lead-owner-popover hidden>
                <label class="task-assignee-search-wrap"><i class="bi bi-search" aria-hidden="true"></i><span class="sr-only">Search owner</span><input type="text" data-lead-owner-search placeholder="Search owner" autocomplete="off" /></label>
                <div class="task-assignee-list" role="listbox">${ownerOptionsMarkup}</div>
              </div>
            </div>
          </div>
          ${isEditing ? `
            <fieldset class="form-field lead-status-field">
              <legend>Status</legend>
              <input type="hidden" name="status" value="${escapeText(values.status)}" />
              <div class="lead-source-segment lead-status-segment" role="group" aria-label="Lead status">
                ${renderSegmentButtons(statusOptions, values.status, "lead-compose-status", "data-lead-status", escapeText)}
              </div>
            </fieldset>` : `<input type="hidden" name="status" value="New" />`}

          <div class="lead-followup-card">
            <span class="lead-followup-label">Next follow-up</span>
            <div class="lead-followup-presets" role="group" aria-label="Follow-up date shortcuts">
              <button type="button" class="lead-followup-chip" data-action="lead-compose-followup-preset" data-id="today" data-lead-followup-preset>Today</button>
              <button type="button" class="lead-followup-chip" data-action="lead-compose-followup-preset" data-id="tomorrow" data-lead-followup-preset>Tomorrow</button>
              <button type="button" class="lead-followup-chip" data-action="lead-compose-followup-preset" data-id="late-week" data-lead-followup-preset>This week</button>
              <button type="button" class="lead-followup-chip" data-action="lead-compose-followup-preset" data-id="custom" data-lead-followup-preset>Custom</button>
            </div>
            <div class="task-deadline-control lead-followup-control" data-lead-followup-control>
              <input type="hidden" name="nextFollowUp" required value="${escapeText(values.nextFollowUp)}" />
              <button type="button" class="task-compose-deadline-preview task-deadline-trigger lead-followup-trigger" data-action="lead-followup-toggle" data-id="toggle" data-lead-followup-trigger aria-haspopup="dialog">
                <i class="bi bi-calendar2-week" aria-hidden="true"></i>
                <span class="lead-followup-trigger-copy"><strong data-lead-followup-relative>${escapeText(followUpRelative)}</strong><small data-lead-followup-preview>${escapeText(followUpPreview)}</small></span>
                <i class="bi bi-chevron-down" aria-hidden="true"></i>
              </button>
              <div class="task-deadline-picker lead-followup-picker" data-lead-followup-picker hidden>
                <div class="task-deadline-picker-main">
                  <div class="task-cal-head">
                    <button type="button" class="task-cal-nav" data-action="lead-followup-nav" data-id="prev" aria-label="Previous month"><i class="bi bi-chevron-left" aria-hidden="true"></i></button>
                    <strong data-lead-followup-month></strong>
                    <button type="button" class="task-cal-nav" data-action="lead-followup-nav" data-id="next" aria-label="Next month"><i class="bi bi-chevron-right" aria-hidden="true"></i></button>
                  </div>
                  <div class="task-cal-week" aria-hidden="true"><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div>
                  <div class="task-cal-grid" data-lead-followup-grid></div>
                </div>
              </div>
            </div>
          </div>
          <label class="lead-task-option">
            <input type="checkbox" name="createFollowUpTask" ${isEditing ? "" : "checked"} />
            <span class="lead-task-option-check" aria-hidden="true"><i class="bi bi-check"></i></span>
            <span><strong>Create a follow-up task</strong><small data-lead-task-owner>Assigned to ${escapeText(owner.name)} after creation</small></span>
          </label>
        </aside>
      </div>

      <section class="lead-duplicate-card" data-lead-duplicate-wrap hidden>
        <div class="lead-duplicate-head">
          <div><p class="task-title">Possible duplicates found</p><p class="task-meta">Review matches before creating another record.</p></div>
          <button type="button" class="mini-btn" data-action="lead-compose-ignore-duplicates" data-id="ignore">${isEditing ? "Save anyway" : "Create anyway"}</button>
        </div>
        <div class="lead-duplicate-list" data-lead-duplicate-list></div>
      </section>

      <section class="lead-more-card">
        <button type="button" class="lead-more-toggle" data-action="lead-compose-more-toggle" data-id="toggle" data-lead-more-toggle aria-expanded="${detailsOpen ? "true" : "false"}">
          <i class="bi bi-card-list" aria-hidden="true"></i>
          <span class="lead-more-copy"><strong>More details</strong><small>Email, secondary phone, role, tags, and notes</small></span>
          <i class="bi bi-chevron-down" aria-hidden="true"></i>
        </button>
        <div class="lead-more-body" data-lead-more-body ${detailsOpen ? "" : "hidden"}>
          <div class="lead-compose-detail-grid">
            <label class="form-field"><span>Email</span><input type="email" name="email" autocomplete="email" value="${escapeText(values.email)}" placeholder="contact@company.com" /></label>
            <label class="form-field"><span>Secondary phone</span><input type="tel" name="secondaryPhone" inputmode="tel" value="${escapeText(values.secondaryPhone)}" placeholder="+1 555 000 0000" /></label>
            <label class="form-field"><span>Role</span><input type="text" name="role" value="${escapeText(values.role)}" placeholder="Decision maker, manager, etc." /></label>
            <label class="form-field"><span>Tags</span><input type="text" name="tags" value="${escapeText(values.tags)}" placeholder="vip, q2, partner" /></label>
          </div>
          <label class="form-field"><span>Notes</span><textarea name="notes" rows="3" placeholder="Context for handoff, next step, objections...">${escapeText(values.notes)}</textarea></label>
        </div>
      </section>

      <footer class="lead-compose-actions">
        <button type="button" class="lead-compose-cancel" data-action="close-modal">Cancel</button>
        <span class="lead-compose-security"><i class="bi bi-shield-check" aria-hidden="true"></i> Saved securely to your workspace</span>
        <button type="submit" class="btn btn-accent lead-compose-submit" data-intent="create" name="submitIntent" value="create" data-submit-default-label="${submitLabel}" data-submit-busy-label="${busyLabel}"><span>${submitLabel}</span><i class="bi bi-arrow-right" aria-hidden="true"></i></button>
      </footer>
    </section>`;
}
