import { initSupabase } from "./init.js";
import { buildDashboardSnapshotCacheKey } from "../modules/cache-keys.js";
import { fetchAndCacheQuery, invalidateQueryCache, readQueryCache } from "../modules/query-cache.js";

export const DASHBOARD_SNAPSHOT_CACHE_STALE_MS = 1000 * 60;
export const DASHBOARD_SNAPSHOT_CACHE_MAX_AGE_MS = 1000 * 60 * 5;
export const DASHBOARD_SNAPSHOT_RANGE_IDS = ["today", "7d", "30d", "mtd", "qtd"];

function getClient() {
  const services = initSupabase();
  if (!services.configured || !services.client) {
    throw new Error("Supabase is not configured.");
  }
  return services.client;
}

function normalizeText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeDashboardSnapshotRange(value, fallback = "30d") {
  const range = normalizeText(value).toLowerCase();
  return DASHBOARD_SNAPSHOT_RANGE_IDS.includes(range) ? range : fallback;
}

function normalizeIso(value) {
  return normalizeText(value);
}

function normalizeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeInteger(value, fallback = 0, minimum = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Math.max(minimum, fallback);
  }
  return Math.max(minimum, Math.round(numeric));
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function mapKpi(entry, compareLabel = "vs previous period") {
  return {
    value: normalizeNumber(entry?.value, 0),
    baseline: normalizeNumber(entry?.baseline, 1),
    compareLabel: normalizeText(entry?.compareLabel, compareLabel)
  };
}

function mapPipelineStage(entry) {
  return {
    id: normalizeText(entry?.id),
    label: normalizeText(entry?.label),
    count: normalizeInteger(entry?.count, 0, 0),
    value: normalizeNumber(entry?.value, 0)
  };
}

function mapTopDeal(entry) {
  return {
    id: normalizeText(entry?.id),
    account: normalizeText(entry?.account, "No account"),
    contactName: normalizeText(entry?.contactName, "Unknown"),
    value: normalizeNumber(entry?.value, 0),
    stage: normalizeText(entry?.stage),
    closeDate: normalizeText(entry?.closeDate)
  };
}

function mapActivity(entry) {
  return {
    actor: normalizeText(entry?.actor, "System"),
    headline: normalizeText(entry?.headline, "Updated the workspace"),
    createdAt: normalizeIso(entry?.createdAt)
  };
}

function mapDueTask(entry) {
  return {
    id: normalizeText(entry?.id),
    title: normalizeText(entry?.title, "Untitled task"),
    assignee: normalizeText(entry?.assignee, "Unassigned"),
    dueDate: normalizeText(entry?.dueDate),
    status: normalizeText(entry?.status, "New")
  };
}

function mapLeadStatusDistribution(entry) {
  return {
    key: normalizeText(entry?.key),
    label: normalizeText(entry?.label, "Status"),
    count: normalizeInteger(entry?.count, 0, 0),
    color: normalizeText(entry?.color)
  };
}

function mapSalesFunnelStage(entry) {
  return {
    key: normalizeText(entry?.key),
    label: normalizeText(entry?.label, "Stage"),
    count: normalizeInteger(entry?.count, 0, 0),
    tone: normalizeText(entry?.tone)
  };
}

function mapTopRep(entry) {
  return {
    id: normalizeText(entry?.id),
    name: normalizeText(entry?.name, "Unknown"),
    initials: normalizeText(entry?.initials),
    dealsClosed: normalizeInteger(entry?.dealsClosed, 0, 0),
    percent: normalizeInteger(entry?.percent, 0, 0)
  };
}

function mapPipelineTrendPoint(entry) {
  const values = entry?.values && typeof entry.values === "object" ? entry.values : {};
  return {
    key: normalizeText(entry?.key),
    label: normalizeText(entry?.label),
    shortLabel: normalizeText(entry?.shortLabel),
    values: {
      new: normalizeInteger(values.new, 0, 0),
      contacted: normalizeInteger(values.contacted, 0, 0),
      qualified: normalizeInteger(values.qualified, 0, 0),
      won: normalizeInteger(values.won, 0, 0)
    }
  };
}

function mapPipelineTrend(entry) {
  const trend = entry && typeof entry === "object" ? entry : {};
  return {
    points: normalizeArray(trend.points).map(mapPipelineTrendPoint),
    currentStageMovements: normalizeInteger(trend.currentStageMovements, 0, 0),
    previousStageMovements: normalizeInteger(trend.previousStageMovements, 0, 0)
  };
}

export function isDashboardSnapshotCommandReady(snapshot, options = {}) {
  const expectedRange = options?.range ? normalizeDashboardSnapshotRange(options.range, "") : "";
  const snapshotRange = normalizeDashboardSnapshotRange(snapshot?.range, "");
  return Boolean(
    snapshot &&
      typeof snapshot === "object" &&
      snapshot.schemaVersion === "command-sections-v3" &&
      snapshotRange &&
      (!expectedRange || snapshotRange === expectedRange) &&
      Array.isArray(snapshot.leadStatusDistribution) &&
      Array.isArray(snapshot.salesFunnel) &&
      Array.isArray(snapshot.topReps) &&
      snapshot.pipelineTrend &&
      typeof snapshot.pipelineTrend === "object" &&
      Array.isArray(snapshot.pipelineTrend.points) &&
      Array.isArray(snapshot.followUpTasks)
  );
}

function mapSnapshot(data) {
  const snapshot = data && typeof data === "object" ? data : {};
  const dueTasks = snapshot.dueTasks && typeof snapshot.dueTasks === "object" ? snapshot.dueTasks : {};
  const kpis = snapshot.kpis && typeof snapshot.kpis === "object" ? snapshot.kpis : {};
  const range = normalizeDashboardSnapshotRange(snapshot.range, "");
  return {
    schemaVersion: normalizeText(snapshot.schemaVersion, range ? "command-sections-v3" : "command-sections-v2"),
    range,
    rangeLabel: normalizeText(snapshot.rangeLabel),
    compareLabel: normalizeText(snapshot.compareLabel),
    window: snapshot.window && typeof snapshot.window === "object"
      ? {
          startDate: normalizeText(snapshot.window.startDate),
          endDate: normalizeText(snapshot.window.endDate),
          previousStartDate: normalizeText(snapshot.window.previousStartDate),
          previousEndDate: normalizeText(snapshot.window.previousEndDate)
        }
      : null,
    generatedAt: normalizeIso(snapshot.generatedAt),
    quarterLabel: normalizeText(snapshot.quarterLabel),
    kpis: {
      totalLeads: mapKpi(kpis.totalLeads, "vs last month"),
      revenue: mapKpi(kpis.revenue, "vs last month"),
      openDeals: mapKpi(kpis.openDeals, "vs last month"),
      callsToday: mapKpi(kpis.callsToday, "vs yesterday")
    },
    pipelineStages: normalizeArray(snapshot.pipelineStages).map(mapPipelineStage),
    leadStatusDistribution: Array.isArray(snapshot.leadStatusDistribution)
      ? normalizeArray(snapshot.leadStatusDistribution).map(mapLeadStatusDistribution)
      : null,
    salesFunnel: Array.isArray(snapshot.salesFunnel) ? normalizeArray(snapshot.salesFunnel).map(mapSalesFunnelStage) : null,
    topReps: Array.isArray(snapshot.topReps) ? normalizeArray(snapshot.topReps).map(mapTopRep) : null,
    pipelineTrend:
      snapshot.pipelineTrend && typeof snapshot.pipelineTrend === "object" ? mapPipelineTrend(snapshot.pipelineTrend) : null,
    followUpTasks: Array.isArray(snapshot.followUpTasks) ? normalizeArray(snapshot.followUpTasks).map(mapDueTask) : null,
    topDeals: normalizeArray(snapshot.topDeals).map(mapTopDeal),
    recentActivity: normalizeArray(snapshot.recentActivity).map(mapActivity),
    dueTasks: {
      dueTodayCount: normalizeInteger(dueTasks.dueTodayCount, 0, 0),
      items: normalizeArray(dueTasks.items).map(mapDueTask)
    }
  };
}

async function fetchSupabaseDashboardSnapshotFromRpc(range = "30d") {
  const client = getClient();
  const normalizedRange = normalizeDashboardSnapshotRange(range);
  const { data, error } = await client.rpc("get_dashboard_snapshot", { p_range: normalizedRange });
  if (error) {
    throw error;
  }
  return mapSnapshot(data);
}

function normalizeDashboardSnapshotOptions(options = {}) {
  if (typeof options === "string") {
    return { workspaceId: options };
  }
  return options && typeof options === "object" ? options : {};
}

export function readCachedSupabaseDashboardSnapshot(workspaceId, options = {}) {
  const normalizedWorkspaceId = normalizeText(workspaceId);
  if (!normalizedWorkspaceId) {
    return null;
  }
  const range = normalizeDashboardSnapshotRange(options?.range);
  return readQueryCache(buildDashboardSnapshotCacheKey(normalizedWorkspaceId, { range }), {
    staleMs: normalizeInteger(options?.staleMs, DASHBOARD_SNAPSHOT_CACHE_STALE_MS, 0),
    maxAgeMs: normalizeInteger(options?.maxAgeMs, DASHBOARD_SNAPSHOT_CACHE_MAX_AGE_MS, 0)
  });
}

export function invalidateSupabaseDashboardSnapshotCache(workspaceId, options = {}) {
  const normalizedWorkspaceId = normalizeText(workspaceId);
  if (!normalizedWorkspaceId) {
    return;
  }
  const requestedRange = normalizeDashboardSnapshotRange(options?.range, "");
  const ranges = requestedRange ? [requestedRange] : DASHBOARD_SNAPSHOT_RANGE_IDS;
  ranges.forEach((range) => {
    invalidateQueryCache(buildDashboardSnapshotCacheKey(normalizedWorkspaceId, { range }));
  });
}

export async function fetchSupabaseDashboardSnapshot(options = {}) {
  const normalizedOptions = normalizeDashboardSnapshotOptions(options);
  const workspaceId = normalizeText(normalizedOptions.workspaceId);
  const range = normalizeDashboardSnapshotRange(normalizedOptions.range);
  const cacheEnabled = normalizedOptions.cache !== false && Boolean(workspaceId);
  if (!cacheEnabled) {
    return fetchSupabaseDashboardSnapshotFromRpc(range);
  }

  const staleMs = normalizeInteger(normalizedOptions.staleMs, DASHBOARD_SNAPSHOT_CACHE_STALE_MS, 0);
  const maxAgeMs = normalizeInteger(normalizedOptions.maxAgeMs, DASHBOARD_SNAPSHOT_CACHE_MAX_AGE_MS, 0);
  const cached = readCachedSupabaseDashboardSnapshot(workspaceId, { range, staleMs, maxAgeMs });
  if (!normalizedOptions.force && cached?.value && !cached.stale && isDashboardSnapshotCommandReady(cached.value, { range })) {
    return cached.value;
  }

  return fetchAndCacheQuery(buildDashboardSnapshotCacheKey(workspaceId, { range }), () =>
    fetchSupabaseDashboardSnapshotFromRpc(range)
  );
}
