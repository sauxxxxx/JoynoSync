export function renderLeadProfileNotionDrawer(model = {}) {
  const {
    id = "",
    name = "Lead",
    initials = "--",
    avatarHue = 210,
    titleActionMarkup = "",
    interestMarkup = "",
    headerMetaMarkup = "",
    quickActionsMarkup = "",
    moreActionsMarkup = "",
    nextStepMarkup = "",
    activityRows = "",
    auditRows = "",
    detailsMarkup = "",
    attemptMarkup = "",
    notesMarkup = "",
    contactsRows = "",
    dealsRows = ""
  } = model;

  return `
    <section class="lead-profile-drawer-view lead-notion-drawer" data-lead-id="${id}">
      <header class="lead-notion-hero">
        <div class="lead-notion-identity">
          <span class="lead-profile-avatar" style="--lead-avatar-hue:${avatarHue}" aria-hidden="true">${initials}</span>
          <div class="lead-notion-identity-copy">
            <div class="lead-notion-title-row">
              <h4>${name}</h4>
              ${titleActionMarkup}
            </div>
            <div class="lead-record-header-meta">${headerMetaMarkup}</div>
            ${interestMarkup}
          </div>
        </div>
        <div class="lead-notion-actions" aria-label="Lead actions">
          ${quickActionsMarkup}
          ${moreActionsMarkup}
        </div>
      </header>

      ${nextStepMarkup}

      <div class="lead-notion-sections">
        <details class="lead-notion-section" open>
          <summary>
            <span><i class="bi bi-activity" aria-hidden="true"></i>Activity</span>
            <i class="bi bi-chevron-right lead-notion-chevron" aria-hidden="true"></i>
          </summary>
          <div class="lead-notion-section-body">
            <div class="lead-notion-section-actions">
              <span>Calls, emails, notes, and qualification changes appear here.</span>
              <button type="button" class="lead-notion-text-action" data-action="lead-add-note" data-id="${id}">
                <i class="bi bi-plus" aria-hidden="true"></i>Add note
              </button>
            </div>
            <div class="lead-profile-timeline">${activityRows}</div>
            <details class="lead-notion-nested-section">
              <summary>Administrative history</summary>
              <div class="lead-profile-timeline lead-profile-audit-timeline">${auditRows}</div>
            </details>
          </div>
        </details>

        <details class="lead-notion-section" open>
          <summary>
            <span><i class="bi bi-person" aria-hidden="true"></i>Contact &amp; Lead Details</span>
            <i class="bi bi-chevron-right lead-notion-chevron" aria-hidden="true"></i>
          </summary>
          <div class="lead-notion-section-body">
            <div class="lead-record-detail-list lead-notion-detail-grid">${detailsMarkup}</div>
          </div>
        </details>

        ${attemptMarkup}

        <details class="lead-notion-section">
          <summary>
            <span><i class="bi bi-journal-text" aria-hidden="true"></i>Notes</span>
            <i class="bi bi-chevron-right lead-notion-chevron" aria-hidden="true"></i>
          </summary>
          <div class="lead-notion-section-body">
            <div class="lead-notion-section-actions">
              <span>Keep useful context with this lead.</span>
              <button type="button" class="lead-notion-text-action" data-action="lead-add-note" data-id="${id}">
                <i class="bi bi-plus" aria-hidden="true"></i>Add note
              </button>
            </div>
            <div class="lead-record-notes">${notesMarkup}</div>
          </div>
        </details>

        <details class="lead-notion-section">
          <summary>
            <span><i class="bi bi-link-45deg" aria-hidden="true"></i>Related Records</span>
            <i class="bi bi-chevron-right lead-notion-chevron" aria-hidden="true"></i>
          </summary>
          <div class="lead-notion-section-body lead-notion-related-grid">
            <section>
              <p class="lead-notion-subsection-title">Contacts</p>
              <div class="lead-profile-list">${contactsRows}</div>
            </section>
            <section>
              <p class="lead-notion-subsection-title">Deals</p>
              <div class="lead-profile-list">${dealsRows}</div>
            </section>
          </div>
        </details>
      </div>
    </section>
  `;
}
