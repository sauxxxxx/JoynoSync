import { initSupabase } from "./init.js";

const PROFILE_IMAGE_BUCKET = "profile-images";
const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_PROFILE_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const PROFILE_IMAGE_EXTENSION_BY_MIME = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp"
};

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
  return normalizeText(value).toLowerCase();
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["true", "t", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "f", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function normalizeInteger(value, fallback = 0, minimum = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Math.max(minimum, fallback);
  }
  return Math.max(minimum, Math.round(numeric));
}

function normalizeBoundedInteger(value, fallback = 0, minimum = 0, maximum = 100) {
  return Math.min(maximum, normalizeInteger(value, fallback, minimum));
}

function normalizeTimeText(value, fallback = "09:00") {
  const text = normalizeText(value, fallback);
  return text.slice(0, 5) || fallback;
}

function normalizeBusinessDays(value) {
  const source = Array.isArray(value) ? value : [];
  const normalized = [...new Set(source.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 0 && item <= 6))];
  return normalized.length ? normalized : [1, 2, 3, 4, 5];
}

function sanitizeStorageSegment(value, fallback = "file") {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || fallback;
}

function isExternalAssetUrl(value) {
  const normalized = normalizeText(value);
  return /^(https?:)?\/\//i.test(normalized) || /^data:/i.test(normalized) || /^blob:/i.test(normalized);
}

function getProfileImageExtension(file) {
  const name = normalizeText(file?.name);
  const extension = name.includes(".") ? name.split(".").pop().trim().toLowerCase() : "";
  if (extension) {
    return extension;
  }
  return PROFILE_IMAGE_EXTENSION_BY_MIME[normalizeText(file?.type)] || "jpg";
}

function normalizeAvailability(value) {
  const normalized = normalizeText(value, "Online").toLowerCase();
  if (normalized === "away") {
    return "Away";
  }
  if (normalized === "offline") {
    return "Offline";
  }
  return "Online";
}

function normalizeScope(value, role = "Member") {
  const normalized = normalizeText(value).toLowerCase();
  if (["own", "team", "all"].includes(normalized)) {
    return normalized;
  }
  const normalizedRole = normalizeText(role, "Member").toLowerCase();
  if (normalizedRole === "owner" || normalizedRole === "admin") {
    return "all";
  }
  if (normalizedRole === "manager") {
    return "team";
  }
  return "own";
}

function normalizeJsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch (_error) {
      return {};
    }
  }
  return {};
}

function normalizeNotifications(value) {
  const source = normalizeJsonObject(value);
  return {
    inApp: source.inApp === undefined ? true : normalizeBoolean(source.inApp, true),
    email: source.email === undefined ? true : normalizeBoolean(source.email, true),
    sms: normalizeBoolean(source.sms, false)
  };
}

function normalizeCommunication(value, fallbackName = "User") {
  const source = normalizeJsonObject(value);
  return {
    senderName: normalizeText(source.senderName, fallbackName || "User"),
    signature: normalizeText(source.signature)
  };
}

function normalizePermissions(value) {
  return normalizeJsonObject(value);
}

function mapWorkspaceRow(row) {
  if (!row || typeof row !== "object") {
    return null;
  }
  const rawLogoValue = normalizeText(row.logo_url || row.logoUrl);
  const logoStoragePath = rawLogoValue && !isExternalAssetUrl(rawLogoValue) ? rawLogoValue : "";
  return {
    id: normalizeText(row.id),
    name: normalizeText(row.name, "Workspace"),
    legalName: normalizeText(row.legal_name || row.legalName || row.name, "Workspace LLC"),
    logoUrl: logoStoragePath ? "" : rawLogoValue,
    logoStoragePath,
    brandColor: normalizeText(row.brand_color || row.brandColor, "#2f68df"),
    appLabel: normalizeText(row.app_label || row.appLabel || row.name, "Workspace"),
    timezone: normalizeText(row.timezone, "Local"),
    dateFormat: normalizeText(row.date_format || row.dateFormat, "YYYY-MM-DD"),
    currency: normalizeText(row.currency, "USD"),
    weekStart: normalizeText(row.week_start || row.weekStart, "Mon"),
    businessStart: normalizeTimeText(row.business_start || row.businessStart, "09:00"),
    businessEnd: normalizeTimeText(row.business_end || row.businessEnd, "18:00"),
    businessDays: normalizeBusinessDays(row.business_days || row.businessDays),
    website: normalizeText(row.website),
    supportEmail: normalizeText(row.support_email || row.supportEmail),
    supportPhone: normalizeText(row.support_phone || row.supportPhone),
    businessAddress: normalizeText(row.business_address || row.businessAddress),
    crmDefaultStage: normalizeText(row.crm_default_stage || row.crmDefaultStage, "Prospecting"),
    crmDefaultOwner: normalizeText(row.crm_default_owner || row.crmDefaultOwner),
    crmSlaHours: normalizeInteger(row.crm_sla_hours ?? row.crmSlaHours, 24, 0),
    crmFollowUpDays: normalizeInteger(row.crm_follow_up_days ?? row.crmFollowUpDays, 2, 0),
    createdAt: normalizeText(row.created_at || row.createdAt),
    updatedAt: normalizeText(row.updated_at || row.updatedAt)
  };
}

function mapTeamMemberRow(row) {
  if (!row || typeof row !== "object") {
    return null;
  }
  const name = String(row.name || "").trim();
  const role = String(row.role || "Member").trim() || "Member";
  const rawAvatarValue = normalizeText(row.avatar_url || row.avatarUrl);
  const avatarStoragePath = rawAvatarValue && !isExternalAssetUrl(rawAvatarValue) ? rawAvatarValue : "";
  return {
    id: String(row.id || "").trim(),
    workspaceId: String(row.workspace_id || "").trim(),
    name,
    email: normalizeEmail(row.email),
    phone: normalizeText(row.phone),
    title: normalizeText(row.title),
    avatarUrl: avatarStoragePath ? "" : rawAvatarValue,
    avatarStoragePath,
    role,
    team: String(row.team || "General").trim() || "General",
    timezone: String(row.timezone || "Local").trim() || "Local",
    language: normalizeText(row.language, "English"),
    availability: normalizeAvailability(row.availability),
    status: String(row.status || "Pending Invite").trim() || "Pending Invite",
    manager: normalizeText(row.manager),
    shift: normalizeText(row.shift, "09:00-18:00"),
    workload: normalizeBoundedInteger(row.workload, 0, 0, 100),
    scope: normalizeScope(row.scope, role),
    queueEligible: normalizeBoolean(row.queue_eligible ?? row.queueEligible, true),
    defaultOwner: normalizeBoolean(row.default_owner ?? row.defaultOwner, false),
    notifications: normalizeNotifications(row.notifications),
    communication: normalizeCommunication(row.communication, name || normalizeEmail(row.email) || "User"),
    permissions: normalizePermissions(row.permissions),
    inviteToken: String(row.invite_token || "").trim(),
    invitedAt: String(row.invited_at || "").trim(),
    inviteLastSentAt: String(row.invite_last_sent_at || "").trim(),
    authProvider: String(row.auth_provider || "").trim(),
    authUserId: String(row.auth_user_id || "").trim(),
    lastLoginAt: String(row.last_login_at || "").trim(),
    updatedAt: String(row.updated_at || "").trim(),
    updatedBy: normalizeText(row.updated_by_name || row.updatedBy)
  };
}

function teamMemberStatusRank(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "active") {
    return 0;
  }
  if (normalized === "pending invite" || normalized === "pending_invite" || normalized === "invited") {
    return 1;
  }
  if (normalized === "inactive") {
    return 2;
  }
  return 3;
}

function choosePreferredTeamMemberRow(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    return null;
  }
  return [...rows].sort((left, right) => {
    const statusDiff = teamMemberStatusRank(left?.status) - teamMemberStatusRank(right?.status);
    if (statusDiff !== 0) {
      return statusDiff;
    }
    const updatedLeft = Date.parse(String(left?.updated_at || left?.invite_last_sent_at || left?.invited_at || ""));
    const updatedRight = Date.parse(String(right?.updated_at || right?.invite_last_sent_at || right?.invited_at || ""));
    const safeLeft = Number.isFinite(updatedLeft) ? updatedLeft : 0;
    const safeRight = Number.isFinite(updatedRight) ? updatedRight : 0;
    return safeRight - safeLeft;
  })[0];
}

function toTeamMemberInsertRow(member) {
  const name = String(member.name || "").trim();
  return {
    workspace_id: String(member.workspaceId || "").trim(),
    name,
    email: normalizeEmail(member.email),
    phone: normalizeText(member.phone),
    title: normalizeText(member.title),
    avatar_url: normalizeText(member.avatarUrl),
    role: String(member.role || "Member").trim() || "Member",
    team: String(member.team || "General").trim() || "General",
    timezone: String(member.timezone || "Local").trim() || "Local",
    language: normalizeText(member.language, "English"),
    availability: normalizeAvailability(member.availability),
    status: String(member.status || "Pending Invite").trim() || "Pending Invite",
    manager: normalizeText(member.manager),
    shift: normalizeText(member.shift, "09:00-18:00"),
    workload: normalizeBoundedInteger(member.workload, 0, 0, 100),
    scope: normalizeScope(member.scope, member.role),
    queue_eligible: normalizeBoolean(member.queueEligible, true),
    default_owner: normalizeBoolean(member.defaultOwner, false),
    notifications: normalizeNotifications(member.notifications),
    communication: normalizeCommunication(member.communication, name || normalizeEmail(member.email) || "User"),
    permissions: normalizePermissions(member.permissions),
    invite_token: String(member.inviteToken || "").trim(),
    invited_at: member.invitedAt || null,
    invite_last_sent_at: member.inviteLastSentAt || null,
    auth_provider: String(member.authProvider || "").trim(),
    auth_user_id: member.authUserId || null,
    last_login_at: member.lastLoginAt || null,
    updated_by_name: normalizeText(member.updatedBy),
    updated_at: member.updatedAt || new Date().toISOString()
  };
}

function toTeamMemberUpdateRow(patch) {
  const next = {};
  if (Object.hasOwn(patch, "name")) {
    next.name = String(patch.name || "").trim();
  }
  if (Object.hasOwn(patch, "email")) {
    next.email = normalizeEmail(patch.email);
  }
  if (Object.hasOwn(patch, "phone")) {
    next.phone = normalizeText(patch.phone);
  }
  if (Object.hasOwn(patch, "title")) {
    next.title = normalizeText(patch.title);
  }
  if (Object.hasOwn(patch, "avatarUrl")) {
    next.avatar_url = normalizeText(patch.avatarUrl);
  }
  if (Object.hasOwn(patch, "role")) {
    next.role = String(patch.role || "Member").trim() || "Member";
  }
  if (Object.hasOwn(patch, "team")) {
    next.team = String(patch.team || "General").trim() || "General";
  }
  if (Object.hasOwn(patch, "timezone")) {
    next.timezone = String(patch.timezone || "Local").trim() || "Local";
  }
  if (Object.hasOwn(patch, "language")) {
    next.language = normalizeText(patch.language, "English");
  }
  if (Object.hasOwn(patch, "availability")) {
    next.availability = normalizeAvailability(patch.availability);
  }
  if (Object.hasOwn(patch, "status")) {
    next.status = String(patch.status || "Pending Invite").trim() || "Pending Invite";
  }
  if (Object.hasOwn(patch, "manager")) {
    next.manager = normalizeText(patch.manager);
  }
  if (Object.hasOwn(patch, "shift")) {
    next.shift = normalizeText(patch.shift, "09:00-18:00");
  }
  if (Object.hasOwn(patch, "workload")) {
    next.workload = normalizeBoundedInteger(patch.workload, 0, 0, 100);
  }
  if (Object.hasOwn(patch, "scope")) {
    next.scope = normalizeScope(patch.scope, patch.role);
  }
  if (Object.hasOwn(patch, "queueEligible")) {
    next.queue_eligible = normalizeBoolean(patch.queueEligible, true);
  }
  if (Object.hasOwn(patch, "defaultOwner")) {
    next.default_owner = normalizeBoolean(patch.defaultOwner, false);
  }
  if (Object.hasOwn(patch, "notifications")) {
    next.notifications = normalizeNotifications(patch.notifications);
  }
  if (Object.hasOwn(patch, "communication")) {
    next.communication = normalizeCommunication(patch.communication, patch.name || "User");
  }
  if (Object.hasOwn(patch, "permissions")) {
    next.permissions = normalizePermissions(patch.permissions);
  }
  if (Object.hasOwn(patch, "inviteToken")) {
    next.invite_token = String(patch.inviteToken || "").trim();
  }
  if (Object.hasOwn(patch, "invitedAt")) {
    next.invited_at = patch.invitedAt || null;
  }
  if (Object.hasOwn(patch, "inviteLastSentAt")) {
    next.invite_last_sent_at = patch.inviteLastSentAt || null;
  }
  if (Object.hasOwn(patch, "authProvider")) {
    next.auth_provider = String(patch.authProvider || "").trim();
  }
  if (Object.hasOwn(patch, "authUserId")) {
    next.auth_user_id = patch.authUserId || null;
  }
  if (Object.hasOwn(patch, "lastLoginAt")) {
    next.last_login_at = patch.lastLoginAt || null;
  }
  if (Object.hasOwn(patch, "updatedBy")) {
    next.updated_by_name = normalizeText(patch.updatedBy);
  }
  next.updated_at = patch.updatedAt || new Date().toISOString();
  return next;
}

function validateProfileImageFile(file) {
  if (!(file instanceof File)) {
    throw new Error("Profile image is not a valid file.");
  }
  if (file.size > MAX_PROFILE_IMAGE_BYTES) {
    throw new Error("Profile image exceeds the 5 MB limit.");
  }
  const mimeType = normalizeText(file.type);
  if (!mimeType || !ALLOWED_PROFILE_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new Error("Profile image must be a PNG, JPG, or WEBP file.");
  }
}

async function hydrateTeamMemberAsset(member) {
  if (!member) {
    return null;
  }
  if (!member.avatarStoragePath) {
    return member;
  }
  try {
    const signedUrl = await createSupabaseProfileImageSignedUrl(member.avatarStoragePath, 3600);
    return {
      ...member,
      avatarUrl: signedUrl || ""
    };
  } catch (_error) {
    return {
      ...member,
      avatarUrl: ""
    };
  }
}

async function hydrateWorkspaceAsset(workspace) {
  if (!workspace) {
    return null;
  }
  if (!workspace.logoStoragePath) {
    return workspace;
  }
  try {
    const signedUrl = await createSupabaseProfileImageSignedUrl(workspace.logoStoragePath, 3600);
    return {
      ...workspace,
      logoUrl: signedUrl || ""
    };
  } catch (_error) {
    return {
      ...workspace,
      logoUrl: ""
    };
  }
}

async function hydrateTeamMemberRows(rows) {
  const members = Array.isArray(rows) ? rows.map(mapTeamMemberRow).filter(Boolean) : [];
  return Promise.all(members.map(hydrateTeamMemberAsset));
}

function toWorkspaceUpdateRow(patch) {
  const next = {};
  if (Object.hasOwn(patch, "name")) {
    next.name = normalizeText(patch.name, "Workspace");
  }
  if (Object.hasOwn(patch, "legalName")) {
    next.legal_name = normalizeText(patch.legalName);
  }
  if (Object.hasOwn(patch, "logoUrl") || Object.hasOwn(patch, "logoStoragePath")) {
    next.logo_url = normalizeText(patch.logoStoragePath || patch.logoUrl);
  }
  if (Object.hasOwn(patch, "brandColor")) {
    next.brand_color = normalizeText(patch.brandColor, "#2f68df");
  }
  if (Object.hasOwn(patch, "appLabel")) {
    next.app_label = normalizeText(patch.appLabel);
  }
  if (Object.hasOwn(patch, "timezone")) {
    next.timezone = normalizeText(patch.timezone, "Local");
  }
  if (Object.hasOwn(patch, "dateFormat")) {
    next.date_format = normalizeText(patch.dateFormat, "YYYY-MM-DD");
  }
  if (Object.hasOwn(patch, "currency")) {
    next.currency = normalizeText(patch.currency, "USD");
  }
  if (Object.hasOwn(patch, "weekStart")) {
    next.week_start = normalizeText(patch.weekStart, "Mon");
  }
  if (Object.hasOwn(patch, "businessStart")) {
    next.business_start = normalizeTimeText(patch.businessStart, "09:00");
  }
  if (Object.hasOwn(patch, "businessEnd")) {
    next.business_end = normalizeTimeText(patch.businessEnd, "18:00");
  }
  if (Object.hasOwn(patch, "businessDays")) {
    next.business_days = normalizeBusinessDays(patch.businessDays);
  }
  if (Object.hasOwn(patch, "website")) {
    next.website = normalizeText(patch.website);
  }
  if (Object.hasOwn(patch, "supportEmail")) {
    next.support_email = normalizeText(patch.supportEmail);
  }
  if (Object.hasOwn(patch, "supportPhone")) {
    next.support_phone = normalizeText(patch.supportPhone);
  }
  if (Object.hasOwn(patch, "businessAddress")) {
    next.business_address = normalizeText(patch.businessAddress);
  }
  if (Object.hasOwn(patch, "crmDefaultStage")) {
    next.crm_default_stage = normalizeText(patch.crmDefaultStage, "Prospecting");
  }
  if (Object.hasOwn(patch, "crmDefaultOwner")) {
    next.crm_default_owner = normalizeText(patch.crmDefaultOwner);
  }
  if (Object.hasOwn(patch, "crmSlaHours")) {
    next.crm_sla_hours = normalizeInteger(patch.crmSlaHours, 24, 0);
  }
  if (Object.hasOwn(patch, "crmFollowUpDays")) {
    next.crm_follow_up_days = normalizeInteger(patch.crmFollowUpDays, 2, 0);
  }
  return next;
}

export async function fetchWorkspaceTeamMemberByEmail(workspaceId, email) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedWorkspaceId = String(workspaceId || "").trim();
  if (!normalizedWorkspaceId || !normalizedEmail) {
    return null;
  }
  const client = getClient();
  const { data, error } = await client
    .from("team_members")
    .select("*")
    .eq("workspace_id", normalizedWorkspaceId)
    .eq("email", normalizedEmail)
    .order("updated_at", { ascending: false });

  if (error) {
    throw error;
  }

  return hydrateTeamMemberAsset(mapTeamMemberRow(choosePreferredTeamMemberRow(data)));
}

export async function fetchWorkspaceBundleByEmail(email, options = {}) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return { workspace: null, member: null, teamMembers: [] };
  }
  const client = getClient();
  const includeTeamMembers = options.includeTeamMembers !== false;

  const { data: memberRows, error: memberError } = await client
    .from("team_members")
    .select("*")
    .eq("email", normalizedEmail)
    .order("updated_at", { ascending: false });

  if (memberError) {
    throw memberError;
  }
  const memberRow = choosePreferredTeamMemberRow(memberRows);
  if (!memberRow) {
    return { workspace: null, member: null, teamMembers: [] };
  }

  const workspaceId = String(memberRow.workspace_id || "").trim();
  const workspacePromise = client.from("workspaces").select("*").eq("id", workspaceId).limit(1).maybeSingle();
  const teamPromise = includeTeamMembers
    ? client.from("team_members").select("*").eq("workspace_id", workspaceId).order("name", { ascending: true })
    : Promise.resolve({ data: null, error: null });
  const [{ data: workspaceRow, error: workspaceError }, { data: teamRows, error: teamError }] = await Promise.all([
    workspacePromise,
    teamPromise
  ]);

  if (workspaceError) {
    throw workspaceError;
  }
  if (teamError) {
    throw teamError;
  }

  const member = await hydrateTeamMemberAsset(mapTeamMemberRow(memberRow));
  const teamMembers = includeTeamMembers ? await hydrateTeamMemberRows(teamRows) : member ? [member] : [];

  return {
    workspace: await hydrateWorkspaceAsset(mapWorkspaceRow(workspaceRow)),
    member,
    teamMembers
  };
}

export async function createSupabaseTeamInvite(member) {
  const client = getClient();
  const payload = toTeamMemberInsertRow(member);
  const { data, error } = await client.from("team_members").insert(payload).select("*").single();
  if (error) {
    throw error;
  }
  return hydrateTeamMemberAsset(mapTeamMemberRow(data));
}

export async function updateSupabaseTeamMember(memberId, patch) {
  const client = getClient();
  const payload = toTeamMemberUpdateRow(patch);
  const { data, error } = await client.from("team_members").update(payload).eq("id", memberId).select("*").single();
  if (error) {
    throw error;
  }
  return hydrateTeamMemberAsset(mapTeamMemberRow(data));
}

export async function deleteSupabaseTeamMember(memberId) {
  const client = getClient();
  const { error } = await client.from("team_members").delete().eq("id", memberId);
  if (error) {
    throw error;
  }
}

export async function updateSupabaseWorkspace(workspaceId, patch) {
  const client = getClient();
  const payload = toWorkspaceUpdateRow(patch);
  const { data, error } = await client.from("workspaces").update(payload).eq("id", normalizeText(workspaceId)).select("*").single();
  if (error) {
    throw error;
  }
  return hydrateWorkspaceAsset(mapWorkspaceRow(data));
}

export async function createSupabaseProfileImageSignedUrl(storagePath, expiresInSeconds = 3600) {
  const client = getClient();
  const normalizedStoragePath = normalizeText(storagePath);
  if (!normalizedStoragePath) {
    return "";
  }
  const ttl = Math.max(60, normalizeInteger(expiresInSeconds, 3600, 60));
  const { data, error } = await client.storage.from(PROFILE_IMAGE_BUCKET).createSignedUrl(normalizedStoragePath, ttl);
  if (error) {
    throw error;
  }
  return normalizeText(data?.signedUrl);
}

export async function uploadSupabaseProfileImage(workspaceId, memberId, file) {
  const client = getClient();
  const normalizedWorkspaceId = normalizeText(workspaceId);
  const normalizedMemberId = normalizeText(memberId);
  if (!normalizedWorkspaceId || !normalizedMemberId) {
    throw new Error("Workspace and member are required for profile image upload.");
  }
  validateProfileImageFile(file);

  const extension = getProfileImageExtension(file);
  const storagePath = [
    sanitizeStorageSegment(normalizedWorkspaceId, "workspace"),
    sanitizeStorageSegment(normalizedMemberId, "member"),
    `${Date.now()}-${sanitizeStorageSegment(file.name || `avatar.${extension}`, "avatar")}`
  ].join("/");

  const { error } = await client.storage.from(PROFILE_IMAGE_BUCKET).upload(storagePath, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: normalizeText(file.type, "application/octet-stream")
  });
  if (error) {
    throw error;
  }

  return {
    storagePath,
    signedUrl: await createSupabaseProfileImageSignedUrl(storagePath, 600).catch(() => "")
  };
}

export async function uploadSupabaseWorkspaceLogo(workspaceId, file) {
  const client = getClient();
  const normalizedWorkspaceId = normalizeText(workspaceId);
  if (!normalizedWorkspaceId) {
    throw new Error("Workspace is required for logo upload.");
  }
  validateProfileImageFile(file);

  const extension = getProfileImageExtension(file);
  const storagePath = [
    sanitizeStorageSegment(normalizedWorkspaceId, "workspace"),
    "branding",
    `${Date.now()}-${sanitizeStorageSegment(file.name || `logo.${extension}`, "logo")}`
  ].join("/");

  const { error } = await client.storage.from(PROFILE_IMAGE_BUCKET).upload(storagePath, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: normalizeText(file.type, "application/octet-stream")
  });
  if (error) {
    throw error;
  }

  return {
    storagePath,
    signedUrl: await createSupabaseProfileImageSignedUrl(storagePath, 600).catch(() => "")
  };
}

export async function deleteSupabaseProfileImage(storagePath) {
  const client = getClient();
  const normalizedStoragePath = normalizeText(storagePath);
  if (!normalizedStoragePath) {
    return;
  }
  const { error } = await client.storage.from(PROFILE_IMAGE_BUCKET).remove([normalizedStoragePath]);
  if (error) {
    throw error;
  }
}

export async function deleteSupabaseWorkspaceLogo(storagePath) {
  return deleteSupabaseProfileImage(storagePath);
}
