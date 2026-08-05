import { escapeHtml } from "../utils/text.js";

export const AVAILABLE_INTEGRATIONS = Object.freeze([
  {
    id: "facebook-lead-ads",
    name: "Facebook Lead Ads",
    category: "Lead capture",
    categoryKey: "lead-capture",
    description: "Capture leads from Facebook ads automatically.",
    icon: '<i class="bi bi-facebook" aria-hidden="true"></i>',
    brand: "facebook"
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    category: "Productivity",
    categoryKey: "productivity",
    description: "Sync follow-up tasks and activities with Google Calendar.",
    icon: '<span class="integration-calendar-mark" aria-hidden="true"><small>31</small></span>',
    brand: "calendar"
  },
  {
    id: "google-sheets",
    name: "Google Sheets",
    category: "Data",
    categoryKey: "data",
    description: "Export lead lists and reports to Google Sheets.",
    icon: '<i class="bi bi-file-earmark-spreadsheet-fill" aria-hidden="true"></i>',
    brand: "sheets"
  },
  {
    id: "slack",
    name: "Slack",
    category: "Communication",
    categoryKey: "communication",
    description: "Get lead notifications and updates in your Slack channels.",
    icon: '<i class="bi bi-slack" aria-hidden="true"></i>',
    brand: "slack"
  }
]);

export function renderAvailableIntegrationCards() {
  return AVAILABLE_INTEGRATIONS.map((integration) => `
    <article class="integration-market-card" data-integration-market-card
      data-integration-name="${escapeHtml(integration.name.toLowerCase())}"
      data-integration-category="${escapeHtml(integration.categoryKey)}">
      <div class="integration-market-card-top">
        <div class="integration-market-icon is-${escapeHtml(integration.brand)}">${integration.icon}</div>
        <button class="integration-info-button" type="button" aria-label="About ${escapeHtml(integration.name)}" title="${escapeHtml(integration.description)}">
          <i class="bi bi-info-circle" aria-hidden="true"></i>
        </button>
      </div>
      <div class="integration-market-copy">
        <span>${escapeHtml(integration.category)}</span>
        <h3>${escapeHtml(integration.name)}</h3>
        <p>${escapeHtml(integration.description)}</p>
      </div>
      <button class="integration-coming-soon" type="button" disabled>
        Coming soon
      </button>
    </article>
  `).join("");
}

function updateMarketplaceResults(container) {
  if (!(container instanceof HTMLElement)) return;
  const searchInput = container.querySelector("[data-integration-search]");
  const categorySelect = container.querySelector("[data-integration-category-filter]");
  const query = String(searchInput?.value || "").trim().toLowerCase();
  const category = String(categorySelect?.value || "all").trim();
  let visibleCount = 0;

  container.querySelectorAll("[data-integration-market-card]").forEach((card) => {
    const matchesQuery = !query || String(card.dataset.integrationName || "").includes(query);
    const matchesCategory = category === "all" || card.dataset.integrationCategory === category;
    card.hidden = !(matchesQuery && matchesCategory);
    if (!card.hidden) visibleCount += 1;
  });

  const emptyState = container.querySelector("[data-integration-empty-results]");
  if (emptyState instanceof HTMLElement) emptyState.hidden = visibleCount > 0;
}

export function handleIntegrationMarketplaceFilter(event) {
  if (!(event?.target instanceof Element)) return false;
  if (!event.target.matches("[data-integration-search], [data-integration-category-filter]")) return false;
  updateMarketplaceResults(event.target.closest("[data-integration-marketplace]"));
  return true;
}
