import { renderCalendar } from "./views/calendar.js";
import { renderKanban } from "./views/kanban.js";
import {
  renderAccountProfile,
  renderAccounts,
  renderContacts,
  renderDealProfile,
  renderDeals,
  renderLeadProfile,
  renderLeads
} from "./views/crm.js";
import {
  renderAttendance,
  renderCommsCalls,
  renderCommsEmail,
  renderCommsSms,
  renderDashboard,
  renderTeam
} from "./views/extended.js";
import { renderCommsMessenger } from "./views/messenger.js";
import { renderIntegrations } from "./views/integrations.js";
import { renderNotifications } from "./views/notifications.js";
import { renderLeadArchive } from "./views/lead-archive.js";
import {
  renderInviteAcceptance,
  renderLoginView,
  renderTeamMemberProfile
} from "./views/settings.js";
import { renderSettings } from "./views/settings-console.js";

export const defaultRouteId = "dashboard";

export const navSections = [
  {
    title: "Work",
    routes: [
      { id: "dashboard", label: "Dashboard", icon: "bi bi-speedometer2", render: renderDashboard },
      { id: "calendar", label: "Calendar", icon: "bi bi-calendar3", render: renderCalendar },
      { id: "kanban", label: "Tasks", icon: "bi bi-grid-3x2-gap", render: renderKanban }
    ]
  },
  {
    title: "CRM",
    routes: [
      { id: "leads", label: "Leads", icon: "bi bi-person", render: renderLeads },
      { id: "lead-archive", label: "Archived", icon: "bi bi-archive", render: renderLeadArchive, adminOnly: true },
      { id: "contacts", label: "Contacts", icon: "bi bi-person-vcard", render: renderContacts },
      { id: "accounts", label: "Accounts", icon: "bi bi-buildings", render: renderAccounts },
      { id: "deals", label: "Deals", icon: "bi bi-bar-chart", render: renderDeals }
    ]
  },
  {
    title: "Comms",
    routes: [
      { id: "comms-messenger", label: "Messenger", icon: "bi bi-chat-dots", render: renderCommsMessenger },
      { id: "comms-calls", label: "Calls", icon: "bi bi-telephone", render: renderCommsCalls },
      { id: "comms-sms", label: "SMS", icon: "bi bi-chat-text", render: renderCommsSms },
      { id: "comms-email", label: "Email", icon: "bi bi-envelope", render: renderCommsEmail }
    ]
  },
  {
    title: "System",
    routes: [
      { id: "attendance", label: "Attendance", icon: "bi bi-clock-history", render: renderAttendance },
      { id: "team", label: "Team", icon: "bi bi-people", render: renderTeam },
      { id: "integrations", label: "Integrations", icon: "bi bi-puzzle", render: renderIntegrations },
      { id: "settings", label: "Settings", icon: "bi bi-gear", render: renderSettings }
    ]
  }
];

const hiddenRoutes = [
  { id: "login", label: "Sign In", icon: "bi bi-door-open", render: renderLoginView },
  { id: "invite", label: "Accept Invite", icon: "bi bi-person-check", render: renderInviteAcceptance },
  { id: "notifications", label: "Notifications", icon: "bi bi-bell", render: renderNotifications },
  { id: "account-profile", label: "Account Profile", icon: "bi bi-buildings", render: renderAccountProfile },
  { id: "deal-profile", label: "Deal Profile", icon: "bi bi-bar-chart", render: renderDealProfile },
  { id: "lead-profile", label: "Lead Profile", icon: "bi bi-person", render: renderLeadProfile },
  { id: "settings-workspace", label: "Workspace", icon: "bi bi-gear", render: renderSettings },
  { id: "settings-me", label: "Profile", icon: "bi bi-person-circle", render: renderSettings },
  { id: "team-member-profile", label: "Team Member Profile", icon: "bi bi-person-badge", render: renderTeamMemberProfile }
];

function flattenRoutes(routes) {
  return routes.flatMap((route) => [route, ...(route.children ? flattenRoutes(route.children) : [])]);
}

const routeMap = new Map(
  [
    ...navSections.flatMap((section) => flattenRoutes(section.routes).map((route) => [route.id, route])),
    ...hiddenRoutes.map((route) => [route.id, route])
  ]
);

const legacyRouteAliases = new Map([
  ["my-work", "kanban"],
  ["table", "kanban"],
  ["projects", "kanban"]
]);

export function getRoute(routeId) {
  return routeMap.get(routeId) || routeMap.get(defaultRouteId);
}

export function getRouteFromHash(hashValue) {
  const raw = hashValue.replace("#/", "").trim();
  const routeId = raw.split("?")[0].trim();
  const [, queryString = ""] = raw.split("?");
  const query = new URLSearchParams(queryString);
  if (!routeId && (query.get("token") || query.get("invite"))) {
    return "invite";
  }
  if (raw === "communications") {
    return "comms-messenger";
  }
  if (routeId === "communications") {
    return "comms-messenger";
  }
  if (legacyRouteAliases.has(routeId)) {
    return legacyRouteAliases.get(routeId);
  }
  return routeMap.has(routeId) ? routeId : defaultRouteId;
}
