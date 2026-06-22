function normalizeValue(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

export function buildLeadsListCacheKey(workspaceId, options = {}) {
  return JSON.stringify({
    type: "crm:leads:list",
    workspaceId: normalizeValue(workspaceId),
    currentUserId: normalizeValue(options.currentUserId),
    currentUserEmail: normalizeValue(options.currentUserEmail),
    currentUserName: normalizeValue(options.currentUserName),
    currentUserTeam: normalizeValue(options.currentUserTeam),
    currentUserDepartment: normalizeValue(options.currentUserDepartment),
    currentUserTitle: normalizeValue(options.currentUserTitle),
    currentUserRole: normalizeValue(options.currentUserRole),
    scope: normalizeValue(options.scope),
    statusFilter: normalizeValue(options.statusFilter),
    dateFilter: normalizeValue(options.dateFilter),
    sourceFilter: normalizeValue(options.sourceFilter),
    timezoneFilter: normalizeValue(options.timezoneFilter),
    ownerFilter: normalizeValue(options.ownerFilter),
    searchTerm: normalizeValue(options.searchTerm),
    page: Number(options.page) || 1,
    pageSize: Number(options.pageSize) || 25,
    sortKey: normalizeValue(options.sortKey),
    sortDir: normalizeValue(options.sortDir)
  });
}

export function buildDashboardSnapshotCacheKey(workspaceId, options = {}) {
  return JSON.stringify({
    type: "dashboard:snapshot",
    schema: "command-sections-v3",
    workspaceId: normalizeValue(workspaceId),
    range: normalizeValue(options.range, "30d")
  });
}

export function buildLeadDetailCacheKey(workspaceId, leadId) {
  return JSON.stringify({
    type: "crm:lead:detail",
    workspaceId: normalizeValue(workspaceId),
    leadId: normalizeValue(leadId)
  });
}

export function buildContactDetailCacheKey(workspaceId, contactId) {
  return JSON.stringify({
    type: "crm:contact:detail",
    workspaceId: normalizeValue(workspaceId),
    contactId: normalizeValue(contactId)
  });
}

export function buildAccountDetailCacheKey(workspaceId, accountId) {
  return JSON.stringify({
    type: "crm:account:detail",
    workspaceId: normalizeValue(workspaceId),
    accountId: normalizeValue(accountId)
  });
}

export function buildDealDetailCacheKey(workspaceId, dealId) {
  return JSON.stringify({
    type: "crm:deal:detail",
    workspaceId: normalizeValue(workspaceId),
    dealId: normalizeValue(dealId)
  });
}

export function buildCrmCollectionCacheKey(workspaceId, routeId) {
  return JSON.stringify({
    type: "crm:collection",
    workspaceId: normalizeValue(workspaceId),
    routeId: normalizeValue(routeId)
  });
}

export function buildCallsPerformanceCacheKey(workspaceId, windowMeta = {}) {
  return JSON.stringify({
    type: "calls:performance",
    workspaceId: normalizeValue(workspaceId),
    range: normalizeValue(windowMeta.range),
    startIso: normalizeValue(windowMeta.startIso),
    endIso: normalizeValue(windowMeta.endIso),
    startAt: normalizeValue(windowMeta.startAt),
    endBefore: normalizeValue(windowMeta.endBefore),
    timeZone: normalizeValue(windowMeta.timeZone),
    shiftStart: normalizeValue(windowMeta.shiftStart),
    shiftEnd: normalizeValue(windowMeta.shiftEnd)
  });
}
