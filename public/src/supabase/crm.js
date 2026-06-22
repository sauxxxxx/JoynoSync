import { initSupabase } from "./init.js";
import { invokeSupabaseFunction } from "./functions.js";

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

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeTagArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => normalizeText(item)).filter(Boolean);
}

function normalizeIso(value) {
  return normalizeText(value);
}

function normalizeDateOnly(value) {
  const text = normalizeText(value);
  return text ? text.slice(0, 10) : "";
}

function normalizeNumeric(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeOptionalNumeric(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  if (!text) {
    return null;
  }
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeLeadAttemptCount(value) {
  const numeric = normalizeOptionalNumeric(value);
  if (numeric === null) {
    return 0;
  }
  return Math.max(0, Math.min(3, Math.round(numeric)));
}

function normalizeMeta(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...value };
}

const LEAD_WEEKLY_REMOVAL_TIMEZONE_OFFSET_HOURS = 8;
const LEAD_WEEKLY_REMOVAL_WEEKDAY = 5;
const LEAD_WEEKLY_REMOVAL_CUTOFF_HOUR = 8;
const LEAD_UNQUALIFIED_ATTEMPT_REASONS = new Set([
  "talk to author, not interested",
  "talked to author, not interested",
  "wrong number"
]);
const LEAD_ATTEMPT_HISTORY_OUTCOMES = new Set(["Contacted", "Unqualified"]);

function normalizeLeadAttemptReasonKey(reason) {
  return normalizeText(reason).replace(/\s+/g, " ").toLowerCase();
}

function resolveLeadAttemptHistoryOutcome(entry) {
  const outcome = normalizeText(entry?.outcome);
  if (LEAD_ATTEMPT_HISTORY_OUTCOMES.has(outcome)) {
    return outcome;
  }
  return LEAD_UNQUALIFIED_ATTEMPT_REASONS.has(normalizeLeadAttemptReasonKey(entry?.reason)) ? "Unqualified" : "Contacted";
}

function normalizeLeadWeeklyRemovalState(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === LEAD_WEEKLY_REMOVAL_PENDING || normalized === LEAD_WEEKLY_REMOVAL_REMOVED) {
    return normalized;
  }
  return "";
}

function normalizeLeadWeeklyRemovalDueAt(value) {
  const parsed = Date.parse(String(value || "").trim());
  if (!Number.isFinite(parsed)) {
    return "";
  }
  const offsetMs = LEAD_WEEKLY_REMOVAL_TIMEZONE_OFFSET_HOURS * 60 * 60 * 1000;
  const localDate = new Date(parsed + offsetMs);
  const isFriday = localDate.getUTCDay() === LEAD_WEEKLY_REMOVAL_WEEKDAY;
  const isBeforeCutoff =
    localDate.getUTCHours() < LEAD_WEEKLY_REMOVAL_CUTOFF_HOUR ||
    (
      localDate.getUTCHours() === LEAD_WEEKLY_REMOVAL_CUTOFF_HOUR &&
      localDate.getUTCMinutes() === 0 &&
      localDate.getUTCSeconds() === 0 &&
      localDate.getUTCMilliseconds() === 0
    );
  if (isFriday && isBeforeCutoff) {
    return new Date(
      Date.UTC(
        localDate.getUTCFullYear(),
        localDate.getUTCMonth(),
        localDate.getUTCDate(),
        LEAD_WEEKLY_REMOVAL_CUTOFF_HOUR,
        0,
        0,
        0
      ) - offsetMs
    ).toISOString();
  }
  return new Date(parsed).toISOString();
}

function normalizeLeadWeeklyRemovalMeta(lead) {
  const meta = normalizeMeta(lead?.meta);
  return {
    unqualifiedAt: normalizeIso(meta.unqualifiedAt),
    removalDueAt: normalizeLeadWeeklyRemovalDueAt(meta.unqualifiedRemovalDueAt),
    removalState: normalizeLeadWeeklyRemovalState(meta.unqualifiedRemovalState),
    removedFromActiveAt: normalizeIso(meta.removedFromActiveAt),
    removedFromActiveReason: normalizeText(meta.removedFromActiveReason)
  };
}

function resolveLeadWeeklyRemovalDueAt(referenceValue = new Date().toISOString()) {
  const parsed = Date.parse(String(referenceValue || "").trim());
  const date = Number.isFinite(parsed) ? new Date(parsed) : new Date();
  const localOffsetMs = LEAD_WEEKLY_REMOVAL_TIMEZONE_OFFSET_HOURS * 60 * 60 * 1000;
  const localNow = new Date(date.getTime() + localOffsetMs);
  const localWeekday = localNow.getUTCDay();
  const localHour = localNow.getUTCHours();
  const localMinute = localNow.getUTCMinutes();
  const localSecond = localNow.getUTCSeconds();
  const localMillisecond = localNow.getUTCMilliseconds();
  const daysUntilFriday = (LEAD_WEEKLY_REMOVAL_WEEKDAY - localWeekday + 7) % 7;
  const passedFridayCutoff =
    localWeekday > LEAD_WEEKLY_REMOVAL_WEEKDAY ||
    (
      localWeekday === LEAD_WEEKLY_REMOVAL_WEEKDAY &&
      (
        localHour > LEAD_WEEKLY_REMOVAL_CUTOFF_HOUR ||
        (
          localHour === LEAD_WEEKLY_REMOVAL_CUTOFF_HOUR &&
          (localMinute > 0 || localSecond > 0 || localMillisecond > 0)
        )
      )
    );
  const targetDays = passedFridayCutoff ? daysUntilFriday || 7 : daysUntilFriday;
  return new Date(
    Date.UTC(
      localNow.getUTCFullYear(),
      localNow.getUTCMonth(),
      localNow.getUTCDate() + targetDays,
      LEAD_WEEKLY_REMOVAL_CUTOFF_HOUR,
      0,
      0,
      0
    ) - localOffsetMs
  ).toISOString();
}

function getLeadWeeklyRemovalDueAt(lead) {
  const lifecycle = normalizeLeadWeeklyRemovalMeta(lead);
  if (lifecycle.removalDueAt) {
    return lifecycle.removalDueAt;
  }
  return String(lead?.status || "").trim() === "Unqualified"
    ? resolveLeadWeeklyRemovalDueAt(lifecycle.unqualifiedAt || lead?.updatedAt || lead?.createdAt || new Date().toISOString())
    : "";
}

function isLeadPendingWeeklyRemoval(lead) {
  if (Boolean(lead?.archived) || normalizeIso(lead?.archivedAt)) {
    return false;
  }
  if (String(lead?.status || "").trim() !== "Unqualified") {
    return false;
  }
  const lifecycle = normalizeLeadWeeklyRemovalMeta(lead);
  return lifecycle.removalState !== LEAD_WEEKLY_REMOVAL_REMOVED && Boolean(getLeadWeeklyRemovalDueAt(lead));
}

function isLeadWeeklyRemovalDue(lead, referenceValue = new Date().toISOString()) {
  if (!isLeadPendingWeeklyRemoval(lead)) {
    return false;
  }
  const dueAt = Date.parse(getLeadWeeklyRemovalDueAt(lead));
  const referenceAt = Date.parse(String(referenceValue || "").trim());
  if (!Number.isFinite(dueAt) || !Number.isFinite(referenceAt)) {
    return false;
  }
  return dueAt <= referenceAt;
}

function isLeadPendingAttemptLimitWeeklyRemoval(lead) {
  if (Boolean(lead?.archived) || normalizeIso(lead?.archivedAt)) {
    return false;
  }
  if (!["New", "Contacted"].includes(normalizeText(lead?.status))) {
    return false;
  }
  const meta = normalizeMeta(lead?.meta);
  return normalizeLeadAttemptCount(meta.attemptCount) >= 3;
}

function isLeadPendingFridayRedistribution(lead) {
  if (Boolean(lead?.archived) || normalizeIso(lead?.archivedAt)) {
    return false;
  }
  if (normalizeText(lead?.status) !== "New") {
    return false;
  }
  return !normalizeText(lead?.ownerId);
}

function normalizeDealStage(value) {
  const stage = normalizeText(value, "Prospecting");
  if (stage === "Closed Won") {
    return "Won";
  }
  if (stage === "Closed Lost") {
    return "Lost";
  }
  return stage;
}

function isOpenDealStage(stage) {
  return !["Won", "Lost", "Closed Won", "Closed Lost"].includes(normalizeDealStage(stage));
}

const CRM_SNAPSHOT_PAGE_SIZE = 500;

const LEADS_PAGE_SIZE_FALLBACK = 50;
const LEAD_STATUS_EVENTS_PAGE_SIZE = 500;
const LEAD_STATUS_ACTIVITY_OUTCOMES = ["New", "Contacted", "Qualified", "Unqualified"];
const LEAD_MANAGE_ROLES = new Set(["Owner", "Admin", "Manager"]);
const LEADS_PAGE_ROW_SELECT = [
  "id",
  "workspace_id",
  "account_id",
  "converted_account_id",
  "name",
  "company_name",
  "email",
  "phone",
  "secondary_phone",
  "phone_timezone_bucket",
  "interest",
  "source",
  "status",
  "owner_member_id",
  "next_follow_up_date",
  "created_at",
  "updated_at",
  "archived_at",
  "active_pool",
  "meta"
].join(",");

const LEAD_WEEKLY_REMOVAL_PENDING = "pending";
const LEAD_WEEKLY_REMOVAL_REMOVED = "removed";
const LEAD_WEEKLY_REDISTRIBUTION_REASON = "weekly-friday-redistribution";

function normalizeLeadListScope(value, canManage = false) {
  const scope = normalizeText(value, canManage ? "all" : "mine").toLowerCase();
  if (!canManage) {
    return "mine";
  }
  return ["all", "mine", "unassigned", "assigned"].includes(scope) ? scope : "all";
}

function normalizeLeadOwnerFilter(value, canManage = false) {
  if (!canManage) {
    return "all";
  }
  const normalized = normalizeText(value, "all");
  return normalized || "all";
}

function normalizeLeadStatusFilter(value) {
  const normalized = normalizeText(value, "all");
  return normalized || "all";
}

function normalizeLeadDateFilter(value) {
  const normalized = normalizeText(value, "all").toLowerCase();
  return ["all", "overdue", "today", "tomorrow", "not-set"].includes(normalized) ? normalized : "all";
}

function normalizeLeadTimezoneFilter(value) {
  const normalized = normalizeText(value, "all").toLowerCase();
  return ["all", "eastern", "central", "mountain", "pacific", "unknown"].includes(normalized) ? normalized : "all";
}

function mapLeadTimezoneFilterToStoredValue(value) {
  const normalized = normalizeLeadTimezoneFilter(value);
  if (normalized === "all") {
    return "all";
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function normalizeLeadListSortColumn(value) {
  const key = normalizeText(value);
  if (key === "phone") {
    return "phone";
  }
  if (key === "interest") {
    return "interest";
  }
  if (key === "timezone") {
    return "phone_timezone_bucket";
  }
  if (key === "status") {
    return "status";
  }
  if (key === "owner") {
    return "owner_member_id";
  }
  if (key === "lastTouch") {
    return "updated_at";
  }
  if (key === "nextFollowUp") {
    return "next_follow_up_date";
  }
  return "name";
}

function normalizeLeadListSortDirection(value) {
  const dir = normalizeText(value).toLowerCase();
  return dir === "desc" ? "desc" : "asc";
}

function normalizeLeadCursorComparableValue(sortColumn, value) {
  if (!sortColumn) {
    return "";
  }
  if (["created_at", "updated_at", "next_follow_up_date"].includes(sortColumn)) {
    return normalizeIso(value);
  }
  return normalizeText(value);
}

function escapePostgrestLiteral(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll("\\", "\\\\").replaceAll("\"", '\\"')}"`;
}

export function buildLeadPageCursorFromRow(row, sortKey) {
  const sortColumn = normalizeLeadListSortColumn(sortKey);
  const sortValue = normalizeLeadCursorComparableValue(sortColumn, row?.[sortColumn]);
  const id = normalizeText(row?.id);
  if (!sortValue || !id) {
    return null;
  }
  return {
    sortKey: normalizeText(sortKey),
    sortColumn,
    sortValue,
    id
  };
}

function buildLeadCursorFilterClause(cursor, sortAscending, direction) {
  if (!cursor || !cursor.sortColumn || !cursor.sortValue || !cursor.id) {
    return "";
  }
  const comparator = direction === "prev"
    ? (sortAscending ? "lt" : "gt")
    : (sortAscending ? "gt" : "lt");
  const idComparator = comparator;
  const sortValue = escapePostgrestLiteral(cursor.sortValue);
  const idValue = escapePostgrestLiteral(cursor.id);
  return `${cursor.sortColumn}.${comparator}.${sortValue},and(${cursor.sortColumn}.eq.${sortValue},id.${idComparator}.${idValue})`;
}

function sanitizeLeadSearchTerm(value) {
  return normalizeText(value)
    .replaceAll(",", " ")
    .replaceAll("(", " ")
    .replaceAll(")", " ")
    .replaceAll("%", " ")
    .replaceAll("_", " ")
    .trim();
}

function buildLeadSearchClause(value) {
  const search = sanitizeLeadSearchTerm(value);
  if (!search) {
    return "";
  }
  const escaped = search.replaceAll(".", "\\.");
  const pattern = `%${escaped}%`;
  return [
    `name.ilike.${pattern}`,
    `company_name.ilike.${pattern}`,
    `email.ilike.${pattern}`,
    `phone.ilike.${pattern}`,
    `secondary_phone.ilike.${pattern}`,
    `phone_timezone_bucket.ilike.${pattern}`,
    `interest.ilike.${pattern}`,
    `source.ilike.${pattern}`,
    `status.ilike.${pattern}`,
    `role.ilike.${pattern}`
  ].join(",");
}

function createBaseLeadsQuery(client, workspaceId) {
  return client.from("leads");
}

function applyBaseLeadsFilters(query, workspaceId) {
  return query.eq("workspace_id", workspaceId).is("archived_at", null).neq("status", "Archived").eq("active_pool", true);
}

function applyLeadScopeFilter(query, scope, currentUserId) {
  if (scope === "mine") {
    return currentUserId ? query.eq("owner_member_id", currentUserId) : query.eq("id", "__no_matching_lead__");
  }
  if (scope === "unassigned") {
    return query.is("owner_member_id", null);
  }
  if (scope === "assigned") {
    return query.not("owner_member_id", "is", null);
  }
  return query;
}

function applyLeadOwnerFilter(query, ownerFilter) {
  const normalized = normalizeText(ownerFilter, "all");
  if (!normalized || normalized === "all") {
    return query;
  }
  if (normalized === "unassigned") {
    return query.is("owner_member_id", null);
  }
  return query.eq("owner_member_id", normalized);
}

function applyLeadStatusFilter(query, statusFilter) {
  const normalized = normalizeLeadStatusFilter(statusFilter);
  if (!normalized || normalized === "all") {
    return query;
  }
  return query.eq("status", normalized);
}

function localIsoDate(daysFromNow = 0) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + daysFromNow);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function applyLeadDateFilter(query, dateFilter) {
  const normalized = normalizeLeadDateFilter(dateFilter);
  if (!normalized || normalized === "all") {
    return query;
  }
  if (normalized === "not-set") {
    return query.is("next_follow_up_date", null);
  }
  const today = localIsoDate(0);
  if (normalized === "overdue") {
    return query.not("next_follow_up_date", "is", null).lt("next_follow_up_date", today);
  }
  if (normalized === "today") {
    return query.eq("next_follow_up_date", today);
  }
  if (normalized === "tomorrow") {
    return query.eq("next_follow_up_date", localIsoDate(1));
  }
  return query;
}

function applyLeadTimezoneFilter(query, timezoneFilter) {
  const normalized = normalizeLeadTimezoneFilter(timezoneFilter);
  if (!normalized || normalized === "all") {
    return query;
  }
  return query.eq("phone_timezone_bucket", mapLeadTimezoneFilterToStoredValue(normalized));
}

function applyLeadSearchFilter(query, searchTerm) {
  const clause = buildLeadSearchClause(searchTerm);
  return clause ? query.or(clause) : query;
}

async function fetchAllWorkspaceCrmRows(client, table, workspaceId, orderColumn = "name", options = {}) {
  const records = [];
  let from = 0;
  const selectColumns = normalizeText(options.selectColumns, "*") || "*";
  const ascending = options.ascending !== false;

  while (true) {
    const to = from + CRM_SNAPSHOT_PAGE_SIZE - 1;
    let query = client
      .from(table)
      .select(selectColumns)
      .eq("workspace_id", workspaceId);
    if (table === "leads" && options.activeLeadsOnly !== false) {
      query = query.eq("active_pool", true);
    }
    const { data, error } = await query
      .order(orderColumn, { ascending, nullsFirst: false })
      .order("id", { ascending: true })
      .range(from, to);

    if (error) {
      throw error;
    }

    const page = Array.isArray(data) ? data : [];
    if (!page.length) {
      break;
    }

    records.push(...page);

    if (page.length < CRM_SNAPSHOT_PAGE_SIZE) {
      break;
    }

    from += page.length;
  }

  return records;
}

export async function fetchSupabaseContactsSnapshot(workspaceId, options = {}) {
  const normalizedWorkspaceId = normalizeText(workspaceId);
  if (!normalizedWorkspaceId) {
    return {
      contacts: [],
      accounts: []
    };
  }

  const client = getClient();
  const [contactRows, accountRows] = await Promise.all([
    fetchAllWorkspaceCrmRows(client, "contacts", normalizedWorkspaceId, "name", {
      selectColumns: "*"
    }),
    fetchAllWorkspaceCrmRows(client, "accounts", normalizedWorkspaceId, "name", {
      selectColumns: "*"
    })
  ]);
  const sharedContext = buildCrmSharedContext(options.teamMembers, accountRows, contactRows, []);

  return {
    contacts: contactRows.map((row) => mapContactRow(row, sharedContext)),
    accounts: accountRows.map((row) => mapAccountRow(row, sharedContext))
  };
}

export async function fetchSupabaseAccountsSnapshot(workspaceId, options = {}) {
  const normalizedWorkspaceId = normalizeText(workspaceId);
  if (!normalizedWorkspaceId) {
    return {
      accounts: [],
      contacts: [],
      deals: []
    };
  }

  const client = getClient();
  const [accountRows, contactRows, dealRows] = await Promise.all([
    fetchAllWorkspaceCrmRows(client, "accounts", normalizedWorkspaceId, "name", {
      selectColumns: "*"
    }),
    fetchAllWorkspaceCrmRows(client, "contacts", normalizedWorkspaceId, "name", {
      selectColumns: "*"
    }),
    fetchAllWorkspaceCrmRows(client, "deals", normalizedWorkspaceId, "name", {
      selectColumns: "*"
    })
  ]);
  const sharedContext = buildCrmSharedContext(options.teamMembers, accountRows, contactRows, dealRows);

  return {
    accounts: accountRows.map((row) => mapAccountRow(row, sharedContext)),
    contacts: contactRows.map((row) => mapContactRow(row, sharedContext)),
    deals: dealRows.map((row) => mapDealRow(row, sharedContext))
  };
}

export async function fetchSupabaseDealsSnapshot(workspaceId, options = {}) {
  const normalizedWorkspaceId = normalizeText(workspaceId);
  if (!normalizedWorkspaceId) {
    return {
      deals: [],
      accounts: [],
      contacts: []
    };
  }

  const client = getClient();
  const [dealRows, accountRows, contactRows] = await Promise.all([
    fetchAllWorkspaceCrmRows(client, "deals", normalizedWorkspaceId, "name", {
      selectColumns: "*"
    }),
    fetchAllWorkspaceCrmRows(client, "accounts", normalizedWorkspaceId, "name", {
      selectColumns: "*"
    }),
    fetchAllWorkspaceCrmRows(client, "contacts", normalizedWorkspaceId, "name", {
      selectColumns: "*"
    })
  ]);
  const sharedContext = buildCrmSharedContext(options.teamMembers, accountRows, contactRows, dealRows);

  return {
    deals: dealRows.map((row) => mapDealRow(row, sharedContext)),
    accounts: accountRows.map((row) => mapAccountRow(row, sharedContext)),
    contacts: contactRows.map((row) => mapContactRow(row, sharedContext))
  };
}

function buildMemberNameMap(teamMembers = []) {
  const map = new Map();
  (Array.isArray(teamMembers) ? teamMembers : []).forEach((member) => {
    const id = normalizeText(member?.id);
    const name = normalizeText(member?.name);
    if (id && name) {
      map.set(id, name);
    }
  });
  return map;
}

function resolveOwnerName(ownerMemberId, memberNameMap) {
  const id = normalizeText(ownerMemberId);
  return id ? normalizeText(memberNameMap.get(id)) : "";
}

function mapAccountRow(row, context) {
  const meta = normalizeMeta(row?.meta);
  const id = normalizeText(row?.id);
  const derivedOpenDeals = Number(context.openDealCountByAccountId.get(id) || 0);
  const configuredOpenDeals = normalizeNumeric(meta.openDeals);
  const openDeals = derivedOpenDeals > 0 ? derivedOpenDeals : configuredOpenDeals;
  const primaryContact = context.primaryContactByAccountId.get(id) || null;
  return {
    id,
    workspaceId: normalizeText(row?.workspace_id),
    name: normalizeText(row?.name, "Untitled Account"),
    industry: normalizeText(row?.industry),
    ownerId: normalizeText(row?.owner_member_id),
    owner: resolveOwnerName(row?.owner_member_id, context.memberNameMap),
    openDeals,
    health: normalizeText(row?.health, "Healthy"),
    crmConversationId: normalizeText(row?.crm_conversation_id),
    notes: normalizeText(row?.notes),
    tags: normalizeTagArray(row?.tags),
    arr: normalizeNumeric(meta.arr),
    renewalDate: normalizeDateOnly(meta.renewalDate),
    website: normalizeText(meta.website),
    address: normalizeText(meta.address),
    companySize: normalizeText(meta.companySize),
    primaryContactId: normalizeText(meta.primaryContactId || primaryContact?.id),
    primaryContactName: normalizeText(meta.primaryContactName || primaryContact?.name),
    archived: Boolean(row?.archived_at),
    archivedAt: normalizeIso(row?.archived_at),
    createdAt: normalizeIso(row?.created_at),
    updatedAt: normalizeIso(row?.updated_at),
    meta
  };
}

function mapContactRow(row, context) {
  const meta = normalizeMeta(row?.meta);
  const accountId = normalizeText(row?.account_id);
  return {
    id: normalizeText(row?.id),
    workspaceId: normalizeText(row?.workspace_id),
    accountId,
    account: normalizeText(context.accountNameById.get(accountId) || meta.accountName),
    name: normalizeText(row?.name, "Unnamed Contact"),
    email: normalizeEmail(row?.email),
    phone: normalizeText(row?.phone),
    secondaryPhone: normalizeText(row?.secondary_phone),
    role: normalizeText(row?.role),
    ownerId: normalizeText(row?.owner_member_id),
    owner: resolveOwnerName(row?.owner_member_id, context.memberNameMap),
    preferredChannel: normalizeText(meta.preferredChannel || meta.channel, "Email"),
    followUpDate: normalizeDateOnly(meta.followUpDate),
    department: normalizeText(meta.department),
    linkedin: normalizeText(meta.linkedin),
    timezone: normalizeText(meta.timezone),
    notes: normalizeText(row?.notes),
    tags: normalizeTagArray(row?.tags),
    archived: Boolean(row?.archived_at),
    archivedAt: normalizeIso(row?.archived_at),
    createdAt: normalizeIso(row?.created_at),
    updatedAt: normalizeIso(row?.updated_at),
    meta
  };
}

function mapDealRow(row, context) {
  const meta = normalizeMeta(row?.meta);
  const accountId = normalizeText(row?.account_id);
  const fallbackContact = context.primaryContactByAccountId.get(accountId) || null;
  const contactId = normalizeText(meta.contactId || fallbackContact?.id);
  const contactName = normalizeText(
    meta.contactName || context.contactNameById.get(contactId) || fallbackContact?.name
  );
  return {
    id: normalizeText(row?.id),
    workspaceId: normalizeText(row?.workspace_id),
    accountId,
    account: normalizeText(context.accountNameById.get(accountId) || meta.accountName),
    name: normalizeText(row?.name, "Untitled Deal"),
    stage: normalizeDealStage(row?.stage),
    value: normalizeOptionalNumeric(row?.value_amount),
    currency: normalizeText(row?.currency, "USD"),
    closeDate: normalizeDateOnly(row?.close_date),
    ownerId: normalizeText(row?.owner_member_id),
    owner: resolveOwnerName(row?.owner_member_id, context.memberNameMap),
    crmConversationId: normalizeText(row?.crm_conversation_id),
    contactId,
    contactName,
    notes: normalizeText(row?.notes),
    tags: normalizeTagArray(row?.tags),
    archived: Boolean(row?.archived_at),
    archivedAt: normalizeIso(row?.archived_at),
    createdAt: normalizeIso(row?.created_at),
    updatedAt: normalizeIso(row?.updated_at),
    meta
  };
}

function mapLeadRow(row, context) {
  const meta = normalizeMeta(row?.meta);
  const accountId = normalizeText(row?.account_id || row?.converted_account_id);
  const companyName = normalizeText(row?.company_name || context.accountNameById.get(accountId) || meta.companyName);
  return {
    id: normalizeText(row?.id),
    workspaceId: normalizeText(row?.workspace_id),
    accountId: normalizeText(row?.account_id),
    name: normalizeText(row?.name, "Unnamed Lead"),
    company: companyName,
    email: normalizeEmail(row?.email),
    phone: normalizeText(row?.phone),
    secondaryPhone: normalizeText(row?.secondary_phone),
    phoneTimezoneBucket: normalizeText(row?.phone_timezone_bucket, "Unknown"),
    role: normalizeText(row?.role),
    interest: normalizeText(row?.interest),
    source: normalizeText(row?.source),
    status: normalizeText(row?.status, "New"),
    ownerId: normalizeText(row?.owner_member_id),
    owner: resolveOwnerName(row?.owner_member_id, context.memberNameMap),
    createdById: normalizeText(row?.created_by_member_id),
    createdBy: resolveOwnerName(row?.created_by_member_id, context.memberNameMap),
    updatedById: normalizeText(row?.updated_by_member_id),
    updatedBy: resolveOwnerName(row?.updated_by_member_id, context.memberNameMap),
    nextFollowUp: normalizeDateOnly(row?.next_follow_up_date),
    crmConversationId: normalizeText(row?.crm_conversation_id),
    notes: normalizeText(row?.notes),
    tags: normalizeTagArray(row?.tags),
    convertedAt: normalizeIso(row?.converted_at),
    convertedAccountId: normalizeText(row?.converted_account_id),
    convertedContactId: normalizeText(row?.converted_contact_id),
    convertedDealId: normalizeText(row?.converted_deal_id),
    archived: Boolean(row?.archived_at),
    archivedAt: normalizeIso(row?.archived_at),
    activePool: row?.active_pool !== false,
    createdAt: normalizeIso(row?.created_at),
    updatedAt: normalizeIso(row?.updated_at),
    meta
  };
}

function mapLeadStatusEventRow(row) {
  return {
    id: normalizeText(row?.id),
    workspaceId: normalizeText(row?.workspace_id),
    leadId: normalizeText(row?.lead_id),
    leadName: normalizeText(row?.lead_name, "Lead"),
    fromStatus: normalizeText(row?.from_status),
    outcome: normalizeText(row?.to_status),
    agentId: normalizeText(row?.member_id),
    agentName: normalizeText(row?.member_name, "Unassigned"),
    department: normalizeText(row?.department),
    occurredAt: normalizeIso(row?.occurred_at),
    direction: "Outbound",
    meta: normalizeMeta(row?.meta)
  };
}

function mapLeadShiftActivityRpcRow(row) {
  const occurredAt = normalizeIso(row?.occurred_at || row?.occurredAt);
  return {
    id: normalizeText(row?.id),
    workspaceId: normalizeText(row?.workspace_id || row?.workspaceId),
    leadId: normalizeText(row?.lead_id || row?.leadId),
    leadName: normalizeText(row?.lead_name || row?.leadName, "Lead"),
    fromStatus: normalizeText(row?.from_status || row?.fromStatus),
    outcome: normalizeText(row?.outcome || row?.to_status || row?.toStatus),
    agentId: normalizeText(row?.agent_id || row?.agentId),
    agentName: normalizeText(row?.agent_name || row?.agentName, "Unassigned"),
    department: normalizeText(row?.department),
    occurredAt,
    occurredDate: normalizeDateOnly(row?.occurred_date || row?.occurredDate || occurredAt),
    shiftDate: normalizeDateOnly(row?.shift_date || row?.shiftDate),
    direction: normalizeText(row?.direction, "Outbound"),
    meta: normalizeMeta(row?.meta)
  };
}

function mapLeadStatusFallbackRowToEvent(row, context) {
  const meta = normalizeMeta(row?.meta);
  const status = normalizeText(meta.lastStatusChangedTo || row?.status);
  const timestamp = normalizeIso(meta.lastStatusChangedAt || row?.updated_at);
  const memberId = normalizeText(meta.lastStatusChangedByMemberId || row?.updated_by_member_id);
  const member = memberId ? context.teamMemberById.get(memberId) || null : null;
  return {
    id: normalizeText(row?.id),
    workspaceId: normalizeText(row?.workspace_id),
    leadId: normalizeText(row?.id),
    leadName: normalizeText(row?.name, "Lead"),
    fromStatus: normalizeText(meta.lastStatusChangedFrom),
    outcome: status,
    agentId: memberId,
    agentName:
      normalizeText(member?.name) ||
      normalizeText(meta.lastStatusChangedByName || context.memberNameMap.get(memberId)) ||
      "Unassigned",
    department: normalizeText(member?.team || member?.department),
    occurredAt: timestamp,
    direction: "Outbound",
    meta
  };
}

function mapLeadAttemptHistoryRowToEvents(row, context) {
  const meta = normalizeMeta(row?.meta);
  const attemptHistory = Array.isArray(meta.attemptHistory)
    ? meta.attemptHistory.filter((entry) => entry && typeof entry === "object")
    : [];
  return attemptHistory
    .map((entry) => {
      const occurredAt = normalizeIso(entry?.createdAt);
      if (!occurredAt) {
        return null;
      }
      const actorName = normalizeText(entry?.actor);
      const member = actorName ? context.teamMemberByName.get(actorName.toLowerCase()) || null : null;
      const outcome = resolveLeadAttemptHistoryOutcome(entry);
      return {
        id: normalizeText(entry?.id) || `${normalizeText(row?.id)}:${occurredAt}`,
        workspaceId: normalizeText(row?.workspace_id),
        leadId: normalizeText(row?.id),
        leadName: normalizeText(row?.name, "Lead"),
        fromStatus: normalizeText(row?.status),
        outcome,
        agentId: normalizeText(member?.id),
        agentName: normalizeText(member?.name || actorName, "Unassigned"),
        department: normalizeText(member?.team || member?.department),
        occurredAt,
        direction: "Outbound",
        meta: {
          source: "lead-attempt-history",
          reason: normalizeText(entry?.reason),
          note: normalizeText(entry?.note)
        }
      };
    })
    .filter(Boolean);
}

function isMissingLeadStatusEventsRelation(error) {
  const code = normalizeText(error?.code).toUpperCase();
  const message = normalizeText(error?.message).toLowerCase();
  return code === "42P01" || message.includes("lead_status_events") || message.includes("relation") && message.includes("does not exist");
}

function isMissingCallsPerformanceShiftRpc(error) {
  const code = normalizeText(error?.code).toUpperCase();
  const message = normalizeText(error?.message).toLowerCase();
  return code === "42883" || code === "PGRST202" || message.includes("get_calls_performance_shift_activity");
}

async function fetchLeadShiftActivityFromRpc(client, workspaceId, options = {}) {
  const startAt = normalizeIso(options.startAt);
  const endBefore = normalizeIso(options.endBefore);
  if (!startAt || !endBefore) {
    return [];
  }
  const { data, error } = await client.rpc("get_calls_performance_shift_activity", {
    p_workspace_id: workspaceId,
    p_start_at: startAt,
    p_end_before: endBefore,
    p_time_zone: normalizeText(options.timeZone, "UTC"),
    p_shift_start: normalizeText(options.shiftStart, "09:00"),
    p_shift_end: normalizeText(options.shiftEnd, "18:00")
  });
  if (error) {
    throw error;
  }
  return (Array.isArray(data) ? data : []).map((row) => mapLeadShiftActivityRpcRow(row));
}

async function fetchLeadStatusEventsFromEventTable(client, workspaceId, options = {}) {
  const records = [];
  const startAt = normalizeIso(options.startAt);
  const endBefore = normalizeIso(options.endBefore);
  let from = 0;

  while (true) {
    let query = client
      .from("lead_status_events")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("occurred_at", { ascending: false })
      .range(from, from + LEAD_STATUS_EVENTS_PAGE_SIZE - 1);

    if (startAt) {
      query = query.gte("occurred_at", startAt);
    }
    if (endBefore) {
      query = query.lt("occurred_at", endBefore);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    const page = Array.isArray(data) ? data : [];
    if (!page.length) {
      break;
    }

    records.push(...page);
    if (page.length < LEAD_STATUS_EVENTS_PAGE_SIZE) {
      break;
    }
    from += page.length;
  }

  return records.map((row) => mapLeadStatusEventRow(row));
}

async function fetchLeadStatusEventsFromLeadsFallback(client, workspaceId, options = {}) {
  const memberNameMap = buildMemberNameMap(options.teamMembers);
  const teamMemberById = new Map(
    (Array.isArray(options.teamMembers) ? options.teamMembers : []).map((member) => [normalizeText(member?.id), member])
  );
  const teamMemberByName = new Map(
    (Array.isArray(options.teamMembers) ? options.teamMembers : [])
      .map((member) => {
        const memberName = normalizeText(member?.name).toLowerCase();
        return memberName ? [memberName, member] : null;
      })
      .filter(Boolean)
  );
  const startAt = normalizeIso(options.startAt);
  const endBefore = normalizeIso(options.endBefore);
  const rows = [];
  let from = 0;

  while (true) {
    let query = client
      .from("leads")
      .select("id,workspace_id,name,status,updated_at,updated_by_member_id,meta")
      .eq("workspace_id", workspaceId)
      .is("archived_at", null)
      .eq("active_pool", true)
      .in("status", LEAD_STATUS_ACTIVITY_OUTCOMES)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .range(from, from + LEAD_STATUS_EVENTS_PAGE_SIZE - 1);
    if (startAt) {
      query = query.gte("updated_at", startAt);
    }
    if (endBefore) {
      query = query.lt("updated_at", endBefore);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    const page = Array.isArray(data) ? data : [];
    if (!page.length) {
      break;
    }

    rows.push(...page);
    if (page.length < LEAD_STATUS_EVENTS_PAGE_SIZE) {
      break;
    }
    from += page.length;
  }

  const events = rows
    .flatMap((row) => {
      const mappedEvents = [];
      const statusEvent = mapLeadStatusFallbackRowToEvent(row, { memberNameMap, teamMemberById });
      if (LEAD_STATUS_ACTIVITY_OUTCOMES.includes(statusEvent.outcome) && statusEvent.occurredAt) {
        mappedEvents.push(statusEvent);
      }
      mappedEvents.push(
        ...mapLeadAttemptHistoryRowToEvents(row, {
          memberNameMap,
          teamMemberById,
          teamMemberByName
        })
      );
      return mappedEvents;
    })
    .filter((entry) => {
      if (!LEAD_STATUS_ACTIVITY_OUTCOMES.includes(entry.outcome) || !entry.occurredAt) {
        return false;
      }
      if (startAt && entry.occurredAt < startAt) {
        return false;
      }
      if (endBefore && entry.occurredAt >= endBefore) {
        return false;
      }
      return true;
    })
    .sort((left, right) => Date.parse(String(right?.occurredAt || "")) - Date.parse(String(left?.occurredAt || "")));

  return events;
}

async function fetchAllLeadSourceRows(client, workspaceId, options = {}) {
  const records = [];
  let from = 0;
  const scope = normalizeLeadListScope(options.scope, options.canManage);
  const currentUserId = normalizeText(options.currentUserId);
  const ownerFilter = normalizeLeadOwnerFilter(options.ownerFilter, options.canManage);

  while (true) {
    let query = createBaseLeadsQuery(client, workspaceId)
      .select("source")
      .order("source", { ascending: true })
      .range(from, from + CRM_SNAPSHOT_PAGE_SIZE - 1);
    query = applyBaseLeadsFilters(query, workspaceId);

    query = applyLeadScopeFilter(query, scope, currentUserId);
    query = applyLeadOwnerFilter(query, ownerFilter);

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    const page = Array.isArray(data) ? data : [];
    if (!page.length) {
      break;
    }

    records.push(...page);
    if (page.length < CRM_SNAPSHOT_PAGE_SIZE) {
      break;
    }
    from += page.length;
  }

  return records;
}

async function fetchReserveLeadCount(client, workspaceId, canManage) {
  if (!canManage) {
    return 0;
  }
  const { count, error } = await client
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("active_pool", false)
    .is("owner_member_id", null)
    .is("archived_at", null)
    .neq("status", "Archived");
  if (error) {
    throw error;
  }
  return Number(count || 0);
}

function normalizeReserveAccessValue(value) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, " ");
}

function isLeadershipAccessValue(value) {
  const normalized = normalizeReserveAccessValue(value);
  return normalized === "leadership" || normalized.includes("leadership");
}

function canViewReserveLeadCount(options = {}, canManage = false) {
  if (!canManage) {
    return false;
  }
  const currentUserId = normalizeText(options.currentUserId);
  const currentUserEmail = normalizeEmail(options.currentUserEmail);
  const currentUserName = normalizeReserveAccessValue(options.currentUserName);
  const directLeadershipFields = [
    options.currentUserRole,
    options.currentUserTeam,
    options.currentUserDepartment,
    options.currentUserTitle
  ];
  if (directLeadershipFields.some(isLeadershipAccessValue)) {
    return true;
  }
  const teamMembers = Array.isArray(options.teamMembers) ? options.teamMembers : [];
  const currentMember = (
    teamMembers.find((member) => currentUserId && normalizeText(member?.id) === currentUserId) ||
    teamMembers.find((member) => currentUserEmail && normalizeEmail(member?.email) === currentUserEmail) ||
    teamMembers.find((member) => currentUserName && normalizeReserveAccessValue(member?.name) === currentUserName) ||
    null
  );
  const leadershipFields = [
    currentMember?.team,
    currentMember?.department,
    currentMember?.title,
    currentMember?.role
  ];
  return leadershipFields.some(isLeadershipAccessValue);
}

export async function fetchSupabasePendingUnqualifiedLeads(workspaceId, options = {}) {
  const normalizedWorkspaceId = normalizeText(workspaceId);
  if (!normalizedWorkspaceId) {
    return [];
  }

  const client = getClient();
  const teamMembers = Array.isArray(options.teamMembers) ? options.teamMembers : [];
  const memberNameMap = buildMemberNameMap(teamMembers);
  const currentUserId = normalizeText(options.currentUserId);
  const canManage = LEAD_MANAGE_ROLES.has(normalizeText(options.currentUserRole));
  const canViewReserveCount = canViewReserveLeadCount(
    {
      ...options,
      teamMembers,
      currentUserId
    },
    canManage
  );
  const scope = normalizeLeadListScope(options.scope, canManage);
  const ownerFilter = normalizeLeadOwnerFilter(options.ownerFilter, canManage);
  const rows = [];
  let from = 0;

  while (true) {
    let query = createBaseLeadsQuery(client, normalizedWorkspaceId)
      .select(LEADS_PAGE_ROW_SELECT)
      .eq("status", "Unqualified")
      .order("updated_at", { ascending: false, nullsFirst: false })
      .range(from, from + CRM_SNAPSHOT_PAGE_SIZE - 1);
    query = applyBaseLeadsFilters(query, normalizedWorkspaceId);
    query = applyLeadScopeFilter(query, scope, currentUserId);
    query = applyLeadOwnerFilter(query, ownerFilter);

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    const page = Array.isArray(data) ? data : [];
    if (!page.length) {
      break;
    }

    rows.push(...page);
    if (page.length < CRM_SNAPSHOT_PAGE_SIZE) {
      break;
    }
    from += page.length;
  }

  const sharedContext = {
    memberNameMap,
    accountNameById: new Map(),
    contactNameById: new Map(),
    primaryContactByAccountId: new Map(),
    openDealCountByAccountId: new Map()
  };

  return rows.map((row) => mapLeadRow(row, sharedContext));
}

export async function fetchSupabaseAllUnqualifiedLeads(workspaceId, options = {}) {
  const normalizedWorkspaceId = normalizeText(workspaceId);
  if (!normalizedWorkspaceId) {
    return [];
  }

  const client = getClient();
  const teamMembers = Array.isArray(options.teamMembers) ? options.teamMembers : [];
  const memberNameMap = buildMemberNameMap(teamMembers);
  const rows = [];
  let from = 0;

  while (true) {
    let query = createBaseLeadsQuery(client, normalizedWorkspaceId)
      .select(LEADS_PAGE_ROW_SELECT)
      .eq("workspace_id", normalizedWorkspaceId)
      .eq("status", "Unqualified")
      .order("name", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })
      .range(from, from + CRM_SNAPSHOT_PAGE_SIZE - 1);

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    const page = Array.isArray(data) ? data : [];
    if (!page.length) {
      break;
    }

    rows.push(...page);
    if (page.length < CRM_SNAPSHOT_PAGE_SIZE) {
      break;
    }
    from += page.length;
  }

  const sharedContext = {
    memberNameMap,
    accountNameById: new Map(),
    contactNameById: new Map(),
    primaryContactByAccountId: new Map(),
    openDealCountByAccountId: new Map()
  };

  return rows.map((row) => mapLeadRow(row, sharedContext));
}

export async function fetchSupabasePendingAttemptLimitLeads(workspaceId, options = {}) {
  const normalizedWorkspaceId = normalizeText(workspaceId);
  if (!normalizedWorkspaceId) {
    return [];
  }

  const client = getClient();
  const teamMembers = Array.isArray(options.teamMembers) ? options.teamMembers : [];
  const memberNameMap = buildMemberNameMap(teamMembers);
  const currentUserId = normalizeText(options.currentUserId);
  const canManage = LEAD_MANAGE_ROLES.has(normalizeText(options.currentUserRole));
  const scope = normalizeLeadListScope(options.scope, canManage);
  const ownerFilter = normalizeLeadOwnerFilter(options.ownerFilter, canManage);
  const rows = [];
  let from = 0;

  while (true) {
    let query = createBaseLeadsQuery(client, normalizedWorkspaceId)
      .select(LEADS_PAGE_ROW_SELECT)
      .in("status", ["New", "Contacted"])
      .order("updated_at", { ascending: false, nullsFirst: false })
      .range(from, from + CRM_SNAPSHOT_PAGE_SIZE - 1);
    query = applyBaseLeadsFilters(query, normalizedWorkspaceId);
    query = applyLeadScopeFilter(query, scope, currentUserId);
    query = applyLeadOwnerFilter(query, ownerFilter);

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    const page = Array.isArray(data) ? data : [];
    if (!page.length) {
      break;
    }

    rows.push(...page);
    if (page.length < CRM_SNAPSHOT_PAGE_SIZE) {
      break;
    }
    from += page.length;
  }

  const sharedContext = {
    memberNameMap,
    accountNameById: new Map(),
    contactNameById: new Map(),
    primaryContactByAccountId: new Map(),
    openDealCountByAccountId: new Map()
  };

  return rows
    .map((row) => mapLeadRow(row, sharedContext))
    .filter((lead) => isLeadPendingAttemptLimitWeeklyRemoval(lead));
}

export async function fetchSupabasePendingFridayRedistributionLeads(workspaceId) {
  const normalizedWorkspaceId = normalizeText(workspaceId);
  if (!normalizedWorkspaceId) {
    return [];
  }

  const client = getClient();
  const rows = [];
  let from = 0;

  while (true) {
    let query = createBaseLeadsQuery(client, normalizedWorkspaceId)
      .select(LEADS_PAGE_ROW_SELECT)
      .eq("status", "New")
      .is("owner_member_id", null)
      .order("created_at", { ascending: true, nullsFirst: false })
      .range(from, from + CRM_SNAPSHOT_PAGE_SIZE - 1);
    query = applyBaseLeadsFilters(query, normalizedWorkspaceId);

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    const page = Array.isArray(data) ? data : [];
    if (!page.length) {
      break;
    }

    rows.push(...page);
    if (page.length < CRM_SNAPSHOT_PAGE_SIZE) {
      break;
    }
    from += page.length;
  }

  const sharedContext = {
    memberNameMap: buildMemberNameMap([]),
    accountNameById: new Map(),
    contactNameById: new Map(),
    primaryContactByAccountId: new Map(),
    openDealCountByAccountId: new Map()
  };

  return rows
    .map((row) => mapLeadRow(row, sharedContext))
    .filter((lead) => isLeadPendingFridayRedistribution(lead));
}

export async function fetchSupabaseCrmSnapshot(workspaceId, options = {}) {
  const normalizedWorkspaceId = normalizeText(workspaceId);
  if (!normalizedWorkspaceId) {
    return {
      accounts: [],
      contacts: [],
      leads: [],
      deals: []
    };
  }

  const client = getClient();
  const memberNameMap = buildMemberNameMap(options.teamMembers);

  const [accounts, contacts, leads, deals] = await Promise.all([
    fetchAllWorkspaceCrmRows(client, "accounts", normalizedWorkspaceId),
    fetchAllWorkspaceCrmRows(client, "contacts", normalizedWorkspaceId),
    fetchAllWorkspaceCrmRows(client, "leads", normalizedWorkspaceId),
    fetchAllWorkspaceCrmRows(client, "deals", normalizedWorkspaceId)
  ]);

  const accountNameById = new Map(
    accounts.map((row) => [normalizeText(row?.id), normalizeText(row?.name, "Untitled Account")])
  );
  const contactNameById = new Map(
    contacts.map((row) => [normalizeText(row?.id), normalizeText(row?.name, "Unnamed Contact")])
  );

  const primaryContactByAccountId = new Map();
  contacts.forEach((row) => {
    const accountId = normalizeText(row?.account_id);
    if (!accountId || primaryContactByAccountId.has(accountId)) {
      return;
    }
    primaryContactByAccountId.set(accountId, {
      id: normalizeText(row?.id),
      name: normalizeText(row?.name, "Unnamed Contact")
    });
  });

  const openDealCountByAccountId = new Map();
  deals.forEach((row) => {
    const accountId = normalizeText(row?.account_id);
    if (!accountId || Boolean(row?.archived_at) || !isOpenDealStage(row?.stage)) {
      return;
    }
    openDealCountByAccountId.set(accountId, Number(openDealCountByAccountId.get(accountId) || 0) + 1);
  });

  const sharedContext = {
    memberNameMap,
    accountNameById,
    contactNameById,
    primaryContactByAccountId,
    openDealCountByAccountId
  };

  return {
    accounts: accounts.map((row) => mapAccountRow(row, sharedContext)),
    contacts: contacts.map((row) => mapContactRow(row, sharedContext)),
    leads: leads.map((row) => mapLeadRow(row, sharedContext)),
    deals: deals.map((row) => mapDealRow(row, sharedContext))
  };
}

export async function fetchSupabaseLeadsPage(workspaceId, options = {}) {
  const normalizedWorkspaceId = normalizeText(workspaceId);
  if (!normalizedWorkspaceId) {
    return {
      rows: [],
      totalCount: 0,
      scope: "all",
      statusFilter: "all",
      dateFilter: "all",
      sourceFilter: "all",
      timezoneFilter: "all",
      ownerFilter: "all",
      page: 1,
      pageSize: LEADS_PAGE_SIZE_FALLBACK,
      sortKey: "",
      sortDir: "none",
      reserveCount: 0
    };
  }

  const client = getClient();
  const teamMembers = Array.isArray(options.teamMembers) ? options.teamMembers : [];
  const memberNameMap = buildMemberNameMap(teamMembers);
  const currentUserId = normalizeText(options.currentUserId);
  const canManage = LEAD_MANAGE_ROLES.has(normalizeText(options.currentUserRole));
  const scope = normalizeLeadListScope(options.scope, canManage);
  const includeMeta = options.includeMeta !== false;
  const statusFilter = normalizeLeadStatusFilter(options.statusFilter);
  const dateFilter = normalizeLeadDateFilter(options.dateFilter);
  const sourceFilter = normalizeText(options.sourceFilter, "all");
  const timezoneFilter = normalizeLeadTimezoneFilter(options.timezoneFilter);
  const ownerFilter = normalizeLeadOwnerFilter(options.ownerFilter, canManage);
  const page = Math.max(1, Number(options.page) || 1);
  const pageSize = Math.max(1, Number(options.pageSize) || LEADS_PAGE_SIZE_FALLBACK);
  const sortKey = normalizeText(options.sortKey);
  const sortColumn = normalizeLeadListSortColumn(sortKey);
  const sortDir = normalizeText(options.sortDir) === "desc" ? "desc" : normalizeText(options.sortDir) === "asc" ? "asc" : "none";
  const sortAscending = normalizeLeadListSortDirection(sortDir === "none" ? "asc" : sortDir) === "asc";
  const requestedCursor =
    options.cursor && typeof options.cursor === "object"
      ? {
          sortKey: normalizeText(options.cursor.sortKey),
          sortColumn: normalizeText(options.cursor.sortColumn),
          sortValue: normalizeText(options.cursor.sortValue),
          id: normalizeText(options.cursor.id)
        }
      : null;
  const cursorDirection = normalizeText(options.cursorDirection).toLowerCase() === "prev" ? "prev" : "next";
  const cursorUsable =
    requestedCursor &&
    requestedCursor.sortColumn === sortColumn &&
    requestedCursor.sortValue &&
    requestedCursor.id;

  let rowsQuery = includeMeta
    ? createBaseLeadsQuery(client, normalizedWorkspaceId).select(LEADS_PAGE_ROW_SELECT, { count: "exact" })
    : createBaseLeadsQuery(client, normalizedWorkspaceId).select(LEADS_PAGE_ROW_SELECT);
  rowsQuery = applyBaseLeadsFilters(rowsQuery, normalizedWorkspaceId);
  rowsQuery = applyLeadScopeFilter(rowsQuery, scope, currentUserId);
  rowsQuery = applyLeadStatusFilter(rowsQuery, statusFilter);
  rowsQuery = applyLeadDateFilter(rowsQuery, dateFilter);
  rowsQuery = applyLeadOwnerFilter(rowsQuery, ownerFilter);
  rowsQuery = applyLeadTimezoneFilter(rowsQuery, timezoneFilter);
  if (sourceFilter && sourceFilter !== "all") {
    rowsQuery = rowsQuery.eq("source", sourceFilter);
  }
  rowsQuery = applyLeadSearchFilter(rowsQuery, options.searchTerm);
  if (cursorUsable) {
    const queryAscending = cursorDirection === "prev" ? !sortAscending : sortAscending;
    const cursorClause = buildLeadCursorFilterClause(requestedCursor, sortAscending, cursorDirection);
    rowsQuery = rowsQuery
      .order(sortColumn, { ascending: queryAscending, nullsFirst: false })
      .order("id", { ascending: queryAscending });
    if (cursorClause) {
      rowsQuery = rowsQuery.or(cursorClause);
    }
    rowsQuery = rowsQuery.limit(pageSize + 1);
  } else {
    rowsQuery = rowsQuery
      .order(sortColumn, { ascending: sortAscending, nullsFirst: false })
      .order("id", { ascending: sortAscending })
      .range((page - 1) * pageSize, page * pageSize - 1);
  }

  const rowsResult = await rowsQuery;
  if (rowsResult.error) {
    throw rowsResult.error;
  }

  const sharedContext = {
    memberNameMap,
    accountNameById: new Map(),
    contactNameById: new Map(),
    primaryContactByAccountId: new Map(),
    openDealCountByAccountId: new Map()
  };

  const fetchedRows = Array.isArray(rowsResult.data) ? rowsResult.data : [];
  const pagedRows = cursorUsable && cursorDirection === "prev" ? [...fetchedRows].reverse() : fetchedRows;
  const hasExtraPage = cursorUsable ? fetchedRows.length > pageSize : pagedRows.length >= pageSize;
  const pageRows = hasExtraPage ? pagedRows.slice(0, pageSize) : pagedRows;
  let hasNextPage = false;
  let hasPreviousPage = false;
  if (cursorUsable && cursorDirection === "prev") {
    hasPreviousPage = hasExtraPage;
    hasNextPage = true;
  } else if (cursorUsable) {
    hasPreviousPage = page > 1;
    hasNextPage = hasExtraPage;
  } else {
    hasPreviousPage = page > 1;
    hasNextPage = hasExtraPage;
  }
  const rows = pageRows.map((row) => ({
    ...mapLeadRow(row, sharedContext),
    _lastTouchAt: normalizeIso(row?.updated_at || row?.created_at)
  }));
  const pageStartCursor = buildLeadPageCursorFromRow(pageRows[0], sortKey);
  const pageEndCursor = buildLeadPageCursorFromRow(pageRows[pageRows.length - 1], sortKey);
  let pendingUnqualifiedCount = 0;
  let dueUnqualifiedCount = 0;
  let reserveCount = 0;

  if (includeMeta && canManage) {
    const [pendingUnqualifiedLeads, fetchedReserveCount] = await Promise.all([
      fetchSupabasePendingUnqualifiedLeads(normalizedWorkspaceId, {
        teamMembers,
        currentUserId,
        currentUserRole: options.currentUserRole,
        scope,
        ownerFilter
      }),
      canViewReserveCount ? fetchReserveLeadCount(client, normalizedWorkspaceId, canManage) : 0
    ]);
    pendingUnqualifiedCount = pendingUnqualifiedLeads.filter((lead) => isLeadPendingWeeklyRemoval(lead)).length;
    dueUnqualifiedCount = pendingUnqualifiedLeads.filter((lead) => isLeadWeeklyRemovalDue(lead)).length;
    reserveCount = fetchedReserveCount;
  }

  return {
    rows,
    ...(includeMeta ? { totalCount: Number(rowsResult.count || 0) } : {}),
    scope,
    statusFilter,
    dateFilter,
    sourceFilter,
    timezoneFilter,
    ownerFilter,
    page,
    pageSize,
    sortKey,
    sortDir,
    hasMore: hasNextPage,
    hasPrevious: hasPreviousPage,
    hasNextPage,
    hasPreviousPage,
    pageStartCursor,
    pageEndCursor,
    pendingUnqualifiedCount,
    dueUnqualifiedCount,
    ...(includeMeta ? { reserveCount } : {})
  };
}

export async function fetchSupabaseLeadsPageMeta(workspaceId, options = {}) {
  const normalizedWorkspaceId = normalizeText(workspaceId);
  if (!normalizedWorkspaceId) {
    return {
      totalCount: 0,
      scopeCounts: { all: 0, mine: 0, unassigned: 0, assigned: 0 },
      reserveCount: 0,
      sourceOptions: [{ id: "all", label: "All" }],
      waitingItems: []
    };
  }

  const client = getClient();
  const teamMembers = Array.isArray(options.teamMembers) ? options.teamMembers : [];
  const memberNameMap = buildMemberNameMap(teamMembers);
  const currentUserId = normalizeText(options.currentUserId);
  const canManage = LEAD_MANAGE_ROLES.has(normalizeText(options.currentUserRole));
  const canViewReserveCount = canViewReserveLeadCount(
    {
      ...options,
      teamMembers,
      currentUserId
    },
    canManage
  );
  const scope = normalizeLeadListScope(options.scope, canManage);
  const statusFilter = normalizeLeadStatusFilter(options.statusFilter);
  const dateFilter = normalizeLeadDateFilter(options.dateFilter);
  const sourceFilter = normalizeText(options.sourceFilter, "all");
  const timezoneFilter = normalizeLeadTimezoneFilter(options.timezoneFilter);
  const ownerFilter = normalizeLeadOwnerFilter(options.ownerFilter, canManage);
  const searchTerm = normalizeText(options.searchTerm);

  const countQuery = (countScope) => {
    let query = createBaseLeadsQuery(client, normalizedWorkspaceId).select("id", { count: "exact", head: true });
    query = applyBaseLeadsFilters(query, normalizedWorkspaceId);
    query = applyLeadScopeFilter(query, countScope, currentUserId);
    query = applyLeadOwnerFilter(query, ownerFilter);
    return query;
  };

  const filteredCountQuery = (() => {
    let query = createBaseLeadsQuery(client, normalizedWorkspaceId).select("id", { count: "exact", head: true });
    query = applyBaseLeadsFilters(query, normalizedWorkspaceId);
    query = applyLeadScopeFilter(query, scope, currentUserId);
    query = applyLeadStatusFilter(query, statusFilter);
    query = applyLeadDateFilter(query, dateFilter);
    query = applyLeadOwnerFilter(query, ownerFilter);
    query = applyLeadTimezoneFilter(query, timezoneFilter);
    if (sourceFilter && sourceFilter !== "all") {
      query = query.eq("source", sourceFilter);
    }
    query = applyLeadSearchFilter(query, searchTerm);
    return query;
  })();

  const waitingQuery = (() => {
    let query = createBaseLeadsQuery(client, normalizedWorkspaceId)
      .select("id,name,company_name,owner_member_id,next_follow_up_date")
      .not("next_follow_up_date", "is", null)
      .order("next_follow_up_date", { ascending: true, nullsFirst: false })
      .limit(24);
    query = applyBaseLeadsFilters(query, normalizedWorkspaceId);
    query = applyLeadScopeFilter(query, scope, currentUserId);
    query = applyLeadOwnerFilter(query, ownerFilter);
    return query;
  })();

  const [
    filteredCountResult,
    allCountResult,
    mineCountResult,
    unassignedCountResult,
    assignedCountResult,
    sourceRows,
    reserveCount,
    waitingResult
  ] =
    await Promise.all([
      filteredCountQuery,
      countQuery("all"),
      countQuery("mine"),
      countQuery("unassigned"),
      countQuery("assigned"),
      fetchAllLeadSourceRows(client, normalizedWorkspaceId, {
        scope,
        canManage,
        currentUserId,
        ownerFilter
      }),
      canViewReserveCount ? fetchReserveLeadCount(client, normalizedWorkspaceId, canManage) : 0,
      waitingQuery
    ]);

  if (allCountResult.error) {
    throw allCountResult.error;
  }
  if (mineCountResult.error) {
    throw mineCountResult.error;
  }
  if (unassignedCountResult.error) {
    throw unassignedCountResult.error;
  }
  if (assignedCountResult.error) {
    throw assignedCountResult.error;
  }
  if (waitingResult.error) {
    throw waitingResult.error;
  }

  const waitingItems = (Array.isArray(waitingResult.data) ? waitingResult.data : []).map((row) => ({
    id: normalizeText(row?.id),
    title:
      [normalizeText(row?.name), normalizeText(row?.company_name)]
        .filter(Boolean)
        .join(" | ") || "Lead",
    owner: resolveOwnerName(row?.owner_member_id, memberNameMap) || "Unassigned",
    linkedType: `Due ${normalizeDateOnly(row?.next_follow_up_date)}`
  }));

  const sourceOptions = [
    { id: "all", label: "All" },
    ...Array.from(
      new Set(
        (Array.isArray(sourceRows) ? sourceRows : [])
          .map((row) => normalizeText(row?.source))
          .filter(Boolean)
      )
    )
      .sort((left, right) => left.localeCompare(right))
      .map((source) => ({
        id: source,
        label: source
      }))
  ];

  return {
    totalCount: Number(filteredCountResult.count || 0),
    scopeCounts: {
      all: Number(allCountResult.count || 0),
      mine: Number(mineCountResult.count || 0),
      unassigned: Number(unassignedCountResult.count || 0),
      assigned: Number(assignedCountResult.count || 0)
    },
    reserveCount,
    sourceOptions,
    waitingItems
  };
}

function dedupeRowsById(rows = []) {
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const id = normalizeText(row?.id);
    if (!id || map.has(id)) {
      return;
    }
    map.set(id, row);
  });
  return [...map.values()];
}

function buildCrmSharedContext(teamMembers = [], accountRows = [], contactRows = [], dealRows = []) {
  const memberNameMap = buildMemberNameMap(teamMembers);
  const accountNameById = new Map(
    (Array.isArray(accountRows) ? accountRows : []).map((row) => [
      normalizeText(row?.id),
      normalizeText(row?.name, "Untitled Account")
    ])
  );
  const contactNameById = new Map(
    (Array.isArray(contactRows) ? contactRows : []).map((row) => [
      normalizeText(row?.id),
      normalizeText(row?.name, "Unnamed Contact")
    ])
  );
  const primaryContactByAccountId = new Map();
  (Array.isArray(contactRows) ? contactRows : []).forEach((row) => {
    const accountId = normalizeText(row?.account_id);
    if (!accountId || primaryContactByAccountId.has(accountId)) {
      return;
    }
    primaryContactByAccountId.set(accountId, {
      id: normalizeText(row?.id),
      name: normalizeText(row?.name, "Unnamed Contact")
    });
  });
  const openDealCountByAccountId = new Map();
  (Array.isArray(dealRows) ? dealRows : []).forEach((row) => {
    const accountId = normalizeText(row?.account_id);
    if (!accountId || Boolean(row?.archived_at) || !isOpenDealStage(row?.stage)) {
      return;
    }
    openDealCountByAccountId.set(accountId, Number(openDealCountByAccountId.get(accountId) || 0) + 1);
  });

  return {
    memberNameMap,
    accountNameById,
    contactNameById,
    primaryContactByAccountId,
    openDealCountByAccountId
  };
}

async function fetchFirstWorkspaceRow(client, table, workspaceId, matchers = []) {
  for (const matcher of matchers) {
    if (typeof matcher !== "function") {
      continue;
    }
    let query = client.from(table).select("*").eq("workspace_id", workspaceId).limit(1);
    query = matcher(query);
    const { data, error } = await query;
    if (error) {
      throw error;
    }
    const row = Array.isArray(data) ? data[0] || null : null;
    if (row) {
      return row;
    }
  }
  return null;
}

export async function fetchSupabaseLeadProfileBundle(workspaceId, leadId, options = {}) {
  const normalizedWorkspaceId = normalizeText(workspaceId);
  const normalizedLeadId = normalizeText(leadId);
  if (!normalizedWorkspaceId || !normalizedLeadId) {
    return {
      lead: null,
      accounts: [],
      contacts: [],
      deals: []
    };
  }

  const client = getClient();
  const leadResult = await client
    .from("leads")
    .select("*")
    .eq("workspace_id", normalizedWorkspaceId)
    .eq("id", normalizedLeadId)
    .eq("active_pool", true)
    .limit(1);
  if (leadResult.error) {
    throw leadResult.error;
  }
  const leadRow = Array.isArray(leadResult.data) ? leadResult.data[0] || null : null;
  if (!leadRow) {
    return {
      lead: null,
      accounts: [],
      contacts: [],
      deals: []
    };
  }

  const leadMeta = normalizeMeta(leadRow?.meta);
  const directAccountId = normalizeText(leadRow?.account_id || leadRow?.converted_account_id);
  const leadCompanyName = normalizeText(leadRow?.company_name || leadMeta.companyName);
  const leadName = normalizeText(leadRow?.name);
  const leadEmail = normalizeEmail(leadRow?.email);

  const accountRow = await fetchFirstWorkspaceRow(client, "accounts", normalizedWorkspaceId, [
    directAccountId ? (query) => query.eq("id", directAccountId).is("archived_at", null) : null,
    leadCompanyName ? (query) => query.eq("name", leadCompanyName).is("archived_at", null) : null
  ]);

  const resolvedAccountId = normalizeText(accountRow?.id || directAccountId);
  const contactQueries = [];
  if (resolvedAccountId) {
    contactQueries.push(
      client
        .from("contacts")
        .select("*")
        .eq("workspace_id", normalizedWorkspaceId)
        .eq("account_id", resolvedAccountId)
        .is("archived_at", null)
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(24)
    );
  }
  if (leadName) {
    contactQueries.push(
      client
        .from("contacts")
        .select("*")
        .eq("workspace_id", normalizedWorkspaceId)
        .eq("name", leadName)
        .is("archived_at", null)
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(12)
    );
  }
  if (leadEmail) {
    contactQueries.push(
      client
        .from("contacts")
        .select("*")
        .eq("workspace_id", normalizedWorkspaceId)
        .eq("email", leadEmail)
        .is("archived_at", null)
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(12)
    );
  }

  const convertedDealId = normalizeText(leadRow?.converted_deal_id);
  const dealQueries = [];
  if (resolvedAccountId) {
    dealQueries.push(
      client
        .from("deals")
        .select("*")
        .eq("workspace_id", normalizedWorkspaceId)
        .eq("account_id", resolvedAccountId)
        .is("archived_at", null)
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(20)
    );
  }
  if (convertedDealId) {
    dealQueries.push(
      client
        .from("deals")
        .select("*")
        .eq("workspace_id", normalizedWorkspaceId)
        .eq("id", convertedDealId)
        .is("archived_at", null)
        .limit(1)
    );
  }

  const [contactResults, dealResults] = await Promise.all([
    Promise.all(contactQueries),
    Promise.all(dealQueries)
  ]);

  const contactRows = [];
  contactResults.forEach((result) => {
    if (result?.error) {
      throw result.error;
    }
    if (Array.isArray(result?.data)) {
      contactRows.push(...result.data);
    }
  });

  const dealRows = [];
  dealResults.forEach((result) => {
    if (result?.error) {
      throw result.error;
    }
    if (Array.isArray(result?.data)) {
      dealRows.push(...result.data);
    }
  });

  const accountRows = accountRow ? [accountRow] : [];
  const dedupedContactRows = dedupeRowsById(contactRows);
  const dedupedDealRows = dedupeRowsById(dealRows);
  const sharedContext = buildCrmSharedContext(options.teamMembers, accountRows, dedupedContactRows, dedupedDealRows);

  return {
    lead: mapLeadRow(leadRow, sharedContext),
    accounts: accountRows.map((row) => mapAccountRow(row, sharedContext)),
    contacts: dedupedContactRows.map((row) => mapContactRow(row, sharedContext)),
    deals: dedupedDealRows.map((row) => mapDealRow(row, sharedContext))
  };
}

export async function fetchSupabaseContactProfileBundle(workspaceId, contactId, options = {}) {
  const normalizedWorkspaceId = normalizeText(workspaceId);
  const normalizedContactId = normalizeText(contactId);
  if (!normalizedWorkspaceId || !normalizedContactId) {
    return {
      contact: null,
      accounts: [],
      contacts: [],
      leads: [],
      deals: []
    };
  }

  const client = getClient();
  const contactResult = await client
    .from("contacts")
    .select("*")
    .eq("workspace_id", normalizedWorkspaceId)
    .eq("id", normalizedContactId)
    .limit(1);
  if (contactResult.error) {
    throw contactResult.error;
  }
  const contactRow = Array.isArray(contactResult.data) ? contactResult.data[0] || null : null;
  if (!contactRow) {
    return {
      contact: null,
      accounts: [],
      contacts: [],
      leads: [],
      deals: []
    };
  }

  const contactMeta = normalizeMeta(contactRow?.meta);
  const directAccountId = normalizeText(contactRow?.account_id);
  const contactAccountName = normalizeText(contactMeta.accountName);
  const contactName = normalizeText(contactRow?.name);
  const contactEmail = normalizeEmail(contactRow?.email);

  const accountRow = await fetchFirstWorkspaceRow(client, "accounts", normalizedWorkspaceId, [
    directAccountId ? (query) => query.eq("id", directAccountId).is("archived_at", null) : null,
    contactAccountName ? (query) => query.eq("name", contactAccountName).is("archived_at", null) : null
  ]);

  const resolvedAccountId = normalizeText(accountRow?.id || directAccountId);
  const resolvedAccountName = normalizeText(accountRow?.name || contactAccountName);

  const leadQueries = [];
  if (resolvedAccountId) {
    leadQueries.push(
      client
        .from("leads")
        .select("*")
        .eq("workspace_id", normalizedWorkspaceId)
        .eq("account_id", resolvedAccountId)
        .eq("active_pool", true)
        .is("archived_at", null)
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(24)
    );
  }
  if (resolvedAccountName) {
    leadQueries.push(
      client
        .from("leads")
        .select("*")
        .eq("workspace_id", normalizedWorkspaceId)
        .eq("company_name", resolvedAccountName)
        .eq("active_pool", true)
        .is("archived_at", null)
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(24)
    );
  }
  if (contactName) {
    leadQueries.push(
      client
        .from("leads")
        .select("*")
        .eq("workspace_id", normalizedWorkspaceId)
        .eq("name", contactName)
        .eq("active_pool", true)
        .is("archived_at", null)
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(12)
    );
  }
  if (contactEmail) {
    leadQueries.push(
      client
        .from("leads")
        .select("*")
        .eq("workspace_id", normalizedWorkspaceId)
        .eq("email", contactEmail)
        .eq("active_pool", true)
        .is("archived_at", null)
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(12)
    );
  }

  const dealQueries = [];
  if (resolvedAccountId) {
    dealQueries.push(
      client
        .from("deals")
        .select("*")
        .eq("workspace_id", normalizedWorkspaceId)
        .eq("account_id", resolvedAccountId)
        .is("archived_at", null)
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(20)
    );
  }

  const [leadResults, dealResults] = await Promise.all([
    Promise.all(leadQueries),
    Promise.all(dealQueries)
  ]);

  const leadRows = [];
  leadResults.forEach((result) => {
    if (result?.error) {
      throw result.error;
    }
    if (Array.isArray(result?.data)) {
      leadRows.push(...result.data);
    }
  });

  const dealRows = [];
  dealResults.forEach((result) => {
    if (result?.error) {
      throw result.error;
    }
    if (Array.isArray(result?.data)) {
      dealRows.push(...result.data);
    }
  });

  const accountRows = accountRow ? [accountRow] : [];
  const contactRows = [contactRow];
  const dedupedLeadRows = dedupeRowsById(leadRows);
  const dedupedDealRows = dedupeRowsById(dealRows);
  const sharedContext = buildCrmSharedContext(options.teamMembers, accountRows, contactRows, dedupedDealRows);

  return {
    contact: mapContactRow(contactRow, sharedContext),
    accounts: accountRows.map((row) => mapAccountRow(row, sharedContext)),
    contacts: contactRows.map((row) => mapContactRow(row, sharedContext)),
    leads: dedupedLeadRows.map((row) => mapLeadRow(row, sharedContext)),
    deals: dedupedDealRows.map((row) => mapDealRow(row, sharedContext))
  };
}

export async function fetchSupabaseAccountProfileBundle(workspaceId, accountId, options = {}) {
  const normalizedWorkspaceId = normalizeText(workspaceId);
  const normalizedAccountId = normalizeText(accountId);
  if (!normalizedWorkspaceId || !normalizedAccountId) {
    return {
      account: null,
      accounts: [],
      contacts: [],
      deals: []
    };
  }

  const client = getClient();
  const accountResult = await client
    .from("accounts")
    .select("*")
    .eq("workspace_id", normalizedWorkspaceId)
    .eq("id", normalizedAccountId)
    .limit(1);
  if (accountResult.error) {
    throw accountResult.error;
  }
  const accountRow = Array.isArray(accountResult.data) ? accountResult.data[0] || null : null;
  if (!accountRow) {
    return {
      account: null,
      accounts: [],
      contacts: [],
      deals: []
    };
  }

  const [contactResult, dealResult] = await Promise.all([
    client
      .from("contacts")
      .select("*")
      .eq("workspace_id", normalizedWorkspaceId)
      .eq("account_id", normalizedAccountId)
      .is("archived_at", null)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(24),
    client
      .from("deals")
      .select("*")
      .eq("workspace_id", normalizedWorkspaceId)
      .eq("account_id", normalizedAccountId)
      .is("archived_at", null)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(24)
  ]);

  if (contactResult.error) {
    throw contactResult.error;
  }
  if (dealResult.error) {
    throw dealResult.error;
  }

  const accountRows = [accountRow];
  const contactRows = dedupeRowsById(Array.isArray(contactResult.data) ? contactResult.data : []);
  const dealRows = dedupeRowsById(Array.isArray(dealResult.data) ? dealResult.data : []);
  const sharedContext = buildCrmSharedContext(options.teamMembers, accountRows, contactRows, dealRows);

  return {
    account: mapAccountRow(accountRow, sharedContext),
    accounts: accountRows.map((row) => mapAccountRow(row, sharedContext)),
    contacts: contactRows.map((row) => mapContactRow(row, sharedContext)),
    deals: dealRows.map((row) => mapDealRow(row, sharedContext))
  };
}

export async function fetchSupabaseDealProfileBundle(workspaceId, dealId, options = {}) {
  const normalizedWorkspaceId = normalizeText(workspaceId);
  const normalizedDealId = normalizeText(dealId);
  if (!normalizedWorkspaceId || !normalizedDealId) {
    return {
      deal: null,
      accounts: [],
      contacts: [],
      deals: []
    };
  }

  const client = getClient();
  const dealResult = await client
    .from("deals")
    .select("*")
    .eq("workspace_id", normalizedWorkspaceId)
    .eq("id", normalizedDealId)
    .limit(1);
  if (dealResult.error) {
    throw dealResult.error;
  }
  const dealRow = Array.isArray(dealResult.data) ? dealResult.data[0] || null : null;
  if (!dealRow) {
    return {
      deal: null,
      accounts: [],
      contacts: [],
      deals: []
    };
  }

  const dealMeta = normalizeMeta(dealRow?.meta);
  const directAccountId = normalizeText(dealRow?.account_id);
  const dealAccountName = normalizeText(dealMeta.accountName);
  const accountRow = await fetchFirstWorkspaceRow(client, "accounts", normalizedWorkspaceId, [
    directAccountId ? (query) => query.eq("id", directAccountId).is("archived_at", null) : null,
    dealAccountName ? (query) => query.eq("name", dealAccountName).is("archived_at", null) : null
  ]);

  const resolvedAccountId = normalizeText(accountRow?.id || directAccountId);
  let contactRows = [];
  if (resolvedAccountId) {
    const contactResult = await client
      .from("contacts")
      .select("*")
      .eq("workspace_id", normalizedWorkspaceId)
      .eq("account_id", resolvedAccountId)
      .is("archived_at", null)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(24);
    if (contactResult.error) {
      throw contactResult.error;
    }
    contactRows = Array.isArray(contactResult.data) ? contactResult.data : [];
  }

  const accountRows = accountRow ? [accountRow] : [];
  const dealRows = [dealRow];
  const dedupedContactRows = dedupeRowsById(contactRows);
  const sharedContext = buildCrmSharedContext(options.teamMembers, accountRows, dedupedContactRows, dealRows);

  return {
    deal: mapDealRow(dealRow, sharedContext),
    accounts: accountRows.map((row) => mapAccountRow(row, sharedContext)),
    contacts: dedupedContactRows.map((row) => mapContactRow(row, sharedContext)),
    deals: dealRows.map((row) => mapDealRow(row, sharedContext))
  };
}

export async function fetchSupabaseLeadStatusEvents(workspaceId, options = {}) {
  const normalizedWorkspaceId = normalizeText(workspaceId);
  if (!normalizedWorkspaceId) {
    return {
      events: [],
      sourceKind: "events"
    };
  }

  const client = getClient();
  const fetchOptions = {
    teamMembers: Array.isArray(options.teamMembers) ? options.teamMembers : [],
    startAt: normalizeIso(options.startAt),
    endBefore: normalizeIso(options.endBefore),
    timeZone: normalizeText(options.timeZone, "UTC"),
    shiftStart: normalizeText(options.shiftStart, "09:00"),
    shiftEnd: normalizeText(options.shiftEnd, "18:00")
  };

  try {
    const events = await fetchLeadShiftActivityFromRpc(client, normalizedWorkspaceId, fetchOptions);
    return {
      events: Array.isArray(events) ? events : [],
      sourceKind: "shift-rpc"
    };
  } catch (error) {
    if (!isMissingCallsPerformanceShiftRpc(error)) {
      throw error;
    }
  }

  try {
    const events = await fetchLeadStatusEventsFromEventTable(client, normalizedWorkspaceId, fetchOptions);
    return {
      events: Array.isArray(events) ? events : [],
      sourceKind: "events"
    };
  } catch (error) {
    if (!isMissingLeadStatusEventsRelation(error)) {
      throw error;
    }
  }

  const events = await fetchLeadStatusEventsFromLeadsFallback(client, normalizedWorkspaceId, fetchOptions);
  return {
    events,
    sourceKind: "leads-fallback"
  };
}

async function insertCrmRow(table, payload) {
  const client = getClient();
  const { data, error } = await client.from(table).insert(payload).select("*").single();
  if (error) {
    throw error;
  }
  return data;
}

async function updateCrmRow(table, recordId, payload) {
  const client = getClient();
  const { data, error } = await client.from(table).update(payload).eq("id", recordId).select("*").single();
  if (error) {
    throw error;
  }
  return data;
}

async function deleteCrmRow(table, recordId) {
  const client = getClient();
  const { error } = await client.from(table).delete().eq("id", recordId);
  if (error) {
    throw error;
  }
}

export function createSupabaseAccount(payload) {
  return insertCrmRow("accounts", payload);
}

export function updateSupabaseAccount(accountId, payload) {
  return updateCrmRow("accounts", accountId, payload);
}

export function deleteSupabaseAccount(accountId) {
  return deleteCrmRow("accounts", accountId);
}

export function createSupabaseContact(payload) {
  return insertCrmRow("contacts", payload);
}

export function updateSupabaseContact(contactId, payload) {
  return updateCrmRow("contacts", contactId, payload);
}

export function deleteSupabaseContact(contactId) {
  return deleteCrmRow("contacts", contactId);
}

export function createSupabaseLead(payload) {
  return insertCrmRow("leads", payload);
}

export function updateSupabaseLead(leadId, payload) {
  return updateCrmRow("leads", leadId, payload);
}

export function deleteSupabaseLead(leadId) {
  return deleteCrmRow("leads", leadId);
}

export function createSupabaseDeal(payload) {
  return insertCrmRow("deals", payload);
}

export function updateSupabaseDeal(dealId, payload) {
  return updateCrmRow("deals", dealId, payload);
}

export function deleteSupabaseDeal(dealId) {
  return deleteCrmRow("deals", dealId);
}

export async function commitSupabaseLeadImport(payload) {
  const response = await invokeSupabaseFunction("lead-import-commit", {
    method: "POST",
    body: payload
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.ok === false) {
    throw new Error(String(result?.error || `Request failed (${response.status})`));
  }
  return result;
}

export async function createSupabaseLeadImportJob(payload) {
  const response = await invokeSupabaseFunction("lead-import-jobs", {
    method: "POST",
    body: payload
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.ok === false) {
    throw new Error(String(result?.error || `Request failed (${response.status})`));
  }
  return result?.job || null;
}

export async function fetchSupabaseLeadImportJob(workspaceId, jobId) {
  const response = await invokeSupabaseFunction("lead-import-jobs", {
    method: "GET",
    query: {
      workspaceId: normalizeText(workspaceId),
      jobId: normalizeText(jobId)
    }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.ok === false) {
    throw new Error(String(result?.error || `Request failed (${response.status})`));
  }
  return result?.job || null;
}
