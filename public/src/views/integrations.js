import { escapeHtml } from "../utils/text.js";
import { renderAvailableIntegrationCards } from "../modules/integration-marketplace.js";

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function formatTimestamp(value, fallback = "Not available") {
  const timestamp = Date.parse(text(value));
  if (!Number.isFinite(timestamp)) return fallback;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp));
}

function statusPresentation(integration) {
  if (integration.connected) return { label: "Active", tone: "connected", icon: "bi-check-circle-fill" };
  if (text(integration.status).toLowerCase() === "needs-attention") {
    return { label: "Needs attention", tone: "warning", icon: "bi-exclamation-circle-fill" };
  }
  if (integration.configured) return { label: "Setup incomplete", tone: "warning", icon: "bi-clock-fill" };
  return { label: "Not connected", tone: "neutral", icon: "bi-circle" };
}

function featuredCapability(icon, title, description) {
  return `
    <div class="integration-featured-capability">
      <span><i class="bi ${escapeHtml(icon)}" aria-hidden="true"></i></span>
      <div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small></div>
    </div>
  `;
}

function setupSteps(activeStep, mappedCount, activeMemberCount) {
  const steps = [
    [1, "Workspace", "Verify service connection"],
    [2, "Agent mapping", `${mappedCount} of ${activeMemberCount} ready`],
    [3, "Call workflow", "Confirm operating rules"]
  ];
  return `
    <nav class="integration-setup-steps" aria-label="RingCentral setup progress">
      ${steps.map(([step, label, detail]) => `
        <button type="button" class="integration-setup-step ${activeStep === step ? "is-active" : ""} ${activeStep > step ? "is-complete" : ""}"
          data-action="integration-step" data-id="${step}" aria-current="${activeStep === step ? "step" : "false"}">
          <span>${activeStep > step ? '<i class="bi bi-check-lg" aria-hidden="true"></i>' : step}</span>
          <span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(detail)}</small></span>
        </button>
      `).join("")}
    </nav>
  `;
}

function connectionFact(label, value, tone = "") {
  return `
    <div class="integration-connection-fact ${tone ? `is-${tone}` : ""}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function renderConnectionStep(integration) {
  const connectionPassed = integration.connected || Boolean(text(integration.testMessage));
  return `
    <section class="integration-wizard-section" aria-labelledby="ringcentralWorkspaceTitle">
      <div class="integration-wizard-heading">
        <p>Step 1 of 3</p>
        <h3 id="ringcentralWorkspaceTitle">Verify workspace connection</h3>
        <span>JoynoSync uses an IT-configured JWT service connection. Agents place calls through their assigned RingCentral devices.</span>
      </div>
      <div class="integration-connection-grid">
        ${connectionFact("Authentication", "JWT service connection")}
        ${connectionFact("RingCentral account", text(integration.accountName, "Current RingCentral account"))}
        ${connectionFact("Service user", text(integration.serviceUser, "Configured service user"))}
        ${connectionFact("Service extension", text(integration.extensionNumber, "Not verified"))}
        ${connectionFact("Call-event webhook", integration.connected ? "Active" : "Created during activation", integration.connected ? "success" : "")}
        ${connectionFact("Connection test", connectionPassed ? "Passed" : "Not tested", connectionPassed ? "success" : "")}
      </div>
      <div class="integration-device-explainer">
        <i class="bi bi-headset" aria-hidden="true"></i>
        <div><strong>RingOut calling</strong><span>The agent's RingCentral desktop app, mobile app, desk phone, or forwarding phone rings first. JoynoSync does not carry browser audio.</span></div>
      </div>
      ${integration.testMessage ? `<p class="integration-inline-success" role="status"><i class="bi bi-check-circle-fill" aria-hidden="true"></i>${escapeHtml(integration.testMessage)}</p>` : ""}
    </section>
  `;
}

function mappingOption(extension, mapping, usedByOtherMember) {
  const label = `${text(extension.displayName, "RingCentral user")} · Ext ${text(extension.extensionNumber, "—")}${extension.directNumber ? ` · ${extension.directNumber}` : ""}`;
  const selected = text(mapping?.providerExtensionRef) === text(extension.id);
  return `<option value="${escapeHtml(text(extension.id))}" ${selected ? "selected" : ""} ${!extension.selectable || usedByOtherMember ? "disabled" : ""}>${escapeHtml(label)}${usedByOtherMember ? " · Already mapped" : ""}</option>`;
}

function renderMappingRows(integration) {
  const members = Array.isArray(integration.teamMembers) ? integration.teamMembers : [];
  const mappings = Array.isArray(integration.mappings) ? integration.mappings : [];
  const extensions = Array.isArray(integration.providerExtensions) ? integration.providerExtensions : [];
  if (!members.length) return `<div class="integration-empty-state">No active workspace agents were found.</div>`;

  return members.map((member) => {
    const mapping = mappings.find((entry) => text(entry.memberId) === text(member.id));
    const mappingReady = Boolean(mapping?.providerExtensionRef && mapping?.extensionNumber);
    return `
      <div class="integration-mapping-row">
        <div class="integration-mapping-agent">
          <span>${escapeHtml(text(member.name, "Team member").slice(0, 2).toUpperCase())}</span>
          <div><strong>${escapeHtml(text(member.name, "Team member"))}</strong><small>${escapeHtml(text(member.role, "Member"))}</small></div>
        </div>
        <label>
          <span class="sr-only">RingCentral extension for ${escapeHtml(text(member.name, "team member"))}</span>
          <select data-integration-mapping-member="${escapeHtml(text(member.id))}" ${integration.canConnect ? "" : "disabled"}>
            <option value="">Select RingCentral user</option>
            ${extensions.map((extension) => mappingOption(
              extension,
              mapping,
              mappings.some((entry) => text(entry.memberId) !== text(member.id) && text(entry.providerExtensionRef) === text(extension.id))
            )).join("")}
          </select>
        </label>
        <div class="integration-mapping-extension">
          <strong>${mappingReady ? `Ext ${escapeHtml(text(mapping.extensionNumber))}` : "—"}</strong>
          <small>${escapeHtml(text(mapping?.directNumber, "No direct number"))}</small>
        </div>
        <span class="integration-mapping-status ${mappingReady ? "is-ready" : "is-unmapped"}">
          <i class="bi ${mappingReady ? "bi-check-circle-fill" : "bi-exclamation-circle-fill"}" aria-hidden="true"></i>
          ${mappingReady ? "Ready" : "Unmapped"}
        </span>
        ${integration.canConnect ? `
          <div class="integration-mapping-actions">
            <button type="button" class="btn btn-light" data-action="integration-save-mapping" data-id="${escapeHtml(text(member.id))}">${mappingReady ? "Update" : "Map"}</button>
            ${mappingReady ? `<button type="button" class="icon-btn" data-action="integration-remove-mapping" data-id="${escapeHtml(text(member.id))}" aria-label="Remove ${escapeHtml(text(member.name))} mapping"><i class="bi bi-x-lg" aria-hidden="true"></i></button>` : ""}
          </div>
        ` : ""}
      </div>
    `;
  }).join("");
}

function renderMappingStep(integration) {
  return `
    <section class="integration-wizard-section" aria-labelledby="ringcentralMappingTitle">
      <div class="integration-wizard-heading is-row">
        <div><p>Step 2 of 3</p><h3 id="ringcentralMappingTitle">Map agent extensions</h3><span>Every calling agent needs one unique, enabled RingCentral user extension.</span></div>
        <span class="integration-mapping-summary"><strong>${Number(integration.mappedCount || 0)}</strong> of ${Number(integration.activeMemberCount || 0)} ready</span>
      </div>
      <div class="integration-mapping-table" role="table" aria-label="JoynoSync agent mappings">
        <div class="integration-mapping-header" role="row"><span>JoynoSync agent</span><span>RingCentral user</span><span>Extension</span><span>Status</span><span></span></div>
        ${renderMappingRows(integration)}
      </div>
      <p class="integration-wizard-note"><i class="bi bi-info-circle" aria-hidden="true"></i>Unmapped agents can use the CRM but cannot start RingCentral calls.</p>
    </section>
  `;
}

function workflowFeature(title, items) {
  return `
    <section class="integration-workflow-feature">
      <h4>${escapeHtml(title)}</h4>
      <ul>${items.map((item) => `<li><i class="bi bi-check2" aria-hidden="true"></i>${escapeHtml(item)}</li>`).join("")}</ul>
    </section>
  `;
}

function policyChoice(name, value, current, title, detail) {
  return `
    <label class="integration-policy-choice ${current === value ? "is-selected" : ""}">
      <input type="radio" name="${escapeHtml(name)}" value="${escapeHtml(value)}" ${current === value ? "checked" : ""}>
      <span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></span>
    </label>
  `;
}

function renderWorkflowStep(integration) {
  const workflow = integration.workflow || {};
  const taskOwnerPolicy = text(workflow.taskOwnerPolicy, "calling-agent");
  const unknownNumberPolicy = text(workflow.unknownNumberPolicy, "unlinked-calls");
  return `
    <section class="integration-wizard-section" aria-labelledby="ringcentralWorkflowTitle">
      <div class="integration-wizard-heading"><p>Step 3 of 3</p><h3 id="ringcentralWorkflowTitle">Confirm the call workflow</h3><span>These rules keep every call attributable, reviewable, and actionable.</span></div>
      <div class="integration-workflow-grid">
        ${workflowFeature("Calling", ["Click-to-call from leads and contacts", "Use the agent's mapped extension", "Ring the agent's RingCentral device first"])}
        ${workflowFeature("Activity", ["Synchronize inbound and outbound calls", "Match calls by normalized phone number", "Update Last Activity automatically", "Send unmatched numbers to Unlinked calls"])}
        ${workflowFeature("After every call", ["Require a call outcome", "Require a future task for active outcomes", "Save notes to lead activity"])}
      </div>
      <div class="integration-policy-grid">
        <fieldset><legend>Default task owner</legend>
          ${policyChoice("ringcentralTaskOwner", "calling-agent", taskOwnerPolicy, "Calling agent", "Keep the next step with the person who placed the call.")}
          ${policyChoice("ringcentralTaskOwner", "lead-owner", taskOwnerPolicy, "Lead owner", "Return follow-up responsibility to the CRM owner.")}
        </fieldset>
        <fieldset><legend>Unknown phone numbers</legend>
          ${policyChoice("ringcentralUnknownNumber", "unlinked-calls", unknownNumberPolicy, "Send to Unlinked calls", "Review the caller before creating or linking a lead.")}
          ${policyChoice("ringcentralUnknownNumber", "confirm-create", unknownNumberPolicy, "Create after confirmation", "Ask the agent before creating a new lead.")}
        </fieldset>
        <fieldset><legend>Multiple matching leads</legend>
          ${policyChoice("ringcentralMultipleMatch", "manual-selection", "manual-selection", "Require manual selection", "Never attach a call when the phone match is ambiguous.")}
        </fieldset>
      </div>
    </section>
  `;
}

function wizardFooter(integration, step) {
  const pending = Boolean(text(integration.pendingAction));
  if (step === 1) return `
    <button class="btn btn-light" type="button" data-action="integration-test" ${pending ? "disabled" : ""}><i class="bi bi-shield-check" aria-hidden="true"></i>Test connection</button>
    <button class="btn btn-primary" type="button" data-action="integration-step" data-id="2">Continue<i class="bi bi-arrow-right" aria-hidden="true"></i></button>
  `;
  if (step === 2) return `
    <button class="btn btn-light" type="button" data-action="integration-step" data-id="1">Back</button>
    <button class="btn btn-primary" type="button" data-action="integration-step" data-id="3">Continue — ${Number(integration.mappedCount || 0)} of ${Number(integration.activeMemberCount || 0)} mapped<i class="bi bi-arrow-right" aria-hidden="true"></i></button>
  `;
  return `
    <button class="btn btn-light" type="button" data-action="integration-step" data-id="2">Back</button>
    <button class="btn btn-primary" type="button" data-action="integration-save-workflow" ${pending || Number(integration.mappedCount || 0) < 1 ? "disabled" : ""}>
      <i class="bi bi-check2-circle" aria-hidden="true"></i>${integration.connected ? "Save configuration" : "Activate RingCentral"}
    </button>
  `;
}

export function renderIntegrations(data, context = {}) {
  const source = context.ringCentralIntegration && typeof context.ringCentralIntegration === "object" ? context.ringCentralIntegration : {};
  const currentRole = text(context.currentUserRole).toLowerCase();
  const integration = {
    ...source,
    canConnect: source.canConnect === true || ["owner", "admin"].includes(currentRole),
    canOperate: source.canOperate === true || ["owner", "admin", "manager"].includes(currentRole)
  };
  const status = statusPresentation(integration);
  const step = Math.min(3, Math.max(1, Number(integration.setupStep || 1)));
  const error = text(integration.error);
  const modalTitle = integration.connected ? "Manage RingCentral" : "Review RingCentral setup";

  return {
    title: "Integrations",
    subtitle: "Connect the services your workspace depends on",
    primaryAction: "",
    showWaitingPanel: false,
    html: `
      <section class="integrations-page" aria-labelledby="integrationsTitle" data-integration-marketplace>
        <header class="integration-page-header">
          <div><h1 id="integrationsTitle">Integrations</h1><p>Connect your favorite tools and streamline your workflow.</p></div>
          <a href="https://developers.ringcentral.com/guide/authentication/jwt-flow" target="_blank" rel="noreferrer">View documentation<i class="bi bi-box-arrow-up-right" aria-hidden="true"></i></a>
        </header>

        <article class="integration-featured-card ${integration.loading ? "is-loading" : ""}" aria-label="RingCentral integration">
          <div class="integration-featured-accent" aria-hidden="true"></div>
          <div class="integration-featured-summary">
            <div class="integration-featured-logo"><img src="/assets/brands/ringcentral-fullcolor.svg" alt="RingCentral"></div>
            <div class="integration-featured-copy">
              <div><h2>RingCentral</h2><span class="integration-status is-${status.tone}"><i class="bi ${status.icon}" aria-hidden="true"></i>${status.label}</span></div>
              <p>RingOut calling with automatic activity and required follow-up.</p>
            </div>
          </div>
          <div class="integration-featured-features" aria-label="RingCentral capabilities">
            ${featuredCapability("bi-telephone-outbound", "Click-to-call", "Start calls from leads and contacts")}
            ${featuredCapability("bi-clock-history", "Automatic call history", "Synchronize call activity")}
            ${featuredCapability("bi-activity", "Automatic Last Activity", "Keep every lead timeline current")}
            ${featuredCapability("bi-list-check", "Required call wrap-up", "Capture an outcome and next task")}
          </div>
          <div class="integration-featured-actions">
            <button class="btn btn-primary" type="button" popovertarget="ringcentralManagePanel" aria-haspopup="dialog" ${integration.loading ? "disabled" : ""}>
              <i class="bi ${integration.connected ? "bi-sliders" : "bi-list-check"}" aria-hidden="true"></i>${integration.connected ? "Manage" : "Review setup"}
            </button>
            <button class="integration-learn-more" type="button" popovertarget="ringcentralManagePanel">Learn more<i class="bi bi-box-arrow-up-right" aria-hidden="true"></i></button>
          </div>
        </article>

        <section class="integration-marketplace" aria-labelledby="availableIntegrationsTitle">
          <header class="integration-marketplace-header">
            <div><h2 id="availableIntegrationsTitle">Available integrations</h2><p>Explore tools planned for the JoynoSync workspace.</p></div>
            <div class="integration-marketplace-filters">
              <label class="integration-marketplace-search"><i class="bi bi-search" aria-hidden="true"></i><input type="search" aria-label="Search integrations" placeholder="Search integrations..." data-integration-search></label>
              <label class="integration-marketplace-category"><select aria-label="Filter integrations by category" data-integration-category-filter><option value="all">All categories</option><option value="lead-capture">Lead capture</option><option value="productivity">Productivity</option><option value="data">Data</option><option value="communication">Communication</option></select><i class="bi bi-chevron-down" aria-hidden="true"></i></label>
            </div>
          </header>
          <div class="integration-marketplace-grid">${renderAvailableIntegrationCards()}</div>
          <div class="integration-marketplace-empty" data-integration-empty-results hidden><i class="bi bi-search" aria-hidden="true"></i><strong>No integrations found</strong><span>Try a different name or category.</span></div>
        </section>

        <aside class="integration-request-banner">
          <div><i class="bi bi-question-circle" aria-hidden="true"></i><span><strong>Can't find the integration you need?</strong><small>Request a new integration and we'll consider adding it.</small></span></div>
          <button class="btn btn-light" type="button" data-action="integration-request">Request integration<i class="bi bi-box-arrow-up-right" aria-hidden="true"></i></button>
        </aside>

        <aside id="ringcentralManagePanel" class="integration-manage-panel integration-setup-modal" popover="auto" role="dialog" aria-modal="true" aria-labelledby="ringcentralPanelTitle">
            <header class="integration-panel-head"><div><p>${integration.connected ? "Active workspace integration" : "JWT + RingOut setup"}</p><h2 id="ringcentralPanelTitle">${escapeHtml(modalTitle)}</h2></div><button class="icon-btn" type="button" popovertarget="ringcentralManagePanel" popovertargetaction="hide" aria-label="Close RingCentral setup"><i class="bi bi-x-lg" aria-hidden="true"></i></button></header>
            ${setupSteps(step, Number(integration.mappedCount || 0), Number(integration.activeMemberCount || 0))}
            <div class="integration-panel-body">
              ${error ? `<div class="integration-alert" role="alert"><i class="bi bi-exclamation-triangle-fill" aria-hidden="true"></i><div><strong>RingCentral needs attention</strong><span>${escapeHtml(error)}</span></div></div>` : ""}
              ${step === 1 ? renderConnectionStep(integration) : step === 2 ? renderMappingStep(integration) : renderWorkflowStep(integration)}
              ${integration.connected ? `<details class="integration-advanced"><summary>Advanced and troubleshooting</summary><div><button class="btn btn-light" type="button" data-action="integration-sync"><i class="bi bi-arrow-repeat" aria-hidden="true"></i>Sync provider data</button>${integration.canConnect ? `<button class="btn btn-light integration-danger-action" type="button" data-action="integration-disconnect"><i class="bi bi-x-circle" aria-hidden="true"></i>Disconnect</button>` : ""}<span>Subscription renews ${escapeHtml(formatTimestamp(integration.expiresAt))}</span></div></details>` : ""}
            </div>
            <footer class="integration-panel-foot integration-wizard-foot"><p><i class="bi bi-shield-check" aria-hidden="true"></i>Credentials stay server-side. This setup never signs an individual agent into RingCentral.</p><div>${wizardFooter(integration, step)}</div></footer>
        </aside>
      </section>
    `
  };
}
