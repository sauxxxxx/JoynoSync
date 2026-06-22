import {
  renderCalendar,
  renderKanban,
  renderMyWork,
  renderProjects,
  renderTable
} from "./views/work.js";
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
import {
  renderInviteAcceptance,
  renderLoginView,
  renderMyProfile,
  renderSettings,
  renderTeamMemberProfile,
  renderWorkspaceProfile
} from "./views/settings.js";

export const defaultRouteId = "dashboard";

export const navSections = [
  {
    title: "Work",
    routes: [
      { id: "dashboard", label: "Dashboard", icon: "bi bi-speedometer2", render: renderDashboard },
      { id: "my-work", label: "My Work", icon: "bi bi-grid", render: renderMyWork },
      { id: "calendar", label: "Calendar", icon: "bi bi-calendar3", render: renderCalendar },
      { id: "kanban", label: "Kanban", icon: "bi bi-grid-3x2-gap", render: renderKanban },
      { id: "table", label: "Table", icon: "bi bi-table", render: renderTable },
      { id: "projects", label: "Projects", icon: "bi bi-folder2-open", render: renderProjects }
    ]
  },
  {
    title: "CRM",
    routes: [
      { id: "leads", label: "Leads", icon: "bi bi-person", render: renderLeads },
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
      { id: "settings", label: "Settings", icon: "bi bi-gear", render: renderSettings }
    ]
  }
];

const hiddenRoutes = [
  { id: "login", label: "Sign In", icon: "bi bi-door-open", render: renderLoginView },
  { id: "invite", label: "Accept Invite", icon: "bi bi-person-check", render: renderInviteAcceptance },
  { id: "account-profile", label: "Account Profile", icon: "bi bi-buildings", render: renderAccountProfile },
  { id: "deal-profile", label: "Deal Profile", icon: "bi bi-bar-chart", render: renderDealProfile },
  { id: "lead-profile", label: "Lead Profile", icon: "bi bi-person", render: renderLeadProfile },
  { id: "settings-workspace", label: "Workspace", icon: "bi bi-gear", render: renderWorkspaceProfile },
  { id: "settings-me", label: "Profile", icon: "bi bi-person-circle", render: renderMyProfile },
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
  return routeMap.has(routeId) ? routeId : defaultRouteId;
}
