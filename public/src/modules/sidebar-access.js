export function shouldRefreshAccessControlledSidebar({
  canManageArchivedLeads = false,
  hasArchivedLeadRoute = false
} = {}) {
  return Boolean(canManageArchivedLeads) !== Boolean(hasArchivedLeadRoute);
}
