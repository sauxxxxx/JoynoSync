import { createId } from "../data/store.js";
import { normalizeSystemAppLabel } from "../config/branding.js";
import { PROFILE_PERMISSION_ACTIONS, PROFILE_PERMISSION_MODULES, PROFILE_SCOPE_OPTIONS } from "../config/options.js";

function normalizeTimeValue(value, fallback = "09:00") {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return fallback;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return fallback;
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function resolveCurrentUserId(data) {
  const currentUserId = String(data?.currentUser?.id || "").trim();
  if (currentUserId) {
    return currentUserId;
  }
  const currentName = String(data?.currentUser?.name || "").trim().toLowerCase();
  if (!currentName) {
    return "";
  }
  const matchedMember = (data?.teamMembers || []).find(
    (member) => String(member.name || "").trim().toLowerCase() === currentName
  );
  if (matchedMember?.id) {
    return String(matchedMember.id).trim();
  }
  return currentName.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function resolveCurrentUserName(data) {
  return String(data?.currentUser?.name || "").trim() || "User";
}

export function resolveCurrentUserRole(data) {
  const directRole = String(data?.currentUser?.role || "").trim();
  if (directRole) {
    return directRole;
  }
  const currentName = resolveCurrentUserName(data).toLowerCase();
  const memberRole =
    (data?.teamMembers || []).find((member) => String(member.name || "").trim().toLowerCase() === currentName)?.role || "";
  return String(memberRole || "Member").trim() || "Member";
}

export function normalizeTeamMemberStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "Pending Invite";
  }
  if (normalized === "active") {
    return "Active";
  }
  if (normalized === "inactive") {
    return "Inactive";
  }
  if (normalized === "pending invite" || normalized === "pending_invite" || normalized === "invited") {
    return "Pending Invite";
  }
  return "Pending Invite";
}

export function isTeamMemberPendingInvite(value) {
  return normalizeTeamMemberStatus(value) === "Pending Invite";
}

export function canManageTeamMembersByRole(role) {
  const normalized = String(role || "").trim().toLowerCase();
  return normalized === "owner" || normalized === "admin";
}

export function defaultPermissionValueByRole(role, action, moduleId) {
  const normalizedRole = String(role || "member").trim().toLowerCase();
  if (normalizedRole === "owner" || normalizedRole === "admin") {
    return true;
  }
  if (normalizedRole === "manager") {
    if (moduleId === "settings" && (action === "delete" || action === "export")) {
      return false;
    }
    if (moduleId === "team" && action === "delete") {
      return false;
    }
    return true;
  }
  if (normalizedRole === "guest") {
    return action === "view" && ["dashboard", "projects", "messenger", "calls", "sms", "email"].includes(moduleId);
  }
  if (moduleId === "team" || moduleId === "settings") {
    return action === "view";
  }
  if (action === "view") {
    return true;
  }
  if (action === "create" || action === "edit") {
    return !["dashboard", "settings"].includes(moduleId);
  }
  return false;
}

export function buildPermissionTemplate(role) {
  const template = {};
  PROFILE_PERMISSION_MODULES.forEach((module) => {
    template[module.id] = {};
    PROFILE_PERMISSION_ACTIONS.forEach((action) => {
      template[module.id][action] = defaultPermissionValueByRole(role, action, module.id);
    });
  });
  return template;
}

export function normalizeMemberPermissions(member) {
  const source = member?.permissions && typeof member.permissions === "object" ? member.permissions : {};
  const fallback = buildPermissionTemplate(member?.role || "Member");
  const normalized = {};
  PROFILE_PERMISSION_MODULES.forEach((module) => {
    const existing = source[module.id] && typeof source[module.id] === "object" ? source[module.id] : {};
    normalized[module.id] = {};
    PROFILE_PERMISSION_ACTIONS.forEach((action) => {
      const fallbackValue = Boolean(fallback[module.id]?.[action]);
      normalized[module.id][action] = existing[action] === undefined ? fallbackValue : Boolean(existing[action]);
    });
  });
  return normalized;
}

export function memberHasPermission(member, moduleId, action = "view") {
  const normalizedModuleId = String(moduleId || "").trim().toLowerCase();
  const normalizedAction = String(action || "view").trim().toLowerCase();
  if (!normalizedModuleId || !normalizedAction) {
    return false;
  }
  const permissions = normalizeMemberPermissions(member);
  return Boolean(permissions?.[normalizedModuleId]?.[normalizedAction]);
}

export function normalizeWorkspaceBusinessDays(value, fallback = [1, 2, 3, 4, 5]) {
  const source = Array.isArray(value) ? value : fallback;
  const days = source
    .map((day) => Number(day))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  return days.length ? [...new Set(days)] : [1, 2, 3, 4, 5];
}

export function ensureProfileCollections(data, options = {}) {
  const defaultAttendancePolicy =
    typeof options.defaultAttendancePolicy === "function"
      ? options.defaultAttendancePolicy
      : () => ({
          shiftStart: "09:00",
          shiftEnd: "18:00",
          timezone: "Local",
          workDays: [1, 2, 3, 4, 5]
        });

  if (!data.workspace || typeof data.workspace !== "object") {
    data.workspace = {};
  }
  if (!data.currentUser || typeof data.currentUser !== "object") {
    data.currentUser = {};
  }
  if (!Array.isArray(data.teamMembers)) {
    data.teamMembers = [];
  }
  if (!data.attendancePolicy || typeof data.attendancePolicy !== "object") {
    data.attendancePolicy = defaultAttendancePolicy();
  }

  const workspaceDefaults = {
    id: String(data.workspace.id || "ws_demo"),
    name: String(data.workspace.name || "Workspace"),
    legalName: String(data.workspace.legalName || data.workspace.name || "Workspace LLC"),
    logoUrl: String(data.workspace.logoUrl || ""),
    logoStoragePath: String(data.workspace.logoStoragePath || ""),
    brandColor: String(data.workspace.brandColor || "#2f68df"),
    appLabel: normalizeSystemAppLabel(data.workspace.appLabel),
    timezone: String(data.workspace.timezone || data.attendancePolicy.timezone || "Local"),
    dateFormat: String(data.workspace.dateFormat || "YYYY-MM-DD"),
    currency: String(data.workspace.currency || "USD"),
    weekStart: String(data.workspace.weekStart || "Mon"),
    businessStart: normalizeTimeValue(data.workspace.businessStart, data.attendancePolicy.shiftStart || "09:00"),
    businessEnd: normalizeTimeValue(data.workspace.businessEnd, data.attendancePolicy.shiftEnd || "18:00"),
    businessDays: normalizeWorkspaceBusinessDays(data.workspace.businessDays, data.attendancePolicy.workDays),
    website: String(data.workspace.website || ""),
    supportEmail: String(data.workspace.supportEmail || ""),
    supportPhone: String(data.workspace.supportPhone || ""),
    businessAddress: String(data.workspace.businessAddress || ""),
    crmDefaultStage: String(data.workspace.crmDefaultStage || "Prospecting"),
    crmDefaultOwner: String(data.workspace.crmDefaultOwner || resolveCurrentUserName(data)),
    crmSlaHours: Math.max(0, Number(data.workspace.crmSlaHours || 24) || 24),
    crmFollowUpDays: Math.max(0, Number(data.workspace.crmFollowUpDays || 2) || 2)
  };
  data.workspace = {
    ...data.workspace,
    ...workspaceDefaults
  };

  const currentMemberById = data.teamMembers.find((member) => String(member.id || "").trim() === String(data.currentUser.id || "").trim());
  const currentMemberByName = data.teamMembers.find(
    (member) => String(member.name || "").trim().toLowerCase() === String(data.currentUser.name || "").trim().toLowerCase()
  );
  const currentMember = currentMemberById || currentMemberByName || null;
  const securityDefaults = data.currentUser.security && typeof data.currentUser.security === "object" ? data.currentUser.security : {};
  const memberNotifications =
    currentMember?.notifications && typeof currentMember.notifications === "object" ? currentMember.notifications : {};
  const notifyDefaults =
    data.currentUser.notifications && typeof data.currentUser.notifications === "object" ? data.currentUser.notifications : memberNotifications;
  const memberCommunication =
    currentMember?.communication && typeof currentMember.communication === "object" ? currentMember.communication : {};
  const communicationDefaults =
    data.currentUser.communication && typeof data.currentUser.communication === "object" ? data.currentUser.communication : memberCommunication;
  const defaultProfileSignature = `Best,\n${String(data.currentUser.name || currentMember?.name || "User")}\n${String(data.currentUser.title || "").trim()}`.trim();

  data.currentUser = {
    ...data.currentUser,
    id: String(data.currentUser.id || currentMember?.id || "u_01"),
    name: String(data.currentUser.name || currentMember?.name || "User"),
    role: String(data.currentUser.role || currentMember?.role || "Member"),
    email: String(data.currentUser.email || currentMember?.email || ""),
    phone: String(data.currentUser.phone || currentMember?.phone || ""),
    title: String(data.currentUser.title || currentMember?.title || ""),
    avatarUrl: String(data.currentUser.avatarUrl || currentMember?.avatarUrl || ""),
    avatarStoragePath: String(data.currentUser.avatarStoragePath || currentMember?.avatarStoragePath || ""),
    timezone: String(data.currentUser.timezone || currentMember?.timezone || data.workspace.timezone || "Local"),
    language: String(data.currentUser.language || currentMember?.language || "English"),
    availability: String(data.currentUser.availability || currentMember?.availability || "Online"),
    communication: {
      senderName: String(communicationDefaults.senderName || data.currentUser.name || currentMember?.name || "User"),
      signature: communicationDefaults.signature === undefined ? defaultProfileSignature : String(communicationDefaults.signature)
    },
    notifications: {
      inApp: notifyDefaults.inApp === undefined ? true : Boolean(notifyDefaults.inApp),
      email: notifyDefaults.email === undefined ? true : Boolean(notifyDefaults.email),
      sms: Boolean(notifyDefaults.sms)
    },
    scope: PROFILE_SCOPE_OPTIONS.includes(String(currentMember?.scope || data.currentUser.scope || "").toLowerCase())
      ? String(currentMember?.scope || data.currentUser.scope || "").toLowerCase()
      : String(data.currentUser.role || currentMember?.role || "Member").trim().toLowerCase() === "manager"
        ? "team"
        : ["owner", "admin"].includes(String(data.currentUser.role || currentMember?.role || "Member").trim().toLowerCase())
          ? "all"
          : "own",
    permissions: normalizeMemberPermissions(currentMember || data.currentUser),
    security: {
      activeSessions: Math.max(1, Number(securityDefaults.activeSessions || 1) || 1),
      lastPasswordChange: String(securityDefaults.lastPasswordChange || ""),
      twoFactorRequired: Boolean(securityDefaults.twoFactorRequired)
    }
  };

  const normalizedMembers = [];
  data.teamMembers.forEach((member) => {
    if (!member || typeof member !== "object") {
      return;
    }
    const role = String(member.role || "Member").trim() || "Member";
    const status = normalizeTeamMemberStatus(member.status || "Pending Invite");
    normalizedMembers.push({
      ...member,
      id: String(member.id || createId("member")),
      name: String(member.name || "Unnamed Member"),
      email: String(member.email || ""),
      team: String(member.team || "General"),
      role,
      workload: Math.max(0, Math.min(100, Number(member.workload || 0))),
      status,
      phone: String(member.phone || ""),
      title: String(member.title || ""),
      avatarUrl: String(member.avatarUrl || ""),
      avatarStoragePath: String(member.avatarStoragePath || ""),
      manager: String(member.manager || ""),
      timezone: String(member.timezone || data.workspace.timezone || "Local"),
      language: String(member.language || "English"),
      availability: String(member.availability || "Online"),
      shift: String(member.shift || `${data.attendancePolicy.shiftStart}-${data.attendancePolicy.shiftEnd}`),
      scope: PROFILE_SCOPE_OPTIONS.includes(String(member.scope || "").toLowerCase())
        ? String(member.scope || "").toLowerCase()
        : role.toLowerCase() === "owner" || role.toLowerCase() === "admin"
          ? "all"
          : role.toLowerCase() === "manager"
            ? "team"
            : "own",
      queueEligible: member.queueEligible === undefined ? true : Boolean(member.queueEligible),
      defaultOwner: member.defaultOwner === undefined ? false : Boolean(member.defaultOwner),
      invitedAt: String(member.invitedAt || ""),
      inviteLastSentAt: String(member.inviteLastSentAt || member.invitedAt || ""),
      inviteToken: String(member.inviteToken || ""),
      authProvider: String(member.authProvider || ""),
      authUserId: String(member.authUserId || ""),
      lastLoginAt: String(member.lastLoginAt || ""),
      updatedAt: String(member.updatedAt || ""),
      updatedBy: String(member.updatedBy || ""),
      notifications:
        member.notifications && typeof member.notifications === "object"
          ? {
              inApp: member.notifications.inApp === undefined ? true : Boolean(member.notifications.inApp),
              email: member.notifications.email === undefined ? true : Boolean(member.notifications.email),
              sms: Boolean(member.notifications.sms)
            }
          : {
              inApp: true,
              email: true,
              sms: false
            },
      communication:
        member.communication && typeof member.communication === "object"
          ? {
              senderName: String(member.communication.senderName || member.name || "User"),
              signature: String(member.communication.signature || "")
            }
          : {
              senderName: String(member.name || "User"),
              signature: ""
            },
      permissions: normalizeMemberPermissions(member)
    });
  });
  data.teamMembers = normalizedMembers;
}
